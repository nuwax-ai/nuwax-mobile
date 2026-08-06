#!/usr/bin/env bash
# 只生成 iOS【真机】自定义基座包（不安装、不启动设备）
# 产物：unpackage/debug/iOS_debug.ipa
#
# 使用 generic/platform=iOS，无需连接真机。
# 前置：HX 本地打包资源 + 已有 device 侧 xcframework（默认 build_esp_chain）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=../local-base-env.sh
source "$SCRIPT_DIR/../local-base-env.sh"
MAIN_ROOT="${NUWAX_MAIN_ROOT}"

export UNIAPPX_SDK_ROOT="${UNIAPPX_SDK_ROOT}"
export IOS_ESP_OUT="${IOS_ESP_OUT}"
export APP_RESOURCES_DIR="${APP_RESOURCES_DIR:-$MAIN_ROOT/unpackage/resources/app-ios}"
export UNIAPPX_IPATYPE="${UNIAPPX_IPATYPE:-1}"

DD="${DEMO_DEVICE_DERIVED_DATA:-$IOS_ESP_BUILD_ROOT/build/DemoDeviceDerivedData}"
OUT_DIR="${CUSTOM_BASE_OUT:-$WT_ROOT/out/ios-custom-base}"
PROJ="$UNIAPPX_SDK_ROOT/UniAppXDemo/UniAppXDemo.xcodeproj"
PROFILE_UUID="${IOS_PROVISIONING_PROFILE_UUID:?set in \$NUWAX_SIGNING_HOME/local-secrets.env}"
TEAM="${IOS_DEVELOPMENT_TEAM:?set in \$NUWAX_SIGNING_HOME/local-secrets.env}"
BUNDLE="${IOS_BUNDLE_ID:-$NUWAX_BUNDLE_ID}"

mkdir -p "$DD" "$OUT_DIR" "$IOS_ESP_OUT"

echo "==== 1) sync 资源 + xcframework ===="
APP_RESOURCES_DIR="$APP_RESOURCES_DIR" "$SCRIPT_DIR/sync_local_pack_resources.sh"

echo "==== 2) inject / strip / configure ===="
python3 "$SCRIPT_DIR/inject_frameworks.py"
python3 "$SCRIPT_DIR/strip_sample_unimodules.py"
python3 "$SCRIPT_DIR/configure_demo.py"

echo "==== 3) xcodebuild 真机（generic，不连机）===="
xcodebuild -project "$PROJ" -scheme UniAppX -configuration Debug \
  -destination "generic/platform=iOS" \
  -derivedDataPath "$DD" \
  DEVELOPMENT_TEAM="$TEAM" \
  CODE_SIGN_STYLE=Manual \
  PROVISIONING_PROFILE_SPECIFIER="$PROFILE_UUID" \
  PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE" \
  build

APP="$DD/Build/Products/Debug-iphoneos/UniAppX.app"
if [[ ! -d "$APP" ]]; then
  echo "✗ 未找到 $APP" >&2
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
DEST_APP="$OUT_DIR/UniAppX-device-$STAMP.app"
rm -rf "$DEST_APP"
cp -R "$APP" "$DEST_APP"
ln -sfn "$(basename "$DEST_APP")" "$OUT_DIR/UniAppX-device-latest.app"

echo "==== 4) 打包 iOS_debug.ipa ===="
IPA_STAGING="$OUT_DIR/_ipa_staging_device"
rm -rf "$IPA_STAGING"
mkdir -p "$IPA_STAGING/Payload"
cp -R "$APP" "$IPA_STAGING/Payload/UniAppX.app"
IPA_OUT="$OUT_DIR/iOS_debug-$STAMP.ipa"
(
  cd "$IPA_STAGING"
  zip -qr "$IPA_OUT" Payload
)
ln -sfn "$(basename "$IPA_OUT")" "$OUT_DIR/iOS_debug-latest.ipa"
for DBG in "$WT_ROOT/unpackage/debug" "$MAIN_ROOT/unpackage/debug"; do
  mkdir -p "$DBG"
  cp -f "$IPA_OUT" "$DBG/iOS_debug.ipa"
  echo "✓ 已写入 $DBG/iOS_debug.ipa"
done
rm -rf "$IPA_STAGING"

echo ""
echo "==== 完成（真机包，未安装设备）===="
echo "HX 自定义基座: unpackage/debug/iOS_debug.ipa"
echo "归档 .app: $DEST_APP"
