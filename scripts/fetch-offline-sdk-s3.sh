#!/usr/bin/env bash
# 从 Nuwax S3（MinIO）拉取离线 SDK 包（sdk/ + archives/，不含 work/）到 NUWAX_OFFLINE_SDK_HOME。
# 公开读，只需 curl；自签证书失败自动 -k 重试。还原后 source scripts/local-base-env.sh 即可联调。
#
# 版本 = NUWAX_HX_VERSION（默认读 latest.json 拉最新）；--version 可固定。
#
# One-liner:
#   curl -fsSL https://s3.nuwax.com:9443/nuwax-packages/mobile-offline-sdk/fetch-offline-sdk-s3.sh | bash
#
# 仓库内:
#   make sdk-fetch
#   bash scripts/fetch-offline-sdk-s3.sh --version 5.15
#   NUWAX_HX_VERSION=5.15 bash scripts/fetch-offline-sdk-s3.sh
set -euo pipefail

ENDPOINT="${NUWAX_S3_ENDPOINT:-https://s3.nuwax.com:9443}"
BUCKET="${NUWAX_S3_BUCKET:-nuwax-packages}"
PREFIX="${NUWAX_S3_SDK_PREFIX:-mobile-offline-sdk}"
PINNED_VERSION="${NUWAX_HX_VERSION:-}"
INSECURE="${NUWAX_S3_INSECURE:-0}"
DEST_DIR=""
VERSION=""

usage() {
  cat <<'EOF'
Usage: bash scripts/fetch-offline-sdk-s3.sh [options]

Options:
  --dest DIR      解压目标 = NUWAX_OFFLINE_SDK_HOME（默认 $HOME/workspace/nuwax-mobile-offline-sdk）
  --version VER   固定 HX 版本（默认读 latest.json 拉最新）
  -h, --help

还原内容：sdk/ + archives/（work/ 不打包，由构建脚本按需生成）。

Environment:
  NUWAX_OFFLINE_SDK_HOME   解压根目录
  NUWAX_HX_VERSION         版本（不设则拉 latest）
  NUWAX_S3_INSECURE=1      自签证书跳过校验
  NUWAX_S3_ENDPOINT / NUWAX_S3_BUCKET / NUWAX_S3_SDK_PREFIX
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest) DEST_DIR="${2:-}"; shift 2 ;;
    --version) PINNED_VERSION="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if [ -t 1 ]; then
  GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; CYAN=$'\033[36m'; NC=$'\033[0m'
else
  GREEN=""; YELLOW=""; RED=""; CYAN=""; NC=""
