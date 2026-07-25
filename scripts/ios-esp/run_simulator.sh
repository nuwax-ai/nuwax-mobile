#!/usr/bin/env bash
# 在 iOS 模拟器上冒烟本地自定义基座（不验证 BLE/GOT_IP）
#
# 与 package_simulator_base.sh 一致：默认 Release，避免 Debug blank executor
# 在无 LLDB 的 simctl launch 下立刻 SIGILL。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../local-base-env.sh
source "$SCRIPT_DIR/../local-base-env.sh"

UNIAPPX_SDK_ROOT="${UNIAPPX_SDK_ROOT}"
SIM_UDID="${SIM_UDID:-8ABDF725-C3A3-47DD-AA3C-AFA7CCA142CA}"
CONFIGURATION="${SIM_CONFIGURATION:-Release}"
SIM_FORCE_X86_64="${SIM_FORCE_X86_64:-1}"
DD="${DEMO_SIM_DERIVED_DATA:-$IOS_ESP_BUILD_ROOT/build/DemoSimDerivedData}"
PROJ="$UNIAPPX_SDK_ROOT/UniAppXDemo/UniAppXDemo.xcodeproj"
APP="$DD/Build/Products/${CONFIGURATION}-iphonesimulator/UniAppX.app"

mkdir -p "$DD"
xcrun simctl boot "$SIM_UDID" 2>/dev/null || true
open -a Simulator

XCB_EXTRA=()
if [[ "$SIM_FORCE_X86_64" == "1" ]]; then
  XCB_EXTRA+=(
    "ARCHS=x86_64"
    "ONLY_ACTIVE_ARCH=NO"
    "EXCLUDED_ARCHS[sdk=iphonesimulator*]=arm64"
  )
fi

echo "==== build simulator（configuration=${CONFIGURATION}, SIM_FORCE_X86_64=${SIM_FORCE_X86_64}）===="
xcodebuild -project "$PROJ" -scheme UniAppX -configuration "$CONFIGURATION" \
  -destination "platform=iOS Simulator,id=$SIM_UDID" \
  -derivedDataPath "$DD" \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO \
  "${XCB_EXTRA[@]}" \
  build

echo "==== install + launch ===="
xcrun simctl uninstall "$SIM_UDID" com.nuwax.nuwa 2>/dev/null || true
xcrun simctl install "$SIM_UDID" "$APP"
xcrun simctl launch "$SIM_UDID" com.nuwax.nuwa

echo "✓ 已在模拟器启动 com.nuwax.nuwa"
echo "  检查 Frameworks："
xcrun simctl get_app_container "$SIM_UDID" com.nuwax.nuwa | while read -r c; do
  ls "$c/Frameworks" 2>/dev/null | grep -E 'ESPProvision|SwiftProtobuf|NuwaxEsp' || true
done
