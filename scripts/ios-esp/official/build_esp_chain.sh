#!/usr/bin/env bash
# 官方对齐链路：SwiftProtobuf → ESPProvision → unimoduleNuwaxEspProvisioning
#
# 关键：ESPProvision 模块名与类名同名，开启 BUILD_LIBRARY_FOR_DISTRIBUTION 会生成
# 损坏的 swiftinterface，导致下游无法 import。本脚本统一关闭 Distribution，
# 产出 .framework，再打包为（可无 slice）xcframework 供 Demo Embed。
#
# 环境变量：
#   IOS_ESP_BUILD_ROOT / UNIAPPX_SDK_ROOT / IOS_ESP_OUT
#   OFFICIAL_PLATFORM  iphoneos|iphonesimulator|all  默认 iphoneos
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
# shellcheck source=../../local-base-env.sh
source "$SCRIPT_DIR/../../local-base-env.sh"
export IOS_ESP_BUILD_ROOT
export UNIAPPX_SDK_ROOT
export IOS_ESP_OUT
export IOS_ESP_FRAMEWORKS_DIR

PLATFORM="${OFFICIAL_PLATFORM:-iphoneos}"
OFF="$IOS_ESP_BUILD_ROOT/official"
STABLE_IOS="$OFF/build/frameworks-iphoneos"
STABLE_SIM="$OFF/build/frameworks-iphonesimulator"
DD_ROOT="$OFF/build"

mkdir -p "$STABLE_IOS" "$STABLE_SIM" "$IOS_ESP_OUT" "$OFF"

sync_unimodule_src() {
  local SRC="$IOS_ESP_BUILD_ROOT/src/unimoduleNuwaxEspProvisioning"
  mkdir -p "$SRC"
  # 桥：仓库最新
  cp "$WT_ROOT/uni_modules/nuwax-esp-provisioning/utssdk/app-ios/EspProvisioningBridge.swift" "$SRC/"
  # index.swift：优先 HX 导出
  if [[ -f "$WT_ROOT/out/ios-esp-plugin-src/nuwax-esp-provisioning/src/index.swift" ]]; then
    cp "$WT_ROOT/out/ios-esp-plugin-src/nuwax-esp-provisioning/src/index.swift" "$SRC/"
  elif [[ -f "$WT_ROOT/unpackage/resources/app-ios/uni_modules/nuwax-esp-provisioning/utssdk/app-ios/src/index.swift" ]]; then
    cp "$WT_ROOT/unpackage/resources/app-ios/uni_modules/nuwax-esp-provisioning/utssdk/app-ios/src/index.swift" "$SRC/"
  fi
  # UTSOC：官方示例（5.15 ExtApiSrc 无此文件）
  local EX="$UNIAPPX_SDK_ROOT/UTSPluginExample/unimoduleUniGetbatteryinfo/unimoduleUniGetbatteryinfo"
  cp "$EX/UTSOC.h" "$SRC/"
  cp "$EX/UTSOC.mm" "$SRC/"
  echo '{}' > "$SRC/uts-config.json"
  cat > "$SRC/unimoduleNuwaxEspProvisioning.h" <<'EOF'
#import <Foundation/Foundation.h>
FOUNDATION_EXPORT double unimoduleNuwaxEspProvisioningVersionNumber;
FOUNDATION_EXPORT const unsigned char unimoduleNuwaxEspProvisioningVersionString[];
EOF
}

