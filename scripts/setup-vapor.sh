#!/usr/bin/env bash
# vapor（蒸汽模式）开发环境初始化——仅运行，不打包基座
# 用法：bash scripts/setup-vapor.sh
#
# 你只需要：HBuilderX Alpha 5.23 + 预构建的 vapor 自定义基座
# 不需要离线 SDK / 不需要打包基座 / 不需要 JDK
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

G="\033[32m"; Y="\033[33m"; R="\033[31m"; B="\033[34m"; N="\033[0m"
log()  { echo -e "${G}[✓]${N} $1"; }
warn() { echo -e "${Y}[⚠]${N} $1"; }
err()  { echo -e "${R}[✗]${N} $1"; exit 1; }
step() { echo -e "\n${B}━━━ $1 ━━━${N}"; }

step "1/3 检查 HBuilderX Alpha 5.23"
HX_ALPHA="/Applications/HBuilderX-Alpha.app"
if [ -d "$HX_ALPHA" ]; then
  HX_VER="$("$HX_ALPHA/Contents/MacOS/cli" --version 2>/dev/null | head -1)"
  log "HBuilderX Alpha: $HX_VER"
  [[ "$HX_VER" == *"5.23"* ]] || warn "版本非 5.23（vapor 需要 Alpha 5.23+）"
else
  warn "未安装 HBuilderX Alpha（不能用稳定版 5.15！）"
  echo "  下载：https://www.dcloud.io/hbuilderx-alpha.html"
  read -p "  安装好后继续？(y/N) " yn; [[ "$yn" =~ ^[Yy]$ ]] || exit 0
fi

step "2/3 安装依赖 + 拉 vapor 自定义基座"
pnpm install --silent 2>/dev/null || warn "pnpm install 跳过（非 H5 开发可忽略）"

BASE="$ROOT/unpackage/debug/android_debug_vapor.apk"
if [ -f "$BASE" ]; then
  log "vapor 基座已存在: $(du -h "$BASE" | awk '{print $1}')"
else
  warn "拉取 vapor 自定义基座（~200MB）..."
  pnpm base:fetch:vapor || err "base-fetch 失败。手动：NUWAX_S3_INSECURE=1 pnpm base:fetch:vapor"
  log "vapor 基座拉取完成"
fi

step "3/3 验证"
VAPOR=$(python3 -c "import json;print(json.load(open('$ROOT/manifest.json'))['uni-app-x'].get('vapor'))" 2>/dev/null)
[[ "$VAPOR" == "True" ]] && log "manifest vapor:true ✓" || warn "manifest vapor 配置异常"
ls "$ROOT/unpackage/debug/"*vapor*.apk >/dev/null 2>&1 && log "vapor 基座 APK 就绪 ✓" || warn "未找到 vapor 基座 APK"

echo ""
echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
echo -e "${G}  ✅ 就绪！在 HBuilderX Alpha 里运行：${N}"
echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
cat <<'EOF'

  1. 启动 HBuilderX Alpha（必须 Alpha 5.23+）
  2. 打开项目 nuwax-mobile
  3. 运行 → 运行到 Android App 基座 → 选「自定义基座」
  4. 选 unpackage/debug/ 下的 vapor 基座 apk
  5. 选设备 → 运行

  改业务代码（uvue/uts）直接重跑即可（HX 热推 www，几分钟）
  不用打基座、不用 SDK、不用 JDK。

  vapor CSS 注意：只支持简单 class 选择器（后代/复合/伪类会被丢）
  详见 AGENTS.md →「vapor 开发约束」节
EOF
