#!/usr/bin/env bash
# 重新生成 DOM-free MathJax (TeX→SVG) 单文件 bundle（供 UTS QuickJS 插件加载）。
#
# 产物 mathjax-tex-svg.js：1.78MB raw / ~600KB gzip，自包含（字形内嵌，无外部字体/DOM 依赖）。
# 升级 MathJax 版本或改 entry 后重跑此脚本。
#
# 依赖（临时目录装，不进仓库 package.json）：mathjax-full@3 + esbuild
set -euo pipefail
cd "$(dirname "$0")"
TMP="${TMPDIR:-/tmp}/mjx-bundle-build"
mkdir -p "$TMP" && cd "$TMP"
[ -d node_modules/mathjax-full ] || npm install mathjax-full@3 esbuild --no-save >/dev/null
cp "$(dirname "$PWD")"/build-entry.js entry.js 2>/dev/null || cp "$OLDPWD/build-entry.js" entry.js
# 注意两个必须项：
#   --define:PACKAGE_VERSION=...  → 跳过 MathJax 运行时读 package.json 的 node require 分支（QuickJS 无 require）
#   --platform=neutral --format=iife → 无 DOM/无 require 的自包含 IIFE
npx esbuild entry.js --bundle --format=iife --global-name=MJX --platform=neutral \
  --target=es2020 --minify --define:PACKAGE_VERSION='"3.2.2"' \
  --outfile=mathjax-tex-svg.js
# 产物落到模块 static/（会被 uni-app x 镜像进 APK assets/apps/__UNI__8BF05E4/www/.../static/，
# UTS 插件 readMathjaxBundle 按该路径读取）。本目录只保留源（build-entry.js + regen.sh）。
OUT="$OLDPWD/../../static/x-math/mathjax-tex-svg.js"
mkdir -p "$(dirname "$OUT")"
cp mathjax-tex-svg.js "$OUT"
echo "✅ 已生成 $(wc -c < "$OUT") bytes → $OUT"
echo "   QuickJS 实测基线：bundle load ~114ms，100 公式 ~277ms（WASM 悲观估计，原生 Android 更快）"