fi
ok()   { printf "%s[OK]%s %s\n" "$GREEN" "$NC" "$1"; }
warn() { printf "%s[!]%s  %s\n" "$YELLOW" "$NC" "$1" >&2; }
info() { printf "%s->%s %s\n" "$CYAN" "$NC" "$1"; }
fail() { printf "%s[X]%s  %s\n" "$RED" "$NC" "$1" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || fail "需要 curl"
command -v tar >/dev/null 2>&1 || fail "需要 tar"

resolve_dest() {
  if [[ -n "$DEST_DIR" ]]; then echo "$DEST_DIR"; return; fi
  echo "${NUWAX_OFFLINE_SDK_HOME:-$HOME/workspace/nuwax-mobile-offline-sdk}"
}

DEST_DIR="$(resolve_dest)"
mkdir -p "$DEST_DIR"
base="$ENDPOINT/$BUCKET/$PREFIX"

# 小文件（json）：静默
fetch_small() {
  local url="$1" dest="$2"
  local opts=(-fsSL -H "Cache-Control: no-cache" -H "Pragma: no-cache")
  [[ "$INSECURE" == "1" ]] && opts+=(-k)
  if ! curl "${opts[@]}" -o "$dest" "$url"; then
    warn "下载失败(可能自签证书),尝试 -k 重试 ..."
    curl -fsSLk -H "Cache-Control: no-cache" -o "$dest" "$url" || return 1
  fi
}

# 大文件（tarball）：进度条
fetch_big() {
  local url="$1" dest="$2"
  local opts=(-fL --progress-bar -H "Cache-Control: no-cache")
  [[ "$INSECURE" == "1" ]] && opts+=(-k)
  if ! curl "${opts[@]}" -o "$dest" "$url"; then
    echo
    warn "下载失败(可能自签证书),尝试 -k 重试 ..."
    curl -fL --progress-bar -k -o "$dest" "$url" || return 1
  fi
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

if [[ -n "$PINNED_VERSION" ]]; then
  VERSION="${PINNED_VERSION#v}"
  ok "指定版本: ${VERSION}"
else
  info "未指定版本，解析 latest ..."
  fetch_small "$base/latest.json" "$TMP/latest.json" \
    || fail "无法读取 latest: $base/latest.json（是否已发布过？）"
  if command -v node >/dev/null 2>&1; then
    VERSION="$(node -p "require('$TMP/latest.json').version" 2>/dev/null || true)"
  else
    VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$TMP/latest.json" | head -1)"
  fi
  [[ -n "${VERSION}" ]] || fail "latest.json 无 version 字段"
  ok "最新 → ${VERSION}"
fi

TARBALL="nuwax-mobile-offline-sdk-${VERSION}.tar.gz"
VER_BASE="$base/versions/${VERSION}"

# manifest（取 sha256 校验）
MANIFEST_SHA=""
if fetch_small "$VER_BASE/manifest.json" "$TMP/manifest.json"; then
  if command -v node >/dev/null 2>&1; then
    MANIFEST_SHA="$(node -p "require('$TMP/manifest.json').sha256 || ''" 2>/dev/null || true)"
  fi
fi

info "下载 ${TARBALL}（约 1G+，请耐心）..."
fetch_big "$VER_BASE/$TARBALL" "$TMP/$TARBALL" || fail "下载失败：$VER_BASE/$TARBALL"

# sha256 校验
if [[ -n "$MANIFEST_SHA" ]] && command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$TMP/$TARBALL" | awk '{print $1}')"
  if [[ "$actual" == "$MANIFEST_SHA" ]]; then
    ok "sha256 校验通过"
  else
    fail "sha256 不匹配（期望 $MANIFEST_SHA，实际 $actual）— 包可能损坏，已中止"
  fi
else
  warn "跳过 sha256 校验（无 manifest 或 shasum）"
fi

# 还原：tar 打包时是 -C SDK_HOME sdk archives，故解压回 DEST 即恢复结构
info "解压到 ${DEST_DIR}/（还原 sdk/ + archives/）..."
tar xzf "$TMP/$TARBALL" -C "$DEST_DIR"

# 版本标记
echo "{\"schema\":\"nuwax.mobile.offlineSdk.v1\",\"version\":\"$VERSION\",\"fetchedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" \
  > "$DEST_DIR/.fetched.json"

# 自检还原结果（与 local-base-env.sh 期望对齐）
miss=0
[[ -d "$DEST_DIR/sdk/android/$VERSION" ]] || { warn "缺失 sdk/android/$VERSION"; miss=1; }
[[ -d "$DEST_DIR/sdk/ios/$VERSION" ]]     || { warn "缺失 sdk/ios/$VERSION"; miss=1; }
[[ -d "$DEST_DIR/archives" ]]             || { warn "缺失 archives/"; miss=1; }

echo
if [[ "$miss" == "0" ]]; then
  ok "完成 → ${DEST_DIR} (version=${VERSION})"
else
  warn "还原完成但部分目录缺失（见上），构建前请检查"
fi
echo "下一步："
echo "  source scripts/local-base-env.sh        # 派生各平台路径"
echo "  make base-android / base-ios-device      # work/ 由构建脚本自动生成"
