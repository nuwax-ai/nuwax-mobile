#!/usr/bin/env bash
# 云打包计费体积守门：拦截 x86/x86_64 .so 回流 + 本地编译产物体积告警。
#
# 用法：bash scripts/check-package-size.sh  （即 pnpm size:check）
# 背景：DCloud 云打包按「编译后、压缩前」的项目体积计费，免费额度 60MB。
#   uni_modules UTS 插件（uni-highlight / uni-cmark）的 x86、x86_64 ABI
#   仅 Intel 模拟器使用，两个 ABI 合计约 15M，已于 2026-09 物理删除
#   （真机全 arm，Apple Silicon 模拟器为 arm64 镜像）。上游插件更新会把
#   它们带回来，由本脚本拦截。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

fail=0

# 1) uni_modules 下不允许出现 x86 / x86_64 ABI 目录
found="$(find "$ROOT_DIR/uni_modules" -type d \( -name x86 -o -name x86_64 \) -path '*/utssdk/app-android/libs/*' -print 2>/dev/null || true)"
if [ -n "$found" ]; then
  echo "✖ uni_modules 下存在 x86/x86_64 ABI 目录（约 15M，会顶破 60MB 免费额度），请删除：" >&2
  echo "$found" >&2
  fail=1
fi

# 2) 本地 app-android 编译产物体积（make app-resource 产出，口径≈云打包计费体积）
DIST="$ROOT_DIR/unpackage/dist/build/app-android"
if [ -d "$DIST" ]; then
  size_mb=$(( $(du -sk "$DIST" | cut -f1) / 1024 ))
  if [ "$size_mb" -gt 60 ]; then
    echo "✖ unpackage/dist/build/app-android 为 ${size_mb}M，超云打包 60MB 免费额度（计费=编译后未压缩体积）" >&2
    fail=1
  elif [ "$size_mb" -gt 55 ]; then
    echo "⚠ unpackage/dist/build/app-android 为 ${size_mb}M，逼近 60MB 计费阈值，建议提前瘦身" >&2
  else
    echo "✓ app-android 编译产物 ${size_mb}M（< 55M，额度内）"
  fi
else
  echo "· 无本地 app-android 编译产物（make app-resource 后才会检查该项）"
fi

exit "$fail"
