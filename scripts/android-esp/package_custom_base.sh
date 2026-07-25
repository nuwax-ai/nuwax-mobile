#!/usr/bin/env bash
# 只生成 Android 自定义基座包（不安装、不启动设备）
# 产物：unpackage/debug/android_debug.apk
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

echo "==== 2) gradlew :app:assembleDebug（仅出包）===="
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
./gradlew :app:assembleDebug --stacktrace

APK="$PROJ/app/build/outputs/apk/debug/app-debug.apk"
if [[ ! -f "$APK" ]]; then
  APK="$(find "$PROJ/app/build/outputs/apk" -name '*.apk' | head -1 || true)"
fi
if [[ -z "${APK:-}" || ! -f "$APK" ]]; then
  echo "✗ 未找到 debug apk" >&2
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$OUT_DIR/android_debug-$STAMP.apk"
cp -f "$APK" "$DEST"
ln -sfn "$(basename "$DEST")" "$OUT_DIR/android_debug-latest.apk"

for DBG in "$WT_ROOT/unpackage/debug" "$MAIN_ROOT/unpackage/debug"; do
  mkdir -p "$DBG"
  cp -f "$DEST" "$DBG/android_debug.apk"
  echo "✓ 已写入 $DBG/android_debug.apk"
done

echo ""
echo "==== 完成（未安装设备）===="
echo "HX 自定义基座: unpackage/debug/android_debug.apk"
echo "归档: $DEST"
