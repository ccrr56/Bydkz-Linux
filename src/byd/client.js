'use strict';

/**
 * 比亚迪云端客户端（国内版）
 * 登录 / 车辆列表 / 实时车况 / GPS / 控车密码校验 / 车控指令
 *
 * 协议流程移植自 BYD-re（已验证社区可用）；指令内层字段对照官方 EXE 核对。
 */

const fs = require('fs');
const path = require('path');
const { md5Hex, aesDecryptUtf8 } = require('./crypto');
const envelope = require('./envelope');
const { Transport } = require('./transport');

class BydApiError extends Error {
  constructor(code, message, endpoint) {
    super(`[${endpoint}] code=${code} ${message || ''}`.trim());
    this.name = 'BydApiError';
    this.code = String(code);
    this.endpoint = endpoint;
  }
}

/** 判断是否「会话失效」类错误（只有这类错误才值得重新登录） */
function isSessionExpiredError(err) {
  if (!(err instanceof BydApiError)) return false;
  if (['22', '224', '226', '401', '403'].includes(err.code)) return true;
  return /登陆失效|登录失效|未登录|会话.*过期|token.*失效|重新登录|please\s*login/i.test(err.message);
}

const REALTIME_POLL_ATTEMPTS = 10;
const REALTIME_POLL_INTERVAL_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRealtimeDataReady(vehicleInfo) {
  if (!vehicleInfo || typeof vehicleInfo !== 'object') {
    return false;
  }
  if (Number(vehicleInfo.onlineState) === 2) {
    return false;
  }
  const tireFields = [
    'leftFrontTirepressure',
    'rightFrontTirepressure',
    'leftRearTirepressure',
    'rightRearTirepressure',
  ];
  if (tireFields.some((field) => Number(vehicleInfo[field]) > 0)) {
    return true;
  }
  if (Number(vehicleInfo.time) > 0) {
    return true;
  }
  if (Number(vehicleInfo.enduranceMileage) > 0) {
    return true;
  }
  return false;
}

class BydClient {
  constructor(cfg, logger) {
    this.cfg = cfg;
    this.log = logger || console;
    this.transport = new Transport(cfg);
    this.session = null;
    this.loginTime = 0;
    this.vehicles = [];
    this.lastLoginAttemptAt = 0;
    this.lastLoginError = null;
  }

  sessionFresh() {
    if (!this.session) return false;
    // loginIntervalHours <= 0：不主动过期，等云端真实报会话失效再重登（少踢手机端）
    if (!(this.cfg.loginIntervalHours > 0)) return true;
    const ageMs = Date.now() - this.loginTime;
    return ageMs < this.cfg.loginIntervalHours * 3600 * 1000;
  }

  sessionFilePath() {
    return this.cfg.sessionFile || path.join(__dirname, '..', '..', 'data', 'session.json');
  }

