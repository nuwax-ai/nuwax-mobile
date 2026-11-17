#!/usr/bin/env bash
# 完整 Nuwax App iOS 本地包；QA_PROJECT 为测试环境独立安装包，否则为 HX 基座。不安装、不上传。
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
if [[ -n "${NUWAX_IOS_QA_PROJECT:-}" ]]; then
  python3 scripts/voip-native/verify-business-qa-ios.py
else
  codesign --verify --deep --strict "$VOIP_APP"
  python3 scripts/voip-native/device/ios_push_config.py "$VOIP_APP"
fi
VOIP_OUT="$VOIP_REPO_ROOT/out/voip-business-packages"
mkdir -p "$VOIP_OUT/Payload" "$VOIP_REPO_ROOT/unpackage/debug"
rm -rf "$VOIP_OUT/Payload/UniAppX.app"
cp -R "$VOIP_APP" "$VOIP_OUT/Payload/UniAppX.app"
VOIP_PACKAGE_PREFIX="iOS_debug"
if [[ -n "${NUWAX_IOS_QA_PROJECT:-}" ]]; then VOIP_PACKAGE_PREFIX="Nuwax-VoIP-Test"; fi
VOIP_IPA="$VOIP_PACKAGE_PREFIX-$(date +%Y%m%d-%H%M%S).ipa"
(cd "$VOIP_OUT" && zip -qr "$VOIP_IPA" Payload)
rm -rf "$VOIP_OUT/Payload"
if [[ -n "${NUWAX_IOS_QA_PROJECT:-}" ]]; then
  cp "$NUWAX_IOS_QA_PROJECT/nuwax-local-qa.json" "$VOIP_OUT/$VOIP_IPA.json"
  ln -sfn "$VOIP_IPA" "$VOIP_OUT/Nuwax-VoIP-Test-latest.ipa"
else
  ln -sfn "$VOIP_IPA" "$VOIP_OUT/iOS_debug-latest.ipa"
  cp "$VOIP_OUT/$VOIP_IPA" "$VOIP_REPO_ROOT/unpackage/debug/iOS_debug.ipa"
fi
shasum -a 256 "$VOIP_OUT/$VOIP_IPA" > "$VOIP_OUT/$VOIP_IPA.sha256"
echo "Signed full Nuwax App: $VOIP_OUT/$VOIP_IPA (not installed or uploaded)"
