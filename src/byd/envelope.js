'use strict';

/**
 * 请求信封构造（国内版 CN 协议）
 *
 * 已核对的完整链路：
 *   明文 JSON（inner） --AES-128-CBC(contentKey)--> encryData
 *   外层对象(outer) + 设备字段 + sha256 校验码 --WBSK 白盒加壳--> 最终 request 字符串
 *
 * 本文件逻辑严格对应 BYD-re client.js 的 CN 分支（已验证可用），
 * 并补充了车控指令（remoteControl）的内层字段（对照官方 EXE 字符串核对）。
 */

const {
  md5Hex,
  pwdLoginKey,
  sha1Mixed,
  buildSignString,
  computeCnCheckcode,
  aesEncryptHex,
  randomHex16,
} = require('./crypto');
const wbsk = require('./wbsk');

/** 统一的设备信息内层字段（对照 BYD-re buildInner 的 CN 分支） */
function buildInnerCN(cfg, nowMs, extra) {
  return Object.assign(
    {
      deviceName: `${cfg.mobileBrand}${cfg.mobileModel}`,
      deviceType: cfg.deviceType,
      imeiMD5: cfg.imeiMD5,
      mobileBrand: cfg.mobileBrand,
      mobileModel: cfg.mobileModel,
      networkOperator: cfg.networkOperator,
      networkType: cfg.networkType,
      osType: 'Android',
      osVersion: cfg.osVersion,
      random: randomHex16(),
      softType: cfg.softType,
      timeStamp: String(nowMs),
      version: cfg.cnAppInnerVersion,
    },
    extra || {},
  );
}

/** 追加 CN 设备字段与 sha256 校验码（必须在 WBSK 加壳之前调用） */
function addCnDeviceFields(cfg, payload) {
  payload.ostype = cfg.ostype;
  payload.imei = cfg.imei;
  payload.mac = cfg.mac;
  payload.model = cfg.model;
  payload.sdk = cfg.sdk;
  payload.serviceTime = String(Date.now());
  payload.mod = cfg.mod;
  payload.checkcode = computeCnCheckcode(JSON.stringify(payload));
  return payload;
}

/** 加壳：设备字段 + 校验码 + WBSK 信封 */
function encodeCnOuterPayload(cfg, payload) {
  addCnDeviceFields(cfg, payload);
  return wbsk.encryptEnvelope(JSON.stringify(payload));
}

/** 解壳：WBSK 解包 → JSON */
function decodeOuterPayload(rawPayload) {
  const plaintext = wbsk.decryptEnvelope(String(rawPayload).trim());
  return JSON.parse(plaintext);
}

/** 登录请求（按官方 EXE v2.1.5_RC 模板复刻，2026-10-27 实测 code=0） */
function buildLoginRequest(cfg, nowMs) {
  const random = randomHex16();
  const reqTimestamp = String(nowMs);
  const loginKey = pwdLoginKey(cfg.password);

  // EXE 登录 inner 为精简模板：无 bluetoothMac/city/configVersion/latitude/longitude
  const inner = {
    appInnerVersion: cfg.cnAppInnerVersion,
    appVersion: cfg.cnAppVersion,
    deviceType: cfg.deviceType,
    devicename: `${cfg.mobileBrand}${cfg.mobileModel}`,
    imeiMD5: cfg.imeiMD5,
    isAuto: '0',
    mobileBrand: cfg.mobileBrand,
    mobileModel: cfg.mobileModel,
    networkOperator: cfg.networkOperator,
    networkType: 'WiFi',
    osType: 'Android',
    osVersion: cfg.osVersion,
    random,
    softType: cfg.softType,
    timeStamp: reqTimestamp,
  };

  const encryData = aesEncryptHex(JSON.stringify(inner), loginKey);

  const signFields = Object.assign({}, inner, {
    appChannel: cfg.appChannel,
    identifier: cfg.username,
    loginType: 0,
    reqTimestamp,
    targetBrand: cfg.targetBrand,
  });
  const sign = sha1Mixed(buildSignString(signFields, md5Hex(cfg.password)));

  const outer = {
    appChannel: cfg.appChannel,
    encryData,
    identifier: cfg.username,
    imeiMD5: cfg.imeiMD5,
    isAuto: '0',
    loginType: 0,
    reqTimestamp,
    sign,
    targetBrand: cfg.targetBrand,
  };

  return { outer };
}

