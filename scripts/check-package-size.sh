#!/usr/bin/env bash
# 拦截多余的 Android ABI，按字节预估云打包输入并检查最终安装包。
#
# 用法：pnpm size:check [--cloud-input <appResource 根目录>] [<APK 或 IPA 路径> ...]
# 背景：DCloud 云打包按「编译后、压缩前」的项目体积计费，免费额度 60MB。
#   uni_modules UTS 插件（uni-highlight / uni-cmark）的 x86、x86_64 ABI
#   仅 Intel 模拟器使用，两个 ABI 合计约 15M，已于 2026-09 物理删除
#   （真机全 arm，Apple Silicon 模拟器为 arm64 镜像）。
#   armeabi-v7a（32 位 arm，合计约 6.8M）于 2026-10 删除：manifest 的
#   abiFilters 本就只有 arm64-v8a，v7a .so 从未进过 APK，纯属项目目录
#   计费死重。上游插件更新会把它们带回来，由本脚本拦截。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

fail=0

# 1) uni_modules 下不允许出现 x86 / x86_64 / armeabi-v7a ABI 目录
found="$(find "$ROOT_DIR/uni_modules" -type d \( -name x86 -o -name x86_64 -o -name armeabi-v7a \) -path '*/utssdk/app-android/libs/*' -print 2>/dev/null || true)"
if [ -n "$found" ]; then
  echo "✖ uni_modules 下存在 x86/x86_64/armeabi-v7a ABI 目录（合计约 15M+6.8M，会顶破 60MB 免费额度），请删除：" >&2
  echo "$found" >&2
  fail=1
fi

# 2) appResource 是上传计费的本地估算。APK/IPA 另按最终文件的实际字节数检查。
node - "$ROOT_DIR" "$@" <<'NODE' || fail=1
const fs = require('node:fs');
const path = require('node:path');
const [root, ...args] = process.argv.slice(2);
const requireResources = args[0] === '--cloud-input';
if (requireResources && (!args[1] || args[1].startsWith('--'))) {
  console.error('用法：pnpm size:check --cloud-input <appResource 根目录> [<APK 或 IPA 路径> ...]');
  process.exit(2);
}
const resources = requireResources ? args[1] : path.join(root, 'unpackage/resources');
const packages = requireResources ? args.slice(2) : args;
const limit = 60_000_000;

function sumFileBytes(directory) {
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) total += sumFileBytes(file);
    if (entry.isFile()) total += fs.statSync(file).size;
  }
  return total;
}

function report(label, bytes, exceeds) {
  const size = `${bytes.toLocaleString('en-US')} 字节`;
  if (exceeds) {
    console.error(`✖ ${label} ${size}，达到或超过本项 60 MB 限制`);
    process.exitCode = 1;
  } else if (bytes >= 55_000_000) {
    console.warn(`⚠ ${label} ${size}，接近 60 MB`);
  } else {
    console.log(`✓ ${label} ${size}`);
  }
}

for (const platform of ['app-android', 'app-ios']) {
  const directory = path.join(resources, platform);
  if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
    console.log(`· 找不到 ${platform} 的 appResource 导出`);
    if (requireResources) process.exitCode = 1;
    continue;
  }
  const bytes = sumFileBytes(directory);
  if (bytes === 0 && requireResources) process.exitCode = 1;
  report(`${platform} 云打包输入估算`, bytes, bytes >= limit);
}

for (const file of packages) {
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!/\.(apk|ipa)$/i.test(file) || !stat?.isFile() || stat.size === 0) {
    console.error(`✖ APK/IPA 文件无效 ${file}`);
    process.exitCode = 1;
    continue;
  }
  report(`安装包 ${file}`, stat.size, stat.size > limit);
}
NODE

exit "$fail"
