#!/usr/bin/env bash
set -euo pipefail
VOIP_REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
VOIP_SDK_DIR="$VOIP_REPO_ROOT/out/voip-native-work/ios-sdk"
mkdir -p "$VOIP_SDK_DIR"
if [[ -d "$VOIP_SDK_DIR/UniAppX-iOS@5.34/SDK" ]]; then
  echo "iOS 5.34 SDK already present in isolated work directory"
  exit 0
fi
# Official VDOM SDK link, version-pinned to this task's HBuilderX.
curl -fL --retry 2 --connect-timeout 15 -o "$VOIP_SDK_DIR/UniAppX-iOS-5.34.zip" 'https://web-ext-storage.dcloud.net.cn/uni-app-x/sdk/iOS/UniAppX-iOS%405.34.zip'
unzip -q "$VOIP_SDK_DIR/UniAppX-iOS-5.34.zip" -d "$VOIP_SDK_DIR"
[[ -d "$VOIP_SDK_DIR/UniAppX-iOS@5.34/SDK" ]]
