#!/usr/bin/env bash
# 只生成 Android 自定义基座 / 内测完整包（不安装、不启动设备）
#
# 产物：
#   ANDROID_BUILD_TYPE=debug（默认）→ unpackage/debug/android_debug.apk
#   ANDROID_BUILD_TYPE=release      → unpackage/debug/android_release.apk
#     （debuggable=false，接近发行性能；内测用 debug 签名，见 configure_app.py）
#
# 给测试同学发「接近发行版」包示例：
#   ENABLE_HX_DEBUG=0 ANDROID_BUILD_TYPE=release make base-android
#
# 前置：HX「生成本地打包 App 资源」→ unpackage/resources/app-android/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=../local-base-env.sh
source "$SCRIPT_DIR/../local-base-env.sh"
MAIN_ROOT="${NUWAX_MAIN_ROOT}"
ANDROID_ESP_WORK="${ANDROID_ESP_WORK}"
PROJ="${ANDROID_ESP_PROJECT:-$ANDROID_ESP_WORK/project}"
OUT_DIR="${ANDROID_CUSTOM_BASE_OUT:-$WT_ROOT/out/android-custom-base}"

# debug = 联调基座；release = 去调试、性能接近正式（仍非上架证书）
BUILD_TYPE="$(echo "${ANDROID_BUILD_TYPE:-debug}" | tr '[:upper:]' '[:lower:]')"
case "$BUILD_TYPE" in
  debug|release) ;;
  *)
    echo "✗ ANDROID_BUILD_TYPE 仅支持 debug|release，当前=$BUILD_TYPE" >&2
    exit 1
    ;;
esac
# 显式拼 assembleDebug / assembleRelease，避免中文括号黏住 $VAR 名（set -u 会报 unbound）
if [[ "$BUILD_TYPE" == "release" ]]; then
  GRADLE_TASK=":app:assembleRelease"
else
  GRADLE_TASK=":app:assembleDebug"
fi
OUT_NAME="android_${BUILD_TYPE}"

export APP_RESOURCES_DIR="${APP_RESOURCES_DIR:-$WT_ROOT/unpackage/resources/app-android}"
export SKIP_INSTALL=1

mkdir -p "$OUT_DIR"

# shellcheck source=ensure_env.sh
source "$SCRIPT_DIR/ensure_env.sh"

# 自动引导：project 未就绪（如 sdk-fetch 后 work/ 为空）时跑 setup_sdk，让 fetch → base-android 一键成立
if [[ ! -e "$PROJ/settings.gradle" ]]; then
  echo "==== 0) 自动引导工作副本（official/setup_sdk.sh）===="
  bash "$SCRIPT_DIR/official/setup_sdk.sh"
fi

ensure_gradle_wrapper_jar "$PROJ"
write_local_properties "$PROJ"

echo "==== 1) sync + inject + configure ===="
"$SCRIPT_DIR/sync_local_pack_resources.sh"
python3 "$SCRIPT_DIR/configure_app.py"

echo "==== 2) gradlew ${GRADLE_TASK} (pack only, BUILD_TYPE=${BUILD_TYPE}) ===="
cd "$PROJ"
chmod +x ./gradlew
if [[ -z "${JAVA_HOME:-}" ]]; then
  echo "✗ 未找到 JAVA_HOME" >&2
  exit 1
fi
if [[ -z "${ANDROID_HOME:-}" ]]; then
  echo "✗ 未找到 ANDROID_HOME" >&2
  exit 1
fi
./gradlew "$GRADLE_TASK" --stacktrace

APK="$PROJ/app/build/outputs/apk/${BUILD_TYPE}/app-${BUILD_TYPE}.apk"
if [[ ! -f "$APK" ]]; then
  APK="$(find "$PROJ/app/build/outputs/apk/${BUILD_TYPE}" -name '*.apk' 2>/dev/null | head -1 || true)"
fi
if [[ -z "${APK:-}" || ! -f "$APK" ]]; then
  # 兜底：任意变体产物
  APK="$(find "$PROJ/app/build/outputs/apk" -name '*.apk' | head -1 || true)"
fi
if [[ -z "${APK:-}" || ! -f "$APK" ]]; then
  echo "✗ 未找到 ${BUILD_TYPE} apk" >&2
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$OUT_DIR/${OUT_NAME}-$STAMP.apk"
cp -f "$APK" "$DEST"
ln -sfn "$(basename "$DEST")" "$OUT_DIR/${OUT_NAME}-latest.apk"

for DBG in "$WT_ROOT/unpackage/debug" "$MAIN_ROOT/unpackage/debug"; do
  mkdir -p "$DBG"
  cp -f "$DEST" "$DBG/${OUT_NAME}.apk"
  echo "✓ 已写入 $DBG/${OUT_NAME}.apk"
done

echo ""
echo "==== 完成（未安装设备）===="
echo "产物名: unpackage/debug/${OUT_NAME}.apk"
echo "归档: $DEST"
if [[ "$BUILD_TYPE" == "release" ]]; then
  echo "说明: Release + ENABLE_HX_DEBUG 当前值=${ENABLE_HX_DEBUG:-默认1}；发测试建议 ENABLE_HX_DEBUG=0"
fi
