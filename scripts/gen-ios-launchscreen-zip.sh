#!/usr/bin/env bash
# 生成 iOS 系统启动屏（LaunchScreen）资源：
#   1. 从 static/splash/icon-xxxhdpi.png 派生 dc_launchscreen_icon@2x/@3x.png
#   2. 打成 HBuilderX 云打包要求的自定义 storyboard zip（根目录、仅一个 .storyboard）
#
# 产物同时供：
#   - HBuilderX 云打包（manifest.json app-ios.distribute.splashScreens.storyboard）
#   - 本地离线基座（scripts/voip-native/device/prepare-ios.py 注入宿主工程）
#
# 用法：bash scripts/gen-ios-launchscreen-zip.sh [输出 zip 路径]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/nativeResources/ios/launchscreen"
# 与 Android 启动图同款：白底 + 居中黑色圆角方块（方块占画布 36%）
ICON_SRC="$ROOT/static/splash/icon-xxxhdpi.png"
OUT_ZIP="${1:-$SRC/NuwaxLaunchScreen.zip}"

# storyboard 里 imageView 宽 = 屏宽 × 0.66（最大约 284pt）；@2x=640px、@3x=960px
ICON_2X="$SRC/dc_launchscreen_icon@2x.png"
ICON_3X="$SRC/dc_launchscreen_icon@3x.png"

[[ -f "$SRC/LaunchScreen.storyboard" ]] || { echo "✗ 缺少 $SRC/LaunchScreen.storyboard" >&2; exit 1; }
[[ -f "$ICON_SRC" ]] || { echo "✗ 缺少 App 图标源图 $ICON_SRC" >&2; exit 1; }
command -v sips >/dev/null 2>&1 || { echo "✗ 需要 macOS sips 缩放图片" >&2; exit 1; }
command -v zip >/dev/null 2>&1 || { echo "✗ 需要 zip" >&2; exit 1; }

sips -z 640 640 "$ICON_SRC" --out "$ICON_2X" >/dev/null
cp "$ICON_SRC" "$ICON_3X"

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/nuwax-ios-launchscreen.XXXXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
cp "$SRC/LaunchScreen.storyboard" "$STAGE/LaunchScreen.storyboard"
cp "$ICON_2X" "$STAGE/dc_launchscreen_icon@2x.png"
cp "$ICON_3X" "$STAGE/dc_launchscreen_icon@3x.png"

mkdir -p "$(dirname "$OUT_ZIP")"
rm -f "$OUT_ZIP"
# -X 去掉额外属性；-j 不需要（已在临时目录内，只打包这 3 个文件，不含目录）
(cd "$STAGE" && zip -qX "$OUT_ZIP" LaunchScreen.storyboard "dc_launchscreen_icon@2x.png" "dc_launchscreen_icon@3x.png")

echo "✓ 生成 iOS 启动屏资源："
ls -l "$ICON_2X" "$ICON_3X" "$OUT_ZIP"
echo "--- zip 内容 ---"
unzip -l "$OUT_ZIP"
