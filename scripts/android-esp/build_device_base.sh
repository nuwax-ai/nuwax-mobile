#!/usr/bin/env bash
# 阶段 D：组装 Debug APK → android_debug.apk → unpackage/debug/，并可选安装真机
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=../local-base-env.sh
source "$SCRIPT_DIR/../local-base-env.sh"
MAIN_ROOT="${NUWAX_MAIN_ROOT}"
ANDROID_ESP_WORK="${ANDROID_ESP_WORK}"
PROJ="${ANDROID_ESP_PROJECT:-$ANDROID_ESP_WORK/project}"
OUT_DIR="${ANDROID_CUSTOM_BASE_OUT:-$WT_ROOT/out/android-custom-base}"
BUNDLE="${ANDROID_BUNDLE_ID:-com.nuwax.nuwa}"

export APP_RESOURCES_DIR="${APP_RESOURCES_DIR:-$WT_ROOT/unpackage/resources/app-android}"

mkdir -p "$OUT_DIR"

# shellcheck source=ensure_env.sh
source "$SCRIPT_DIR/ensure_env.sh"
ensure_gradle_wrapper_jar "$PROJ"
write_local_properties "$PROJ"

echo "==== 1) sync + inject + configure ===="
"$SCRIPT_DIR/sync_local_pack_resources.sh"
python3 "$SCRIPT_DIR/configure_app.py"

echo "==== 2) gradlew :app:assembleDebug ===="
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
./gradlew :app:assembleDebug --stacktrace

APK="$PROJ/app/build/outputs/apk/debug/app-debug.apk"
if [[ ! -f "$APK" ]]; then
  # 兼容可能的命名
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

# 官方方案1：android_debug.apk → unpackage/debug/
for DBG in "$WT_ROOT/unpackage/debug" "$MAIN_ROOT/unpackage/debug"; do
  mkdir -p "$DBG"
  cp -f "$DEST" "$DBG/android_debug.apk"
  echo "✓ 已写入 $DBG/android_debug.apk"
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
echo "HX 方案1: unpackage/debug/android_debug.apk → 使用自定义基座运行"
echo "AS 打开: open -a 'Android Studio' \"$PROJ\""
