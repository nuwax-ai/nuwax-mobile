#!/usr/bin/env bash
# 阶段 D：组装 APK → unpackage/debug/，并可选安装真机
#
# ANDROID_BUILD_TYPE=debug（默认）→ android_debug.apk（HX 自定义基座联调）
# ANDROID_BUILD_TYPE=release      → android_release.apk（接近发行性能，与调试包共用正式签名）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=../local-base-env.sh
source "$SCRIPT_DIR/../local-base-env.sh"
export ANDROID_SIGNING_MODE="${ANDROID_SIGNING_MODE:-release}"
MAIN_ROOT="${NUWAX_MAIN_ROOT}"
ANDROID_ESP_WORK="${ANDROID_ESP_WORK}"
PROJ="${ANDROID_ESP_PROJECT:-$ANDROID_ESP_WORK/project}"
OUT_DIR="${ANDROID_CUSTOM_BASE_OUT:-$WT_ROOT/out/android-custom-base}"
BUNDLE="${ANDROID_BUNDLE_ID:-com.nuwax.app}"

BUILD_TYPE="$(echo "${ANDROID_BUILD_TYPE:-debug}" | tr '[:upper:]' '[:lower:]')"
case "$BUILD_TYPE" in
  debug|release) ;;
  *)
    echo "✗ ANDROID_BUILD_TYPE 仅支持 debug|release，当前=$BUILD_TYPE" >&2
    exit 1
    ;;
esac
if [[ "$BUILD_TYPE" == "release" ]]; then
  GRADLE_TASK=":app:assembleRelease"
else
  GRADLE_TASK=":app:assembleDebug"
fi
OUT_NAME="android_${BUILD_TYPE}"

export APP_RESOURCES_DIR="${APP_RESOURCES_DIR:-$WT_ROOT/unpackage/resources/app-android}"

mkdir -p "$OUT_DIR"

# shellcheck source=ensure_env.sh
source "$SCRIPT_DIR/ensure_env.sh"
ensure_gradle_wrapper_jar "$PROJ"
write_local_properties "$PROJ"

echo "==== 1) sync + inject + configure ===="
"$SCRIPT_DIR/sync_local_pack_resources.sh"
python3 "$SCRIPT_DIR/configure_app.py"

echo "==== 2) gradlew ${GRADLE_TASK} (BUILD_TYPE=${BUILD_TYPE}) ===="
cd "$PROJ"
chmod +x ./gradlew
if [[ -z "${JAVA_HOME:-}" ]]; then
  echo "✗ 未找到 JAVA_HOME（请安装 Android Studio JBR 或 OpenJDK 17）" >&2
  exit 1
fi
if [[ -z "${ANDROID_HOME:-}" ]]; then
  echo "✗ 未找到 ANDROID_HOME（需含 platforms/）" >&2
  exit 1
fi
echo "JAVA_HOME=$JAVA_HOME"
echo "ANDROID_HOME=$ANDROID_HOME"
./gradlew "$GRADLE_TASK" --stacktrace

APK="$PROJ/app/build/outputs/apk/${BUILD_TYPE}/app-${BUILD_TYPE}.apk"
if [[ ! -f "$APK" ]]; then
  APK="$(find "$PROJ/app/build/outputs/apk/${BUILD_TYPE}" -name '*.apk' 2>/dev/null | head -1 || true)"
fi
if [[ -z "${APK:-}" || ! -f "$APK" ]]; then
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

# 官方方案1：产物落到 unpackage/debug/
for DBG in "$WT_ROOT/unpackage/debug" "$MAIN_ROOT/unpackage/debug"; do
  mkdir -p "$DBG"
  cp -f "$DEST" "$DBG/${OUT_NAME}.apk"
  echo "✓ 已写入 $DBG/${OUT_NAME}.apk"
done

echo "==== 3) 可选安装真机 ===="
if [[ "${SKIP_INSTALL:-0}" == "1" ]]; then
  echo "SKIP_INSTALL=1，跳过安装（仅出包）"
else
  ADB="${ADB:-}"
  if [[ -z "$ADB" ]]; then
    if command -v adb >/dev/null 2>&1; then
      ADB=adb
    else
      ADB=/Applications/HBuilderX.app/Contents/HBuilderX/plugins/launcher-tools/tools/adbs/adb
    fi
  fi
  if [[ -x "$ADB" ]] || command -v "$ADB" >/dev/null 2>&1; then
    DEV="$("$ADB" devices | awk 'NR>1 && $2=="device"{print $1; exit}')"
    if [[ -n "${DEV:-}" ]]; then
      "$ADB" -s "$DEV" install -r "$DEST"
      echo "✓ 已安装到 $DEV ($BUNDLE)"
      echo "  启动: $ADB -s $DEV shell am start -n $BUNDLE/io.dcloud.uniapp.UniAppActivity"
    else
      echo "⚠ 无已连接 adb device，跳过安装"
    fi
  else
    echo "⚠ 无 adb，跳过安装"
  fi
fi

echo ""
echo "==== 完成 ===="
echo "产物: $DEST"
echo "交付: unpackage/debug/${OUT_NAME}.apk"
if [[ "$BUILD_TYPE" == "debug" ]]; then
  echo "HX 方案1: unpackage/debug/android_debug.apk → 使用自定义基座运行"
fi
echo "AS 打开: open -a 'Android Studio' \"$PROJ\""