/**
 * 已登录会话的通用信封（对照 BYD-re buildTokenOuterEnvelope 的 CN 分支）
 * @param {object} session {userId, superId, signToken, encryToken}
 */
function buildTokenOuterEnvelope(cfg, session, inner, nowMs) {
  const reqTimestamp = String(nowMs);
  const contentKey = md5Hex(session.encryToken);
  const signKey = md5Hex(session.signToken);

  const encryData = aesEncryptHex(JSON.stringify(inner), contentKey);
  const idType = inner.vin ? 0 : 2;
  const signFields = Object.assign({}, inner, {
    appChannel: cfg.appChannel,
    identifier: session.superId || session.userId,
    identifierType: idType,
    imeiMD5: cfg.imeiMD5,
    reqTimestamp,
    targetBrand: cfg.targetBrand,
    vehicleBrand: cfg.vehicleBrand,
  });
  if (inner.vin) {
    signFields.objective = inner.vin;
  }
  const sign = sha1Mixed(buildSignString(signFields, signKey));
  const outer = {
    appChannel: cfg.appChannel,
    encryData,
    identifier: session.superId || session.userId,
    identifierType: idType,
    imeiMD5: cfg.imeiMD5,
    objective: inner.vin || null,
    outModelTypes: null,
    reqTimestamp,
    sign,
    softType: null,
    targetBrand: cfg.targetBrand,
    vehicleBrand: cfg.vehicleBrand,
    version: null,
  };
  addCnDeviceFields(cfg, outer);
  return { outer, contentKey };
}

/** 车辆列表 */
function buildListRequest(cfg, session, nowMs) {
  const inner = Object.assign({ appUiName: '' }, buildInnerCN(cfg, nowMs));
  return buildTokenOuterEnvelope(cfg, session, inner, nowMs);
}

/** 实时车况：请求（无 serial）或查询结果（带 serial） */
function buildRealtimeEnvelope(cfg, session, vin, requestSerial, nowMs) {
  const inner = Object.assign({}, buildInnerCN(cfg, nowMs), {
    energyType: '0',
    isAuto: '0',
    tboxVersion: cfg.tboxVersion,
    vin,
  });
  if (requestSerial) {
    inner.requestSerial = requestSerial;
  }
  return buildTokenOuterEnvelope(cfg, session, inner, nowMs);
}

/** GPS 定位（国内版单次请求，无需轮询） */
function buildGpsEnvelope(cfg, session, vin, nowMs) {
  const inner = Object.assign({}, buildInnerCN(cfg, nowMs), { vin });
  return buildTokenOuterEnvelope(cfg, session, inner, nowMs);
}

/** 控车密码校验 */
function buildVerifyControlPasswordRequest(cfg, session, vin, commandPwd, nowMs) {
  const inner = Object.assign({}, buildInnerCN(cfg, nowMs), {
    commandPwd,
    functionType: 'remoteControl',
    vin,
  });
  return buildTokenOuterEnvelope(cfg, session, inner, nowMs);
}

/**
 * 车控指令（/control/rc/remoteControl）
 * 内层字段对照官方 EXE 字符串核对：
 *   source=app, tboxVersion=3, asyncControl=0, autoType, commandType, commandPwd, controlParamsMap
 */
function buildControlEnvelope(cfg, session, vin, options, nowMs) {
  const { commandType, commandPwd, controlParamsMap, autoType, asyncControl } = options;
  const inner = Object.assign({}, buildInnerCN(cfg, nowMs), {
    vin,
    source: 'app',
    tboxVersion: cfg.tboxVersion,
    asyncControl: asyncControl !== undefined ? String(asyncControl) : '0',
    commandType,
    commandPwd,
  });
  if (controlParamsMap !== undefined && controlParamsMap !== null) {
    inner.controlParamsMap =
      typeof controlParamsMap === 'string' ? controlParamsMap : JSON.stringify(controlParamsMap);
  }
  if (autoType !== undefined && autoType !== null) {
    inner.autoType = String(autoType);
  }
  return buildTokenOuterEnvelope(cfg, session, inner, nowMs);
}

module.exports = {
  buildInnerCN,
  addCnDeviceFields,
  encodeCnOuterPayload,
  decodeOuterPayload,
  buildLoginRequest,
  buildTokenOuterEnvelope,
  buildListRequest,
  buildRealtimeEnvelope,
  buildGpsEnvelope,
  buildVerifyControlPasswordRequest,
  buildControlEnvelope,
};
