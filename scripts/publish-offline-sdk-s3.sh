#!/usr/bin/env bash
# 将本地离线 SDK（sdk/ + archives/，不含 work/）打包发布到 Nuwax S3（MinIO），供同事免手工下载。
#
# 对齐 publish-custom-base-s3.sh 的凭证与桶约定：
#   - 凭证只读环境变量 / ~/.aws profile，绝不入库
#   - 默认桶 nuwax-packages，前缀 mobile-offline-sdk
#
# 版本策略：
#   - 版本 = NUWAX_HX_VERSION（默认 5.15）
#   - 同版本重复发布 = 覆盖；latest.json 每次指向该版本（同事不指定版本即拉最新）
#
# 打包内容：$NUWAX_OFFLINE_SDK_HOME/{sdk,archives}（work/ 不打包，跨机不可用）
#
# Usage:
#   bash scripts/publish-offline-sdk-s3.sh
#   bash scripts/publish-offline-sdk-s3.sh --version 5.15
#   bash scripts/publish-offline-sdk-s3.sh --dry-run
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FETCH_SCRIPT="$SCRIPT_DIR/fetch-offline-sdk-s3.sh"

VERSION="${NUWAX_HX_VERSION:-5.15}"
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: bash scripts/publish-offline-sdk-s3.sh [options]

Options:
  --version VERSION   HX 版本（默认 NUWAX_HX_VERSION=5.15；同版本覆盖）
  --dry-run           只打印计划，不上传
  -h, --help

打包内容：$NUWAX_OFFLINE_SDK_HOME/{sdk,archives}（work/ 不打包）。

Environment:
  NUWAX_OFFLINE_SDK_HOME   离线 SDK 根（默认 $HOME/workspace/nuwax-mobile-offline-sdk）
  NUWAX_S3_ENDPOINT / NUWAX_S3_REGION / NUWAX_S3_BUCKET / NUWAX_S3_SDK_PREFIX
  NUWAX_S3_ACCESS_KEY_ID / NUWAX_S3_SECRET_ACCESS_KEY / NUWAX_S3_NO_VERIFY_SSL
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

command -v aws >/dev/null 2>&1 || { echo "aws cli required (brew install awscli)" >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "tar required" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node required（写 latest.json）" >&2; exit 1; }

SDK_HOME="${NUWAX_OFFLINE_SDK_HOME:-$HOME/workspace/nuwax-mobile-offline-sdk}"
[[ -d "$SDK_HOME/sdk" || -d "$SDK_HOME/archives" ]] \
  || { echo "未找到 $SDK_HOME 下的 sdk/ 或 archives/（先按维护文档准备离线 SDK）" >&2; exit 1; }
[[ "$VERSION" != *"/"* && "$VERSION" != *".."* ]] || { echo "非法 version: $VERSION" >&2; exit 1; }

if [[ -z "${AWS_ACCESS_KEY_ID:-}" && -n "${NUWAX_S3_ACCESS_KEY_ID:-}" ]]; then
  export AWS_ACCESS_KEY_ID="$NUWAX_S3_ACCESS_KEY_ID"
fi
if [[ -z "${AWS_SECRET_ACCESS_KEY:-}" && -n "${NUWAX_S3_SECRET_ACCESS_KEY:-}" ]]; then
  export AWS_SECRET_ACCESS_KEY="$NUWAX_S3_SECRET_ACCESS_KEY"
fi

ENDPOINT="${NUWAX_S3_ENDPOINT:-https://s3.nuwax.com:9443}"
REGION="${NUWAX_S3_REGION:-us-east-1}"
BUCKET="${NUWAX_S3_BUCKET:-nuwax-packages}"
PREFIX="${NUWAX_S3_SDK_PREFIX:-mobile-offline-sdk}"

AWS_ARGS=(--endpoint-url "$ENDPOINT" --region "$REGION")
[[ "${NUWAX_S3_NO_VERIFY_SSL:-0}" == "1" ]] && AWS_ARGS+=(--no-verify-ssl)

run_aws() {
  if [[ "$DRY_RUN" == "1" ]]; then echo "+ aws $*"; else aws "$@"; fi
}

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else sha256sum "$1" | awk '{print $1}'; fi
}

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

echo "Publishing offline SDK version=$VERSION"
echo "  source:   $SDK_HOME (sdk + archives + iOS ESP 源码；work 派生产物 excluded)"
echo "  endpoint: $ENDPOINT"
echo "  bucket:   $BUCKET"
echo "  prefix:   $PREFIX"
[[ "$DRY_RUN" == "1" ]] && echo "  [DRY RUN]"

# 打包：sdk/ + archives/ + iOS ESP 源码输入（work 的派生产物 build/out/DerivedData 仍不打）
INCLUDE=()
[[ -d "$SDK_HOME/sdk" ]] && INCLUDE+=("sdk")
[[ -d "$SDK_HOME/archives" ]] && INCLUDE+=("archives")
# iOS ESP 源码（非派生输入；fresh fetch 后从源码编 ESPProvision/SwiftProtobuf framework 必需，否则 iOS 模拟器基座打不出）
ESP_SRC_DIRS=("work/ios/src/SwiftProtobuf" "work/ios/src/ESPProvision" "work/ios/SwiftProtobuf" "work/ios/ESPProvision")
for d in "${ESP_SRC_DIRS[@]}"; do
  [[ -d "$SDK_HOME/$d" ]] && INCLUDE+=("$d")
