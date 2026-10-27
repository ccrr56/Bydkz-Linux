'use strict';

/**
 * 首次配置向导
 * 交互式填写比亚迪账号信息 → 写入 config.json → 连接云端验证 → 可选启动服务
 *
 * 用法：node tools/setup.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const EXAMPLE_PATH = path.join(ROOT, 'config.example.json');

let pipeBuf = '';

function readLinePiped() {
  return new Promise((resolve) => {
    const tryResolve = () => {
      const idx = pipeBuf.indexOf('\n');
      if (idx !== -1) {
        const line = pipeBuf.slice(0, idx).replace(/\r$/, '');
        pipeBuf = pipeBuf.slice(idx + 1);
        process.stdin.removeListener('data', onData);
        process.stdin.pause();
        resolve(line);
        return true;
      }
      return false;
    };
    const onData = (chunk) => {
      pipeBuf += chunk.toString('utf8');
      tryResolve();
    };
    if (!tryResolve()) {
      process.stdin.resume();
      process.stdin.on('data', onData);
    }
  });
}

function askRaw(query, hidden) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(query);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    let input = '';
    const onData = (chunk) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(wasRaw);
          stdin.removeListener('data', onData);
          stdin.pause();
          process.stdout.write('\n');
          resolve(input);
          return;
        }
        if (ch === '\u0003') {
          process.stdout.write('\n已取消\n');
          process.exit(1);
        }
        if (ch === '\u007f' || ch === '\b') {
          if (input.length) {
            input = input.slice(0, -1);
            if (!hidden) process.stdout.write('\b \b');
          }
          continue;
        }
        input += ch;
        if (!hidden) process.stdout.write(ch);
      }
    };
    stdin.on('data', onData);
  });
}

async function ask(question, hidden = false) {
  if (process.stdin.isTTY) {
    return askRaw(question, hidden);
  }
  process.stdout.write(question);
  return readLinePiped();
}

async function main() {
  console.log('==============================================');
  console.log('   Bydkz Linux 首次配置向导');
  console.log('==============================================');
  console.log('');

  let existing = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
      existing = {};
    }
  }

  const usernameRaw = await ask(
    `1) 比亚迪账号手机号${existing.username ? `（回车沿用 ${existing.username}）` : ''}: `,
  );
  const username = String(usernameRaw || '').trim() || existing.username || '';
  if (!/^1\d{10}$/.test(username)) {
    console.error('✗ 手机号格式不正确（应为 11 位数字）');
    process.exit(1);
  }

  const password = await ask('2) 账号登录密码（输入不回显）: ', true);
  if (!password) {
    console.error('✗ 密码不能为空');
    process.exit(1);
  }

  const pin = String(await ask('3) 6 位控车密码（输入不回显）: ', true)).trim();
  if (!/^\d{6}$/.test(pin)) {
    console.error('✗ 控车密码应为 6 位数字');
    process.exit(1);
  }

  const cfg = JSON.parse(fs.readFileSync(EXAMPLE_PATH, 'utf8'));
  cfg.username = username;
  cfg.password = password;
  cfg.controlPin = pin;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`\n✓ 配置已写入：${CONFIG_PATH}`);

  console.log('\n正在连接比亚迪云端验证（约 10~30 秒）…');
  const { loadConfig } = require('../src/config');
  const { createLogger } = require('../src/log');
  const { BydClient } = require('../src/byd/client');

  try {
    const c = loadConfig(CONFIG_PATH);
    const client = new BydClient(c, createLogger('warn'));
    await client.login();
    console.log('✓ 登录成功');

    const vehicles = await client.getVehicles();
    if (!vehicles.length) {
      console.error('✗ 账号下未找到车辆（请确认使用的是车主账号）');
      process.exit(1);
    }
    vehicles.forEach((v, i) => {
      console.log(`  [${i}] VIN: ${v.vin}  车牌: ${v.autoPlate || '-'}  昵称: ${v.autoAlias || '-'}`);
    });

    const vin = c.vin || vehicles[0].vin;
    const info = await client.getRealtime(vin);
    console.log(
      `✓ 车况获取成功：电量 ${info.elecPercent ?? '-'}% ｜ 续航 ${info.evEndurance ?? '-'} km ｜ 总里程 ${info.totalMileage ?? '-'} km`,
    );
  } catch (err) {
    console.error(`\n✗ 验证失败：${err.message}`);
    console.error('  配置已保存（可修改后重跑本向导），或把上方报错原文发回给协助者分析');
    process.exit(1);
  }

  const answer = String(
    await ask('\n是否现在启动服务并设置开机自启（systemd）？[y/N]: '),
  )
    .trim()
    .toLowerCase();
  if (answer === 'y' || answer === 'yes') {
    try {
      const { execSync } = require('child_process');
      execSync('systemctl enable --now bydkz-linux', { stdio: 'inherit' });
      console.log('✓ 服务已启动，查看状态：systemctl status bydkz-linux');
    } catch (e) {
      console.error('启动服务失败，稍后可手动执行：systemctl enable --now bydkz-linux');
    }
  } else {
    console.log('已跳过启动。稍后手动执行：systemctl enable --now bydkz-linux');
  }

  console.log('');
  console.log('=============== 全部完成 ===============');
  console.log('接下来要做的事：');
  console.log('  1) 阿里云控制台 → 安全组 → 放行入方向 TCP 8889');
  console.log('  2) 手机 APP → 设置 → API 地址 = 服务器公网IP:8889');
  console.log('  3) 保存后刷新车况，先测试"闪灯"等无害指令');
  console.log('========================================');
}

main().catch((err) => {
  console.error('向导异常：', err && err.message ? err.message : err);
  process.exit(1);
});
