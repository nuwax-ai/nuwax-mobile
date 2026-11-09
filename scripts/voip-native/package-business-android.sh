#!/usr/bin/env bash
# 完整 Nuwax App 的本地 HX 调试基座。只生成，不安装、不上传。
set -euo pipefail
VOIP_REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$VOIP_REPO_ROOT"
if [[ -n "${NUWAX_SIGNING_ENV:-}" ]]; then
  set -a
  source "$NUWAX_SIGNING_ENV"
  set +a
fi
export NUWAX_HX_VERSION=5.34
export NUWAX_MAIN_ROOT="$VOIP_REPO_ROOT"
export NUWAX_LOCAL_BASE_ROOT="$VOIP_REPO_ROOT/out/voip-native-work"
export ANDROID_ESP_WORK="$NUWAX_LOCAL_BASE_ROOT/android"
for voip_sdk in "$ANDROID_ESP_WORK"/Android-uni-app-x-SDK@*-5.34; do
  [[ -d "$voip_sdk/uniappxnativepackage" ]] || continue
  export UNIAPPX_ANDROID_SDK_ROOT="$voip_sdk" ANDROID_ESP_PROJECT="$voip_sdk/uniappxnativepackage"
  break
done
[[ "${ANDROID_ESP_PROJECT:-}" == "$VOIP_REPO_ROOT/out/"* ]] || { echo 'Requires isolated HBuilderX 5.34 SDK under this worktree out/.' >&2; exit 1; }
export APP_RESOURCES_DIR="$VOIP_REPO_ROOT/unpackage/resources/app-android"
export ANDROID_CUSTOM_BASE_OUT="$VOIP_REPO_ROOT/out/voip-business-packages"
export ENABLE_HX_DEBUG=1 ANDROID_BUILD_TYPE=debug
unset NUWAX_VOIP_DEVICE_TEST APP_NAME
bash "$VOIP_REPO_ROOT/scripts/android-esp/package_custom_base.sh"