build_one_platform() {
  local sdk="$1" # iphoneos | iphonesimulator
  local dest_flag="$2"
  local stable="$3"
  local dd="$DD_ROOT/DD-chain-$sdk"
  mkdir -p "$stable"
  rm -rf "$dd"

  echo "==== [$sdk] SwiftProtobuf ===="
  xcodebuild -project "$IOS_ESP_BUILD_ROOT/SwiftProtobuf/SwiftProtobuf.xcodeproj" \
    -scheme SwiftProtobuf -configuration Release \
    -destination "$dest_flag" \
    -derivedDataPath "$dd" \
    CODE_SIGNING_ALLOWED=NO ONLY_ACTIVE_ARCH=NO \
    BUILD_LIBRARY_FOR_DISTRIBUTION=NO \
    build

  local prod="$dd/Build/Products/Release-$sdk"
  rm -rf "$stable/SwiftProtobuf.framework"
  cp -R "$prod/SwiftProtobuf.framework" "$stable/"

  # 临时把 frameworks dir 指到当前平台，供 gen / ESPProvision 链接
  export IOS_ESP_FRAMEWORKS_DIR="$stable"
  python3 "$WT_ROOT/scripts/ios-esp/gen_projects.py" >/tmp/gen_projects_$sdk.log

  echo "==== [$sdk] ESPProvision ===="
  xcodebuild -project "$IOS_ESP_BUILD_ROOT/ESPProvision/ESPProvision.xcodeproj" \
    -scheme ESPProvision -configuration Release \
    -destination "$dest_flag" \
    -derivedDataPath "$dd" \
    CODE_SIGNING_ALLOWED=NO ONLY_ACTIVE_ARCH=NO \
    BUILD_LIBRARY_FOR_DISTRIBUTION=NO \
    FRAMEWORK_SEARCH_PATHS="$stable" \
    build
  rm -rf "$stable/ESPProvision.framework"
  cp -R "$prod/ESPProvision.framework" "$stable/"

  echo "==== [$sdk] unimoduleNuwaxEspProvisioning ===="
  python3 "$WT_ROOT/scripts/ios-esp/gen_projects.py" >/tmp/gen_projects_$sdk.log
  xcodebuild -project "$IOS_ESP_BUILD_ROOT/unimoduleNuwaxEspProvisioning/unimoduleNuwaxEspProvisioning.xcodeproj" \
    -scheme unimoduleNuwaxEspProvisioning -configuration Release \
    -destination "$dest_flag" \
    -derivedDataPath "$dd" \
    CODE_SIGNING_ALLOWED=NO ONLY_ACTIVE_ARCH=NO \
    BUILD_LIBRARY_FOR_DISTRIBUTION=NO \
    FRAMEWORK_SEARCH_PATHS="$stable $UNIAPPX_SDK_ROOT/SDK/Libs" \
    build
  rm -rf "$stable/unimoduleNuwaxEspProvisioning.framework"
  cp -R "$prod/unimoduleNuwaxEspProvisioning.framework" "$stable/"
  echo "✓ [$sdk] → $stable"
}

pack_xcframework() {
  local name="$1"
  local out="$IOS_ESP_OUT/$name.xcframework"
  rm -rf "$out"
  local args=()
  if [[ -d "$STABLE_IOS/$name.framework" ]]; then
    args+=(-framework "$STABLE_IOS/$name.framework")
  fi
  if [[ -d "$STABLE_SIM/$name.framework" ]]; then
    args+=(-framework "$STABLE_SIM/$name.framework")
  fi
  if [[ ${#args[@]} -eq 0 ]]; then
    echo "✗ 无 $name.framework 可打包" >&2
    return 1
  fi
  xcodebuild -create-xcframework -allow-internal-distribution "${args[@]}" -output "$out"
  # 同步到 SDK/Libs 供 Demo Embed
  rm -rf "$UNIAPPX_SDK_ROOT/SDK/Libs/$name.xcframework"
  cp -R "$out" "$UNIAPPX_SDK_ROOT/SDK/Libs/"
  echo "✓ $out → SDK/Libs"
}

echo "==== sync unimodule 源码 + gen_projects ===="
sync_unimodule_src
# 先用 iphoneos frameworks dir 生成工程骨架
export IOS_ESP_FRAMEWORKS_DIR="$STABLE_IOS"
python3 "$WT_ROOT/scripts/ios-esp/gen_projects.py"

case "$PLATFORM" in
  iphoneos)
    build_one_platform iphoneos 'generic/platform=iOS' "$STABLE_IOS"
    ;;
  iphonesimulator)
    build_one_platform iphonesimulator 'generic/platform=iOS Simulator' "$STABLE_SIM"
    ;;
  all)
    build_one_platform iphoneos 'generic/platform=iOS' "$STABLE_IOS"
    build_one_platform iphonesimulator 'generic/platform=iOS Simulator' "$STABLE_SIM"
    ;;
  *)
    echo "未知 OFFICIAL_PLATFORM=$PLATFORM" >&2
    exit 1
    ;;
esac

echo "==== create-xcframework ===="
for N in SwiftProtobuf ESPProvision unimoduleNuwaxEspProvisioning; do
  pack_xcframework "$N"
done

echo ""
echo "==== 完成 ===="
echo "产物: $IOS_ESP_OUT/*.xcframework"
echo "下一步: python3 $WT_ROOT/scripts/ios-esp/inject_frameworks.py"
echo "        或 ./scripts/ios-esp/build_device_base.sh"
