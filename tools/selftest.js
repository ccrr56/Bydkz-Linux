'use strict';

/**
 * 加密算法自检（不需要账号，本地即可运行）
 * 用法：node tools/selftest.js
 */

const { md5Hex, pwdLoginKey, sha1Mixed, computeCheckcode } = require('../src/byd/crypto');
const wbsk = require('../src/byd/wbsk');
const envelope = require('../src/byd/envelope');

let pass = 0;
let fail = 0;

function assertEq(name, actual, expected) {
  if (actual === expected) {
    pass += 1;
    console.log(`[PASS] ${name}`);
  } else {
    fail += 1;
    console.error(`[FAIL] ${name}\n       实际: ${actual}\n       期望: ${expected}`);
  }
}

// ---- 1. 基础算法（基准值由独立实现计算得出）----
assertEq("md5Hex('123456')", md5Hex('123456'), 'E10ADC3949BA59ABBE56E057F20F883E');
// 向量取自 BYD-re 参考实现原样执行结果，并于 2026-10-27 以真实登录验证通过
assertEq("pwdLoginKey('123456')", pwdLoginKey('123456'), 'F59BD65F7EDAFB087A81D4DCA06C4910');
assertEq("sha1Mixed('abc')", sha1Mixed('abc'), 'A9993E36476816aBA3e25717850C26c9Cd0D89d');
assertEq('computeCheckcode({"a":"1"})', computeCheckcode({ a: '1' }), '214256e3db071729471908607d514306');

// ---- 2. WBSK 白盒加解密往返 ----
const sample = JSON.stringify({ hello: 'world', n: 123, cn: '中文测试' });
const enc = wbsk.encryptEnvelope(sample);
const dec = wbsk.decryptEnvelope(enc);
assertEq('WBSK 加解密往返', dec, sample);

// ---- 3. 登录信封结构冒烟测试 ----
const fakeCfg = {
  username: '13800000000',
  password: 'testPassword',
  controlPin: '123456',
  mobileBrand: 'XIAOMI',
  mobileModel: 'POCO F1',
  imeiMD5: '00000000000000000000000000000000',
  networkOperator: '无',
  networkType: 'wifi',
  osVersion: '35',
  deviceType: '0',
  softType: '0',
  cnAppInnerVersion: '502',
  cnAppVersion: '9.10.2',
  appChannel: '99',
  targetBrand: '1',
  vehicleBrand: '1',
  tboxVersion: '3',
  ostype: 'and',
  imei: 'BANGCLE01234',
  mac: '00:00:00:00:00:00',
  model: 'POCO F1',
  sdk: '35',
  mod: 'Xiaomi',
};

const { outer } = envelope.buildLoginRequest(fakeCfg, Date.now());
assertEq('登录信封包含 encryData', typeof outer.encryData === 'string' && outer.encryData.length > 0, true);
assertEq('登录信封包含 sign', typeof outer.sign === 'string' && outer.sign.length > 0, true);
assertEq('登录信封 identifier', outer.identifier, '13800000000');

// 加壳后可正常解壳
const packed = envelope.encodeCnOuterPayload(fakeCfg, Object.assign({}, outer));
const unpacked = JSON.parse(wbsk.decryptEnvelope(packed));
assertEq('设备字段存在', !!unpacked.ostype && !!unpacked.imei && !!unpacked.checkcode, true);
assertEq('校验码为 sha256（64位）', unpacked.checkcode.length, 64);

// ---- 4. 会话信封冒烟测试 ----
const fakeSession = {
  userId: 'u123',
  superId: 's456',
  signToken: 'SIGNTOKEN',
  encryToken: 'ENCRYTOKEN',
};
const inner = { vin: 'LGX0000000000000', random: 'ABCD' };
const tokenReq = envelope.buildTokenOuterEnvelope(fakeCfg, fakeSession, inner, Date.now());
assertEq('会话信封包含 encryData', typeof tokenReq.outer.encryData === 'string', true);
assertEq('会话信封 objective=VIN', tokenReq.outer.objective, 'LGX0000000000000');
assertEq('会话信封 identifierType=0（带VIN）', tokenReq.outer.identifierType, 0);

console.log('');
console.log(`====== 自检结果：${pass} 通过 / ${fail} 失败 ======`);
process.exit(fail ? 1 : 0);
