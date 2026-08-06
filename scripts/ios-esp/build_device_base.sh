#!/usr/bin/env bash
# 生成本地离线自定义基座（真机）并安装到已连接 iPhone
# 依赖：已解压 UniAppX-iOS@5.15、已有 xcframework、HX 已生成本地打包 App 资源
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=../local-base-env.sh
source "$SCRIPT_DIR/../local-base-env.sh"
MAIN_ROOT="${NUWAX_MAIN_ROOT}"

export UNIAPPX_SDK_ROOT="${UNIAPPX_SDK_ROOT}"
export IOS_ESP_OUT="${IOS_ESP_OUT}"
export APP_RESOURCES_DIR="${APP_RESOURCES_DIR:-$MAIN_ROOT/unpackage/resources/app-ios}"
# 官方文档：1=自定义基座(HX 联调) 2=正式包
export UNIAPPX_IPATYPE="${UNIAPPX_IPATYPE:-1}"

DEVICE_ID="${DEVICE_ID:-}"
if [[ -z "$DEVICE_ID" ]]; then
  DEVICE_ID="$(xcrun xctrace list devices 2>/dev/null | awk '/LLD|iPhone/{print}' | rg -v 'Simulator|——' | head -1 | sed -E 's/.*\(([^)]+)\).*/\1/' || true)"
fi
if [[ -z "$DEVICE_ID" ]]; then
  echo "✗ 未找到真机，请 USB 连接并信任，或设置 DEVICE_ID=<UDID>" >&2
  exit 1
fi

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

echo "==== 3) xcodebuild 真机 Debug ===="
xcodebuild -project "$PROJ" -scheme UniAppX -configuration Debug \
  -destination "id=$DEVICE_ID" \
  -derivedDataPath "$DD" \
  DEVELOPMENT_TEAM="$TEAM" \
  CODE_SIGN_STYLE=Manual \
  PROVISIONING_PROFILE_SPECIFIER="$PROFILE_UUID" \
  PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE" \
  build

APP="$DD/Build/Products/Debug-iphoneos/UniAppX.app"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$OUT_DIR/UniAppX-custom-base-$STAMP.app"
rm -rf "$DEST"
cp -R "$APP" "$DEST"
ln -sfn "$(basename "$DEST")" "$OUT_DIR/UniAppX-custom-base-latest.app"
echo "✓ 产物: $DEST"

# 官方方案1：Archive 等价物 → iOS_debug.ipa → 项目 unpackage/debug/
echo "==== 3.1) 打包 iOS_debug.ipa（HX 自定义基座） ===="
IPA_STAGING="$OUT_DIR/_ipa_staging"
rm -rf "$IPA_STAGING"
mkdir -p "$IPA_STAGING/Payload"
cp -R "$APP" "$IPA_STAGING/Payload/UniAppX.app"
IPA_OUT="$OUT_DIR/iOS_debug-$STAMP.ipa"
(
  cd "$IPA_STAGING"
  zip -qr "$IPA_OUT" Payload
)
ln -sfn "$(basename "$IPA_OUT")" "$OUT_DIR/iOS_debug-latest.ipa"
# 同步到 uni-app 工程（worktree 优先，其次主仓）
for DBG in "$WT_ROOT/unpackage/debug" "$MAIN_ROOT/unpackage/debug"; do
  mkdir -p "$DBG"
  cp -f "$IPA_OUT" "$DBG/iOS_debug.ipa"
  echo "✓ 已写入 $DBG/iOS_debug.ipa"
done
rm -rf "$IPA_STAGING"

echo "==== 4) 安装到真机 $DEVICE_ID ===="
if [[ "${SKIP_INSTALL:-0}" == "1" ]]; then
  echo "SKIP_INSTALL=1，跳过安装（仅出包）"
else
  xcrun devicectl device install app --device "$DEVICE_ID" "$APP"
fi

echo ""
echo "==== 完成 ===="
if [[ "${SKIP_INSTALL:-0}" == "1" ]]; then
  echo "已生成真机自定义基座包（未安装）"
else
  echo "自定义基座已安装: $BUNDLE (ipatype=$UNIAPPX_IPATYPE)"
fi
echo "产物目录: $OUT_DIR"
echo "官方方案1 IPA: $OUT_DIR/iOS_debug-latest.ipa → unpackage/debug/iOS_debug.ipa"
echo "官方方案2: HX → 使用自定义基座 → 原生工程基座，基座位置填:"
echo "  $APP"
if [[ "${SKIP_INSTALL:-0}" != "1" ]]; then
  echo "请解锁手机后打开 App。"
  echo "（可选）启动: xcrun devicectl device process launch --device $DEVICE_ID $BUNDLE"
fi
