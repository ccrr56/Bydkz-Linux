'use strict';

/**
 * 链路自检（需要账号）：登录 → 车辆列表 → 实时车况 → GPS
 * 用法：
 *   node tools/check.js         基础检查
 *   node tools/check.js --pin   附加控车密码校验
 */

const { loadConfig } = require('../src/config');
const { createLogger } = require('../src/log');
const { BydClient } = require('../src/byd/client');

(async () => {
  const cfg = loadConfig();
  const log = createLogger(cfg.logLevel);
  const client = new BydClient(cfg, log);

  console.log('== 1/4 登录 ==');
  await client.login();
  console.log('   登录成功');

  console.log('== 2/4 车辆列表 ==');
  const vehicles = await client.getVehicles();
  vehicles.forEach((v, i) => {
    console.log(`   [${i}] VIN: ${v.vin}  车牌: ${v.autoPlate || '-'}  昵称: ${v.autoAlias || v.alias || '-'}`);
  });
  const vin = cfg.vin || (vehicles[0] && vehicles[0].vin);
  if (!vin) {
    throw new Error('没有可用车辆');
  }
  console.log(`   使用 VIN: ${vin}`);

  console.log('== 3/4 实时车况 ==');
  const info = await client.getRealtime(vin);
  console.log(JSON.stringify(info, null, 2));

  console.log('== 4/4 GPS 定位 ==');
  try {
    const gps = await client.getGps(vin);
    console.log(JSON.stringify(gps, null, 2));
  } catch (e) {
    console.log(`   GPS 获取失败（不影响车控）：${e.message}`);
  }

  if (process.argv.includes('--pin')) {
    console.log('== 附加：控车密码校验 ==');
    const result = await client.verifyControlPassword(vin, cfg.controlPin);
    console.log(JSON.stringify(result, null, 2));
  }

  console.log('');
  console.log('链路自检全部完成 ✓');
})().catch((err) => {
  console.error('');
  console.error('执行失败：', err && err.message ? err.message : err);
  process.exit(1);
});
