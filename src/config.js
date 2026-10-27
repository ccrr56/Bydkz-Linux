'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function loadConfig(file) {
  const p = file || process.env.BYDKZ_CONFIG || DEFAULT_CONFIG_PATH;
  if (!fs.existsSync(p)) {
    throw new Error(`配置文件不存在：${p}\n请先执行：cp config.example.json config.json 并填写账号信息`);
  }
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));

  const cfg = {
    // ---- 账号 ----
    username: String(raw.username || '').trim(),
    password: String(raw.password || ''),
    controlPin: String(raw.controlPin || '').trim(),
    vin: String(raw.vin || '').trim(),

    // ---- 服务 ----
    port: Number(raw.port || 8889),
    host: raw.host || '0.0.0.0',
    requireSign: raw.requireSign !== false,

    // ---- 行为参数 ----
    statusCacheMs: Number(raw.statusCacheMs || 15000),
    backgroundRefreshMs: Number(raw.backgroundRefreshMs || 60000),
    climateTimeSpan: Number(raw.climateTimeSpan || 1),
    // 0 = 不主动过期重登（推荐）：仅云端报会话失效才重登，减少踢手机端次数
    loginIntervalHours: raw.loginIntervalHours !== undefined && raw.loginIntervalHours !== null
      ? Number(raw.loginIntervalHours)
      : 0,
    // 登录失败后的冷却时间（ms），防崩溃循环反复登录踢手机端
    loginRetryCooldownMs: Number(raw.loginRetryCooldownMs || 60000),
    // 会话持久化文件（token+cookie），重启服务时复用，避免重新登录
    sessionFile: raw.sessionFile || path.join(__dirname, '..', 'data', 'session.json'),
    requestTimeoutMs: Number(raw.requestTimeoutMs || 25000),
    // 防爆破：sign 连续失败 N 次锁定 IP（默认 10 次锁 30 分钟）
    authMaxFails: Number(raw.authMaxFails || 10),
    authLockMs: Number(raw.authLockMs || 30 * 60 * 1000),
    logLevel: raw.logLevel || 'info',
    tencentMapKey: String(raw.tencentMapKey || ''),

    // ---- 云端对接（一般无需修改）----
    // 默认值已按官方 EXE v2.1.5_RC 实测可用模板校准（2026-10-27 登录/列表/车况全链路验证通过）
    baseUrl: raw.baseUrl || 'https://dilinksuperappserver-cn.byd.auto',
    appChannel: '99',
    cnAppInnerVersion: raw.cnAppInnerVersion || '511',
    cnAppVersion: raw.cnAppVersion || '9.11.1',
    targetBrand: raw.targetBrand || '1',
    vehicleBrand: raw.vehicleBrand || '1',
    networkOperator: raw.networkOperator || '无',
    networkType: raw.networkType || 'wifi',
    osVersion: raw.osVersion || '11',
    deviceType: '0',
    softType: '0',
    tboxVersion: '3',
    mobileBrand: raw.mobileBrand || 'XIAOMI',
    mobileModel: raw.mobileModel || 'POCO F1',
    imeiMD5: raw.imeiMD5 || 'ad921d60486366258809553a3db49a4a', // md5('unknown')，与 EXE 一致
    ostype: 'and',
    imei: raw.imei || 'unknown',
    mac: raw.mac || 'unknown',
    model: raw.model || 'unknown',
    sdk: raw.sdk || 'unknown',
    mod: raw.mod || 'unknown',
  };

  if (!cfg.username || !cfg.password) {
    throw new Error('请先在 config.json 中填写 username（手机号）与 password（登录密码）');
  }
  if (!/^\d{6}$/.test(cfg.controlPin)) {
    // 不强制，但提醒
    cfg.controlPinWarning = '未配置 6 位控车密码（controlPin），车控指令将不可用';
  }
  return cfg;
}

module.exports = { loadConfig, DEFAULT_CONFIG_PATH };
