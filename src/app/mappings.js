'use strict';

/**
 * 手机 APP 接口映射层
 * - 状态字段映射（对照 APP 解析字段核对）
 * - id → 云端指令 分发
 */

const {
  BYD_COMMANDS,
  SMART_COMMANDS,
  PHASE2_COMMANDS,
  parseClimateCommand,
  buildSeatParams,
  buildClimateParams,
} = require('../byd/commands');

/** 手机 APP 解析的状态字段（与 APP 内字符串核对过，直接透传云端数值） */
const STATUS_FIELDS = [
  'okLight',
  'vehicleState',
  'trunkLid',
  'leftFrontDoor',
  'rightFrontDoor',
  'leftRearDoor',
  'rightRearDoor',
  'leftFrontDoorLock',
  'rightFrontDoorLock',
  'leftRearDoorLock',
  'rightRearDoorLock',
  'leftFrontWindow',
  'rightFrontWindow',
  'leftRearWindow',
  'rightRearWindow',
  'skylight',
  'leftFrontTirepressure',
  'rightFrontTirepressure',
  'leftRearTirepressure',
  'rightRearTirepressure',
  'elecPercent',
  'evEndurance',
  'oilPercent',
  'oilEndurance',
  'hevMileage',
  'evMileage',
  'totalMileage',
  'energyConsumption',
  'totalConsumption',
  'time',
  'smallUiSmartChargeTips',
  'remainingHours',
  'remainingMinutes',
  'chargingPower',
  'onlineState',
];

function buildStatusJson(info) {
  const out = { ret: 200, msg: 'ok' };
  if (!info || typeof info !== 'object') {
    return { ret: 500, msg: '车况数据暂不可用' };
  }
  for (const field of STATUS_FIELDS) {
    if (info[field] !== undefined && info[field] !== null) {
      out[field] = info[field];
    }
  }
  return out;
}

function buildGpsJson(gpsInfo) {
  const out = { ret: 200, msg: 'ok' };
  if (!gpsInfo || typeof gpsInfo !== 'object') {
    return { ret: 500, msg: '定位数据暂不可用' };
  }
  Object.assign(out, gpsInfo);
  // 补全常见别名，兼容不同解析方式
  const lat = out.latitude !== undefined ? out.latitude : out.lat;
  const lng = out.longitude !== undefined ? out.longitude : out.lng;
  if (lat !== undefined) {
    out.latitude = lat;
    out.lat = lat;
  }
  if (lng !== undefined) {
    out.longitude = lng;
    out.lng = lng;
  }
  return out;
}

/** 判断车辆是否上锁（依据四个门锁字段；如与实际相反请反馈日志中的字段值以校准） */
function isLocked(info) {
  if (!info) return null;
  const fields = ['leftFrontDoorLock', 'rightFrontDoorLock', 'leftRearDoorLock', 'rightRearDoorLock'];
  const values = fields.map((f) => Number(info[f])).filter((v) => !Number.isNaN(v));
  if (!values.length) return null;
  const lockedCount = values.filter((v) => v === 1).length;
  return lockedCount >= Math.ceil(values.length / 2);
}

/**
 * 分发 APP 请求
 * @param {string} id /byd?id= 后接的指令码
 * @param {object} ctx { client, cfg, getStatus, getGps, log }
 */
async function dispatch(id, ctx) {
  const { client, cfg, log } = ctx;
  const vin = ctx.vin;

  // ---- 只读 ----
  if (id === 'ssck' || id === 'ssck1') {
    const info = await ctx.getStatus();
    return buildStatusJson(info);
  }
  if (id === 'gps' || id === 'cxwz' || id === 'cxwz1') {
    const gpsInfo = await ctx.getGps();
    const out = buildGpsJson(gpsInfo);
    if (id === 'cxwz1' && cfg.tencentMapKey && out.latitude && out.longitude) {
      try {
        const addr = await reverseGeocode(cfg.tencentMapKey, out.latitude, out.longitude);
        if (addr) {
          out.address = addr;
          out.msg = addr;
        }
      } catch (e) {
        log.warn(`逆地理编码失败：${e.message}`);
      }
    }
    return out;
  }

  // ---- 智能判断 ----
  if (SMART_COMMANDS[id]) {
    const info = await ctx.getStatus();
    const locked = isLocked(info);
    log.info(
      `智能判断：锁状态判定=${locked}（leftFrontDoorLock=${info && info.leftFrontDoorLock} 等）`,
    );
    if (locked === null) {
      return { ret: 500, msg: '无法判断车辆锁状态' };
    }
    const command = locked
      ? { commandType: 'OPENDOOR', params: SMART_COMMANDS[id].withPower ? { autoType: '1' } : undefined }
      : { commandType: 'LOCKDOOR' };
    await client.sendCommand(vin, {
      commandType: command.commandType,
      controlParamsMap: command.params,
      autoType: command.params ? command.params.autoType : undefined,
    });
    ctx.refreshAfterCommand();
    return { ret: 200, msg: locked ? '车辆已解锁' : '车辆已锁定' };
  }

  // ---- 空调 ----
  if (id === 'ktdk' || parseClimateCommand(id)) {
    const parsed = parseClimateCommand(id);
    const level = parsed ? parsed.level : 9;
    await client.sendCommand(vin, {
      commandType: 'OPENAIR',
      controlParamsMap: buildClimateParams(cfg, level),
    });
    ctx.refreshAfterCommand();
    return { ret: 200, msg: `空调已开启（档位 ${level}）` };
  }

  // ---- 常规指令 ----
  const def = BYD_COMMANDS[id];
  if (def) {
    let controlParamsMap;
    let autoType = def.autoType;
    if (def.seat) {
      let info = null;
      try {
        info = await ctx.getStatus();
      } catch (e) {
        log.warn(`读取车况失败，座椅指令将使用默认参数：${e.message}`);
      }
      controlParamsMap = buildSeatParams(info, def.seat);
    } else if (def.params) {
      const p = def.params();
      controlParamsMap = p;
      if (p && p.autoType) autoType = p.autoType;
    }
    try {
      await client.sendCommand(vin, { commandType: def.commandType, controlParamsMap, autoType });
    } catch (err) {
      // 降窗指令兼容：DOWNWINDOW 失败时尝试 OPENWINDOW
      if (def.fallbackCommandType) {
        log.warn(`${def.commandType} 失败（${err.message}），尝试备选 ${def.fallbackCommandType}`);
        await client.sendCommand(vin, { commandType: def.fallbackCommandType, controlParamsMap, autoType });
      } else {
        throw err;
      }
    }
    ctx.refreshAfterCommand();
    return { ret: 200, msg: `${def.desc}：操作成功` };
  }

  // ---- 二期功能 ----
  if (PHASE2_COMMANDS[id]) {
    log.info(`收到二期功能请求（暂未实现云端对接）：${id} ${PHASE2_COMMANDS[id]}`);
    return { ret: 200, msg: `${PHASE2_COMMANDS[id]}（功能开发中）`, pending: true };
  }

  return { ret: 404, msg: `未知指令：${id}` };
}

/** 腾讯地图逆地理编码（可选，配置 tencentMapKey 后生效） */
async function reverseGeocode(key, latitude, longitude) {
  const url = `https://apis.map.qq.com/ws/geocoder/v1/?key=${encodeURIComponent(
    key,
  )}&location=${encodeURIComponent(`${latitude},${longitude}`)}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const data = await resp.json();
  if (data && data.status === 0 && data.result && data.result.address) {
    return String(data.result.address);
  }
  return null;
}

module.exports = { dispatch, buildStatusJson, buildGpsJson, STATUS_FIELDS };
