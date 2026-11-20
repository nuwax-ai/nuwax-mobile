#!/usr/bin/env bash
# 发布自定义基座到 Nuwax S3（MinIO）。版本不可覆盖，通道可单独切换。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_DIR="${NUWAX_BASE_SOURCE:-$ROOT_DIR/unpackage/debug}"
VERSION="${NUWAX_BASE_VERSION:-}"
CHANNEL="${NUWAX_BASE_CHANNEL:-debug}"
TARGETS="${NUWAX_BASE_TARGETS:-}"
NO_PROMOTE="${NUWAX_BASE_NO_PROMOTE:-0}"
DRY_RUN="${NUWAX_BASE_DRY_RUN:-0}"
PROMOTE_ONLY=0
NOTE=""

usage() {
  cat <<'HELP'
Usage: bash scripts/publish-custom-base-s3.sh [options]

  --version ID    基座版本（新发布必填 X.Y.Z；每次新出包使用新版本）
  --channel NAME  更新指定通道（默认 debug）
  --source DIR    基座产物所在目录（默认 unpackage/debug）
  --targets LIST  android,ios-device,ios-simulator,harmony（默认上传找到的产物）
  --no-promote    入库但不更新通道
  --promote-only  用 --version 指定已入库版本，只更新通道
  --note TEXT     写入发布清单的备注
  --dry-run       仅预演，不写入 S3
  -h, --help

Environment:
  NUWAX_BASE_VERSION / NUWAX_BASE_CHANNEL / NUWAX_BASE_SOURCE / NUWAX_BASE_TARGETS
  NUWAX_BASE_NO_PROMOTE / NUWAX_BASE_DRY_RUN
  NUWAX_HX_VERSION（非 Android 发布时填写实际运行时版本）
  NUWAX_S3_ENDPOINT / NUWAX_S3_REGION / NUWAX_S3_BUCKET / NUWAX_S3_PREFIX
  NUWAX_S3_ACCESS_KEY_ID / NUWAX_S3_SECRET_ACCESS_KEY / NUWAX_S3_NO_VERIFY_SSL
HELP
}

fail() { echo "错误：$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version|--channel|--source|--targets|--note)
      [[ -n "${2:-}" && "$2" != --* ]] || fail "$1 需要参数"
      case "$1" in
        --version) VERSION="$2" ;;
        --channel) CHANNEL="$2" ;;
        --source) SOURCE_DIR="$2" ;;
        --targets) TARGETS="$2" ;;
        --note) NOTE="$2" ;;
      esac
      shift 2
      ;;
    --no-promote) NO_PROMOTE=1; shift ;;
    --promote-only) PROMOTE_ONLY=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "未知参数：$1" ;;
  esac
done