done
if [[ ${#INCLUDE[@]} == 0 ]]; then
  echo "sdk/ 与 archives/ 均不存在，无内容可打包" >&2; exit 1
fi

TARBALL="nuwax-mobile-offline-sdk-${VERSION}.tar.gz"
OUT="$STAGE/$TARBALL"
echo "→ 打包 $TARBALL (${INCLUDE[*]}) ..."
if [[ "$DRY_RUN" == "1" ]]; then
  echo "+ tar czf $OUT -C $SDK_HOME ${INCLUDE[*]}"
else
  tar czf "$OUT" -C "$SDK_HOME" "${INCLUDE[@]}"
fi

SIZE=$(wc -c < "$OUT" | tr -d ' ')
SHA=$(sha256_file "$OUT")
GIT_SHA=$(cd "$ROOT_DIR" && git rev-parse HEAD 2>/dev/null || echo unknown)
RELEASE_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

MANIFEST="$STAGE/manifest.json"
{
  echo "{"
  echo "  \"schema\": \"nuwax.mobile.offlineSdk.v1\","
  echo "  \"version\": \"$VERSION\","
  echo "  \"tarball\": \"$TARBALL\","
  echo "  \"sha256\": \"$SHA\","
  echo "  \"bytes\": $SIZE,"
  echo "  \"gitSha\": \"$GIT_SHA\","
  echo "  \"releasedAt\": \"$RELEASE_DATE\","
  echo "  \"includes\": [\"sdk\", \"archives\", \"ios-esp-source\"],"
  echo "  \"excludes\": [\"work/build\", \"work/out\", \"DerivedData\"]"
  echo "}"
} > "$MANIFEST"
echo "→ manifest:"
cat "$MANIFEST"

S3_BASE="s3://$BUCKET/$PREFIX"
VER_BASE="$S3_BASE/versions/$VERSION"

echo "→ 上传 $TARBALL ($((SIZE/1024/1024)) MiB)"
run_aws s3 cp "$OUT" "$VER_BASE/$TARBALL" "${AWS_ARGS[@]}" \
  --cache-control "public, max-age=60, must-revalidate" \
  --content-type "application/gzip" >/dev/null

echo "→ 上传 manifest.json"
run_aws s3 cp "$MANIFEST" "$VER_BASE/manifest.json" "${AWS_ARGS[@]}" \
  --cache-control "public, max-age=60, must-revalidate" \
  --content-type "application/json" >/dev/null

if [[ -f "$FETCH_SCRIPT" ]]; then
  echo "→ 引导 fetch-offline-sdk-s3.sh"
  run_aws s3 cp "$FETCH_SCRIPT" "$VER_BASE/scripts/fetch-offline-sdk-s3.sh" "${AWS_ARGS[@]}" \
    --cache-control "public, max-age=60, must-revalidate" \
    --content-type "text/x-shellscript" >/dev/null
  run_aws s3 cp "$FETCH_SCRIPT" "$S3_BASE/fetch-offline-sdk-s3.sh" "${AWS_ARGS[@]}" \
    --cache-control "public, max-age=60, must-revalidate" \
    --content-type "text/x-shellscript" >/dev/null
else
  echo "  warn: fetch script missing at $FETCH_SCRIPT" >&2
fi

LATEST_BODY=$(VERSION="$VERSION" GITSHA="$GIT_SHA" DATE="$RELEASE_DATE" node <<'NODE'
process.stdout.write(JSON.stringify({
  schema: "nuwax.mobile.offlineSdk.latest.v1",
  version: process.env.VERSION,
  gitSha: process.env.GITSHA,
  releasedAt: process.env.DATE,
}, null, 2) + "\n");
NODE
)
echo "→ latest.json"
if [[ "$DRY_RUN" == "1" ]]; then
  echo "+ aws s3 cp - $S3_BASE/latest.json"
  echo "$LATEST_BODY"
else
  printf '%s' "$LATEST_BODY" | aws s3 cp - "$S3_BASE/latest.json" \
    "${AWS_ARGS[@]}" \
    --cache-control "public, max-age=60, must-revalidate" \
    --content-type "application/json"
fi

echo
echo "Publish complete: offline SDK $VERSION → versions/$VERSION/ (overwritten) + latest"
echo "  latest:    $ENDPOINT/$BUCKET/$PREFIX/latest.json"
echo "  bootstrap: $ENDPOINT/$BUCKET/$PREFIX/fetch-offline-sdk-s3.sh"
echo "同事拉取（不指定版本 = 最新）:"
echo "  curl -fsSL $ENDPOINT/$BUCKET/$PREFIX/fetch-offline-sdk-s3.sh | bash"
echo "  # 或: make sdk-fetch"
