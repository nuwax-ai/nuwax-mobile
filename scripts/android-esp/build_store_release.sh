#!/usr/bin/env bash
# Android 应用市场正式包：生产资源 + 正式证书 + Release APK/AAB。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# shellcheck source=../local-base-env.sh
source "$SCRIPT_DIR/../local-base-env.sh"
# shellcheck source=ensure_env.sh
source "$SCRIPT_DIR/ensure_env.sh"

PROJ="${ANDROID_ESP_PROJECT:-$ANDROID_ESP_WORK/project}"
OUTPUT_DIR="${ANDROID_RELEASE_OUTPUT_DIR:-$ROOT_DIR/unpackage/release}"
FORMATS="${ANDROID_RELEASE_FORMATS:-apk,aab}"
SKIP_APP_RESOURCE="${SKIP_APP_RESOURCE:-0}"
EXPECTED_BUNDLE="com.nuwax.app"

fail() {
  echo "✗ $*" >&2
  exit 1
}

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "缺少 ${name}（请配置到 scripts/local-secrets.env）"
}

contains_format() {
  case ",${FORMATS}," in
    *",$1,"*) return 0 ;;
    *) return 1 ;;
  esac
}

echo "======== Android 应用市场正式打包 ========"

for name in \
  DCLOUD_APPKEY \
  ANDROID_RELEASE_STORE_FILE \
  ANDROID_RELEASE_STORE_PASSWORD \
  ANDROID_RELEASE_KEY_ALIAS \
  ANDROID_RELEASE_KEY_PASSWORD; do
  require_env "$name"
done

export ANDROID_RELEASE_STORE_TYPE="${ANDROID_RELEASE_STORE_TYPE:-JKS}"
[[ -f "$ANDROID_RELEASE_STORE_FILE" ]] \
  || fail "正式签名证书不存在: $ANDROID_RELEASE_STORE_FILE"
[[ "$FORMATS" == "apk" || "$FORMATS" == "aab" || "$FORMATS" == "apk,aab" || "$FORMATS" == "aab,apk" ]] \
  || fail "ANDROID_RELEASE_FORMATS 仅支持 apk、aab 或 apk,aab，当前=$FORMATS"

[[ -x "${JAVA_HOME:-}/bin/keytool" ]] || fail "需要 JDK 17 keytool"
JAVA_MAJOR="$("$JAVA_HOME/bin/java" -version 2>&1 | sed -n '1s/.*version "\([0-9][0-9]*\).*/\1/p')"
[[ "$JAVA_MAJOR" == "17" ]] \
  || fail "正式构建要求 JDK 17，当前 JAVA_HOME=${JAVA_HOME:-unset}（Java ${JAVA_MAJOR:-unknown}）"
echo "✓ JDK 17: $JAVA_HOME"
"$JAVA_HOME/bin/keytool" -list \
  -keystore "$ANDROID_RELEASE_STORE_FILE" \
  -storetype "$ANDROID_RELEASE_STORE_TYPE" \
  -alias "$ANDROID_RELEASE_KEY_ALIAS" \
  -storepass:env ANDROID_RELEASE_STORE_PASSWORD >/dev/null \
  || fail "无法打开正式签名证书或找不到 alias"
echo "✓ 正式签名证书与 alias 可读取"

MANIFEST_VALUES="$(python3 - "$ROOT_DIR/manifest.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    manifest = json.load(stream)
android = manifest.get("app-android", {}).get("distribute", {})
print(android.get("packagename", ""))
print(str(manifest.get("versionName", "")).strip())
print(str(manifest.get("versionCode", "")).strip())
PY
)"
PACKAGE_NAME="$(printf '%s\n' "$MANIFEST_VALUES" | sed -n '1p')"
VERSION_NAME="$(printf '%s\n' "$MANIFEST_VALUES" | sed -n '2p')"
VERSION_CODE="$(printf '%s\n' "$MANIFEST_VALUES" | sed -n '3p')"
[[ "$PACKAGE_NAME" == "$EXPECTED_BUNDLE" ]] \
  || fail "manifest.json 包名必须为 ${EXPECTED_BUNDLE}，当前=${PACKAGE_NAME}"
