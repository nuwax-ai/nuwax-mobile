#!/usr/bin/env bash
# vapor（蒸汽模式）开发环境一键初始化
# 用法：bash scripts/setup-vapor.sh
#
# 前置：已 git clone 仓库 + 切到 feat/nuwa-zhuoda-2026.07-vapor 分支
# 本脚本完成：SDK 拉取 → 密钥配置 → 自定义基座拉取 → 验证
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 颜色
G="\033[32m"
Y="\033[33m"
R="\033[31m"
B="\033[34m"
N="\033[0m"

log()  { echo -e "${G}[✓]${N} $1"; }
warn() { echo -e "${Y}[⚠]${N} $1"; }
err()  { echo -e "${R}[✗]${N} $1"; exit 1; }
step() { echo -e "\n${B}━━━ $1 ━━━${N}"; }

# ─── 检查分支 ───
step "0/5 检查分支"
BRANCH="$(git branch --show-current)"
if [[ "$BRANCH" != *vapor* ]]; then
  warn "当前分支 $BRANCH 不是 vapor 分支。"
  warn "vapor 模式需要 feat/nuwa-zhuoda-2026.07-vapor 分支。"
  read -p "是否继续？(y/N) " yn
  [[ "$yn" == "y" || "$yn" == "Y" ]] || exit 0
fi
log "分支: $BRANCH"

# ─── 检查 HBuilderX Alpha ───
step "1/5 检查 HBuilderX Alpha"
HX_ALPHA="/Applications/HBuilderX-Alpha.app"
if [ -d "$HX_ALPHA" ]; then
  HX_VER="$("$HX_ALPHA/Contents/MacOS/cli" --version 2>/dev/null | head -1)"
  log "HBuilderX Alpha: $HX_VER"
  if [[ "$HX_VER" != *"5.23"* ]]; then
    warn "版本不是 5.23（$HX_VER），vapor 需要 Alpha 5.23+"
    warn "下载：https://www.dcloud.io/hbuilderx-alpha.html"
  fi
else
  warn "未找到 HBuilderX Alpha（/Applications/HBuilderX-Alpha.app）"
  warn "vapor 必须 Alpha 5.23+，不能用稳定版 5.15"
  warn "下载：https://www.dcloud.io/hbuilderx-alpha.html"
  read -p "已安装好后继续？(y/N) " yn
  [[ "$yn" == "y" || "$yn" == "Y" ]] || exit 0
fi

# ─── 拉离线 SDK ───
step "2/5 离线 SDK"
SDK_HOME="$HOME/workspace/nuwax-mobile-offline-sdk"
if [ -d "$SDK_HOME/sdk/android/5.23" ]; then
  log "离线 SDK 已存在: $SDK_HOME/sdk/android/5.23"
else
  warn "离线 SDK 未找到，开始拉取（~1GB，需几分钟）..."
  make sdk-fetch || err "sdk-fetch 失败。手动：NUWAX_S3_INSECURE=1 make sdk-fetch"
  log "离线 SDK 拉取完成"
fi
# 验证 SDK
SDK_DIR="$SDK_HOME/sdk/android/5.23/Android-uni-app-x-SDK@14987-5.23"
if [ ! -d "$SDK_DIR" ]; then
  err "SDK 目录不存在: $SDK_DIR\n手动：make sdk-fetch"
fi
log "SDK 路径: $SDK_DIR"

# ─── 配置密钥 ───
step "3/5 密钥配置"
SECRETS="$ROOT/scripts/local-secrets.env"
SECRETS_EXAMPLE="$ROOT/scripts/local-secrets.env.example"
if [ -f "$SECRETS" ]; then
  log "local-secrets.env 已存在"
