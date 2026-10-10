#!/usr/bin/env bash
# 阶段 C：打开 Android Studio 工程（官方联调入口）
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../local-base-env.sh
source "$SCRIPT_DIR/../local-base-env.sh"
PROJ="${ANDROID_ESP_PROJECT:-$ANDROID_ESP_WORK/project}"
echo "工程: $PROJ"
echo "插件源码断点: $PROJ/uts-nuwax-esp-provisioning/src/main/java/com/nuwax/provisioning/EspProvisioningBridge.kt"
echo ""
echo "HX 联调（4.71+）：运行 → Android App 基座 → 自定义基座 → 关联项目填:"
echo "  $PROJ"
if [[ "${OPEN_AS:-1}" == "1" ]]; then
  open -a "Android Studio" "$PROJ" 2>/dev/null || echo "请手动用 Android Studio 打开 $PROJ"
fi