  /** 持久化会话（token + cookie），重启服务时复用，避免重新登录踢手机端 */
  saveSession() {
    try {
      const file = this.sessionFilePath();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify(
          {
            version: 1,
            loginTime: this.loginTime,
            session: this.session,
            cookies: this.transport.exportCookies(),
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    } catch (e) {
      this.log.warn(`会话保存失败：${e.message}`);
    }
  }

  loadSession() {
    const file = this.sessionFilePath();
    try {
      if (!fs.existsSync(file)) return false;
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!data || !data.session || !data.session.signToken || !data.session.encryToken) {
        return false;
      }
      this.session = data.session;
      this.loginTime = Number(data.loginTime) || Date.now();
      this.transport.importCookies(data.cookies);
      this.log.info(`已载入本地会话（登录于 ${new Date(this.loginTime).toLocaleString()}），本次不重新登录`);
      return true;
    } catch (e) {
      this.log.warn(`会话载入失败：${e.message}`);
      return false;
    }
  }

  /** 启动入口：优先复用本地会话，没有或损坏才登录（登录会踢手机端，尽量少发生） */
  async startSession() {
    if (this.loadSession()) {
      return this.session;
    }
    return this.login();
  }

  async login() {
    // 冷却保护：登录失败后短时间内不连续重试（防崩溃循环反复踢手机端/触发风控）
    const cooldown = Number(this.cfg.loginRetryCooldownMs) || 60000;
    if (this.lastLoginAttemptAt && this.lastLoginError && Date.now() - this.lastLoginAttemptAt < cooldown) {
      const waitS = Math.ceil((cooldown - (Date.now() - this.lastLoginAttemptAt)) / 1000);
      throw new Error(`登录冷却中（${waitS}s 后可重试）。上次错误：${this.lastLoginError}`);
    }
    this.lastLoginAttemptAt = Date.now();

    const nowMs = Date.now();
    const req = envelope.buildLoginRequest(this.cfg, nowMs);
    let resp;
    try {
      resp = await this.transport.postSecure('/app/auth/login', req.outer);
    } catch (e) {
      this.lastLoginError = e.message;
      throw e;
    }
    if (String(resp.code) !== '0') {
      this.lastLoginError = `code=${resp.code} ${resp.message || ''}`;
      throw new BydApiError(resp.code, resp.message, '/app/auth/login');
    }

    const { pwdLoginKey } = require('./crypto');
    const loginKey = pwdLoginKey(this.cfg.password);
    const loginInner = JSON.parse(aesDecryptUtf8(resp.respondData, loginKey));
    const token = (loginInner && loginInner.token) || {};

    const signToken = String(token.signToken || '');
    const encryToken = String(token.encryToken || token.encryptToken || '');
    const superId = String(token.superId || '');
    let userId = '';
    if (token.superBindRelationDtoMap && token.superBindRelationDtoMap[this.cfg.targetBrand]) {
      userId = String(token.superBindRelationDtoMap[this.cfg.targetBrand].userId || '');
    }
    if (!userId) {
      userId = superId || String(token.userId || '');
    }

    if (!userId || !signToken || !encryToken) {
      this.lastLoginError = '登录响应缺少 token 字段';
      throw new Error('登录响应缺少 token 字段（signToken/encryToken/userId），请检查账号与协议版本');
    }

    this.session = { userId, superId, signToken, encryToken };
    this.loginTime = Date.now();
    this.lastLoginError = null;
    this.saveSession();
    this.log.info(`登录成功：userId=${userId}${superId ? ` superId=${superId}` : ''}（注意：登录会踢手机 APP 端）`);
    return this.session;
  }

  async ensureSession() {
    if (!this.sessionFresh()) {
      await this.login();
    }
  }

  /** 读取类请求：仅「会话失效」类错误才自动重登重试一次（避免无谓踢手机端） */
  async withSession(fn) {
    await this.ensureSession();
    try {
      return await fn();
    } catch (err) {
      if (isSessionExpiredError(err)) {
        this.log.warn(`会话失效（${err.message}），重新登录后重试一次…`);
        await this.login();
        return await fn();
      }
      throw err;
    }
  }

  async getVehicles() {
    return this.withSession(async () => {
      const req = envelope.buildListRequest(this.cfg, this.session, Date.now());
      const resp = await this.transport.postSecure('/app/auth/getAllListByUserId', req.outer);
      if (String(resp.code) !== '0') {
        throw new BydApiError(resp.code, resp.message, '/app/auth/getAllListByUserId');
      }
      const data = JSON.parse(aesDecryptUtf8(resp.respondData, req.contentKey));
      const list = Array.isArray(data)
        ? data
        : data && Array.isArray(data.diLinkAutoInfoList)
          ? data.diLinkAutoInfoList
          : [];
      this.vehicles = list.filter((v) => v && v.vin);
      this.log.info(`车辆列表：共 ${this.vehicles.length} 辆`);
      return this.vehicles;
    });
  }

  /** 实时车况：先请求，再轮询结果 */
  async getRealtime(vin) {
    return this.withSession(async () => {
      const reqMs = Date.now();
      const req = envelope.buildRealtimeEnvelope(this.cfg, this.session, vin, null, reqMs);
      let resp = await this.transport.postSecure(
        '/vehicleInfo/vehicle/vehicleRealTimeRequest',
        req.outer,
      );
      if (String(resp.code) !== '0') {
        throw new BydApiError(
          resp.code,
          resp.message,
          '/vehicleInfo/vehicle/vehicleRealTimeRequest',
        );
      }
      let info = JSON.parse(aesDecryptUtf8(resp.respondData, req.contentKey));
      let serial = info && typeof info.requestSerial === 'string' ? info.requestSerial : null;

      for (let attempt = 1; attempt <= REALTIME_POLL_ATTEMPTS; attempt += 1) {
        if (isRealtimeDataReady(info)) {
          return info;
        }
        if (REALTIME_POLL_INTERVAL_MS > 0) {
          await sleep(REALTIME_POLL_INTERVAL_MS);
        }
        const pollReq = envelope.buildRealtimeEnvelope(
          this.cfg,
          this.session,
          vin,
          serial,
          Date.now(),
        );
        const pollResp = await this.transport.postSecure(
          '/vehicleInfo/vehicle/vehicleRealTimeResult',
          pollReq.outer,
        );
        if (String(pollResp.code) !== '0') {
          throw new BydApiError(
            pollResp.code,
            pollResp.message,
            '/vehicleInfo/vehicle/vehicleRealTimeResult',
          );
        }
        info = JSON.parse(aesDecryptUtf8(pollResp.respondData, pollReq.contentKey));
        if (info && typeof info.requestSerial === 'string') {
          serial = info.requestSerial;
        }
      }
      return info;
    });
  }

  /** GPS 定位（国内版单次请求） */
  async getGps(vin) {
    return this.withSession(async () => {
      const req = envelope.buildGpsEnvelope(this.cfg, this.session, vin, Date.now());
      const resp = await this.transport.postSecure(
        '/vehicleInfo/gps/locationRequestService',
        req.outer,
      );
      if (String(resp.code) !== '0') {
        throw new BydApiError(
          resp.code,
          resp.message,
          '/vehicleInfo/gps/locationRequestService',
        );
      }
      return JSON.parse(aesDecryptUtf8(resp.respondData, req.contentKey));
    });
  }

  /** 控车密码（6 位）校验 */
  async verifyControlPassword(vin, pin) {
    if (!pin) throw new Error('未配置控车密码');
    return this.withSession(async () => {
      const req = envelope.buildVerifyControlPasswordRequest(
        this.cfg,
        this.session,
        vin,
        md5Hex(pin),
        Date.now(),
      );
      const resp = await this.transport.postSecure(
        '/vehicle/vehicleswitch/verifyControlPassword',
        req.outer,
      );
      if (String(resp.code) !== '0') {
        throw new BydApiError(resp.code, resp.message, '/vehicle/vehicleswitch/verifyControlPassword');
      }
      return JSON.parse(aesDecryptUtf8(resp.respondData, req.contentKey));
    });
  }

  /**
   * 发送车控指令
   * @param {string} vin
   * @param {{commandType:string, controlParamsMap?:object|string, autoType?:string}} options
   */
  async sendCommand(vin, options) {
    if (!this.cfg.controlPin) {
      throw new Error('未配置控车密码（config.json 的 controlPin），无法下发指令');
    }
    await this.ensureSession();
    const req = envelope.buildControlEnvelope(
      this.cfg,
      this.session,
      vin,
      Object.assign({ commandPwd: md5Hex(this.cfg.controlPin) }, options),
      Date.now(),
    );
    const resp = await this.transport.postSecure('/control/rc/remoteControl', req.outer);
    if (String(resp.code) !== '0') {
      throw new BydApiError(resp.code, resp.message, '/control/rc/remoteControl');
    }
    let result = {};
    try {
      result = JSON.parse(aesDecryptUtf8(resp.respondData, req.contentKey));
    } catch (e) {
      this.log.warn(`指令响应解密失败（可能为空）：${e.message}`);
    }
    this.log.info(`指令已下发：${options.commandType} → ${JSON.stringify(result).slice(0, 200)}`);
    return result;
  }
}

module.exports = { BydClient, BydApiError };
