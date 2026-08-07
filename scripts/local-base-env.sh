#!/usr/bin/env bash
# 本地离线自定义基座 · 统一环境变量
#
# 用法：
#   source scripts/local-base-env.sh
#
# 仓外统一目录（默认基于 $HOME，可覆盖）：
#   NUWAX_OFFLINE_SDK_HOME = $HOME/workspace/nuwax-mobile-offline-sdk
#     ├── sdk/{ios,android,harmony}/<ver>/
#     ├── work/{ios,android,harmony}/
#     └── archives/*.zip
#
# 进 Git 的只有 nuwax-mobile 内脚本/文档；SDK 与工作副本不进业务仓。
# 兼容旧变量：UNIAPPX_SDK_ROOT / ANDROID_ESP_WORK / IOS_ESP_BUILD_ROOT 等仍可手动覆盖。

_NUWAX_LB_ENV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
_NUWAX_REPO_ROOT="$(cd "$_NUWAX_LB_ENV_DIR/.." && pwd)"

export NUWAX_HX_VERSION="${NUWAX_HX_VERSION:-5.23}"
export NUWAX_WORKSPACE_ROOT="${NUWAX_WORKSPACE_ROOT:-$HOME/workspace}"
export NUWAX_OFFLINE_SDK_HOME="${NUWAX_OFFLINE_SDK_HOME:-$NUWAX_WORKSPACE_ROOT/nuwax-mobile-offline-sdk}"
export NUWAX_SDK_ROOT="${NUWAX_SDK_ROOT:-$NUWAX_OFFLINE_SDK_HOME/sdk}"
export NUWAX_LOCAL_BASE_ROOT="${NUWAX_LOCAL_BASE_ROOT:-$NUWAX_OFFLINE_SDK_HOME/work}"
export NUWAX_SDK_ARCHIVES="${NUWAX_SDK_ARCHIVES:-$NUWAX_OFFLINE_SDK_HOME/archives}"
export NUWAX_MAIN_ROOT="${NUWAX_MAIN_ROOT:-$_NUWAX_REPO_ROOT}"
export NUWAX_BUNDLE_ID="${NUWAX_BUNDLE_ID:-com.nuwax.app}"
export NUWAX_APPID="${NUWAX_APPID:-__UNI__8BF05E4}"

# 本机敏感配置（gitignore）：AppKey / Android 正式签名 / iOS 签名。存在则 source，绝不入库。
if [[ -f "$_NUWAX_LB_ENV_DIR/local-secrets.env" ]]; then
  source "$_NUWAX_LB_ENV_DIR/local-secrets.env"
fi

# ---------- iOS ----------
export UNIAPPX_SDK_ROOT="${UNIAPPX_SDK_ROOT:-$NUWAX_SDK_ROOT/ios/${NUWAX_HX_VERSION}/UniAppX-iOS@${NUWAX_HX_VERSION}}"
export IOS_ESP_BUILD_ROOT="${IOS_ESP_BUILD_ROOT:-$NUWAX_LOCAL_BASE_ROOT/ios}"
export IOS_ESP_OUT="${IOS_ESP_OUT:-$IOS_ESP_BUILD_ROOT/out}"
export IOS_ESP_FRAMEWORKS_DIR="${IOS_ESP_FRAMEWORKS_DIR:-$IOS_ESP_BUILD_ROOT/official/build/frameworks-iphoneos}"

# ---------- Android ----------
# build 号（14915/14987…）随 HX 版本变；glob 匹配 sdk/ 下实际目录，避免硬编码 14915。
if [[ -z "${UNIAPPX_ANDROID_SDK_ROOT:-}" ]]; then
  _NUWAX_ANDROID_SDK=""
  for _d in "$NUWAX_SDK_ROOT"/android/"${NUWAX_HX_VERSION}"/Android-uni-app-x-SDK@*-"${NUWAX_HX_VERSION}"; do
    if [[ -d "$_d/uniappxnativepackage" ]]; then
      _NUWAX_ANDROID_SDK="$_d"; break
    fi
  done
  [[ -n "$_NUWAX_ANDROID_SDK" ]] && export UNIAPPX_ANDROID_SDK_ROOT="$_NUWAX_ANDROID_SDK"
  unset _d _NUWAX_ANDROID_SDK