[[ -n "$VERSION_NAME" ]] || fail "manifest.json versionName 不能为空"
[[ "$VERSION_CODE" =~ ^[1-9][0-9]*$ ]] || fail "manifest.json versionCode 必须为正整数"
echo "✓ 包名=$PACKAGE_NAME 版本=$VERSION_NAME ($VERSION_CODE)"

grep -q 'API_BASE_URL = "https://agent.nuwax.com"' "$ROOT_DIR/constants/config.uts" \
  || fail "未找到生产 API 地址 https://agent.nuwax.com"
if grep -q '打包正式环境时要删除' "$ROOT_DIR/constants/config.uts"; then
  fail "constants/config.uts 仍有强制测试环境配置"
fi
echo "✓ 生产 API 配置检查通过"

BRANCH="$(git -C "$ROOT_DIR" branch --show-current)"
if [[ "$BRANCH" != "release/nuwa-zhuoda" && "${ALLOW_NON_RELEASE_BRANCH:-0}" != "1" ]]; then
  if [[ "${STRICT_RELEASE_GIT:-0}" == "1" ]]; then
    fail "严格发布模式仅允许 release/nuwa-zhuoda，当前=${BRANCH}"
  fi
  echo "⚠ 当前分支=${BRANCH}，不是生产发布分支 release/nuwa-zhuoda；本次产物仅用于验包"
fi
if [[ -n "$(git -C "$ROOT_DIR" status --porcelain)" && "${ALLOW_DIRTY_RELEASE:-0}" != "1" ]]; then
  if [[ "${STRICT_RELEASE_GIT:-0}" == "1" ]]; then
    fail "严格发布模式要求工作区无未提交修改"
  fi
  echo "⚠ 工作区存在未提交修改；本次产物仅用于验包"
fi
if [[ "$BRANCH" == "release/nuwa-zhuoda" && -z "$(git -C "$ROOT_DIR" status --porcelain)" ]]; then
  echo "✓ Git 发布状态检查通过"
fi

HX_CLI="${HX_CLI:-/Applications/HBuilderX.app/Contents/MacOS/cli}"
[[ -x "$HX_CLI" ]] || fail "找不到 HBuilderX CLI: $HX_CLI"
[[ -n "${ANDROID_HOME:-}" && -d "$ANDROID_HOME/platforms" ]] \
  || fail "ANDROID_HOME 无效或缺少 platforms/"

if [[ "$SKIP_APP_RESOURCE" == "1" ]]; then
  [[ -d "$ROOT_DIR/unpackage/resources/app-android" ]] \
    || fail "缺少 app-android 资源，不能跳过资源导出"
  echo "✓ 使用已有 appResource"
else
  pgrep -xq HBuilderX 2>/dev/null || fail "请先启动 HBuilderX 并导入本项目"
  echo "==== 1) 生成生产 appResource ===="
  bash "$SCRIPT_DIR/../hx-cli.sh" publish app \
    --platform APP \
    --type appResource \
    --project "$ROOT_DIR"
fi

[[ -d "$ROOT_DIR/unpackage/resources/app-android" ]] || fail "未生成 app-android 资源"
# 即使 SKIP_APP_RESOURCE=1 使用了 tester 留下的资源，也必须恢复为生产接口。
python3 "$SCRIPT_DIR/set_app_resource_api_env.py" \
  production "$ROOT_DIR/unpackage/resources/app-android"
export APP_RESOURCES_DIR="$ROOT_DIR/unpackage/resources/app-android"
export ENABLE_HX_DEBUG=0
export ANDROID_BUILD_TYPE=release
export ANDROID_SIGNING_MODE=release
export SKIP_INSTALL=1

