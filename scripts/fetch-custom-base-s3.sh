#!/usr/bin/env bash
# 从 Nuwax S3（MinIO）拉取联调自定义基座到 unpackage/debug/。
# 公开读，无需 aws 凭证（只需 curl）；自签证书失败时自动 -k 重试。
#
# 版本策略：
#   - 不指定版本 → 读 channels/<channel>.json（默认 debug）= 当前最新（安装/同步更新用）
#   - 指定 NUWAX_BASE_VERSION / --version → 固定 App versionName
#
# One-liner:
#   curl -fsSL https://s3.nuwax.com:9443/nuwax-packages/mobile-custom-bases/fetch-custom-base-s3.sh | bash
#
# 仓库内:
#   make base-fetch
#   bash scripts/fetch-custom-base-s3.sh --targets android,ios-device
#   NUWAX_BASE_VERSION=1.0.0 bash scripts/fetch-custom-base-s3.sh
set -euo pipefail

ENDPOINT="${NUWAX_S3_ENDPOINT:-https://s3.nuwax.com:9443}"
BUCKET="${NUWAX_S3_BUCKET:-nuwax-packages}"
PREFIX="${NUWAX_S3_PREFIX:-mobile-custom-bases}"
CHANNEL="${NUWAX_BASE_CHANNEL:-debug}"
PINNED_VERSION="${NUWAX_BASE_VERSION:-}"
INSECURE="${NUWAX_S3_INSECURE:-0}"
TARGETS="android,ios-device,ios-simulator,harmony"
DEST_DIR=""

usage() {
  cat <<'EOF'
Usage: bash scripts/fetch-custom-base-s3.sh [options]

Options:
  --targets LIST     android,ios-device,ios-simulator,harmony（默认全开）
  --dest DIR         输出目录（默认：仓库 unpackage/debug）
  --version VER      固定 App versionName（不设则拉最新）
  --channel NAME     通道（默认 debug）
  -h, --help

不指定 --version：读 channels/<channel>.json → 当前最新（同步更新时再跑一次即可）。

Environment:
  NUWAX_S3_ENDPOINT / NUWAX_S3_BUCKET / NUWAX_S3_PREFIX
  NUWAX_BASE_CHANNEL / NUWAX_BASE_VERSION
  NUWAX_S3_INSECURE=1
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --targets) TARGETS="${2:-}"; shift 2 ;;
    --dest) DEST_DIR="${2:-}"; shift 2 ;;
    --version) PINNED_VERSION="${2:-}"; shift 2 ;;
    --channel) CHANNEL="${2:-}"; shift 2 ;;
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
command -v unzip >/dev/null 2>&1 || fail "需要 unzip"

resolve_dest() {
  if [[ -n "$DEST_DIR" ]]; then
    echo "$DEST_DIR"
    return
  fi
  if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
    local script_dir root
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    root="$(cd "$script_dir/.." && pwd)"
    if [[ -d "$root/unpackage" || -f "$root/Makefile" ]]; then
      echo "$root/unpackage/debug"
      return
    fi
  fi
  echo "$(pwd)/unpackage/debug"
}

DEST_DIR="$(resolve_dest)"
mkdir -p "$DEST_DIR"
base="$ENDPOINT/$BUCKET/$PREFIX"

fetch() {
  local url="$1" dest="$2"
  local opts=(-fsSL -H "Cache-Control: no-cache" -H "Pragma: no-cache")
  [[ "$INSECURE" == "1" ]] && opts+=(-k)
  if ! curl "${opts[@]}" -o "$dest" "$url"; then
    warn "下载失败(可能是自签证书),尝试 -k 重试 ..."
    curl -fsSLk -H "Cache-Control: no-cache" -o "$dest" "$url" || return 1
  fi
}

want_target() {
  local t="$1"
  [[ ",$TARGETS," == *",$t,"* ]]
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

if [[ -n "$PINNED_VERSION" ]]; then
  VERSION="${PINNED_VERSION#v}"
  ok "指定版本: $VERSION"
else
  info "未指定版本，解析最新 channel '$CHANNEL' ..."
  fetch "$base/channels/$CHANNEL.json" "$TMP/channel.json" || fail "无法读取 channel: $base/channels/$CHANNEL.json（是否已发布过？）"
  if command -v node >/dev/null 2>&1; then
    VERSION="$(node -p "require('$TMP/channel.json').version" 2>/dev/null || true)"
  else
    VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$TMP/channel.json" | head -1)"
  fi
  [[ -n "$VERSION" ]] || fail "channel 无 version 字段"
  ok "最新 → $VERSION（与 App versionName 对齐）"
fi

ART_BASE="$base/versions/$VERSION/artifacts"
info "拉取 manifest ..."
if fetch "$ART_BASE/manifest.json" "$TMP/manifest.json"; then
  cp "$TMP/manifest.json" "$DEST_DIR/manifest.json"
  ok "manifest.json"
else
  warn "无 manifest.json，按约定文件名拉取"
fi

download_one() {
  local name="$1" url="$ART_BASE/$name" out="$DEST_DIR/$name"
  info "下载 $name ..."
  if fetch "$url" "$out"; then
    ok "$name → $out"
    return 0
  fi
  warn "跳过 $name（该版本可能未发布）"
  rm -f "$out"
  return 1
}

if want_target android; then download_one "android_debug.apk" || true; fi
if want_target ios-device; then download_one "iOS_debug.ipa" || true; fi

if want_target ios-simulator; then
  if download_one "Pandora_simulator_debug.app.zip"; then
    info "解压 Pandora_simulator_debug.app.zip ..."
    rm -rf "$DEST_DIR/Pandora_simulator_debug.app"
    unzip -q -o "$DEST_DIR/Pandora_simulator_debug.app.zip" -d "$DEST_DIR"
    ok "Pandora_simulator_debug.app"
  fi
fi

if want_target harmony; then
  for name in harmony_debug.hap harmony_debug.app.zip harmony_debug.app; do
    download_one "$name" || true
  done
  if [[ -f "$DEST_DIR/harmony_debug.app.zip" ]]; then
    info "解压 harmony_debug.app.zip ..."
    rm -rf "$DEST_DIR/harmony_debug.app"
    unzip -q -o "$DEST_DIR/harmony_debug.app.zip" -d "$DEST_DIR" || true
  fi
fi

echo
ok "完成 → $DEST_DIR (version=$VERSION)"
echo "HX：运行 → 使用自定义基座运行 → 选择对应 apk / ipa / simulator .app"
echo "同步更新：再执行一次本脚本（不指定版本）即可覆盖本地文件。"
echo "说明：真机与模拟器勿混用；iOS 真机包受证书/设备列表限制。"
