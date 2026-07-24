#!/usr/bin/env bash
# 将 HBuilderX「生成本地打包 App 资源」产物同步到 UniAppXDemo。
#
# 前置：HBuilderX → 发行 → 原生App-本地打包 → 生成本地打包App资源
# 产物默认在仓库 unpackage/resources/app-ios/
#
# 环境变量：
#   UNIAPPX_SDK_ROOT   UniAppX-iOS@5.15 根（含 UniAppXDemo/）
#   APP_RESOURCES_DIR  HX 本地打包资源根，默认 <repo>/unpackage/resources/app-ios
#   APPID              默认 __UNI__8BF05E4
#   XCFRAMEWORKS_DIR   预编译 xcframework 目录（拷到 SDK/Libs）；可选
#                      默认优先 $IOS_ESP_OUT，其次 backup 路径
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=../local-base-env.sh
source "$SCRIPT_DIR/../local-base-env.sh"

UNIAPPX_SDK_ROOT="${UNIAPPX_SDK_ROOT}"
APP_RESOURCES_DIR="${APP_RESOURCES_DIR:-$REPO_ROOT/unpackage/resources/app-ios}"
APPID="${APPID:-$NUWAX_APPID}"
DEMO_APPS="$UNIAPPX_SDK_ROOT/UniAppXDemo/UniAppXDemo/uni-app-x/apps"
SDK_LIBS="$UNIAPPX_SDK_ROOT/SDK/Libs"

XCFRAMEWORKS_DIR="${XCFRAMEWORKS_DIR:-}"
if [[ -z "$XCFRAMEWORKS_DIR" ]]; then
  if [[ -n "${IOS_ESP_OUT:-}" && -d "${IOS_ESP_OUT}" ]]; then
    XCFRAMEWORKS_DIR="$IOS_ESP_OUT"
  elif [[ -d "$IOS_ESP_BUILD_ROOT/out" ]]; then
    XCFRAMEWORKS_DIR="$IOS_ESP_BUILD_ROOT/out"
  fi
fi

echo "REPO_ROOT=$REPO_ROOT"
echo "UNIAPPX_SDK_ROOT=$UNIAPPX_SDK_ROOT"
echo "APP_RESOURCES_DIR=$APP_RESOURCES_DIR"
echo "XCFRAMEWORKS_DIR=${XCFRAMEWORKS_DIR:-<none>}"

if [[ ! -d "$UNIAPPX_SDK_ROOT/UniAppXDemo" ]]; then
  echo "✗ 找不到 UniAppXDemo：$UNIAPPX_SDK_ROOT/UniAppXDemo" >&2
  echo "  请将官方 SDK 放到 \$NUWAX_OFFLINE_SDK_HOME/sdk/ios/\$NUWAX_HX_VERSION/ 或设置 UNIAPPX_SDK_ROOT" >&2
  exit 1
fi

if [[ ! -d "$APP_RESOURCES_DIR/$APPID" ]]; then
  echo "✗ 缺少本地打包资源：$APP_RESOURCES_DIR/$APPID" >&2
  echo "  请先在 HBuilderX 执行：发行 → 原生App-本地打包 → 生成本地打包App资源" >&2
  exit 1
fi

mkdir -p "$DEMO_APPS"
# HX 产物是 $APPID/www/...；Demo 期望 apps/$APPID/www
rm -rf "$DEMO_APPS/$APPID"
mkdir -p "$DEMO_APPS/$APPID"
if [[ -d "$APP_RESOURCES_DIR/$APPID/www" ]]; then
  cp -R "$APP_RESOURCES_DIR/$APPID/www" "$DEMO_APPS/$APPID/"
else
  # 容错：有的产物直接把 www 内容放在 $APPID 下
  cp -R "$APP_RESOURCES_DIR/$APPID/." "$DEMO_APPS/$APPID/"
fi
echo "✓ 已同步 App 资源 → $DEMO_APPS/$APPID"

# uni-cmark：把 scopeparser 放到 SDK/Libs，便于后续手动/脚本注入（配网页不强制）
CMARK_FW="$APP_RESOURCES_DIR/uni_modules/uni-cmark/utssdk/app-ios/Frameworks/scopeparser4ios.xcframework"
if [[ -d "$CMARK_FW" ]]; then
  mkdir -p "$SDK_LIBS"
  rm -rf "$SDK_LIBS/scopeparser4ios.xcframework"
  cp -R "$CMARK_FW" "$SDK_LIBS/"
  echo "✓ 已拷贝 scopeparser4ios.xcframework → $SDK_LIBS"
else
  echo "⚠ 未找到 uni-cmark Frameworks（跳过；Markdown 相关能力可能不可用）"
fi

# 备份 HX 编译出的插件源（供重编 unimodule 对照）
PLUGIN_STAGING="$REPO_ROOT/out/ios-esp-plugin-src"
mkdir -p "$PLUGIN_STAGING"
for P in nuwax-esp-provisioning uni-cmark; do
  SRC="$APP_RESOURCES_DIR/uni_modules/$P/utssdk/app-ios"
  if [[ -d "$SRC" ]]; then
    rm -rf "$PLUGIN_STAGING/$P"
    mkdir -p "$PLUGIN_STAGING/$P"
    cp -R "$SRC/." "$PLUGIN_STAGING/$P/"
    echo "✓ 暂存插件编译产物 → $PLUGIN_STAGING/$P"
  fi
done

# 预编译 ESP xcframework → SDK/Libs
if [[ -n "${XCFRAMEWORKS_DIR:-}" && -d "$XCFRAMEWORKS_DIR" ]]; then
  mkdir -p "$SDK_LIBS"
  for N in SwiftProtobuf ESPProvision unimoduleNuwaxEspProvisioning; do
    if [[ -d "$XCFRAMEWORKS_DIR/$N.xcframework" ]]; then
      rm -rf "$SDK_LIBS/$N.xcframework"
      cp -R "$XCFRAMEWORKS_DIR/$N.xcframework" "$SDK_LIBS/"
      echo "✓ 已拷贝 $N.xcframework → $SDK_LIBS"
    else
      echo "⚠ 缺少 $XCFRAMEWORKS_DIR/$N.xcframework"
    fi
  done
else
  echo "⚠ 未设置/找到 XCFRAMEWORKS_DIR，跳过 ESP xcframework 拷贝"
  echo "  可先用 backup 产物或运行 build_xcframeworks.sh"
fi

echo ""
echo "下一步："
echo "  1) python3 scripts/ios-esp/inject_frameworks.py"
echo "  2) python3 scripts/ios-esp/strip_sample_unimodules.py"
echo "  3) python3 scripts/ios-esp/configure_demo.py   # AppKey / 签名 / 蓝牙文案"
echo "  4) open \"$UNIAPPX_SDK_ROOT/UniAppXDemo/UniAppXDemo.xcodeproj\""
echo "     或: xcodebuild -project ... -scheme UniAppX -destination 'id=<UDID>' build"
