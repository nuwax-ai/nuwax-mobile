#!/usr/bin/env bash
# 在 iOS 模拟器上冒烟本地自定义基座（不验证 BLE/GOT_IP）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../local-base-env.sh
source "$SCRIPT_DIR/../local-base-env.sh"

UNIAPPX_SDK_ROOT="${UNIAPPX_SDK_ROOT}"
SIM_UDID="${SIM_UDID:-8ABDF725-C3A3-47DD-AA3C-AFA7CCA142CA}"
DD="${DEMO_SIM_DERIVED_DATA:-$IOS_ESP_BUILD_ROOT/build/DemoSimDerivedData}"
PROJ="$UNIAPPX_SDK_ROOT/UniAppXDemo/UniAppXDemo.xcodeproj"
APP="$DD/Build/Products/Debug-iphonesimulator/UniAppX.app"

mkdir -p "$DD"
xcrun simctl boot "$SIM_UDID" 2>/dev/null || true
open -a Simulator

echo "==== build simulator ===="
xcodebuild -project "$PROJ" -scheme UniAppX -configuration Debug \
  -destination "platform=iOS Simulator,id=$SIM_UDID" \
  -derivedDataPath "$DD" \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO build

echo "==== install + launch ===="
xcrun simctl uninstall "$SIM_UDID" com.nuwax.nuwa 2>/dev/null || true
xcrun simctl install "$SIM_UDID" "$APP"
xcrun simctl launch "$SIM_UDID" com.nuwax.nuwa

echo "✓ 已在模拟器启动 com.nuwax.nuwa"
echo "  检查 Frameworks："
xcrun simctl get_app_container "$SIM_UDID" com.nuwax.nuwa | while read -r c; do
  ls "$c/Frameworks" 2>/dev/null | grep -E 'ESPProvision|SwiftProtobuf|NuwaxEsp' || true
done
