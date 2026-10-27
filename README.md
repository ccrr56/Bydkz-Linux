# Bydkz-Linux · 比亚迪车控 Linux 服务端

把「手机 APP 远程控车」的后端搬到 **Linux 服务器**上原生运行——替代 Windows 版 EXE 主程序，无需微信客户端、无需模拟器、无需证书拦截。

手机 APP 无需修改，把 API 地址指向本服务即可使用：远程车况查询、GPS 定位、解锁/上锁、空调控制等。

> ⚠️ **仅供个人学习与研究使用。** 本项目涉及与比亚迪云端接口的非官方对接，请遵守当地法律与服务条款，风险自负。不提供任何担保。

---

## 功能

- ✅ 手机号 + 密码登录比亚迪云端（国内版协议，WBSK 白盒加密信封）
- ✅ 车辆列表 / 实时车况（电量、续航、里程、胎压、车门车窗…）
- ✅ GPS 定位
- ✅ 33 项车控指令（解锁、上锁、空调、车窗、座椅通风加热、预约充电…）
- ✅ 与官方 EXE 相同的 APP 对接接口：`GET /byd?id=<指令>&sign=<控车密码MD5>`
- ✅ 会话持久化：服务重启不重新登录（重新登录会把手机 APP 踢下线）
- ✅ 公网防爆破：sign 连续校验失败自动锁定 IP

## 架构

```
手机 APP ──HTTP──► 本服务 :8889 ──HTTPS/加密信封──► 比亚迪云端
   (Bydkz)          (Node.js)        dilinksuperappserver-cn.byd.auto
```

- 纯 Node.js（≥18），**零 npm 依赖**，内存占用约 50MB
- systemd 常驻、开机自启、崩溃自动拉起

## 快速开始

```bash
# 1. 上传本项目到服务器，例如 /www/wwwroot/bydkz-linux
cd /www/wwwroot/bydkz-linux

# 2. 安装 Node.js 22（如已有 node 可跳过）
bash deploy/install_node.sh

# 3. 填写配置（手机号 / 账号密码 / 6 位控车 PIN）
cp config.example.json config.json
vi config.json

# 4. 自检 + 账号链路验证
node tools/selftest.js        # 加密算法自检（不需要账号）
node tools/check.js           # 登录→车辆→车况（⚠️ 登录会把手机 APP 踢下线一次）

# 5. 安装 systemd 服务并启动
sudo cp deploy/bydkz-linux.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now bydkz-linux
```

手机 APP → 设置 → API 地址填 `服务器IP:8889`，协议选 `http`，完成。

📖 **完整教程（配置项、安全加固、FAQ、运维）见 [部署教程.md](./部署教程.md)**

## 项目结构

```
├── src/                  # 服务端源码
│   ├── index.js          # 入口
│   ├── config.js         # 配置加载
│   ├── app/              # APP 对接 HTTP 服务（/byd 接口）
│   └── byd/              # 比亚迪云端协议（加密/信封/客户端/指令映射）
├── tools/                # 自检 / 配置向导 / 链路检测 / 指令发送
├── deploy/               # 部署材料（systemd 单元、Node 安装脚本）
├── config.example.json   # 配置模板
└── 部署教程.md            # 完整部署与使用教程
```

## 安全须知（重要）

1. **控车接口的 `sign` 是控车 PIN 的 MD5**，6 位纯数字 PIN 仅百万组合，公网可被暴力枚举。本服务内置「连错 10 次锁 IP 30 分钟」防护；**强烈建议**：若 APP 的控车密码支持长字符串，改用 12 位以上随机串；不用时在防火墙/安全组关闭 8889 端口。
2. 传输为 **HTTP 明文**（APP 限制），链路上理论上可被窃听重放，个人自用可接受，在意请通过 VPN/内网使用。
3. `config.json` 含账号密码、`data/session.json` 含登录凭证，**切勿提交到 git 或外传**。
4. 服务登录云端时**会把手机 APP 踢下线**（协议如此），已通过会话持久化把频率降到最低，详见教程。

## 致谢

协议逆向成果来自以下开源项目（感谢原作者的工作）：

- [BYD-re](https://github.com/linguo2625469/BYD-re)（原 Niek/BYD-re）：国内版 WBSK 白盒加密与登录/车况协议
- [pyBYD](https://github.com/jkaberg/pyBYD)（MIT）：车控指令结构与参数模型
- [Qcby/Bydkz](https://github.com/Qcby/Bydkz)：配套手机 APP 与原始 Windows 工具的思路

比亚迪、BYD 等商标归其各自所有者所有。本项目与比亚迪官方无关。

## 免责声明

本项目仅供学习、研究与个人自用。使用者应自行确保行为符合当地法律法规及服务条款；因使用本项目造成的任何后果（包括但不限于账号风控、车辆损失）由使用者自行承担。作者不承担任何责任。
