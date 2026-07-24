#!/usr/bin/env bash
# 只生成 iOS【模拟器】自定义基座包（不启动 Simulator、不安装）
# 产物：unpackage/debug/Pandora_simulator_debug.app（官方云打包命名）
#
# 需要带 iphonesimulator slice 的 ESP xcframework：
#   OFFICIAL_PLATFORM=all ./scripts/ios-esp/official/build_esp_chain.sh
# 本脚本在缺 slice 时会自动尝试补编（可用 SKIP_ESP_CHAIN=1 跳过）。
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

DD="${DEMO_SIM_DERIVED_DATA:-$IOS_ESP_BUILD_ROOT/build/DemoSimDerivedData}"
OUT_DIR="${CUSTOM_BASE_OUT:-$WT_ROOT/out/ios-custom-base}"
PROJ="$UNIAPPX_SDK_ROOT/UniAppXDemo/UniAppXDemo.xcodeproj"
BUNDLE="${IOS_BUNDLE_ID:-$NUWAX_BUNDLE_ID}"

mkdir -p "$DD" "$OUT_DIR" "$IOS_ESP_OUT"

need_sim_slice() {
  local xcf="$IOS_ESP_OUT/ESPProvision.xcframework"
  [[ -d "$xcf/ios-arm64_x86_64-simulator" ]] || [[ -d "$xcf/ios-arm64-simulator" ]]
}

if [[ "${SKIP_ESP_CHAIN:-0}" != "1" ]] && ! need_sim_slice; then
  echo "==== 0) 补编含模拟器 slice 的 xcframework（OFFICIAL_PLATFORM=all）===="
  OFFICIAL_PLATFORM=all "$SCRIPT_DIR/official/build_esp_chain.sh"
fi

echo "==== 1) sync 资源 + xcframework ===="
APP_RESOURCES_DIR="$APP_RESOURCES_DIR" "$SCRIPT_DIR/sync_local_pack_resources.sh"

echo "==== 2) inject / strip / configure ===="
python3 "$SCRIPT_DIR/inject_frameworks.py"
python3 "$SCRIPT_DIR/strip_sample_unimodules.py"
python3 "$SCRIPT_DIR/configure_demo.py"

echo "==== 3) xcodebuild 模拟器（generic，不启动 Simulator）===="
xcodebuild -project "$PROJ" -scheme UniAppX -configuration Debug \
  -destination "generic/platform=iOS Simulator" \
  -derivedDataPath "$DD" \
  CODE_SIGN_IDENTITY="-" \
  CODE_SIGNING_REQUIRED=NO \
  PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE" \
  build

APP="$DD/Build/Products/Debug-iphonesimulator/UniAppX.app"
if [[ ! -d "$APP" ]]; then
  echo "✗ 未找到 $APP" >&2
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
DEST_APP="$OUT_DIR/UniAppX-simulator-$STAMP.app"
rm -rf "$DEST_APP"
cp -R "$APP" "$DEST_APP"
ln -sfn "$(basename "$DEST_APP")" "$OUT_DIR/UniAppX-simulator-latest.app"

# 官方 HX 真机包名为 iOS_debug.ipa；模拟器单独一份，避免互相覆盖
for DBG in "$WT_ROOT/unpackage/debug" "$MAIN_ROOT/unpackage/debug"; do
  mkdir -p "$DBG"
  # HX 官方命名：Pandora_simulator_debug.app（见 run-app 文档）
  rm -rf "$DBG/Pandora_simulator_debug.app"
  cp -R "$APP" "$DBG/Pandora_simulator_debug.app"
  echo "✓ 已写入 $DBG/Pandora_simulator_debug.app"
done

echo ""
echo "==== 完成（模拟器包，未启动设备）===="
echo "模拟器基座: unpackage/debug/Pandora_simulator_debug.app"
echo "真机基座请用: unpackage/debug/iOS_debug.ipa（package_device_base.sh）"
echo "归档: $DEST_APP"
