'use strict';

/**
 * 基础加密函数（比亚迪云端协议）
 *
 * 说明：本文件中的算法实现移植自公开逆向项目 BYD-re
 * (https://github.com/linguo2625469/BYD-re, 原项目 Niek/BYD-re)
 * 与 pyBYD (https://github.com/jkaberg/pyBYD, MIT)，仅供个人自用学习。
 */

const crypto = require('crypto');

/** MD5 大写十六进制 */
function md5Hex(value) {
  return crypto.createHash('md5').update(String(value), 'utf8').digest('hex').toUpperCase();
}

/** 登录密码派生密钥：md5Hex(md5Hex(密码))（内层 MD5 的【大写】hex 串再哈希，与 BYD-re 一致） */
function pwdLoginKey(password) {
  return md5Hex(md5Hex(password));
}

/** SHA1 摘要按字节交替大小写输出，并剔除偶数字符位上的 '0'（与 BYD-re sha1Mixed 一致） */
function sha1Mixed(value) {
  const digest = crypto.createHash('sha1').update(String(value), 'utf8').digest();
  const mixed = Array.from(digest)
    .map((byte, index) => {
      const hex = byte.toString(16).padStart(2, '0');
      return index % 2 === 0 ? hex.toUpperCase() : hex.toLowerCase();
    })
    .join('');
  let filtered = '';
  for (let i = 0; i < mixed.length; i += 1) {
    const ch = mixed[i];
    if (ch === '0' && i % 2 === 0) {
      continue;
    }
    filtered += ch;
  }
  return filtered;
}

/** 构造签名串：字段按 key 排序拼接 + &password=xxx */
function buildSignString(fields, password) {
  const keys = Object.keys(fields).sort();
  const joined = keys.map((key) => `${key}=${String(fields[key])}`).join('&');
  return `${joined}&password=${password}`;
}

/** 新版校验码（海外信封使用）：md5(JSON) 的字节重排 */
function computeCheckcode(payload) {
  const json = JSON.stringify(payload);
  const md5 = crypto.createHash('md5').update(json, 'utf8').digest('hex');
  return `${md5.slice(24, 32)}${md5.slice(8, 16)}${md5.slice(16, 24)}${md5.slice(0, 8)}`;
}

/** 国内版校验码：sha256(JSON) 十六进制（小写） */
function computeCnCheckcode(jsonStr) {
  return crypto.createHash('sha256').update(String(jsonStr), 'utf8').digest('hex');
}

/** AES-128-CBC 零 IV 加密 → 大写十六进制 */
function aesEncryptHex(plaintextUtf8, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.alloc(16, 0);
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([cipher.update(plaintextUtf8, 'utf8'), cipher.final()])
    .toString('hex')
    .toUpperCase();
}

/** AES-128-CBC 零 IV 解密（十六进制输入 → UTF-8 明文） */
function aesDecryptUtf8(cipherHex, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.alloc(16, 0);
  const ciphertext = Buffer.from(cipherHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** 16 字节随机数（32 位大写十六进制） */
function randomHex16() {
  return crypto.randomBytes(16).toString('hex').toUpperCase();
}

module.exports = {
  md5Hex,
  pwdLoginKey,
  sha1Mixed,
  buildSignString,
  computeCheckcode,
  computeCnCheckcode,
  aesEncryptHex,
  aesDecryptUtf8,
  randomHex16,
};
