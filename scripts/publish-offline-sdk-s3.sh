#!/usr/bin/env bash
# 将本地离线 SDK（sdk/ + archives/，不含 work/）打包发布到 Nuwax S3（MinIO），供同事免手工下载。
#
# 对齐 publish-custom-base-s3.sh 的凭证与桶约定：
#   - 凭证只读环境变量 / ~/.aws profile，绝不入库
#   - 默认桶 nuwax-packages，前缀 mobile-offline-sdk
#
# 版本策略：
#   - 版本 = NUWAX_HX_VERSION（默认 5.24）
#   - 同版本重复发布 = 覆盖；latest.json 每次指向该版本（同事不指定版本即拉最新）
#
# 打包内容：$NUWAX_OFFLINE_SDK_HOME/{sdk,archives}（work/ 不打包，跨机不可用）
#
# Usage:
#   bash scripts/publish-offline-sdk-s3.sh
#   bash scripts/publish-offline-sdk-s3.sh --version 5.23
#   bash scripts/publish-offline-sdk-s3.sh --dry-run
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FETCH_SCRIPT="$SCRIPT_DIR/fetch-offline-sdk-s3.sh"

VERSION="${NUWAX_HX_VERSION:-}"
DRY_RUN="${NUWAX_SDK_DRY_RUN:-0}"
NO_PROMOTE="${NUWAX_SDK_NO_PROMOTE:-}"

usage() {
  cat <<'EOF'
Usage: bash scripts/publish-offline-sdk-s3.sh [options]

Options:
  --version VERSION   HX 版本（默认当前分支配置；同版本覆盖）
  --no-promote        只上传指定版本，保留 latest 和公共下载入口（配置了分支 SDK 时默认）
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
    --version) [[ -n "${2:-}" && "$2" != --* ]] || { usage >&2; exit 1; }; VERSION="$2"; shift 2 ;;
    --no-promote) NO_PROMOTE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

[[ "$DRY_RUN" == 1 ]] || command -v aws >/dev/null 2>&1 || { echo "aws cli required" >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "tar required" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node required（写 latest.json）" >&2; exit 1; }

profile_home=""
if [[ -f "$ROOT_DIR/custom-base.lock.json" && -f "$SCRIPT_DIR/resolve-package-profile.mjs" ]]; then
  profile="$(node "$SCRIPT_DIR/resolve-package-profile.mjs" sdk "$VERSION")"
  if [[ -n "$profile" ]]; then
    IFS=$'\t' read -r VERSION profile_home <<< "$profile"
    NO_PROMOTE="${NO_PROMOTE:-1}"
  fi
fi
VERSION="${VERSION:-5.24}"
NO_PROMOTE="${NO_PROMOTE:-0}"
SDK_HOME="${NUWAX_OFFLINE_SDK_HOME:-${profile_home:-$HOME/workspace/nuwax-mobile-offline-sdk}}"
[[ -d "$SDK_HOME/sdk" || -d "$SDK_HOME/archives" ]] \
  || { echo "未找到 $SDK_HOME 下的 sdk/ 或 archives/（先按维护文档准备离线 SDK）" >&2; exit 1; }
[[ "$VERSION" =~ ^[0-9]+[.][0-9]+$ ]] || { echo "非法 version: $VERSION" >&2; exit 1; }

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
PLATFORMS=()
for platform in android ios harmony; do
  if [[ -d "$SDK_HOME/sdk/$platform/$VERSION" ]]; then
    PLATFORMS+=("$platform")
    INCLUDE+=("sdk/$platform/$VERSION")
  fi
done
[[ ${#PLATFORMS[@]} -gt 0 ]] || { echo "SDK $VERSION 未找到任何平台目录" >&2; exit 1; }
PLATFORMS_JSON="$(node -e 'console.log(JSON.stringify(process.argv.slice(1)))' "${PLATFORMS[@]}")"
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
  printf '平台 %s；源 %s；目标 s3://%s/%s/versions/%s/\n' "${PLATFORMS[*]}" "$SDK_HOME" "$BUCKET" "$PREFIX" "$VERSION"
  printf 'tar -czf %q -C %q' "$OUT" "$SDK_HOME"
  printf ' %q' "${INCLUDE[@]}"
  printf '\n'
  exit 0
fi
tar czf "$OUT" -C "$SDK_HOME" "${INCLUDE[@]}"

SIZE=$(wc -c < "$OUT" | tr -d ' ')
SHA=$(sha256_file "$OUT")
GIT_SHA=$(cd "$ROOT_DIR" && git rev-parse HEAD 2>/dev/null || echo unknown)
RELEASE_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

MANIFEST="$STAGE/manifest.json"
{
  echo "{"
  echo "  \"schema\": \"nuwax.mobile.offlineSdk.v1\","
  echo "  \"version\": \"$VERSION\","
  echo "  \"platforms\": $PLATFORMS_JSON,"
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
aws s3 cp "$OUT" "$VER_BASE/$TARBALL" "${AWS_ARGS[@]}" \
  --cache-control "public, max-age=60, must-revalidate" \
  --content-type "application/gzip" >/dev/null

echo "→ 上传 manifest.json"
aws s3 cp "$MANIFEST" "$VER_BASE/manifest.json" "${AWS_ARGS[@]}" \
  --cache-control "public, max-age=60, must-revalidate" \
  --content-type "application/json" >/dev/null

if [[ -f "$FETCH_SCRIPT" ]]; then
  echo "→ 引导 fetch-offline-sdk-s3.sh"
  aws s3 cp "$FETCH_SCRIPT" "$VER_BASE/scripts/fetch-offline-sdk-s3.sh" "${AWS_ARGS[@]}" \
    --cache-control "public, max-age=60, must-revalidate" \
    --content-type "text/x-shellscript" >/dev/null
  if [[ "$NO_PROMOTE" != 1 ]]; then
    aws s3 cp "$FETCH_SCRIPT" "$S3_BASE/fetch-offline-sdk-s3.sh" "${AWS_ARGS[@]}" \
      --cache-control "public, max-age=60, must-revalidate" \
      --content-type "text/x-shellscript" >/dev/null
  fi
else
  echo "  warn: fetch script missing at $FETCH_SCRIPT" >&2
fi

if [[ "$NO_PROMOTE" == 1 ]]; then
  echo "SDK $VERSION 已上传，保留原 latest 指针"
  exit 0
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
printf '%s' "$LATEST_BODY" | aws s3 cp - "$S3_BASE/latest.json" \
  "${AWS_ARGS[@]}" \
  --cache-control "public, max-age=60, must-revalidate" \
  --content-type "application/json"

echo
echo "Publish complete: offline SDK $VERSION → versions/$VERSION/ (overwritten) + latest"
echo "  latest:    $ENDPOINT/$BUCKET/$PREFIX/latest.json"
echo "  bootstrap: $ENDPOINT/$BUCKET/$PREFIX/fetch-offline-sdk-s3.sh"
echo "同事拉取（不指定版本 = 最新）:"
echo "  curl -fsSL $ENDPOINT/$BUCKET/$PREFIX/fetch-offline-sdk-s3.sh | bash"
echo "  # 或: make sdk-fetch"
