#!/usr/bin/env bash
# 构建 ESP 配网插件所需的 3 个 xcframework
# 依赖顺序: SwiftProtobuf -> ESPProvision -> unimoduleNuwaxEspProvisioning
#
# 环境变量见 scripts/local-base-env.sh（默认 nuwax-mobile-offline-sdk/work/ios）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../local-base-env.sh
source "$SCRIPT_DIR/../local-base-env.sh"

BASE="${IOS_ESP_BUILD_ROOT}"
OUT="${IOS_ESP_OUT:-$BASE/out}"
DD="$BASE/build/DerivedData"
mkdir -p "$OUT" "$DD"

echo "IOS_ESP_BUILD_ROOT=$BASE"
echo "IOS_ESP_OUT=$OUT"

build_one () { # $1=name
  local NAME="$1"
  local PROJ="$BASE/$NAME/$NAME.xcodeproj"
  if [[ ! -d "$PROJ" ]]; then
    echo "✗ 缺少工程 $PROJ（先运行 gen_projects.py）" >&2
    return 1
  fi
  echo ""
  echo "================== 构建 $NAME =================="
  for SDK in iphoneos iphonesimulator; do
    echo "---- $NAME @ $SDK ----"
    if ! xcodebuild -project "$PROJ" -scheme "$NAME" -configuration Release \
      -sdk "$SDK" -derivedDataPath "$DD" \
      BUILD_LIBRARY_FOR_DISTRIBUTION=YES SKIP_INSTALL=NO \
      ARCHS="arm64" ONLY_ACTIVE_ARCH=NO \
      "EXCLUDED_ARCHS[sdk=iphonesimulator*]=" \
      build > "$DD/${NAME}_${SDK}.log" 2>&1; then
        echo "✗ $NAME @ $SDK 失败，关键错误：" >&2
        grep -iE "error:" "$DD/${NAME}_${SDK}.log" | head -20 >&2
        return 1
      fi
    echo "✓ $NAME @ $SDK"
  done
  local DEV_FW SIM_FW
  DEV_FW=$(find "$DD/Build/Products/Release-iphoneos" -maxdepth 1 -name "$NAME.framework" | head -1)
  SIM_FW=$(find "$DD/Build/Products/Release-iphonesimulator" -maxdepth 1 -name "$NAME.framework" | head -1)
  echo "  device : $DEV_FW"
  echo "  sim    : $SIM_FW"
  rm -rf "$OUT/$NAME.xcframework"
  xcodebuild -create-xcframework -framework "$DEV_FW" -framework "$SIM_FW" -output "$OUT/$NAME.xcframework" > /dev/null
  echo "✓ 生成 $OUT/$NAME.xcframework"
  ls "$OUT/$NAME.xcframework"
}

build_one SwiftProtobuf
build_one ESPProvision
build_one unimoduleNuwaxEspProvisioning

echo ""
echo "================== 全部完成 =================="
ls -la "$OUT"/*.xcframework
