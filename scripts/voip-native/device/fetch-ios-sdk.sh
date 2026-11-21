#!/usr/bin/env bash
set -euo pipefail
VOIP_REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
VOIP_SDK_DIR="$VOIP_REPO_ROOT/out/voip-native-work/ios-sdk"
mkdir -p "$VOIP_SDK_DIR"
if [[ -d "$VOIP_SDK_DIR/UniAppX-iOS@5.34/SDK/Libs" ]]; then
  echo "iOS 5.34 SDK already present in isolated work directory"
  exit 0
fi
# Official VDOM SDK link pinned to the HBuilderX runtime version.
VOIP_SDK_STAGE="$(mktemp -d "$VOIP_SDK_DIR/.sdk.XXXXXXXX")"
trap 'rm -rf "$VOIP_SDK_STAGE"' EXIT
curl -fL --retry 2 --connect-timeout 15 -o "$VOIP_SDK_STAGE/UniAppX-iOS-5.34.zip" 'https://web-ext-storage.dcloud.net.cn/uni-app-x/sdk/iOS/UniAppX-iOS%405.34.zip'
unzip -q "$VOIP_SDK_STAGE/UniAppX-iOS-5.34.zip" -d "$VOIP_SDK_STAGE"
[[ -d "$VOIP_SDK_STAGE/UniAppX-iOS@5.34/SDK/Libs" ]]
mv -n "$VOIP_SDK_STAGE/UniAppX-iOS@5.34" "$VOIP_SDK_DIR/"
[[ -d "$VOIP_SDK_DIR/UniAppX-iOS@5.34/SDK/Libs" ]]