else
  if [ -f "$SECRETS_EXAMPLE" ]; then
    cp "$SECRETS_EXAMPLE" "$SECRETS"
    log "已从 .example 复制 local-secrets.env"
  else
    warn "找不到 .example，手动创建 scripts/local-secrets.env"
  fi
  warn "请编辑 scripts/local-secrets.env 填入 DCLOUD_APPKEY（从同事/1Password 获取）"
  warn "iOS 真机还需 IOS_DEVELOPMENT_TEAM / IOS_PROVISIONING_PROFILE_UUID"
fi
# 验证 AppKey
if grep -q 'DCLOUD_APPKEY=""' "$SECRETS" 2>/dev/null; then
  warn "DCLOUD_APPKEY 为空！请编辑 scripts/local-secrets.env 填入"
else
  log "DCLOUD_APPKEY 已配置"
fi

# ─── 拉 vapor 自定义基座 ───
step "4/5 vapor 自定义基座"
BASE_APK="$ROOT/unpackage/debug/android_debug.apk"
if [ -f "$BASE_APK" ]; then
  SIZE=$(du -h "$BASE_APK" | awk '{print $1}')
  log "基座已存在: unpackage/debug/android_debug.apk ($SIZE)"
else
  warn "vapor 自定义基座未找到，开始拉取（~200MB）..."
  make base-fetch || err "base-fetch 失败。手动：NUWAX_S3_INSECURE=1 make base-fetch"
  log "基座拉取完成"
fi

# ─── 验证 ───
step "5/5 验证"
PASS=true

# manifest vapor 配置
VAPOR_CFG=$(python3 -c "
import json
try:
    c = json.load(open('$ROOT/manifest.json')).get('uni-app-x', {})
    print(c.get('vapor'), c.get('styleIsolationVersion'), c.get('vapor-render-target'))
except: print('ERR')
" 2>/dev/null)
if [[ "$VAPOR_CFG" == *"True"* ]]; then
  log "manifest vapor 配置正确: $VAPOR_CFG"
else
  warn "manifest vapor 配置异常: $VAPOR_CFG（应为 vapor:true, styleIsolationVersion:2, vapor-render-target:bytecode）"
  PASS=false
fi

# local-base-env
if [ -f "$ROOT/scripts/local-base-env.sh" ]; then
  log "local-base-env.sh 存在"
else
  warn "scripts/local-base-env.sh 不存在"
  PASS=false
fi

# 离线 SDK work 目录
WORK_DIR="$SDK_HOME/work/android/project"
if [ -L "$WORK_DIR" ] || [ -d "$WORK_DIR" ]; then
  log "work 目录就绪: $WORK_DIR"
else
  warn "work 目录不存在（首次构建时自动创建）"
fi

# ─── 总结 ───
echo ""
echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
if [ "$PASS" == "true" ]; then
  echo -e "${G}  ✅ vapor 开发环境就绪！${N}"
else
  echo -e "${Y}  ⚠️  基本就绪，但有警告项需检查${N}"
fi
echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
echo ""
cat <<'EOF'

  接下来在 HBuilderX Alpha 里运行 vapor：

  1. 启动 HBuilderX Alpha（必须 Alpha 5.23+，不是稳定版）
  2. 打开项目 nuwax-mobile（已导入则直接用）
  3. 运行 → 运行到手机或模拟器 → 运行到 Android App 基座
  4. 选择「自定义基座」→ 选 unpackage/debug/ 下的 vapor 基座 apk
  5. 选设备（模拟器或真机）→ 运行

  ⚠️ 注意事项：
  • 改业务代码（uvue/uts）不用重打基座，HX 热推 www（几分钟）
  • 改 native 插件（kotlin/swift）才需重打：make base-android（10-20 分钟）
  • iOS vapor 暂不支持（本轮只做 Android）
  • 独立离线 APK 当前卡启动屏（path-a），用 HX 自定义基座或云打包
  • vapor CSS 只支持简单 class 选择器（后代/复合/伪类会被丢），见 AGENTS.md

  文档：
  • AGENTS.md →「vapor 开发约束」节
  • docs/vapor-tech-debt.md → 进度 + 附 D 官方约束摘要

EOF
