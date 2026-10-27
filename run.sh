#!/bin/bash
# Bydkz Linux 车控服务启动脚本
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "错误：未找到 node，请先安装 Node.js 18+（宝塔：软件商店 → Node.js 版本管理器）"
  exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "错误：Node.js 版本过低（当前 $(node -v)），需要 18 及以上"
  exit 1
fi

exec node src/index.js
