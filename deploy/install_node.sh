#!/bin/bash
# ============================================================
# Node.js 22 LTS 一键安装（幂等，可重复执行）
# 安装到 /usr/local/node-v22，并软链 /usr/local/bin/{node,npm,npx}
# 国内服务器走 npmmirror 镜像，失败自动回退 nodejs.org
# 用法：bash install_node.sh   （可选 NODE_VER=v22.22.2 bash install_node.sh）
# ============================================================
set -e

NODE_VER=${NODE_VER:-v22.22.2}
PREFIX=/usr/local/node-v22

ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  NARCH=x64 ;;
  aarch64) NARCH=arm64 ;;
  *) echo "不支持的架构: $ARCH"; exit 1 ;;
esac

FILE="node-${NODE_VER}-linux-${NARCH}.tar.xz"

if [ -x "$PREFIX/bin/node" ] && "$PREFIX/bin/node" -v 2>/dev/null | grep -q "$NODE_VER"; then
  echo "Node ${NODE_VER} 已安装于 ${PREFIX}，跳过下载"
else
  echo "==> 下载 Node ${NODE_VER}（${NARCH}）..."
  OK=0
  for BASE in \
    "https://cdn.npmmirror.com/binaries/node/${NODE_VER}" \
    "https://npmmirror.com/mirrors/node/${NODE_VER}" \
    "https://nodejs.org/dist/${NODE_VER}"; do
    echo "    尝试 $BASE ..."
    if curl -fL --connect-timeout 15 --retry 2 -o "/tmp/${FILE}" "$BASE/${FILE}"; then
      OK=1
      break
    fi
  done
  [ "$OK" = "1" ] || { echo "错误：所有下载源均失败，请检查网络"; exit 1; }

  echo "==> 解压到 ${PREFIX} ..."
  mkdir -p "$PREFIX"
  tar -xJf "/tmp/${FILE}" -C "$PREFIX" --strip-components=1
  rm -f "/tmp/${FILE}"
fi

ln -sf "$PREFIX/bin/node" /usr/local/bin/node
ln -sf "$PREFIX/bin/npm"  /usr/local/bin/npm
ln -sf "$PREFIX/bin/npx"  /usr/local/bin/npx

echo "完成：$(node -v)  npm $(npm -v 2>/dev/null || echo n/a)  路径 $PREFIX/bin/node"
