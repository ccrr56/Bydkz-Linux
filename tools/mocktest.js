'use strict';

/**
 * 本地模拟测试（无需账号）
 * 用模拟数据验证 HTTP 服务与指令分发逻辑
 * 用法：node tools/mocktest.js
 */

const { createServer } = require('../src/app/server');
const { md5Hex } = require('../src/byd/crypto');

const cfg = {
  controlPin: '123456',
  requireSign: true,
  tencentMapKey: '',
  climateTimeSpan: 1,
};

const log = {
  info: () => {},
  warn: () => {},
  error: (...a) => console.error('[log]', ...a),
  debug: () => {},
};

const sentCommands = [];

const ctx = {
  cfg,
  log,
  vin: 'TESTVIN0000000001',
  getStatus: async () => ({
    okLight: '1',
    vehicleState: '1',
    elecPercent: '66',
    evEndurance: '420',
    leftFrontDoor: '0',
    leftFrontDoorLock: '1',
    rightFrontDoorLock: '1',
    leftRearDoorLock: '1',
    rightRearDoorLock: '1',
    time: '1729000000000',
    smallUiSmartChargeTips: '',
  }),
  getGps: async () => ({ latitude: 31.2304, longitude: 121.4737, direction: 90 }),
  refreshAfterCommand: () => {},
  client: {
    sendCommand: async (vin, options) => {
      sentCommands.push(options);
      return { res: 2, requestSerial: 'SERIAL123' };
    },
  },
};

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log(`[PASS] ${name}`);
  } else {
    fail += 1;
    console.error(`[FAIL] ${name} ${extra || ''}`);
  }
}

const server = createServer(ctx);

server.listen(0, async () => {
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const sign = md5Hex('123456');

  try {
    let r = await fetch(`${base}/`);
    let j = await r.json();
    check('根路径服务状态', j.ok === true);

    r = await fetch(`${base}/byd?id=ssck`);
    j = await r.json();
    check('无签名被拒绝 (ret=403)', j.ret === 403);

    r = await fetch(`${base}/byd?id=ssck&sign=${sign}`);
    j = await r.json();
    check('实时车况返回字段', j.ret === 200 && j.elecPercent === '66' && j.evEndurance === '420');

    r = await fetch(`${base}/gps?sign=${sign}`);
    j = await r.json();
    check('GPS 返回并带别名', j.latitude === 31.2304 && j.lat === 31.2304 && j.lng === 121.4737);

    r = await fetch(`${base}/byd?id=jscm&sign=${sign}`);
    j = await r.json();
    check('解锁指令（OPENDOOR）', j.ret === 200 && sentCommands[0] && sentCommands[0].commandType === 'OPENDOOR');

    r = await fetch(`${base}/byd?id=sdcm&sign=${sign}`);
    j = await r.json();
    check('锁车指令（LOCKDOOR）', sentCommands[1] && sentCommands[1].commandType === 'LOCKDOOR');

    r = await fetch(`${base}/byd?id=ktdk9&sign=${sign}`);
    j = await r.json();
    const climate = sentCommands[2];
    check(
      '开空调（OPENAIR + 参数）',
      climate &&
        climate.commandType === 'OPENAIR' &&
        climate.controlParamsMap &&
        climate.controlParamsMap.mainSettingTemp === 9,
    );

    r = await fetch(`${base}/byd?id=ztfk&sign=${sign}`);
    j = await r.json();
    const seat = sentCommands[3];
    check(
      '主驾通风开（VENTILATIONHEATING 全字段）',
      seat &&
        seat.commandType === 'VENTILATIONHEATING' &&
        seat.controlParamsMap &&
        seat.controlParamsMap.mainVentilation === 1 &&
        seat.controlParamsMap.copilotHeat === 3 &&
        seat.controlParamsMap.remoteMode === 1,
    );

    r = await fetch(`${base}/byd?id=znpd&sign=${sign}`);
    j = await r.json();
    check(
      '智能判断（已锁→解锁）',
      sentCommands[4] && sentCommands[4].commandType === 'OPENDOOR' && sentCommands[4].autoType == null,
    );

    r = await fetch(`${base}/byd?id=xxxx&sign=${sign}`);
    j = await r.json();
    check('未知指令（ret=404）', j.ret === 404);

    r = await fetch(`${base}/byd?id=yycd&sign=${sign}`);
    j = await r.json();
    check('二期功能占位（pending）', j.pending === true);
  } catch (err) {
    console.error('模拟测试异常：', err);
    fail += 1;
  }

  console.log('');
  console.log(`====== 模拟测试结果：${pass} 通过 / ${fail} 失败 ======`);
  server.close();
  process.exit(fail ? 1 : 0);
});
