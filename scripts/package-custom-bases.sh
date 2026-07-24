#!/usr/bin/env bash
# 一键只生成自定义基座包（不安装、不唤起任何设备）
#
# 默认：Android + iOS 真机 + iOS 模拟器 三份产物到 unpackage/debug/
#
#   TARGETS=android|ios-device|ios-simulator|all
#   例: TARGETS=android,ios-device ./scripts/package-custom-bases.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=local-base-env.sh
source "$SCRIPT_DIR/local-base-env.sh"

TARGETS="${TARGETS:-all}"

want() {
  local name="$1"
  [[ "$TARGETS" == "all" ]] || [[ ",$TARGETS," == *",$name,"* ]]
}

echo "NUWAX_OFFLINE_SDK_HOME=$NUWAX_OFFLINE_SDK_HOME"
echo "TARGETS=$TARGETS"
echo "模式: 仅出包（SKIP_INSTALL / 不启动设备）"
echo ""

if want android; then
  echo "######## Android → android_debug.apk ########"
  "$SCRIPT_DIR/android-esp/package_custom_base.sh"
  echo ""
fi

if want ios-device; then
  echo "######## iOS 真机 → iOS_debug.ipa ########"
  "$SCRIPT_DIR/ios-esp/package_device_base.sh"
  echo ""
fi

if want ios-simulator; then
  echo "######## iOS 模拟器 → Pandora_simulator_debug.app ########"
  "$SCRIPT_DIR/ios-esp/package_simulator_base.sh"
  echo ""
fi

DBG="$ROOT/unpackage/debug"
echo "==== unpackage/debug 产物 ===="
ls -lh "$DBG/android_debug.apk" 2>/dev/null || true
ls -lh "$DBG/iOS_debug.ipa" 2>/dev/null || true
ls -ld "$DBG/Pandora_simulator_debug.app" 2>/dev/null || true
echo ""
echo "说明: 真机与模拟器是两套包，请勿混用。"
echo "  真机 HX: iOS_debug.ipa / android_debug.apk"
echo "  模拟器:  Pandora_simulator_debug.app（Android 模拟器可用同一 apk）"
