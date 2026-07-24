#!/usr/bin/env bash
# 阶段 A：校验 / 引导 UniAppX Android 5.15 离线 SDK 工作副本
#
# 官方包：Android-uni-app-x-SDK@14915-5.15
# 下载：https://web-ext-storage.dcloud.net.cn/uni-app-x/sdk/Android/Android-uni-app-x-SDK@14915-5.15.zip
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
# shellcheck source=../../local-base-env.sh
source "$SCRIPT_DIR/../../local-base-env.sh"

UNIAPPX_ANDROID_SDK_ROOT="${UNIAPPX_ANDROID_SDK_ROOT}"
ANDROID_ESP_WORK="${ANDROID_ESP_WORK}"
SDK_ZIP="${ANDROID_SDK_ZIP:-$NUWAX_SDK_ARCHIVES/UniAppX-Android-${NUWAX_HX_VERSION}.zip}"
SDK_URL="${ANDROID_SDK_URL:-https://web-ext-storage.dcloud.net.cn/uni-app-x/sdk/Android/Android-uni-app-x-SDK@14915-${NUWAX_HX_VERSION}.zip}"

download_sdk() {
  if [[ -d "$UNIAPPX_ANDROID_SDK_ROOT/uniappxnativepackage" ]]; then
    echo "✓ SDK 已存在: $UNIAPPX_ANDROID_SDK_ROOT"
    return 0
  fi
  mkdir -p "$(dirname "$SDK_ZIP")"
  if [[ ! -f "$SDK_ZIP" ]]; then
    echo "下载 Android SDK 5.15 ..."
    curl -L --fail --progress-bar -o "$SDK_ZIP" "$SDK_URL"
  fi
  local dest
  dest="$(dirname "$UNIAPPX_ANDROID_SDK_ROOT")"
  mkdir -p "$dest"
  unzip -q -o "$SDK_ZIP" -d "$dest"
  echo "✓ 解压到 $dest"
}

bootstrap_work() {
  mkdir -p "$ANDROID_ESP_WORK"
  local target="$ANDROID_ESP_WORK/Android-uni-app-x-SDK@14915-5.15"
  if [[ ! -d "$target/uniappxnativepackage" ]] || [[ "${FORCE_BOOTSTRAP:-0}" == "1" ]]; then
    echo "同步工作副本 → $target"
    rm -rf "$target"
    rsync -a --exclude '__MACOSX' --exclude '.DS_Store' --exclude '*/build/' \
      "$UNIAPPX_ANDROID_SDK_ROOT/" "$target/"
  fi
  ln -sfn "$target" "$ANDROID_ESP_WORK/sdk-root"
  ln -sfn "$target/uniappxnativepackage" "$ANDROID_ESP_WORK/project"
  echo "✓ ANDROID_ESP_WORK=$ANDROID_ESP_WORK"
  echo "  project=$ANDROID_ESP_WORK/project"
}

download_sdk
# 若用户只解压了 zip，校正 ROOT
if [[ ! -d "$UNIAPPX_ANDROID_SDK_ROOT/uniappxnativepackage" ]]; then
  ALT="$NUWAX_SDK_ROOT/android/${NUWAX_HX_VERSION}/Android-uni-app-x-SDK@14915-${NUWAX_HX_VERSION}"
  if [[ -d "$ALT/uniappxnativepackage" ]]; then
    UNIAPPX_ANDROID_SDK_ROOT="$ALT"
  fi
fi
bootstrap_work

# 基本校验
PROJ="$ANDROID_ESP_WORK/project"
test -f "$PROJ/settings.gradle"
test -f "$ANDROID_ESP_WORK/sdk-root/plugins/uts-kotlin-gradle-plugin-0.0.1.jar"
test -d "$ANDROID_ESP_WORK/sdk-root/SDK/libs"

# shellcheck source=../ensure_env.sh
source "$SCRIPT_DIR/../ensure_env.sh"
ensure_gradle_wrapper_jar "$PROJ"
write_local_properties "$PROJ"

echo "✓ 官方示例工程与 uts-kotlin 插件就绪"
echo "下一步: python3 $WT_ROOT/scripts/android-esp/configure_app.py"
echo "        $WT_ROOT/scripts/android-esp/inject_esp_module.sh"