fi
export ANDROID_ESP_WORK="${ANDROID_ESP_WORK:-$NUWAX_LOCAL_BASE_ROOT/android}"
# 按版本选 work 工程，避免多 checkout 共享符号链接互相污染。
# 默认 NUWAX_HX_VERSION=5.23（当前 diff 线 VDOM 5.23）；回退其他版本时显式 export 覆盖。
# glob 匹配 build 号（14915/14987…），匹配不到则回退旧的 project 符号链接。
if [[ -z "${ANDROID_ESP_PROJECT:-}" ]]; then
  _NUWAX_PROJ_MATCH=""
  for _d in "$NUWAX_LOCAL_BASE_ROOT"/android/Android-uni-app-x-SDK@*-"${NUWAX_HX_VERSION}"; do
    if [[ -d "$_d/uniappxnativepackage" ]]; then
      _NUWAX_PROJ_MATCH="$_d/uniappxnativepackage"
      break
    fi
  done
  if [[ -n "$_NUWAX_PROJ_MATCH" ]]; then
    export ANDROID_ESP_PROJECT="$_NUWAX_PROJ_MATCH"
  else
    export ANDROID_ESP_PROJECT="$ANDROID_ESP_WORK/project"
  fi
  unset _d _NUWAX_PROJ_MATCH
fi
export ANDROID_BUNDLE_ID="${ANDROID_BUNDLE_ID:-$NUWAX_BUNDLE_ID}"
export APPID="${APPID:-$NUWAX_APPID}"
export ANDROID_COMPILE_SDK="${ANDROID_COMPILE_SDK:-36}"
export ANDROID_TARGET_SDK="${ANDROID_TARGET_SDK:-36}"

# ---------- Harmony（预留）----------
export UNIAPPX_HARMONY_SDK_ROOT="${UNIAPPX_HARMONY_SDK_ROOT:-$NUWAX_SDK_ROOT/harmony/${NUWAX_HX_VERSION}}"
export HARMONY_ESP_WORK="${HARMONY_ESP_WORK:-$NUWAX_LOCAL_BASE_ROOT/harmony}"

export DCLOUD_APPKEY="${DCLOUD_APPKEY:-}"

# 未拉取离线 SDK 时给一行提示（不中断 source）。拉取：make sdk-fetch
if [[ ! -d "$NUWAX_OFFLINE_SDK_HOME/sdk" && ! -d "$NUWAX_OFFLINE_SDK_HOME/archives" ]]; then
  echo "[local-base-env] 未找到离线 SDK：$NUWAX_OFFLINE_SDK_HOME 下缺 sdk/ 与 archives/。运行 make sdk-fetch 拉取。" >&2
fi

if [[ "${NUWAX_LOCAL_BASE_ENV_VERBOSE:-0}" == "1" ]]; then
  echo "NUWAX_HX_VERSION=$NUWAX_HX_VERSION"
  echo "NUWAX_OFFLINE_SDK_HOME=$NUWAX_OFFLINE_SDK_HOME"
  echo "NUWAX_MAIN_ROOT=$NUWAX_MAIN_ROOT"
  echo "UNIAPPX_SDK_ROOT=$UNIAPPX_SDK_ROOT"
  echo "IOS_ESP_BUILD_ROOT=$IOS_ESP_BUILD_ROOT"
  echo "UNIAPPX_ANDROID_SDK_ROOT=$UNIAPPX_ANDROID_SDK_ROOT"
  echo "ANDROID_ESP_WORK=$ANDROID_ESP_WORK"
  echo "HARMONY_ESP_WORK=$HARMONY_ESP_WORK"
fi
