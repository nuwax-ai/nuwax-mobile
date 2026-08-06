#!/usr/bin/env bash
# 本地离线自定义基座 · 统一环境变量
#
# 用法：
#   source scripts/local-base-env.sh
#
# 仓外本机目录（默认基于 $HOME/workspace，可覆盖）——三者职责不同，勿混放证书：
#   NUWAX_OFFLINE_SDK_HOME = …/nuwax-mobile-offline-sdk
#     ├── sdk/{ios,android,harmony}/<ver>/
#     ├── work/{ios,android,harmony}/
#     └── archives/*.zip          # 无证书；S3 包也不含签名材料
#   NUWAX_SIGNING_HOME     = …/nuwax-signing
#     ├── local-secrets.env   # 口令 / AppKey / UUID（权威；仅本地 Git）
#     └── android|ios-app|…   # 签名实体（极敏感，永不进业务仓 / SDK / S3）
#
# 进 Git 可推远程的只有 nuwax-mobile 内脚本/文档；SDK、work、signing 均不进业务仓远程。
# 敏感配置：优先 $NUWAX_SIGNING_HOME/local-secrets.env，回退 scripts/local-secrets.env。
# 兼容旧变量：UNIAPPX_SDK_ROOT / ANDROID_ESP_WORK / IOS_ESP_BUILD_ROOT 等仍可手动覆盖。

_NUWAX_LB_ENV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
_NUWAX_REPO_ROOT="$(cd "$_NUWAX_LB_ENV_DIR/.." && pwd)"

# 版本默认对齐本机 HBuilderX-Alpha（蒸汽模式 vapor 需 Android 编译器 5.21+，见 docs）
export NUWAX_HX_VERSION="${NUWAX_HX_VERSION:-5.23}"
# Android 离线 SDK 构建号（官方包名 Android-uni-app-x-SDK@<build>-<ver>；5.23=14987，5.15=14915）
export NUWAX_ANDROID_SDK_BUILD="${NUWAX_ANDROID_SDK_BUILD:-14987}"
export NUWAX_WORKSPACE_ROOT="${NUWAX_WORKSPACE_ROOT:-$HOME/workspace}"
export NUWAX_OFFLINE_SDK_HOME="${NUWAX_OFFLINE_SDK_HOME:-$NUWAX_WORKSPACE_ROOT/nuwax-mobile-offline-sdk}"
export NUWAX_SIGNING_HOME="${NUWAX_SIGNING_HOME:-$NUWAX_WORKSPACE_ROOT/nuwax-signing}"
export NUWAX_SDK_ROOT="${NUWAX_SDK_ROOT:-$NUWAX_OFFLINE_SDK_HOME/sdk}"
export NUWAX_LOCAL_BASE_ROOT="${NUWAX_LOCAL_BASE_ROOT:-$NUWAX_OFFLINE_SDK_HOME/work}"
export NUWAX_SDK_ARCHIVES="${NUWAX_SDK_ARCHIVES:-$NUWAX_OFFLINE_SDK_HOME/archives}"
export NUWAX_MAIN_ROOT="${NUWAX_MAIN_ROOT:-$_NUWAX_REPO_ROOT}"
export NUWAX_BUNDLE_ID="${NUWAX_BUNDLE_ID:-com.nuwax.app}"
export NUWAX_APPID="${NUWAX_APPID:-__UNI__8BF05E4}"

# 本机敏感配置：AppKey / Android 正式签名路径与口令 / iOS Team·Profile。
# 权威路径在签名目录；业务仓 scripts/local-secrets.env 仅作回退（勿提交真实值到远程）。
_NUWAX_SECRETS_SIGNING="${NUWAX_SIGNING_HOME}/local-secrets.env"
_NUWAX_SECRETS_LEGACY="${_NUWAX_LB_ENV_DIR}/local-secrets.env"
if [[ -f "$_NUWAX_SECRETS_SIGNING" ]]; then
  # shellcheck source=/dev/null
  source "$_NUWAX_SECRETS_SIGNING"
elif [[ -f "$_NUWAX_SECRETS_LEGACY" ]]; then
  echo "[local-base-env] 警告：使用已弃用的 $_NUWAX_SECRETS_LEGACY；请迁移到 $_NUWAX_SECRETS_SIGNING" >&2
  # shellcheck source=/dev/null
  source "$_NUWAX_SECRETS_LEGACY"
fi

# ---------- iOS ----------
export UNIAPPX_SDK_ROOT="${UNIAPPX_SDK_ROOT:-$NUWAX_SDK_ROOT/ios/${NUWAX_HX_VERSION}/UniAppX-iOS@${NUWAX_HX_VERSION}}"
export IOS_ESP_BUILD_ROOT="${IOS_ESP_BUILD_ROOT:-$NUWAX_LOCAL_BASE_ROOT/ios}"
export IOS_ESP_OUT="${IOS_ESP_OUT:-$IOS_ESP_BUILD_ROOT/out}"
export IOS_ESP_FRAMEWORKS_DIR="${IOS_ESP_FRAMEWORKS_DIR:-$IOS_ESP_BUILD_ROOT/official/build/frameworks-iphoneos}"

# ---------- Android ----------
export UNIAPPX_ANDROID_SDK_ROOT="${UNIAPPX_ANDROID_SDK_ROOT:-$NUWAX_SDK_ROOT/android/${NUWAX_HX_VERSION}/Android-uni-app-x-SDK@${NUWAX_ANDROID_SDK_BUILD}-${NUWAX_HX_VERSION}}"
if [[ ! -d "$UNIAPPX_ANDROID_SDK_ROOT/uniappxnativepackage" ]]; then
  _ALT="$NUWAX_SDK_ROOT/android/${NUWAX_HX_VERSION}/Android-uni-app-x-SDK@${NUWAX_ANDROID_SDK_BUILD}-${NUWAX_HX_VERSION}"
  if [[ -d "$_ALT/uniappxnativepackage" ]]; then
    export UNIAPPX_ANDROID_SDK_ROOT="$_ALT"
  fi
fi
export ANDROID_ESP_WORK="${ANDROID_ESP_WORK:-$NUWAX_LOCAL_BASE_ROOT/android}"
export ANDROID_ESP_PROJECT="${ANDROID_ESP_PROJECT:-$ANDROID_ESP_WORK/project}"
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
  echo "NUWAX_ANDROID_SDK_BUILD=$NUWAX_ANDROID_SDK_BUILD"
  echo "NUWAX_OFFLINE_SDK_HOME=$NUWAX_OFFLINE_SDK_HOME"
  echo "NUWAX_SIGNING_HOME=$NUWAX_SIGNING_HOME"
  echo "NUWAX_MAIN_ROOT=$NUWAX_MAIN_ROOT"
  echo "UNIAPPX_SDK_ROOT=$UNIAPPX_SDK_ROOT"
  echo "IOS_ESP_BUILD_ROOT=$IOS_ESP_BUILD_ROOT"
  echo "UNIAPPX_ANDROID_SDK_ROOT=$UNIAPPX_ANDROID_SDK_ROOT"
  echo "ANDROID_ESP_WORK=$ANDROID_ESP_WORK"
  echo "HARMONY_ESP_WORK=$HARMONY_ESP_WORK"
fi