[[ "$CHANNEL" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || fail "无效通道：$CHANNEL"
if [[ "$PROMOTE_ONLY" == 1 ]]; then
  [[ -n "$VERSION" && "$NO_PROMOTE" != 1 ]] || fail "切换通道需指定已发布版本，且不能使用 --no-promote"
  [[ "$VERSION" =~ ^v[0-9] ]] && VERSION="${VERSION#v}"
else
  [[ "$VERSION" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] \
    || fail "请显式指定 X.Y.Z 格式的新基座版本（NUWAX_BASE_VERSION 或 --version）"
fi
command -v node >/dev/null 2>&1 || fail "需要 node"
if [[ "$DRY_RUN" != 1 || "$PROMOTE_ONLY" == 1 ]]; then
  command -v aws >/dev/null 2>&1 || fail "需要支持 s3api put-object --if-none-match 的 AWS CLI"
fi

if [[ -z "${AWS_ACCESS_KEY_ID:-}" && -n "${NUWAX_S3_ACCESS_KEY_ID:-}" ]]; then
  export AWS_ACCESS_KEY_ID="$NUWAX_S3_ACCESS_KEY_ID"
fi
if [[ -z "${AWS_SECRET_ACCESS_KEY:-}" && -n "${NUWAX_S3_SECRET_ACCESS_KEY:-}" ]]; then
  export AWS_SECRET_ACCESS_KEY="$NUWAX_S3_SECRET_ACCESS_KEY"
fi

APP_VERSION_NAME=""
APP_VERSION_CODE=""
if [[ "$PROMOTE_ONLY" == 0 ]]; then
  APP_VERSION_NAME="$(node -p 'String(require(process.argv[1]).versionName || "").replace(/^v/i, "")' "$ROOT_DIR/manifest.json")"
  APP_VERSION_CODE="$(node -p 'String(require(process.argv[1]).versionCode ?? "")' "$ROOT_DIR/manifest.json")"
  [[ -n "$APP_VERSION_NAME" && "$APP_VERSION_CODE" =~ ^[1-9][0-9]*$ ]] \
    || fail "manifest.json 缺少有效的 App versionName 或 versionCode"
fi
[[ "$VERSION" =~ ^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$ && "$VERSION" != *..* ]] || fail "无效基座版本：$VERSION"

ENDPOINT="${NUWAX_S3_ENDPOINT:-https://s3.nuwax.com:9443}"
REGION="${NUWAX_S3_REGION:-us-east-1}"
BUCKET="${NUWAX_S3_BUCKET:-nuwax-packages}"
PREFIX="${NUWAX_S3_PREFIX:-mobile-custom-bases}"
AWS_ARGS=(--endpoint-url "$ENDPOINT" --region "$REGION")
[[ "${NUWAX_S3_NO_VERIFY_SSL:-0}" == 1 ]] && AWS_ARGS+=(--no-verify-ssl)
S3_BASE="s3://$BUCKET/$PREFIX"
VERSION_KEY="$PREFIX/versions/$VERSION"
VERSION_BASE="s3://$BUCKET/$VERSION_KEY"
FETCH_SCRIPT="$SCRIPT_DIR/fetch-custom-base-s3.sh"

STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT
MANIFEST_OUT="$STAGE_DIR/manifest.json"

run_aws() {
  if [[ "$DRY_RUN" == 1 ]]; then
    printf '+ aws'
    printf ' %q' "$@"
    printf '\n'
  else
    aws "$@" >/dev/null
  fi
}

upload() {
  local file="$1" key="$2" content_type="$3" cache_control="$4"
  run_aws s3 cp "$file" "$key" "${AWS_ARGS[@]}" \
    --content-type "$content_type" --cache-control "$cache_control" --only-show-errors
}

promote() {
  VERSION="$VERSION" CHANNEL="$CHANNEL" VERSION_KEY="$VERSION_KEY" node -e '
    const manifest = JSON.parse(require("fs").readFileSync(0, "utf8"));
    if (manifest.version !== process.env.VERSION || !Array.isArray(manifest.artifacts) || !manifest.artifacts.length) {
      throw new Error("版本缺少有效的发布清单");
    }
    const {version, appVersionName, appVersionCode, gitSha, releasedAt, hxVersion} = manifest;
    console.log(JSON.stringify({
      schema: "nuwax.mobile.customBase.channel.v1",
      channel: process.env.CHANNEL,
      version, appVersionName, appVersionCode, gitSha, releasedAt, hxVersion,
      artifactBase: process.env.VERSION_KEY + "/artifacts/"
    }, null, 2));
  ' < "$MANIFEST_OUT" > "$STAGE_DIR/channel.json"

  if [[ "$CHANNEL" == debug ]]; then
    upload "$FETCH_SCRIPT" "$S3_BASE/fetch-custom-base-s3.sh" text/x-shellscript "no-cache"
  fi
  upload "$STAGE_DIR/channel.json" "$S3_BASE/channels/$CHANNEL.json" application/json "no-cache"
  if [[ "$CHANNEL" == debug ]]; then
    sed 's/customBase.channel.v1/customBase.latest.v1/' "$STAGE_DIR/channel.json" > "$STAGE_DIR/latest.json"
    upload "$STAGE_DIR/latest.json" "$S3_BASE/latest.json" application/json "no-cache"
  fi
  echo "通道 $CHANNEL → $VERSION"
}

if [[ "$PROMOTE_ONLY" == 1 ]]; then
  aws s3 cp "$VERSION_BASE/artifacts/manifest.json" "$MANIFEST_OUT" "${AWS_ARGS[@]}" --only-show-errors \
    || fail "无法读取已发布版本 $VERSION 的清单"
  promote
  exit 0
fi

if [[ -n "$TARGETS" ]]; then
  target_pattern='android|ios-device|ios-simulator|harmony'
  [[ "$TARGETS" =~ ^($target_pattern)(,($target_pattern))*$ ]] || fail "无效平台列表：$TARGETS"
fi

artifacts=()
want_target() { [[ -z "$TARGETS" || ",$TARGETS," == *",$1,"* ]]; }

stage_first_available() {
  local name
  for name in "$@"; do
    if [[ -f "$SOURCE_DIR/$name" ]]; then
      cp "$SOURCE_DIR/$name" "$STAGE_DIR/$name" || fail "无法准备 $name"
      artifacts+=("$name")
      return 0
    fi
    if [[ -d "$SOURCE_DIR/$name" && "$name" == *.app ]]; then
      (cd "$SOURCE_DIR" && zip -qry "$STAGE_DIR/$name.zip" "$name") || fail "无法压缩 $name"
      artifacts+=("$name.zip")
      return 0
    fi
  done
  return 1
}

stage_platform() {
  local target="$1"
  shift
  want_target "$target" || return 0
  stage_first_available "$@" || [[ -z "$TARGETS" ]] || fail "缺少 ${target} 的产物：$SOURCE_DIR"
}

stage_platform android android_debug.apk
stage_platform ios-device iOS_debug.ipa
if [[ -n "${NUWAX_BASE_REUSED_IOS_VERSION:-}" ]]; then
  stage_platform ios-simulator Pandora_simulator_debug.app.zip Pandora_simulator_debug.app
else
  stage_platform ios-simulator Pandora_simulator_debug.app Pandora_simulator_debug.app.zip
fi
if want_target harmony; then
  count_before_harmony="${#artifacts[@]}"
  stage_first_available harmony_debug.hap || true
  stage_first_available harmony_debug.app harmony_debug.app.zip || true
  [[ -z "$TARGETS" || "${#artifacts[@]}" -gt "$count_before_harmony" ]] || fail "缺少 harmony 的产物：$SOURCE_DIR"
fi
[[ ${#artifacts[@]} -gt 0 ]] || fail "没有可发布的基座：$SOURCE_DIR"

HX_VERSION="${NUWAX_HX_VERSION:-}"
# Android 以包内的实际运行时为准。
if [[ -f "$STAGE_DIR/android_debug.apk" ]]; then
  apk_hx_version="$(unzip -p "$STAGE_DIR/android_debug.apk" assets/uni-app-x/version.json | node -e '
    const {hxVersion} = JSON.parse(require("fs").readFileSync(0, "utf8"));
    process.stdout.write(hxVersion || "");
  ')" || fail "无法读取 Android 基座运行时版本"
  [[ -n "$apk_hx_version" ]] || fail "无法读取 Android 基座运行时版本"
  [[ -z "$HX_VERSION" || "$HX_VERSION" == "$apk_hx_version" ]] \
    || fail "NUWAX_HX_VERSION=$HX_VERSION 与 APK 的 $apk_hx_version 不一致"
  HX_VERSION="$apk_hx_version"
fi
[[ -n "$HX_VERSION" ]] || fail "请设置 NUWAX_HX_VERSION 为实际构建版本"

if command -v shasum >/dev/null 2>&1; then
  checksum=(shasum -a 256)
else
  command -v sha256sum >/dev/null 2>&1 || fail "需要 shasum 或 sha256sum"
  checksum=(sha256sum)
fi

git_sha="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
git_short="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
git_dirty=false
[[ -n "$(git -C "$ROOT_DIR" status --porcelain --untracked-files=normal)" ]] && git_dirty=true
released_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

# 发布时记录每个包实际内置的 App 版本，避免将旧包标成当前工作区版本。
bundled_app_version() {
  local file="$1" resource_path
  case "$2" in
    android_debug.apk) resource_path='assets/apps/*/www/manifest.json' ;;
    iOS_debug.ipa) resource_path='Payload/*.app/uni-app-x/apps/*/www/manifest.json' ;;
    Pandora_simulator_debug.app.zip) resource_path='Pandora_simulator_debug.app/uni-app-x/apps/*/www/manifest.json' ;;
    *) return 0 ;;
  esac
  unzip -p "$file" "$resource_path" | node -e '
    const {version} = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const name = version?.name;
    const code = String(version?.code ?? "");
    if (typeof name !== "string" || !/^[^\s]+$/.test(name) || !/^[1-9][0-9]*$/.test(code)) process.exit(1);
    process.stdout.write(name + "\t" + code);
  '
}

for name in "${artifacts[@]}"; do
  file="$STAGE_DIR/$name"
  bytes="$(wc -c < "$file")"
  [[ "$bytes" -gt 0 ]] || fail "空产物：$name"
  app_version="$(bundled_app_version "$file" "$name")" || fail "无法读取 ${name} 的内置 App 版本"
  case "$name" in
    iOS_*|Pandora_*) reused_ios="${NUWAX_BASE_REUSED_IOS_VERSION:-}" ;;
    *) reused_ios="" ;;
  esac
  if [[ -n "$app_version" && -z "$reused_ios" && "$app_version" != "$APP_VERSION_NAME"$'\t'"$APP_VERSION_CODE" ]]; then
    fail "${name} 内置 App ${app_version%%$'\t'*}/${app_version#*$'\t'} 与当前源码 $APP_VERSION_NAME/$APP_VERSION_CODE 不一致"
  fi
  sha256="$("${checksum[@]}" < "$file")"
  printf '%s\t%s\t%s\t%s\n' "$name" "${sha256%% *}" "$bytes" "$app_version"
