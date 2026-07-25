#!/usr/bin/env bash
# 只生成 iOS【模拟器】自定义基座包（不启动 Simulator、不安装）
# 产物：unpackage/debug/Pandora_simulator_debug.app（官方云打包命名）
#
# 配置说明（重要）：
#   1) 必须用 Release，不能用 Debug。
#      Xcode Debug 产物主二进制是 __debug_blank_executor_main 空壳，
#      只有挂上 LLDB 才能继续；主屏 / simctl launch 会立刻 SIGILL。
#   2) 默认强制 x86_64 模拟器（Rosetta）。
#      官方 5.15 DCloudUTSExtAPI 仅有 ios-x86_64-simulator，无 arm64-sim slice；
#      Apple Silicon 默认 arm64 模拟器会加载失败，表现为
#     「UTS-Storage / uni-getSystemInfo 模块不存在，请重新打自定义基座」。
#      需在「支持 Rosetta」的 iOS Simulator runtime 上运行（官方文档同要求）。
#
# 需要带 iphonesimulator slice 的 ESP xcframework：
#   OFFICIAL_PLATFORM=all ./scripts/ios-esp/official/build_esp_chain.sh
# 本脚本在缺 slice 时会自动尝试补编（可用 SKIP_ESP_CHAIN=1 跳过）。
#
# 可选环境变量：
#   SIM_CONFIGURATION     默认 Release
#   SIM_FORCE_X86_64      默认 1；设 0 则不排除 arm64（需 ExtAPI 有 arm64-sim）
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

# Release：无 blank executor，可主屏 / simctl 冷启动
CONFIGURATION="${SIM_CONFIGURATION:-Release}"
# Apple Silicon：默认打 x86_64 模拟器包，对齐 ExtAPI 仅有的 x86_64-sim slice
SIM_FORCE_X86_64="${SIM_FORCE_X86_64:-1}"
DD="${DEMO_SIM_DERIVED_DATA:-$IOS_ESP_BUILD_ROOT/build/DemoSimDerivedData}"
OUT_DIR="${CUSTOM_BASE_OUT:-$WT_ROOT/out/ios-custom-base}"
PROJ="$UNIAPPX_SDK_ROOT/UniAppXDemo/UniAppXDemo.xcodeproj"
BUNDLE="${IOS_BUNDLE_ID:-$NUWAX_BUNDLE_ID}"

mkdir -p "$DD" "$OUT_DIR" "$IOS_ESP_OUT"

need_sim_slice() {
  local xcf="$IOS_ESP_OUT/ESPProvision.xcframework"
  [[ -d "$xcf/ios-arm64_x86_64-simulator" ]] || [[ -d "$xcf/ios-arm64-simulator" ]] || [[ -d "$xcf/ios-x86_64-simulator" ]]
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

# xcodebuild 额外参数：强制模拟器架构与 ExtAPI 对齐
XCB_EXTRA=()
if [[ "$SIM_FORCE_X86_64" == "1" ]]; then
  echo "==== 架构：强制 iphonesimulator=x86_64（排除 arm64，对齐 ExtAPI）===="
  XCB_EXTRA+=(
    "ARCHS=x86_64"
    "ONLY_ACTIVE_ARCH=NO"
    "EXCLUDED_ARCHS[sdk=iphonesimulator*]=arm64"
  )
fi

echo "==== 3) xcodebuild 模拟器（configuration=${CONFIGURATION}, generic，不启动 Simulator）===="
xcodebuild -project "$PROJ" -scheme UniAppX -configuration "${CONFIGURATION}" \
  -destination "generic/platform=iOS Simulator" \
  -derivedDataPath "$DD" \
  CODE_SIGN_IDENTITY="-" \
  CODE_SIGNING_REQUIRED=NO \
  PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE" \
  "${XCB_EXTRA[@]}" \
  build

# Xcode 产物目录：Debug-iphonesimulator / Release-iphonesimulator
APP="$DD/Build/Products/${CONFIGURATION}-iphonesimulator/UniAppX.app"
if [[ ! -d "$APP" ]]; then
  echo "✗ 未找到 $APP" >&2
  exit 1
fi

EXE="$APP/UniAppX"
if [[ -f "$EXE" ]] && [[ -f "$APP/UniAppX.debug.dylib" ]]; then
  echo "⚠ 检测到 UniAppX.debug.dylib（多为 Debug blank executor）。" >&2
  echo "  无 LLDB 时主屏启动会 SIGILL。请确认 SIM_CONFIGURATION=Release 后重打。" >&2
fi

# 架构门禁：主程序含 arm64 但 ExtAPI 仅有 x86_64 → 运行时必现「模块不存在」
EXTAPI_BIN="$APP/Frameworks/DCloudUTSExtAPI.framework/DCloudUTSExtAPI"
if [[ -f "$EXE" ]] && [[ -f "$EXTAPI_BIN" ]]; then
  EXE_ARCH="$(lipo -info "$EXE" 2>/dev/null || true)"
  EXT_ARCH="$(lipo -info "$EXTAPI_BIN" 2>/dev/null || true)"
  echo "主程序: $EXE_ARCH"
  echo "ExtAPI:  $EXT_ARCH"
  if echo "$EXE_ARCH" | grep -q arm64 && ! echo "$EXT_ARCH" | grep -q arm64; then
    echo "✗ UniAppX 含 arm64，但 DCloudUTSExtAPI 无 arm64（仅 x86_64）。" >&2
    echo "  Apple Silicon 默认模拟器会报 UTS-Storage / getSystemInfo 模块不存在。" >&2
    echo "  请用默认 SIM_FORCE_X86_64=1 重打，并在「Rosetta」模拟器 runtime 上运行。" >&2
    exit 1
  fi
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
DEST_APP="$OUT_DIR/UniAppX-simulator-$STAMP.app"
rm -rf "$DEST_APP"
cp -R "$APP" "$DEST_APP"
ln -sfn "$(basename "$DEST_APP")" "$OUT_DIR/UniAppX-simulator-latest.app"

# 官方 HX 真机包名为 iOS_debug.ipa；模拟器单独一份，避免互相覆盖
for DBG in "$WT_ROOT/unpackage/debug" "$MAIN_ROOT/unpackage/debug"; do
  mkdir -p "$DBG"
  # HX 官方命名：Pandora_simulator_debug.app（文件名仍带 debug，实为 Release 可独立启动包）
  rm -rf "$DBG/Pandora_simulator_debug.app"
  cp -R "$APP" "$DBG/Pandora_simulator_debug.app"
  echo "✓ 已写入 $DBG/Pandora_simulator_debug.app"
done

echo ""
echo "==== 完成（模拟器包，未启动设备）===="
echo "模拟器基座: unpackage/debug/Pandora_simulator_debug.app（configuration=${CONFIGURATION}, SIM_FORCE_X86_64=${SIM_FORCE_X86_64}）"
echo "真机基座请用: unpackage/debug/iOS_debug.ipa（package_device_base.sh）"
echo "归档: $DEST_APP"
echo "说明:"
echo "  - Release 避免 Debug blank executor 冷启动闪退"
echo "  - x86_64 对齐 ExtAPI；Apple Silicon 请用带 Rosetta 的 iOS Simulator"
echo "  - BLE 配网仍需真机验证"
