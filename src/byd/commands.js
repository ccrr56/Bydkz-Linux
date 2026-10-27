'use strict';

/**
 * 车控指令目录
 *
 * - BYD_COMMANDS：手机 APP 接口 id → 云端指令（commandType + controlParamsMap）
 * - 对照来源：官方 EXE「API 接口」说明字符串 + pyBYD 参数模型（MIT）
 */

/** 座椅指令参数模板（对照官方 EXE 字符串核对字段名） */
function buildSeatParams(currentInfo, changes) {
  // 命令刻度：1=最高档 2=低档 3=关闭（与状态读数刻度相反）
  const base = {
    mainVentilation: 3,
    mainHeat: 3,
    copilotVentilation: 3,
    copilotHeat: 3,
    lrSeatHeatState: 0,
    lrSeatVentilationState: 0,
    rrSeatHeatState: 0,
    rrSeatVentilationState: 0,
    lrThreeRowSeatHeatState: 0,
    lrThreeRowSeatVentilationState: 0,
    rrThreeRowSeatHeatState: 0,
    rrThreeRowSeatVentilationState: 0,
    remoteMode: 1,
  };
  // 尽量沿用当前车辆状态（字段命名与状态一致时直接沿用数值）
  if (currentInfo && typeof currentInfo === 'object') {
    for (const key of Object.keys(base)) {
      if (key === 'remoteMode') continue;
      const v = Number(currentInfo[key]);
      if (!Number.isNaN(v) && v >= 0 && v <= 3) {
        base[key] = v;
      }
    }
  }
  for (const [key, value] of Object.entries(changes || {})) {
    base[key] = value;
  }
  return base;
}

/** 空调参数（对照官方 EXE 字符串：mainSettingTemp/copilotSettingTemp/cycleMode/remoteMode/timeSpan） */
function buildClimateParams(cfg, level) {
  const temp = Number.isFinite(level) && level >= 1 && level <= 17 ? level : 9;
  return {
    mainSettingTemp: temp,
    copilotSettingTemp: temp,
    cycleMode: 2,
    remoteMode: 4,
    timeSpan: cfg.climateTimeSpan || 1,
  };
}

/**
 * 手机 APP 接口指令表
 * commandType 取值参考 pyBYD RemoteCommand（海外/国内同一套业务指令名）
 */
const BYD_COMMANDS = {
  jscm: { desc: '解锁车门', commandType: 'OPENDOOR' },
  jssd: { desc: '解锁上电', commandType: 'OPENDOOR', autoType: '1', params: () => ({ autoType: '1' }) },
  sdcm: { desc: '锁定车辆', commandType: 'LOCKDOOR' },
  ktgb: { desc: '关闭空调', commandType: 'CLOSEAIR' },
  gbcc: { desc: '关闭全车车窗', commandType: 'CLOSEWINDOW' },
  cctq: { desc: '一键降窗透气', commandType: 'DOWNWINDOW', fallbackCommandType: 'OPENWINDOW' },
  hbxk: { desc: '打开后备箱', commandType: 'OPENTRUNK' },
  hbxg: { desc: '关闭后备箱', commandType: 'CLOSETRUNK' },
  clsd: { desc: '车辆闪灯', commandType: 'FLASHLIGHTNOWHISTLE' },
  sdmd: { desc: '闪灯鸣笛', commandType: 'FINDCAR' },
  ztfk: { desc: '主驾通风开', commandType: 'VENTILATIONHEATING', seat: { mainVentilation: 1 } },
  ztfg: { desc: '主驾通风关', commandType: 'VENTILATIONHEATING', seat: { mainVentilation: 3 } },
  zjrk: { desc: '主驾加热开', commandType: 'VENTILATIONHEATING', seat: { mainHeat: 1 } },
  zjrg: { desc: '主驾加热关', commandType: 'VENTILATIONHEATING', seat: { mainHeat: 3 } },
  ftfk: { desc: '副驾通风开', commandType: 'VENTILATIONHEATING', seat: { copilotVentilation: 1 } },
  ftfg: { desc: '副驾通风关', commandType: 'VENTILATIONHEATING', seat: { copilotVentilation: 3 } },
  fjrk: { desc: '副驾加热开', commandType: 'VENTILATIONHEATING', seat: { copilotHeat: 1 } },
  fjrg: { desc: '副驾加热关', commandType: 'VENTILATIONHEATING', seat: { copilotHeat: 3 } },
};

/** 需要走「智能判断」逻辑的 id（先查车况再决定） */
const SMART_COMMANDS = {
  znpd: { desc: '智能判断解锁/锁定', withPower: false },
  znpds: { desc: '智能判断解锁上电/锁定', withPower: true },
};

/** 二期功能（暂不实际下发，仅记录） */
const PHASE2_COMMANDS = {
  yycd: '开启预约充电',
  yygb: '关闭预约充电',
  jlxc: '记录行程',
  jsxc: '结束行程',
  jszk: '驾驶周报',
  jsyk: '驾驶月报',
};

/** 解析 ktdk9 这类带参数的空调指令 */
function parseClimateCommand(id) {
  const m = /^ktdk(\d{1,2})$/.exec(id);
  if (!m) return null;
  return { level: parseInt(m[1], 10) };
}

module.exports = {
  BYD_COMMANDS,
  SMART_COMMANDS,
  PHASE2_COMMANDS,
  parseClimateCommand,
  buildSeatParams,
  buildClimateParams,
};