done | VERSION="$VERSION" APP_VERSION_NAME="$APP_VERSION_NAME" APP_VERSION_CODE="$APP_VERSION_CODE" \
  CHANNEL="$CHANNEL" HX_VERSION="$HX_VERSION" GIT_SHA="$git_sha" GIT_SHORT="$git_short" \
  GIT_DIRTY="$git_dirty" RELEASED_AT="$released_at" NOTE="$NOTE" node -e '
    const env = process.env;
    const artifacts = require("fs").readFileSync(0, "utf8").trim().split("\n").map(line => {
      const [name, sha256, bytes, appVersionName, appVersionCode] = line.split("\t");
      const bundledApp = appVersionName ? {appVersionName, appVersionCode} : {};
      const sourceVersion = env.NUWAX_BASE_REUSED_IOS_VERSION;
      const reused = sourceVersion && /^(iOS_|Pandora_)/.test(name) ? {reused: true, sourceVersion} : {};
      return {name, sha256, bytes: Number(bytes), ...bundledApp, ...reused};
    });
    console.log(JSON.stringify({
      schema: "nuwax.mobile.customBase.v1",
      version: env.VERSION,
      appVersionName: env.APP_VERSION_NAME,
      appVersionCode: env.APP_VERSION_CODE,
      channel: env.CHANNEL,
      gitSha: env.GIT_SHA,
      gitShort: env.GIT_SHORT,
      gitDirty: env.GIT_DIRTY === "true",
      releasedAt: env.RELEASED_AT,
      hxVersion: env.HX_VERSION,
      overwritePolicy: "immutable",
      note: env.NOTE,
      artifacts
    }, null, 2));
  ' > "$MANIFEST_OUT"

