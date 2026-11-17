#!/usr/bin/env bash
# 本地独立安装 IPA：真实 App + 测试环境；不安装、不上传、不部署。
set -euo pipefail
VOIP_REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$VOIP_REPO_ROOT"
export NUWAX_SIGNING_ENV="${NUWAX_SIGNING_ENV:-${NUWAX_SIGNING_HOME:-$HOME/workspace/nuwax-signing}/local-secrets.env}"
test -f "$NUWAX_SIGNING_ENV"
node scripts/generate-app-privacy-policy.mjs
node scripts/prepare-offline-h5.mjs
node scripts/prepare-voip-media.mjs
node scripts/voip-native/prepare-business-qa.mjs
VOIP_QA_SOURCE="$VOIP_REPO_ROOT/out/voip-business-qa-project"
/Applications/HBuilderX.app/Contents/MacOS/cli project open --path "$VOIP_QA_SOURCE"
python3 scripts/voip-native/run-hx-local-build.py publish app --type appResource --project "$VOIP_QA_SOURCE"
test -f "$VOIP_QA_SOURCE/unpackage/resources/app-ios/__UNI__8BF05E4/www/app-service.js"
NUWAX_IOS_QA_PROJECT="$VOIP_QA_SOURCE" bash scripts/voip-native/package-business-ios.sh
