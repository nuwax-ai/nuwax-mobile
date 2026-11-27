#!/usr/bin/env bash
# 本地独立安装 IPA：使用当前项目和当前环境配置；不安装、不上传。
set -euo pipefail
VOIP_REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$VOIP_REPO_ROOT"
export NUWAX_SIGNING_ENV="${NUWAX_SIGNING_ENV:-${NUWAX_SIGNING_HOME:-$HOME/workspace/nuwax-signing}/local-secrets.env}"
export HX_CLI="${HX_CLI:-/Applications/HBuilderX.app/Contents/MacOS/cli}"
[[ -x "$HX_CLI" ]] || { echo 'Install HBuilderX 5.34 or set HX_CLI.' >&2; exit 1; }
bash scripts/hx-cli.sh publish app --type appResource --project "$VOIP_REPO_ROOT"
test -f "$VOIP_REPO_ROOT/unpackage/resources/app-ios/__UNI__8BF05E4/www/app-service.js"
unset NUWAX_IOS_QA_PROJECT
NUWAX_IOS_STANDALONE=1 bash scripts/voip-native/package-business-ios.sh
