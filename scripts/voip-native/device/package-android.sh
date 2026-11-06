#!/usr/bin/env bash
set -euo pipefail
VOIP_REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
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
if [[ -z "${ANDROID_ESP_PROJECT:-}" ]]; then
  for voip_project in "$ANDROID_ESP_WORK"/Android-uni-app-x-SDK@*-5.34/uniappxnativepackage; do
    [[ -d "$voip_project" ]] && export ANDROID_ESP_PROJECT="$voip_project" && break
  done
fi
[[ "${ANDROID_ESP_PROJECT:-}" == "$VOIP_REPO_ROOT/out/"* ]] || { echo 'Android SDK work project must be isolated in this worktree out/.' >&2; exit 1; }
export APP_RESOURCES_DIR="$VOIP_REPO_ROOT/out/voip-device-project/unpackage/resources/app-android"
export ANDROID_CUSTOM_BASE_OUT="$VOIP_REPO_ROOT/out/voip-device-packages"
export NUWAX_VOIP_DEVICE_TEST=1 APP_NAME='Nuwax VoIP Test' ENABLE_HX_DEBUG=0 ANDROID_BUILD_TYPE=debug
bash "$VOIP_REPO_ROOT/scripts/android-esp/package_custom_base.sh"
