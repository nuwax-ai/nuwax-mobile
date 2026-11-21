#!/usr/bin/env bash
# 完整 Nuwax App iOS 本地包；QA_PROJECT 为测试环境独立安装包，否则为 HX 基座。不安装、不上传。
set -euo pipefail
VOIP_REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$VOIP_REPO_ROOT"
NUWAX_SIGNING_ENV="${NUWAX_SIGNING_ENV:-${NUWAX_SIGNING_HOME:-$HOME/workspace/nuwax-signing}/local-secrets.env}"
if [[ -f "$NUWAX_SIGNING_ENV" ]]; then
  set -a
  source "$NUWAX_SIGNING_ENV"
  set +a
fi
: "${DCLOUD_APPKEY:?Configure DCLOUD_APPKEY in the local signing environment}"
: "${IOS_DEVELOPMENT_TEAM:?Configure IOS_DEVELOPMENT_TEAM in the local signing environment}"
: "${IOS_PROVISIONING_PROFILE_UUID:?Configure IOS_PROVISIONING_PROFILE_UUID in the local signing environment}"
export NUWAX_IOS_VOIP_PUSH_PROVIDER="${NUWAX_IOS_VOIP_PUSH_PROVIDER:-unipush}"
if [[ "$NUWAX_IOS_VOIP_PUSH_PROVIDER" == unipush ]]; then
  : "${NUWAX_IOS_UNIPUSH_CLIENT_IPA:?Set NUWAX_IOS_UNIPUSH_CLIENT_IPA to a trusted base for com.nuwax.app}"
fi
if [[ -z "${UNIAPPX_SDK_ROOT:-}" ]]; then
  bash scripts/voip-native/device/fetch-ios-sdk.sh
  export UNIAPPX_SDK_ROOT="$VOIP_REPO_ROOT/out/voip-native-work/ios-sdk/UniAppX-iOS@5.34"
fi
export NUWAX_VOIP_BUSINESS_HOST=1
VOIP_BUILD_DIR="$VOIP_REPO_ROOT/out/voip-business-ios"
if [[ -n "${NUWAX_IOS_QA_PROJECT:-}" ]]; then
  VOIP_BUILD_DIR="$VOIP_REPO_ROOT/out/voip-business-qa-ios"
fi
python3 scripts/voip-native/device/prepare-ios.py
xcodebuild -workspace "$VOIP_BUILD_DIR/VoipBusiness.xcworkspace" -scheme UniAppX -configuration Debug -destination 'generic/platform=iOS' -derivedDataPath "$VOIP_BUILD_DIR-derived" build
VOIP_APP="$VOIP_BUILD_DIR-derived/Build/Products/Debug-iphoneos/UniAppX.app"
if [[ -n "${NUWAX_IOS_QA_PROJECT:-}" ]]; then
  python3 scripts/voip-native/verify-business-qa-ios.py
else
  codesign --verify --deep --strict "$VOIP_APP"
  python3 scripts/voip-native/device/ios_push_config.py "$VOIP_APP"
fi
VOIP_OUT="$VOIP_REPO_ROOT/out/voip-business-packages"
mkdir -p "$VOIP_OUT"
VOIP_STAGE="$(mktemp -d "$VOIP_OUT/.ios-package.XXXXXXXX")"
trap 'rm -rf "$VOIP_STAGE"' EXIT
mkdir "$VOIP_STAGE/Payload"
cp -R "$VOIP_APP" "$VOIP_STAGE/Payload/UniAppX.app"
VOIP_PACKAGE_PREFIX="iOS_debug"
if [[ -n "${NUWAX_IOS_QA_PROJECT:-}" ]]; then VOIP_PACKAGE_PREFIX="Nuwax-iOS-Test"; fi
VOIP_IPA="$VOIP_PACKAGE_PREFIX-$(date +%Y%m%d-%H%M%S).ipa"
(cd "$VOIP_STAGE" && zip -qry "$VOIP_IPA" Payload)
mv "$VOIP_STAGE/$VOIP_IPA" "$VOIP_OUT/$VOIP_IPA"
if [[ -n "${NUWAX_IOS_QA_PROJECT:-}" ]]; then
  cp "$NUWAX_IOS_QA_PROJECT/nuwax-local-qa.json" "$VOIP_OUT/$VOIP_IPA.json"
  ln -sfn "$VOIP_IPA" "$VOIP_OUT/Nuwax-iOS-Test-latest.ipa"
else
  mkdir -p "$VOIP_REPO_ROOT/unpackage/debug"
  ln -sfn "$VOIP_IPA" "$VOIP_OUT/iOS_debug-latest.ipa"
  cp "$VOIP_OUT/$VOIP_IPA" "$VOIP_REPO_ROOT/unpackage/debug/iOS_debug.ipa"
fi
shasum -a 256 "$VOIP_OUT/$VOIP_IPA" > "$VOIP_OUT/$VOIP_IPA.sha256"
echo "Signed full Nuwax App: $VOIP_OUT/$VOIP_IPA (not installed or uploaded)"
