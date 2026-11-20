#!/usr/bin/env bash
# 完整真实 App 的独立测试环境 APK；不安装、不上传、不覆盖 HX 基座。
set -euo pipefail
VOIP_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$VOIP_ROOT"
export NUWAX_SIGNING_ENV="${NUWAX_SIGNING_ENV:-${NUWAX_SIGNING_HOME:-$HOME/workspace/nuwax-signing}/local-secrets.env}"
export NUWAX_ANDROID_UNIPUSH_CONFIG="${NUWAX_ANDROID_UNIPUSH_CONFIG:-${NUWAX_SIGNING_HOME:-$HOME/workspace/nuwax-signing}/android/unipush-client.json}"
test -f "$NUWAX_SIGNING_ENV"
test -f "$NUWAX_ANDROID_UNIPUSH_CONFIG"
node scripts/generate-app-privacy-policy.mjs
node scripts/prepare-offline-h5.mjs
node scripts/prepare-voip-media.mjs
node scripts/voip-native/prepare-business-qa.mjs
export NUWAX_ANDROID_QA_PROJECT="$VOIP_ROOT/out/voip-business-qa-project"
HX_CLI=/Applications/HBuilderX.app/Contents/MacOS/cli
# HBuilderX can resolve a nested project path to its registered parent project.
HX_QA_PROJECT="$(mktemp -d "${TMPDIR:-/tmp}/nuwax-android-qa.XXXXXX")"
cleanup_hx_project() {
  "$HX_CLI" project close --path "$HX_QA_PROJECT" || true
  rm -rf "$HX_QA_PROJECT"
}
trap cleanup_hx_project EXIT
cp -cR "$NUWAX_ANDROID_QA_PROJECT/." "$HX_QA_PROJECT/"
"$HX_CLI" project open --path "$HX_QA_PROJECT"
python3 scripts/voip-native/run-hx-local-build.py publish app-android --type appResource --project "$HX_QA_PROJECT"
mkdir -p "$NUWAX_ANDROID_QA_PROJECT/unpackage/resources"
mv "$HX_QA_PROJECT/unpackage/resources/app-android" "$NUWAX_ANDROID_QA_PROJECT/unpackage/resources/app-android"
bash scripts/voip-native/package-business-android.sh
VOIP_OUT="$VOIP_ROOT/out/voip-business-packages"
VOIP_APK="$VOIP_OUT/Nuwax-VoIP-Test-$(date +%Y%m%d-%H%M%S).apk"
cp "$VOIP_OUT/android_debug-latest.apk" "$VOIP_APK"
set -a
source "$NUWAX_SIGNING_ENV"
set +a
python3 scripts/voip-native/verify-business-qa-android.py "$VOIP_APK"
ln -sfn "$(basename "$VOIP_APK")" "$VOIP_OUT/Nuwax-VoIP-Test-latest.apk"
echo "Verified standalone real App test APK: $VOIP_APK (not installed or uploaded)"
