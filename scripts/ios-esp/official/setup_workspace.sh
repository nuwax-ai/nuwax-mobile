#!/usr/bin/env bash
# 阶段 C：创建/更新 NuwaxUniAppX.xcworkspace
# 按官方 debug 文档：主工程 + UTS 插件工程同 Workspace，便于 Swift 断点。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../../local-base-env.sh
source "$SCRIPT_DIR/../../local-base-env.sh"

WS_DIR="$IOS_ESP_BUILD_ROOT/official/workspace"
WS="$WS_DIR/NuwaxUniAppX.xcworkspace"
mkdir -p "$WS"

DEMO_PROJ="$UNIAPPX_SDK_ROOT/UniAppXDemo/UniAppXDemo.xcodeproj"
UNI_PROJ="$IOS_ESP_BUILD_ROOT/unimoduleNuwaxEspProvisioning/unimoduleNuwaxEspProvisioning.xcodeproj"
ESP_PROJ="$IOS_ESP_BUILD_ROOT/ESPProvision/ESPProvision.xcodeproj"
SPB_PROJ="$IOS_ESP_BUILD_ROOT/SwiftProtobuf/SwiftProtobuf.xcodeproj"

for P in "$DEMO_PROJ" "$UNI_PROJ"; do
  if [[ ! -d "$P" ]]; then
    echo "✗ 缺少工程: $P" >&2
    echo "  请先跑 scripts/ios-esp/official/build_esp_chain.sh" >&2
    exit 1
  fi
done

# 使用绝对路径 FileRef，避免相对路径漂移
cat > "$WS/contents.xcworkspacedata" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<Workspace
   version = "1.0">
   <FileRef
      location = "absolute:$DEMO_PROJ">
   </FileRef>
   <FileRef
      location = "absolute:$UNI_PROJ">
   </FileRef>
   <FileRef
      location = "absolute:$ESP_PROJ">
   </FileRef>
   <FileRef
      location = "absolute:$SPB_PROJ">
   </FileRef>
</Workspace>
EOF

echo "✓ Workspace: $WS"
echo "打开: open \"$WS\""
echo ""
echo "调试提示（官方）："
echo "  1) Xcode 用本 Workspace 编译运行 UniAppX"
echo "  2) HBuilderX 开启 uts 调试(swift)，将插件工程目录拖入项目管理器"
echo "  3) 在 EspProvisioningBridge.swift 下断点"
