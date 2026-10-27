'use strict';

/**
 * HTTP 传输层（国内版）
 * - POST {baseUrl}{endpoint}，body: {"request": <WBSK加壳后的信封>}
 * - 自动管理 Cookie
 * - 响应解壳后返回 JSON
 *
 * 对照 BYD-re client.js 的 postSecure 实现。
 */

const { encodeCnOuterPayload, decodeOuterPayload } = require('./envelope');

class Transport {
  constructor(cfg) {
    this.cfg = cfg;
    this.cookies = new Map();
    this.timeoutMs = cfg.requestTimeoutMs || 25000;
  }

  buildCookieHeader() {
    if (!this.cookies.size) {
      return '';
    }
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  /** 导出 Cookie（会话持久化用） */
  exportCookies() {
    return Array.from(this.cookies.entries());
  }

  /** 导入 Cookie（会话恢复用） */
  importCookies(list) {
    this.cookies = new Map(Array.isArray(list) ? list : []);
  }

  updateCookies(headers) {
    const absorb = (raw) => {
      const first = String(raw).split(';', 1)[0];
      const idx = first.indexOf('=');
      if (idx > 0) {
        this.cookies.set(first.slice(0, idx), first.slice(idx + 1));
      }
    };
    const getSetCookie = headers.getSetCookie;
    if (typeof getSetCookie === 'function') {
      for (const raw of getSetCookie.call(headers) || []) {
        absorb(raw);
      }
      return;
    }
    const single = headers.get('set-cookie');
    if (single) {
      absorb(single);
    }
  }

  /**
   * 发送加密请求
   * @param {string} endpoint 形如 /app/auth/login
   * @param {object} outerPayload 信封外层对象
   * @returns {Promise<object>} 解壳后的响应 JSON
   */
  async postSecure(endpoint, outerPayload) {
    const headers = {
      'accept-encoding': 'identity',
      'content-type': 'application/json; charset=UTF-8',
      'user-agent': 'okhttp/4.12.0',
      version: this.cfg.cnAppInnerVersion,
      platform: 'ANDROID',
      BrandFlag: 'dynasty',
    };

    const cookie = this.buildCookieHeader();
    if (cookie) {
      headers.cookie = cookie;
    }

    const requestPayload = encodeCnOuterPayload(this.cfg, outerPayload);

    const response = await fetch(`${this.cfg.baseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ request: requestPayload }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    this.updateCookies(response.headers);

    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${endpoint}: ${bodyText.slice(0, 200)}`);
    }

    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      throw new Error(`响应不是 JSON (${endpoint}): ${bodyText.slice(0, 200)}`);
    }

    if (!body || typeof body.response !== 'string') {
      throw new Error(`响应缺少 response 字段 (${endpoint})`);
    }

    return decodeOuterPayload(body.response);
  }
}

module.exports = { Transport };