if [[ ! -e "$PROJ/settings.gradle" ]]; then
  echo "==== 2) 初始化 Android 离线 SDK 工作副本 ===="
  bash "$SCRIPT_DIR/official/setup_sdk.sh"
fi
ensure_gradle_wrapper_jar "$PROJ"
write_local_properties "$PROJ"

echo "==== 2) 同步资源并配置正式宿主 ===="
"$SCRIPT_DIR/sync_local_pack_resources.sh"
python3 "$SCRIPT_DIR/configure_app.py"

GRADLE_TASKS=()
contains_format apk && GRADLE_TASKS+=(":app:assembleRelease")
contains_format aab && GRADLE_TASKS+=(":app:bundleRelease")

echo "==== 3) Gradle 正式构建 (${FORMATS}) ===="
cd "$PROJ"
chmod +x ./gradlew
./gradlew "${GRADLE_TASKS[@]}" --stacktrace

mkdir -p "$OUTPUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
BASE_NAME="nuwax-${VERSION_NAME}-${VERSION_CODE}-release-${STAMP}"
APK_DEST=""
AAB_DEST=""

if contains_format apk; then
  APK_SOURCE="$PROJ/app/build/outputs/apk/release/app-release.apk"
  [[ -f "$APK_SOURCE" ]] || fail "未找到正式 APK: $APK_SOURCE"
  APK_DEST="$OUTPUT_DIR/${BASE_NAME}.apk"
  cp -f "$APK_SOURCE" "$APK_DEST"
fi
if contains_format aab; then
  AAB_SOURCE="$PROJ/app/build/outputs/bundle/release/app-release.aab"
  [[ -f "$AAB_SOURCE" ]] || fail "未找到正式 AAB: $AAB_SOURCE"
  AAB_DEST="$OUTPUT_DIR/${BASE_NAME}.aab"
  cp -f "$AAB_SOURCE" "$AAB_DEST"
fi

echo "==== 4) 正式产物验收 ===="
if [[ -n "$APK_DEST" ]]; then
  AAPT="$(find "$ANDROID_HOME/build-tools" -type f -name aapt | sort | tail -1)"
  BUILD_TOOLS="$(dirname "$AAPT")"
  APKSIGNER="$BUILD_TOOLS/apksigner"
  [[ -x "$AAPT" && -x "$APKSIGNER" ]] || fail "Android build-tools 缺少 aapt/apksigner"
  BADGING="$($AAPT dump badging "$APK_DEST" | sed -n '1p')"
  [[ "$BADGING" == *"name='$PACKAGE_NAME'"* ]] || fail "APK 包名验收失败: $BADGING"
  [[ "$BADGING" == *"versionCode='$VERSION_CODE'"* ]] || fail "APK versionCode 验收失败: $BADGING"
  [[ "$BADGING" == *"versionName='$VERSION_NAME'"* ]] || fail "APK versionName 验收失败: $BADGING"
  "$APKSIGNER" verify "$APK_DEST" || fail "APK 签名校验失败"
  CERT_INFO="$($APKSIGNER verify --print-certs "$APK_DEST")"
  if printf '%s\n' "$CERT_INFO" | grep -q 'CN=Android Debug'; then
    fail "检测到 Android Debug 证书，拒绝交付"
  fi
  if "$AAPT" dump badging "$APK_DEST" | grep -q 'application-debuggable'; then
    fail "APK 仍为 debuggable，拒绝交付"
  fi
  printf '%s\n' "$CERT_INFO" | sed -n '1,4p'
  shasum -a 256 "$APK_DEST"
fi
if [[ -n "$AAB_DEST" ]]; then
  "$JAVA_HOME/bin/jarsigner" -verify "$AAB_DEST" >/dev/null \
    || fail "AAB 签名校验失败"
  shasum -a 256 "$AAB_DEST"
fi

echo ""
echo "======== 正式打包完成 ========"
[[ -n "$APK_DEST" ]] && echo "APK: $APK_DEST"
[[ -n "$AAB_DEST" ]] && echo "AAB: $AAB_DEST"
