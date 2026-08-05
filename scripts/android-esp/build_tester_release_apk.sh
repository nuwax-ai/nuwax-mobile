#!/usr/bin/env bash
# =============================================================================
# Android 发测试 Release APK · 流程化一键脚本
# =============================================================================
#
# 目标：打出接近发行性能、可直接安装的完整 APK，交给测试同学。
# 对齐：ENABLE_HX_DEBUG=0 + ANDROID_BUILD_TYPE=release
#
# 流程步骤：
#   [0/4] 环境预检（HX CLI / 离线 SDK / Android SDK）
#   [1/4] HX 生成本地打包 App 资源 → unpackage/resources/app-android
#   [2/4] 同步资源 + 注入 UTS + 出 Release 包（无 debug-server）
#   [3/4] 复制带日期的交付文件名（便于发给测试）
#   [4/4] 验收摘要（路径 / 体积 / 包名提示）
#
# 前置：
#   - HBuilderX 已启动，项目已导入为 nuwax-mobile
#   - 离线 SDK 已就绪（没有则先 make sdk-fetch）
#
# 用法：
#   make android-tester          # 或：pnpm android:tester
#   bash scripts/android-esp/build_tester_release_apk.sh
#
# 开关：
#   SKIP_APP_RESOURCE=1   跳过步骤 1（业务未改、资源已是最新时）
#   SKIP_DELIVER_COPY=1   不额外复制 nuwa-zhuoda-release-YYYYMMDD.apk
#   DELIVER_NAME=xxx.apk  覆盖交付文件名（仍写到 unpackage/debug/）
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

SKIP_APP_RESOURCE="${SKIP_APP_RESOURCE:-0}"
SKIP_DELIVER_COPY="${SKIP_DELIVER_COPY:-0}"
STAMP="$(date +%Y%m%d-%H%M)"
DELIVER_NAME="${DELIVER_NAME:-nuwa-zhuoda-release-${STAMP}.apk}"

# 发测试固定：关 HX 调试通道 + Gradle Release 变体
export ENABLE_HX_DEBUG=0
export ANDROID_BUILD_TYPE=release
export ANDROID_SIGNING_MODE=release
export SKIP_INSTALL=1
# 不强制覆盖 ANDROID_HOME：无效路径会导致误报；由 ensure_env / package_custom_base 自动探测
# （本机常见：~/Library/Android/sdk 或 ~/workspace/Android/sdk）

OUT_DIR="$ROOT_DIR/unpackage/debug"
RELEASE_APK="$OUT_DIR/android_release.apk"
DELIVER_APK="$OUT_DIR/$DELIVER_NAME"

step() {
  # $1 = 当前步 / $2 = 总步 / $3 = 标题
  echo ""
  echo "######## [$1/$2] $3 ########"
}

fail() {
  echo "✗ $*" >&2
  exit 1
}

# ---------- [0/4] 环境预检 ----------
step 0 4 "环境预检"

HX_CLI="${HX_CLI:-/Applications/HBuilderX.app/Contents/MacOS/cli}"
[[ -x "$HX_CLI" ]] || fail "找不到 HBuilderX CLI: $HX_CLI（请安装 HX 5.15+ 或设 HX_CLI）"

if ! pgrep -xq HBuilderX 2>/dev/null; then
  echo "⚠ HBuilderX 进程未检测到：步骤 1 可能失败，请先打开 HBuilderX 并导入本项目。"
else
  echo "✓ HBuilderX 已在运行"
fi

# shellcheck source=../local-base-env.sh
source "$SCRIPT_DIR/../local-base-env.sh"
# shellcheck source=ensure_env.sh
source "$SCRIPT_DIR/ensure_env.sh"
echo "✓ NUWAX_OFFLINE_SDK_HOME=${NUWAX_OFFLINE_SDK_HOME}"
echo "✓ ANDROID_ESP_WORK=${ANDROID_ESP_WORK}"
echo "✓ ANDROID_HOME=${ANDROID_HOME:-}"
echo "✓ ENABLE_HX_DEBUG=${ENABLE_HX_DEBUG}  ANDROID_BUILD_TYPE=${ANDROID_BUILD_TYPE}"

