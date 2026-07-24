#!/usr/bin/env bash
# 阶段 A：按官方 modules 文档规范化 DCloudUTSExtAPI
#
# UniAppX-iOS@5.15 的 TemporarySampleFramework/DCloudUTSExtAPI 已是 DCloud 预置完整 ExtAPI
#（含 barcode / storage / getSystemInfo 等）。官方 Embed 路径要求放到主工程可引用位置。
# 本脚本：
#  1) 拷贝到 SDK/Libs/DCloudUTSExtAPI.xcframework（与其它 Libs 一致）
#  2) 将 Demo pbxproj 引用从 TemporarySampleFramework 改为 SDK/Libs
#  3) 对照 HX 导出 www/manifest.json 的 modules 做符号校验
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
# shellcheck source=../../local-base-env.sh
source "$SCRIPT_DIR/../../local-base-env.sh"
APP_RESOURCES_DIR="${APP_RESOURCES_DIR:-$WT_ROOT/unpackage/resources/app-ios}"
APPID="${APPID:-$NUWAX_APPID}"

SRC_XCF="$UNIAPPX_SDK_ROOT/TemporarySampleFramework/DCloudUTSExtAPI.xcframework"
DST_XCF="$UNIAPPX_SDK_ROOT/SDK/Libs/DCloudUTSExtAPI.xcframework"
DEMO_PBX="$UNIAPPX_SDK_ROOT/UniAppXDemo/UniAppXDemo.xcodeproj/project.pbxproj"

if [[ ! -d "$SRC_XCF" ]]; then
  echo "✗ 找不到 TemporarySample ExtAPI: $SRC_XCF" >&2
  exit 1
fi

mkdir -p "$UNIAPPX_SDK_ROOT/SDK/Libs"
if [[ ! -d "$DST_XCF" ]] || [[ "${FORCE_COPY_EXTAPI:-0}" == "1" ]]; then
  rm -rf "$DST_XCF"
  cp -R "$SRC_XCF" "$DST_XCF"
  echo "✓ ExtAPI → $DST_XCF"
else
  echo "✓ ExtAPI 已在 SDK/Libs（FORCE_COPY_EXTAPI=1 可强制覆盖）"
fi

python3 <<PY
from pathlib import Path
p = Path("$DEMO_PBX")
t = p.read_text()
old = "../TemporarySampleFramework/DCloudUTSExtAPI.xcframework"
new = "../SDK/Libs/DCloudUTSExtAPI.xcframework"
if old in t:
    p.write_text(t.replace(old, new))
    print("✓ Demo pbxproj ExtAPI → SDK/Libs")
elif new in t:
    print("✓ Demo 已指向 SDK/Libs ExtAPI")
else:
    print("⚠ 未找到 ExtAPI 路径条目，请手动检查 Demo 工程")
PY

# 模块校验
MANIFEST="$APP_RESOURCES_DIR/$APPID/www/manifest.json"
if [[ ! -f "$MANIFEST" ]]; then
  echo "⚠ 无 $MANIFEST，跳过模块校验（先 HX 生成本地打包资源）"
  exit 0
fi

python3 "$SCRIPT_DIR/verify_extapi_modules.py" \
  --manifest "$MANIFEST" \
  --extapi-binary "$DST_XCF/ios-arm64/DCloudUTSExtAPI.framework/DCloudUTSExtAPI"