printf '发布基座 %s（App %s，HX %s）→ %s\n' "$VERSION" "$APP_VERSION_NAME" "$HX_VERSION" "$VERSION_BASE"
# 查旧版或中断发布遗留的目录，随后用条件写入防止并发发布占用同一 ID。
if [[ "$DRY_RUN" == 1 ]]; then
  echo "[预演] 检查 S3 上的版本目录是否为空"
  cat "$MANIFEST_OUT"
else
  key_count="$(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix "$VERSION_KEY/" \
    --max-keys 1 --no-paginate --query KeyCount --output text "${AWS_ARGS[@]}")"
  [[ "$key_count" == 0 ]] || fail "版本 $VERSION 已存在或已被占用，请使用新版本 ID"
fi
run_aws s3api put-object --bucket "$BUCKET" --key "$VERSION_KEY/reservation.json" \
  --body "$MANIFEST_OUT" --if-none-match '*' --content-type application/json "${AWS_ARGS[@]}" \
  || fail "无法占用版本 ${VERSION}，请检查权限、条件写入支持或使用新版本 ID"

for name in "${artifacts[@]}"; do
  echo "上传 $name"
  content_type="application/octet-stream"
  [[ "$name" == *.zip ]] && content_type="application/zip"
  upload "$STAGE_DIR/$name" "$VERSION_BASE/artifacts/$name" "$content_type" "public, max-age=60, must-revalidate"
done
upload "$FETCH_SCRIPT" "$VERSION_BASE/scripts/fetch-custom-base-s3.sh" text/x-shellscript "no-cache"
# 最后提交清单。清单出现后才能下载或切换通道。
upload "$MANIFEST_OUT" "$VERSION_BASE/artifacts/manifest.json" application/json "no-cache"
if [[ "$DRY_RUN" == 1 ]]; then
  echo "版本 $VERSION 发布预演"
else
  echo "版本已入库：$VERSION"
fi
echo "固定版本下载：NUWAX_BASE_VERSION=$VERSION make base-fetch"

if [[ "$NO_PROMOTE" != 1 ]]; then
  echo "如通道更新失败，可用 NUWAX_BASE_CHANNEL=$CHANNEL NUWAX_BASE_VERSION=$VERSION make base-promote 重试"
  promote
fi
