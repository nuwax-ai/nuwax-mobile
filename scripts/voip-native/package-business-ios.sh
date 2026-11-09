#!/usr/bin/env bash
# 完整 Nuwax App iOS 本地 HX 调试基座；不安装、不上传。
set -euo pipefail
VOIP_REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$VOIP_REPO_ROOT"
if [[ -n "${NUWAX_SIGNING_ENV:-}" ]]; then
  set -a
  source "$NUWAX_SIGNING_ENV"
  set +a
fi
export UNIAPPX_SDK_ROOT="$VOIP_REPO_ROOT/out/voip-native-work/ios-sdk/UniAppX-iOS@5.34"
export NUWAX_VOIP_BUSINESS_HOST=1
python3 scripts/voip-native/device/prepare-ios.py
xcodebuild -workspace "$VOIP_REPO_ROOT/out/voip-business-ios/VoipBusiness.xcworkspace" -scheme UniAppX -configuration Debug -destination 'generic/platform=iOS' -derivedDataPath "$VOIP_REPO_ROOT/out/voip-business-ios-derived" -clonedSourcePackagesDirPath "$VOIP_REPO_ROOT/out/voip-native-ios-derived/SourcePackages" build
VOIP_APP="$VOIP_REPO_ROOT/out/voip-business-ios-derived/Build/Products/Debug-iphoneos/UniAppX.app"
codesign --verify --deep --strict "$VOIP_APP"
VOIP_OUT="$VOIP_REPO_ROOT/out/voip-business-packages"
mkdir -p "$VOIP_OUT/Payload" "$VOIP_REPO_ROOT/unpackage/debug"
cp -R "$VOIP_APP" "$VOIP_OUT/Payload/UniAppX.app"
VOIP_IPA="iOS_debug-$(date +%Y%m%d-%H%M%S).ipa"
(cd "$VOIP_OUT" && zip -qr "$VOIP_IPA" Payload)
rm -rf "$VOIP_OUT/Payload"
ln -sfn "$VOIP_IPA" "$VOIP_OUT/iOS_debug-latest.ipa"
cp "$VOIP_OUT/$VOIP_IPA" "$VOIP_REPO_ROOT/unpackage/debug/iOS_debug.ipa"
echo "Signed full Nuwax App HX base: $VOIP_OUT/$VOIP_IPA (not installed or uploaded)"
