#!/usr/bin/env bash
# 将本地离线自定义基座发布到 Nuwax S3（MinIO），供同事免打包联调。
#
# 对齐 nuwa-cli/scripts/publish-s3.sh 的凭证与桶约定：
#   - 凭证只读环境变量 / ~/.aws profile，绝不入库
#   - 默认桶 nuwax-packages，前缀 mobile-custom-bases
#
# 版本策略：
#   - 默认版本 = manifest.json 的 versionName（与 App 版本一致）
#   - 同一 version 重复发布 = 覆盖同路径（只保留该版本最新一份）
#   - channels/debug.json + latest.json 每次发布都指向该版本（同事不指定版本即拉最新）
#
# 变体（flavor）：
#   - --flavor vapor：读 android_debug_vapor.apk / iOS_debug_vapor.ipa，
#     版本默认 <versionName>-vapor、channel 默认 vapor，与标准基座区分发布。
#     发布的产物名仍是规范名（android_debug.apk / iOS_debug.ipa），故 fetch 流程不变，
#     仅靠 version/channel 区分。配合 --no-latest 可避免劫持默认拉取指针 latest.json。
#
# 产物（存在才上传；可用 --targets 裁剪）：
#   android_debug.apk / iOS_debug.ipa / Pandora_simulator_debug.app.zip / harmony_*（预留）
#
# Usage:
#   bash scripts/publish-custom-base-s3.sh
#   bash scripts/publish-custom-base-s3.sh --version 1.0.0
#   bash scripts/publish-custom-base-s3.sh --targets android,ios-device,ios-simulator
#   bash scripts/publish-custom-base-s3.sh --flavor vapor --no-latest   # vapor 蒸汽基座
#   bash scripts/publish-custom-base-s3.sh --dry-run
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEBUG_DIR="$ROOT_DIR/unpackage/debug"
MANIFEST_JSON_APP="$ROOT_DIR/manifest.json"
FETCH_SCRIPT="$SCRIPT_DIR/fetch-custom-base-s3.sh"

VERSION=""
CHANNEL=""
FLAVOR=""
NO_LATEST=0
TARGETS="android,ios-device,ios-simulator,harmony"
DRY_RUN=0
NOTE=""

