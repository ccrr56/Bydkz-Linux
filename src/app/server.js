'use strict';

/**
 * 手机 APP 对接 HTTP 服务
 * 路由：
 *   GET /byd?id=<指令>&sign=<控车密码MD5>   主接口（与官方 EXE 协议一致）
 *   GET /gps                               轨迹页占位（二期实现）
 *   GET /                                  服务状态
 */

const http = require('http');
const { dispatch } = require('./mappings');
const { md5Hex } = require('../byd/crypto');

function createServer(ctx) {
  const { cfg, log } = ctx;
  const expectedSign = cfg.controlPin ? md5Hex(cfg.controlPin).toLowerCase() : null;

  function checkSign(sign) {
    if (!cfg.requireSign) return true;
    if (!expectedSign) return false;
    return String(sign || '').toLowerCase() === expectedSign;
  }

  // ---------------- 防爆破 ----------------
  // sign = MD5(6位PIN) 空间仅 10^6，公网暴露时必须限速锁定，否则几分钟可被穷举
  const MAX_FAILS = Number(cfg.authMaxFails) || 10;
  const LOCK_MS = Number(cfg.authLockMs) || 30 * 60 * 1000;
  const failMap = new Map(); // ip -> { count, lockedUntil }
  let lastPrune = 0;

  function clientIp(req) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return fwd || req.socket.remoteAddress || 'unknown';
  }

  function authGate(req) {
    const now = Date.now();
    if (now - lastPrune > 10 * 60 * 1000) {
      lastPrune = now;
      for (const [ip, rec] of failMap) {
        if (rec.lockedUntil < now && now - rec.lockedUntil > LOCK_MS) failMap.delete(ip);
      }
    }
    const ip = clientIp(req);
    const rec = failMap.get(ip);
    if (rec && rec.lockedUntil > now) {
      return { blocked: true, ip, retryAfterS: Math.ceil((rec.lockedUntil - now) / 1000) };
    }
    return { blocked: false, ip };
  }

  function authFail(ip) {
    const now = Date.now();
    const rec = failMap.get(ip) || { count: 0, lockedUntil: 0 };
    rec.count += 1;
    if (rec.count >= MAX_FAILS) {
      rec.lockedUntil = now + LOCK_MS;
      rec.count = 0;
      log.error(`安全告警：IP ${ip} 连续 ${MAX_FAILS} 次 sign 校验失败，已锁定 ${LOCK_MS / 60000} 分钟`);
    }
    failMap.set(ip, rec);
  }

  function authOk(ip) {
    failMap.delete(ip);
  }

  return http.createServer(async (req, res) => {
    const started = Date.now();

    const sendJson = (obj, status = 200) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(obj));
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      });
      res.end();
      return;
    }

    try {
      const u = new URL(req.url, 'http://local');
      const pathname = u.pathname;

      if (pathname === '/') {
        return sendJson({
          ok: true,
          service: 'bydkz-linux',
          version: '0.1.0',
          vin: ctx.vin,
          msg: 'Bydkz Linux 车控服务运行中',
        });
      }

      if (pathname !== '/byd' && pathname !== '/gps') {
        return sendJson({ ret: 404, msg: 'not found' });
      }

      const id = u.searchParams.get('id') || (pathname === '/gps' ? 'gps' : '');
      const sign = u.searchParams.get('sign') || '';

      const gate = authGate(req);
      if (gate.blocked) {
        log.warn(`拒绝请求：IP ${gate.ip} 已锁定（剩余 ${gate.retryAfterS}s）`);
        return sendJson({ ret: 429, msg: '尝试次数过多，已临时锁定' });
      }

      if (!checkSign(sign)) {
        authFail(gate.ip);
        log.warn(`拒绝请求：sign 校验失败 (id=${id} ip=${gate.ip})`);
        return sendJson({ ret: 403, msg: 'sign 校验失败' });
      }
      authOk(gate.ip);
      if (!id) {
        return sendJson({ ret: 400, msg: '缺少 id 参数' });
      }

      const result = await dispatch(id, ctx);
      log.debug(`[${id}] → ${JSON.stringify(result).slice(0, 160)} (${Date.now() - started}ms)`);
      return sendJson(result);
    } catch (err) {
      log.error(`请求处理失败：${err && err.stack ? err.stack : err}`);
      return sendJson({ ret: 500, msg: `服务异常：${err.message}` });
    }
  });
}

module.exports = { createServer };
