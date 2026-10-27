'use strict';

/**
 * 指令测试工具（需要账号与控车密码）
 * 用法：
 *   node tools/send.js list          查看支持的指令
 *   node tools/send.js jscm          解锁车门
 *   node tools/send.js sdcm          锁定车辆
 *   node tools/send.js ktdk9         开空调（档位9=25度）
 *
 * ⚠️ 会对真实车辆执行操作，请在安全环境下测试（人在车旁或有把握的场景）
 */

const { loadConfig } = require('../src/config');
const { createLogger } = require('../src/log');
const { BydClient } = require('../src/byd/client');
const { dispatch } = require('../src/app/mappings');
const { BYD_COMMANDS, PHASE2_COMMANDS, SMART_COMMANDS } = require('../src/byd/commands');

function printList() {
  console.log('=== 支持的指令 ===');
  for (const [id, def] of Object.entries(BYD_COMMANDS)) {
    console.log(`  ${id.padEnd(8)} ${def.desc}`);
  }
  console.log('  ktdk9    开空调（数字=档位1-17，9≈25度）');
  console.log('  ktgb     关闭空调');
  for (const [id, def] of Object.entries(SMART_COMMANDS)) {
    console.log(`  ${id.padEnd(8)} ${def.desc}`);
  }
  console.log('--- 只读 ---');
  console.log('  ssck     查询实时车况');
  console.log('  gps      查询位置');
  console.log('--- 二期（暂未实现）---');
  for (const [id, desc] of Object.entries(PHASE2_COMMANDS)) {
    console.log(`  ${id.padEnd(8)} ${desc}`);
  }
}

(async () => {
  const id = process.argv[2];
  if (!id || id === 'list' || id === '--help') {
    printList();
    return;
  }

  const cfg = loadConfig();
  const log = createLogger(cfg.logLevel);
  const client = new BydClient(cfg, log);

  await client.login();
  const vehicles = await client.getVehicles();
  const vin = cfg.vin || (vehicles[0] && vehicles[0].vin);
  if (!vin) {
    throw new Error('没有可用车辆');
  }

  const ctx = {
    cfg,
    log,
    client,
    vin,
    getStatus: () => client.getRealtime(vin),
    getGps: () => client.getGps(vin),
    refreshAfterCommand: () => {},
  };

  console.log(`执行指令：${id}（车辆 ${vin}）`);
  const result = await dispatch(id, ctx);
  console.log('返回：', JSON.stringify(result, null, 2));
})().catch((err) => {
  console.error('执行失败：', err && err.message ? err.message : err);
  process.exit(1);
});