usage() {
  cat <<'EOF'
Usage: bash scripts/publish-custom-base-s3.sh [options]

Options:
  --version VERSION   版本号（默认：manifest.json versionName，与 App 一致）
  --channel NAME      通道指针名（默认 debug；每次发布会更新 channel + latest）
  --flavor NAME       发布变体（如 vapor：读 *_vapor 源文件，版本默认 -<flavor>、channel 默认同名）
  --no-latest         不更新 latest.json（非默认变体避免劫持默认拉取指针）
  --targets LIST      android,ios-device,ios-simulator,harmony
  --note TEXT         写入 artifact manifest 的备注
  --dry-run           只打印计划，不上传
  -h, --help

版本策略：
  - 默认跟 App versionName；同版本重复发布覆盖 versions/<ver>/artifacts/*
  - 每次发布更新 channels/<channel>.json；latest.json 仅在未传 --no-latest 时更新
  - --flavor vapor：独立版本（<ver>-vapor）+ channel（vapor），产物名保持规范，靠 version/channel 区分

Environment:
  NUWAX_S3_ENDPOINT / NUWAX_S3_REGION / NUWAX_S3_BUCKET / NUWAX_S3_PREFIX
  NUWAX_S3_ACCESS_KEY_ID / NUWAX_S3_SECRET_ACCESS_KEY / NUWAX_S3_NO_VERIFY_SSL
  NUWAX_HX_VERSION（写入 manifest/channel 的 HX 版本，vapor 用 5.23）
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="${2:-}"; shift 2 ;;
    --channel) CHANNEL="${2:-}"; shift 2 ;;
    --flavor) FLAVOR="${2:-}"; shift 2 ;;
    --no-latest) NO_LATEST=1; shift ;;
    --targets) TARGETS="${2:-}"; shift 2 ;;
    --note) NOTE="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

command -v aws >/dev/null 2>&1 || { echo "aws cli required (brew install awscli)" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node required" >&2; exit 1; }

if [[ -z "${AWS_ACCESS_KEY_ID:-}" && -n "${NUWAX_S3_ACCESS_KEY_ID:-}" ]]; then
  export AWS_ACCESS_KEY_ID="$NUWAX_S3_ACCESS_KEY_ID"
fi
if [[ -z "${AWS_SECRET_ACCESS_KEY:-}" && -n "${NUWAX_S3_SECRET_ACCESS_KEY:-}" ]]; then
  export AWS_SECRET_ACCESS_KEY="$NUWAX_S3_SECRET_ACCESS_KEY"
fi

APP_VERSION_NAME=""
APP_VERSION_CODE=""
if [[ -f "$MANIFEST_JSON_APP" ]]; then
  APP_VERSION_NAME="$(node -p "const m=require('$MANIFEST_JSON_APP'); (m.versionName||'').replace(/^v/i,'')" 2>/dev/null || true)"
  APP_VERSION_CODE="$(node -p "const m=require('$MANIFEST_JSON_APP'); String(m.versionCode||'')" 2>/dev/null || true)"
fi

# 变体（flavor）：vapor 等读带后缀的源文件、独立版本与 channel，与标准基座区分发布。
SUFFIX=""
if [[ -n "$FLAVOR" ]]; then
  SUFFIX="_${FLAVOR}"
  [[ -z "$CHANNEL" ]] && CHANNEL="$FLAVOR"
fi
[[ -z "$CHANNEL" ]] && CHANNEL="debug"

if [[ -z "$VERSION" ]]; then
  [[ -n "$APP_VERSION_NAME" ]] || { echo "无法从 manifest.json 读取 versionName，请传 --version" >&2; exit 1; }
  VERSION="$APP_VERSION_NAME"
  [[ -n "$FLAVOR" ]] && VERSION="$APP_VERSION_NAME-$FLAVOR"
fi
[[ "$VERSION" != *"/"* && "$VERSION" != *".."* ]] || { echo "非法 version: $VERSION" >&2; exit 1; }

ENDPOINT="${NUWAX_S3_ENDPOINT:-https://s3.nuwax.com:9443}"
REGION="${NUWAX_S3_REGION:-us-east-1}"
BUCKET="${NUWAX_S3_BUCKET:-nuwax-packages}"
PREFIX="${NUWAX_S3_PREFIX:-mobile-custom-bases}"

AWS_ARGS=(--endpoint-url "$ENDPOINT" --region "$REGION")
[[ "${NUWAX_S3_NO_VERIFY_SSL:-0}" == "1" ]] && AWS_ARGS+=(--no-verify-ssl)

echo "Publishing custom bases version=$VERSION (App versionName=${APP_VERSION_NAME:-?} versionCode=${APP_VERSION_CODE:-?}) channel=$CHANNEL flavor=${FLAVOR:-none}"
echo "  policy:   same version overwrites; channel → this version; latest $([[ "$NO_LATEST" -eq 1 ]] && echo 'untouched' || echo '→ this version')"
echo "  endpoint: $ENDPOINT"
echo "  bucket:   $BUCKET"
echo "  prefix:   $PREFIX"
echo "  targets:  $TARGETS"
[[ "$DRY_RUN" -eq 1 ]] && echo "  [DRY RUN]"

run_aws() {
  if [[ "$DRY_RUN" -eq 1 ]]; then echo "+ aws $*"; else aws "$@"; fi
}

want_target() {
  local t="$1"
  [[ ",$TARGETS," == *",$t,"* ]]
}

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

STAGE_DIR=$(mktemp -d)
trap 'rm -rf "$STAGE_DIR"' EXIT

S3_BASE="s3://$BUCKET/$PREFIX"
VERSION_BASE="$S3_BASE/versions/$VERSION"
ARTIFACTS_DIR="$STAGE_DIR/artifacts"
mkdir -p "$ARTIFACTS_DIR"

declare -a ARTIFACT_NAMES=()
declare -a ARTIFACT_PATHS=()

add_artifact() {
  ARTIFACT_NAMES+=("$1")
  ARTIFACT_PATHS+=("$2")
}

if want_target android; then
  src="$DEBUG_DIR/android_debug${SUFFIX}.apk"
  name="android_debug${SUFFIX}.apk"
  if [[ -f "$src" ]]; then
    cp "$src" "$ARTIFACTS_DIR/$name"
    add_artifact "$name" "$ARTIFACTS_DIR/$name"
  else
    echo "  skip android (missing $src)" >&2
  fi
fi

if want_target ios-device; then
  src="$DEBUG_DIR/iOS_debug${SUFFIX}.ipa"
  name="iOS_debug${SUFFIX}.ipa"
  if [[ -f "$src" ]]; then
    cp "$src" "$ARTIFACTS_DIR/$name"
    add_artifact "$name" "$ARTIFACTS_DIR/$name"
  else
    echo "  skip ios-device (missing $src)" >&2
  fi
fi

if want_target ios-simulator; then
  src="$DEBUG_DIR/Pandora_simulator_debug${SUFFIX}.app"
  name="Pandora_simulator_debug${SUFFIX}.app.zip"
  if [[ -d "$src" ]]; then
    echo "→ zip $(basename "$src")"
    (cd "$DEBUG_DIR" && zip -qry "$ARTIFACTS_DIR/$name" "$(basename "$src")")
    add_artifact "$name" "$ARTIFACTS_DIR/$name"
  else
    echo "  skip ios-simulator (missing $src)" >&2
  fi
fi

if want_target harmony; then
  found=0
  for cand in harmony_debug.hap harmony_debug.app; do
    if [[ -f "$DEBUG_DIR/$cand" ]]; then
      cp "$DEBUG_DIR/$cand" "$ARTIFACTS_DIR/$cand"
      add_artifact "$cand" "$ARTIFACTS_DIR/$cand"
      found=1
    elif [[ -d "$DEBUG_DIR/$cand" ]]; then
      echo "→ zip $cand"
      (cd "$DEBUG_DIR" && zip -qry "$ARTIFACTS_DIR/${cand}.zip" "$cand")
      add_artifact "${cand}.zip" "$ARTIFACTS_DIR/${cand}.zip"
      found=1
    fi
  done
  if [[ "$found" -eq 0 ]]; then
    echo "  skip harmony (尚未产出，预留 ok)" >&2
  fi
fi

if [[ ${#ARTIFACT_NAMES[@]} -eq 0 ]]; then
  echo "没有可上传的产物，退出" >&2
  exit 1
fi

GIT_SHA=$(cd "$ROOT_DIR" && git rev-parse HEAD 2>/dev/null || echo unknown)
GIT_SHORT=$(cd "$ROOT_DIR" && git rev-parse --short HEAD 2>/dev/null || echo unknown)
RELEASE_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
HX_VERSION="${NUWAX_HX_VERSION:-5.15}"

MANIFEST_OUT="$ARTIFACTS_DIR/manifest.json"
{
  echo "{"
  echo "  \"schema\": \"nuwax.mobile.customBase.v1\","
  echo "  \"version\": \"$VERSION\","
  echo "  \"appVersionName\": \"${APP_VERSION_NAME:-$VERSION}\","
  echo "  \"appVersionCode\": \"${APP_VERSION_CODE}\","
  echo "  \"channel\": \"$CHANNEL\","
  echo "  \"flavor\": \"${FLAVOR}\","
  echo "  \"gitSha\": \"$GIT_SHA\","
  echo "  \"gitShort\": \"$GIT_SHORT\","
  echo "  \"releasedAt\": \"$RELEASE_DATE\","
  echo "  \"hxVersion\": \"$HX_VERSION\","
  echo "  \"overwritePolicy\": \"same-version-replace\","
  echo "  \"note\": $(NOTE="$NOTE" node -p "JSON.stringify(process.env.NOTE || '')"),"
  echo "  \"artifacts\": ["
  for i in "${!ARTIFACT_NAMES[@]}"; do
    name="${ARTIFACT_NAMES[$i]}"
    path="${ARTIFACT_PATHS[$i]}"
    size=$(wc -c < "$path" | tr -d ' ')
    hash=$(sha256_file "$path")
    comma=","
    [[ "$i" -eq $((${#ARTIFACT_NAMES[@]} - 1)) ]] && comma=""
    echo "    { \"name\": \"$name\", \"sha256\": \"$hash\", \"bytes\": $size }$comma"
  done
  echo "  ]"
  echo "}"
} > "$MANIFEST_OUT"
add_artifact "manifest.json" "$MANIFEST_OUT"

echo "→ manifest"
cat "$MANIFEST_OUT"

for i in "${!ARTIFACT_NAMES[@]}"; do
  name="${ARTIFACT_NAMES[$i]}"
  path="${ARTIFACT_PATHS[$i]}"
  echo "→ artifacts/$name (overwrite)"
  ctype="application/octet-stream"
  [[ "$name" == *.json ]] && ctype="application/json"
  [[ "$name" == *.zip ]] && ctype="application/zip"
  run_aws s3 cp "$path" "$VERSION_BASE/artifacts/$name" "${AWS_ARGS[@]}" \
    --cache-control "public, max-age=60, must-revalidate" \
    --content-type "$ctype" >/dev/null
done

if [[ -f "$FETCH_SCRIPT" ]]; then
  echo "→ bootstrap fetch-custom-base-s3.sh"
  run_aws s3 cp "$FETCH_SCRIPT" "$VERSION_BASE/scripts/fetch-custom-base-s3.sh" "${AWS_ARGS[@]}" \
    --cache-control "public, max-age=60, must-revalidate" \
    --content-type "text/x-shellscript" >/dev/null
  run_aws s3 cp "$FETCH_SCRIPT" "$S3_BASE/fetch-custom-base-s3.sh" "${AWS_ARGS[@]}" \
    --cache-control "public, max-age=60, must-revalidate" \
    --content-type "text/x-shellscript" >/dev/null
else
  echo "  warn: fetch script missing at $FETCH_SCRIPT" >&2
fi

echo "→ channels/$CHANNEL.json"
CHANNEL_BODY=$(CHANNEL="$CHANNEL" VERSION="$VERSION" GITSHA="$GIT_SHA" DATE="$RELEASE_DATE" PREFIX="$PREFIX" HX="$HX_VERSION" VCODE="$APP_VERSION_CODE" FLAVOR="$FLAVOR" node <<'NODE'
process.stdout.write(JSON.stringify({
  schema: "nuwax.mobile.customBase.channel.v1",
  channel: process.env.CHANNEL,
  flavor: process.env.FLAVOR || "",
  version: process.env.VERSION,
  appVersionName: process.env.VERSION,
  appVersionCode: process.env.VCODE || "",
  gitSha: process.env.GITSHA,
  releasedAt: process.env.DATE,
  hxVersion: process.env.HX,
  artifactBase: `${process.env.PREFIX}/versions/${process.env.VERSION}/artifacts/`,
}, null, 2) + "\n");
NODE
)
LATEST_BODY=$(VERSION="$VERSION" GITSHA="$GIT_SHA" DATE="$RELEASE_DATE" CHANNEL="$CHANNEL" HX="$HX_VERSION" VCODE="$APP_VERSION_CODE" FLAVOR="$FLAVOR" node <<'NODE'
process.stdout.write(JSON.stringify({
  schema: "nuwax.mobile.customBase.latest.v1",
  channel: process.env.CHANNEL,
  flavor: process.env.FLAVOR || "",
  version: process.env.VERSION,
  appVersionName: process.env.VERSION,
  appVersionCode: process.env.VCODE || "",
  gitSha: process.env.GITSHA,
  releasedAt: process.env.DATE,
  hxVersion: process.env.HX,
}, null, 2) + "\n");
NODE
)

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "+ aws s3 cp - $S3_BASE/channels/$CHANNEL.json"
  echo "$CHANNEL_BODY"
  if [[ "$NO_LATEST" -ne 1 ]]; then
    echo "+ aws s3 cp - $S3_BASE/latest.json"
    echo "$LATEST_BODY"
  else
    echo "  [skip] latest.json（--no-latest，保留默认拉取指针不变）"
  fi
else
  printf '%s' "$CHANNEL_BODY" | aws s3 cp - "$S3_BASE/channels/$CHANNEL.json" \
    "${AWS_ARGS[@]}" \
    --cache-control "public, max-age=60, must-revalidate" \
    --content-type "application/json"
  if [[ "$NO_LATEST" -ne 1 ]]; then
    printf '%s' "$LATEST_BODY" | aws s3 cp - "$S3_BASE/latest.json" \
      "${AWS_ARGS[@]}" \
      --cache-control "public, max-age=60, must-revalidate" \
      --content-type "application/json"
  else
    echo "  [skip] latest.json（--no-latest）"
  fi
fi

echo
echo "Publish complete: App ${VERSION} → versions/${VERSION}/ (overwritten) + channel=${CHANNEL} pointer"
echo "  channel:   ${ENDPOINT}/${BUCKET}/${PREFIX}/channels/${CHANNEL}.json"
[[ "$NO_LATEST" -ne 1 ]] && echo "  latest:    ${ENDPOINT}/${BUCKET}/${PREFIX}/latest.json"
echo "  bootstrap: ${ENDPOINT}/${BUCKET}/${PREFIX}/fetch-custom-base-s3.sh"
if [[ -n "$FLAVOR" ]]; then
  echo "Colleague 拉 ${FLAVOR}（产物名保留 _${FLAVOR} 后缀；不指定版本即走 channel=${CHANNEL}）："
  echo "  NUWAX_BASE_CHANNEL=${CHANNEL} make base-fetch"
  echo "  # 或固定版本: NUWAX_BASE_VERSION=${VERSION} make base-fetch"
  echo "  # 默认 make base-fetch 仍拉 latest（非 ${FLAVOR}），不受影响"
else
  echo "Colleague（不指定版本 = 最新）:"
  echo "  curl -fsSL ${ENDPOINT}/${BUCKET}/${PREFIX}/fetch-custom-base-s3.sh | bash"
  echo "  # or: make base-fetch"
fi
