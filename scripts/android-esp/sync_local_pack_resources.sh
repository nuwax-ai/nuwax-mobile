#!/usr/bin/env bash
# 同步 HX「生成本地打包 App 资源」到官方宿主工程（官方 android.html / androiduts.html）
#
#  - apps/{appid}/www → uniappx/src/main/assets/apps/{appid}/
#  - uniappx/app-android/src/** → uniappx/src/main/java/（整目录替换，避免残留 Hello 示例）
#  - uni_modules/*/utssdk/app-android → 独立 UTS Library 模块
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
export WT_ROOT
# shellcheck source=../local-base-env.sh
source "$SCRIPT_DIR/../local-base-env.sh"
ANDROID_ESP_WORK="${ANDROID_ESP_WORK}"
PROJ="${ANDROID_ESP_PROJECT:-$ANDROID_ESP_WORK/project}"
APP_RESOURCES_DIR="${APP_RESOURCES_DIR:-$WT_ROOT/unpackage/resources/app-android}"
APPID="${APPID:-__UNI__8BF05E4}"

ASSETS_APPS="$PROJ/uniappx/src/main/assets/apps"
JAVA_DST="$PROJ/uniappx/src/main/java"

if [[ ! -d "$APP_RESOURCES_DIR/$APPID" ]]; then
  echo "✗ 缺少 $APP_RESOURCES_DIR/$APPID" >&2
  echo "  请先 HBuilderX：发行 → 原生App-本地打包 → 生成本地打包App资源" >&2
  exit 1
fi

mkdir -p "$ASSETS_APPS"
rm -rf "$ASSETS_APPS/$APPID"
mkdir -p "$ASSETS_APPS/$APPID"
if [[ -d "$APP_RESOURCES_DIR/$APPID/www" ]]; then
  cp -R "$APP_RESOURCES_DIR/$APPID/www" "$ASSETS_APPS/$APPID/"
else
  cp -R "$APP_RESOURCES_DIR/$APPID/." "$ASSETS_APPS/$APPID/"
fi
# 去掉示例 Hello 资源，避免误启动
rm -rf "$ASSETS_APPS/__UNI__HelloUniAppX"
echo "✓ assets/apps/$APPID"

# 拷贝编译出的页面 kt —— 必须整目录替换，否则 Hello 示例组件残留导致编译失败
KT_SRC="$APP_RESOURCES_DIR/uniappx/app-android/src"
if [[ -d "$KT_SRC" ]]; then
  rm -rf "$JAVA_DST"
  mkdir -p "$JAVA_DST"
  rsync -a "$KT_SRC/" "$JAVA_DST/"
  echo "✓ uniappx kt → src/main/java（已清空示例残留）"
else
  echo "⚠ 无 ${KT_SRC}，跳过 kt 同步"
fi

# 注入全部 UTS 原生插件（含 esp / pay / cmark / highlight）
python3 "$SCRIPT_DIR/inject_all_uts_modules.py"

echo ""
echo "下一步: python3 $SCRIPT_DIR/configure_app.py"
echo "        $SCRIPT_DIR/build_device_base.sh"