if [[ -z "${ANDROID_HOME:-}" || ! -d "${ANDROID_HOME}/platforms" ]]; then
  fail "ANDROID_HOME 无效（无 platforms/）: ${ANDROID_HOME:-unset}"
fi

# 离线 Android SDK 目录粗检（具体 work 由 package_custom_base 自动 bootstrap）
if [[ ! -d "${NUWAX_SDK_ROOT}/android" ]] && [[ ! -d "${NUWAX_OFFLINE_SDK_HOME}/sdk/android" ]]; then
  echo "⚠ 未发现离线 Android SDK，若出包失败请先：make sdk-fetch"
fi

echo ""
echo "======== Android 发测试 Release APK 流水线 ========"
echo "ROOT=$ROOT_DIR"
echo "SKIP_APP_RESOURCE=$SKIP_APP_RESOURCE"
echo "交付文件名=$DELIVER_NAME"
echo ""

# ---------- [1/4] 生成本地打包 App 资源 ----------
if [[ "$SKIP_APP_RESOURCE" == "1" ]]; then
  step 1 4 "跳过 appResource（SKIP_APP_RESOURCE=1）"
  [[ -d "$ROOT_DIR/unpackage/resources/app-android" ]] \
    || fail "unpackage/resources/app-android 不存在，请去掉 SKIP_APP_RESOURCE 重新跑"
  echo "✓ 使用已有资源: $ROOT_DIR/unpackage/resources/app-android"
else
  step 1 4 "HX：生成本地打包 App 资源（含当前业务代码）"
  echo "提示：等价菜单「发行 → 原生App-本地打包 → 生成本地打包App资源」"
  bash "$SCRIPT_DIR/../hx-cli.sh" publish app \
    --platform APP \
    --type appResource \
    --project "$ROOT_DIR"
  [[ -d "$ROOT_DIR/unpackage/resources/app-android" ]] \
    || fail "appResource 完成后仍无 unpackage/resources/app-android"
  echo "✓ 资源已导出"
fi

# HBuilderX 的 publish app 固定按 production 编译；Android tester 明确改为测试接口。
python3 "$SCRIPT_DIR/set_app_resource_api_env.py" \
  test "$ROOT_DIR/unpackage/resources/app-android"

# ---------- [2/4] Release 出包 ----------
step 2 4 "出 Release 包（无 HX debug-server，assembleRelease）"
bash "$SCRIPT_DIR/package_custom_base.sh"
[[ -f "$RELEASE_APK" ]] || fail "未生成 $RELEASE_APK"

# ---------- [3/4] 交付副本 ----------
if [[ "$SKIP_DELIVER_COPY" == "1" ]]; then
  step 3 4 "跳过交付副本（SKIP_DELIVER_COPY=1）"
  DELIVER_APK="$RELEASE_APK"
else
  step 3 4 "复制交付文件 → ${DELIVER_NAME}"
  mkdir -p "$OUT_DIR"
  cp -f "$RELEASE_APK" "$DELIVER_APK"
  echo "✓ $DELIVER_APK"
fi

# ---------- [4/4] 验收摘要 ----------
step 4 4 "验收摘要（发给测试）"
SIZE="$(du -h "$DELIVER_APK" | awk '{print $1}')"
echo "包名（applicationId）: com.nuwax.app"
echo "体积: $SIZE"
echo "主文件: $RELEASE_APK"
echo "交付: $DELIVER_APK"
echo ""
echo "测试安装说明:"
echo "  1. 允许「未知来源」安装"
echo "  2. 若已装旧包且签名冲突：先卸载再装"
echo "  3. 本包为内测 Release，与正式包使用同一签名证书"
echo ""
echo "======== 流水线完成 ========"
echo "$DELIVER_APK"
