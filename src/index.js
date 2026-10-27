'use strict';

/**
 * Bydkz Linux 车控服务 - 主入口
 *
 * 流程：加载配置 → 登录比亚迪云端 → 获取车辆 → 启动 APP 对接服务
 */

const { loadConfig } = require('./config');
const { createLogger } = require('./log');
const { BydClient } = require('./byd/client');
const { createServer } = require('./app/server');

async function main() {
  const cfg = loadConfig();
  const log = createLogger(cfg.logLevel);

  log.info('==========================================');
  log.info('  Bydkz Linux 原生车控服务（测试版 0.1.0）');
  log.info('==========================================');
  if (cfg.controlPinWarning) {
    log.warn(cfg.controlPinWarning);
  }

  const client = new BydClient(cfg, log);

  log.info('正在恢复会话（优先复用本地会话，避免踢手机端）…');
  await client.startSession();

  log.info('正在获取车辆列表…');
  const vehicles = await client.getVehicles();
  if (!vehicles.length) {
    throw new Error('账号下未查询到车辆（请确认使用车主账号，且车辆已绑定）');
  }

  let vin = cfg.vin;
  if (!vin || !vehicles.some((v) => v.vin === vin)) {
    if (cfg.vin) {
      log.warn(`配置的 VIN 不在账号车辆列表中，改用第一辆`);
    }
    vin = vehicles[0].vin;
  }
  log.info(`使用车辆 VIN：${vin}`);

  // ---------------- 状态缓存 ----------------
  let lastInfo = null;
  let lastAt = 0;
  let inflight = null;

  async function getStatus(force) {
    if (!force && lastInfo && Date.now() - lastAt < cfg.statusCacheMs) {
      return lastInfo;
    }
    if (inflight) return inflight;
    inflight = client
      .getRealtime(vin)
      .then((info) => {
        lastInfo = info;
        lastAt = Date.now();
        inflight = null;
        return info;
      })
      .catch((err) => {
        inflight = null;
        throw err;
      });
    return inflight;
  }

  async function getGps() {
    return client.getGps(vin);
  }

  const ctx = {
    cfg,
    log,
    client,
    vin,
    getStatus,
    getGps,
    refreshAfterCommand() {
      setTimeout(() => {
        getStatus(true).catch((err) => log.warn(`指令后刷新车况失败：${err.message}`));
      }, 4000);
    },
  };

  // 预热一次车况
  try {
    await getStatus(true);
    log.info('车况数据预热成功');
  } catch (e) {
    log.warn(`车况预热失败（收到请求时会重试）：${e.message}`);
  }

  // 后台定时刷新（保持数据新鲜 & 会话心跳）
  const refreshTimer = setInterval(() => {
    getStatus(true).catch((err) => log.warn(`后台刷新失败：${err.message}`));
  }, cfg.backgroundRefreshMs);

  const server = createServer(ctx);
  server.listen(cfg.port, cfg.host, () => {
    log.info('------------------------------------------');
    log.info(`服务已启动，监听端口：${cfg.port}`);
    log.info(`本机自测：http://127.0.0.1:${cfg.port}/byd?id=ssck&sign=<控车密码的MD5>`);
    log.info(`手机 APP 配置：API 地址 = 服务器公网IP:${cfg.port}`);
    if (!cfg.controlPin) {
      log.warn('未配置控车密码（controlPin）：签名校验会拒绝所有请求，请先配置');
    }
    log.info('------------------------------------------');
  });

  const shutdown = () => {
    log.info('正在退出…');
    clearInterval(refreshTimer);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[启动失败]', err && err.message ? err.message : err);
  process.exit(1);
});
