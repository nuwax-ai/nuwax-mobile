#!/usr/bin/env bash
# 从 Nuwax S3（MinIO）拉取联调自定义基座到 unpackage/debug/。
# 公开读，无需 aws 凭证（只需 curl）；自签证书失败时自动 -k 重试。
#
# 版本策略：
#   - 不指定版本 → 读 channels/<channel>.json（默认 debug）= 当前最新（安装/同步更新用）
#   - 指定 NUWAX_BASE_VERSION / --version → 固定 App versionName
#
# 变体（flavor）：
#   - --flavor vapor（或 channel=vapor / 版本含 vapor）：拉 _vapor 后缀的产物，
#     落地为 android_debug_vapor.apk / iOS_debug_vapor.ipa / Pandora_simulator_debug_vapor.app，
#     与标准基座文件名共存、互不覆盖。
#
# One-liner:
#   curl -fsSL https://s3.nuwax.com:9443/nuwax-packages/mobile-custom-bases/fetch-custom-base-s3.sh | bash
#
# 仓库内:
#   make base-fetch
#   bash scripts/fetch-custom-base-s3.sh --targets android,ios-device
#   NUWAX_BASE_CHANNEL=vapor make base-fetch                 # 拉 vapor 蒸汽基座
#   NUWAX_BASE_VERSION=1.0.0-vapor make base-fetch
set -euo pipefail

ENDPOINT="${NUWAX_S3_ENDPOINT:-https://s3.nuwax.com:9443}"
BUCKET="${NUWAX_S3_BUCKET:-nuwax-packages}"
PREFIX="${NUWAX_S3_PREFIX:-mobile-custom-bases}"
CHANNEL="${NUWAX_BASE_CHANNEL:-debug}"
PINNED_VERSION="${NUWAX_BASE_VERSION:-}"
FLAVOR="${NUWAX_BASE_FLAVOR:-}"
INSECURE="${NUWAX_S3_INSECURE:-0}"
TARGETS="android,ios-device,ios-simulator,harmony"
DEST_DIR=""
VERSION=""

usage() {
  cat <<'EOF'
Usage: bash scripts/fetch-custom-base-s3.sh [options]

Options:
  --targets LIST     android,ios-device,ios-simulator,harmony（默认全开）
  --dest DIR         输出目录（默认：仓库 unpackage/debug）
  --version VER      固定 App versionName（不设则拉最新）
  --channel NAME     通道（默认 debug）
  --flavor NAME      变体（如 vapor：拉 _<flavor> 后缀产物；channel/version 含 vapor 时自动）
  -h, --help

不指定 --version：读 channels/<channel>.json → 当前最新（同步更新时再跑一次即可）。
vapor：--channel vapor（或 --version 1.0.0-vapor）自动拉 _vapor 后缀产物，与标准基座共存。

Environment:
  NUWAX_S3_ENDPOINT / NUWAX_S3_BUCKET / NUWAX_S3_PREFIX
  NUWAX_BASE_CHANNEL / NUWAX_BASE_VERSION / NUWAX_BASE_FLAVOR
  NUWAX_S3_INSECURE=1
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --targets) TARGETS="${2:-}"; shift 2 ;;
    --dest) DEST_DIR="${2:-}"; shift 2 ;;
    --version) PINNED_VERSION="${2:-}"; shift 2 ;;
    --channel) CHANNEL="${2:-}"; shift 2 ;;
    --flavor) FLAVOR="${2:-}"; shift 2 ;;
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
  ok "指定版本: ${VERSION}"
else
  info "未指定版本，解析最新 channel '${CHANNEL}' ..."
  fetch "$base/channels/$CHANNEL.json" "$TMP/channel.json" || fail "无法读取 channel: $base/channels/$CHANNEL.json（是否已发布过？）"
  if command -v node >/dev/null 2>&1; then
    VERSION="$(node -p "require('$TMP/channel.json').version" 2>/dev/null || true)"
  else
    VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$TMP/channel.json" | head -1)"
  fi
  [[ -n "${VERSION}" ]] || fail "channel 无 version 字段"
  # 必须用 ${VERSION}：紧跟全角「（」时，$VERSION（ 会被当成未定义变量名（set -u 直接挂）
  ok "最新 → ${VERSION}（与 App versionName 对齐）"
fi

# 变体后缀：--flavor 显式；否则 channel/version 含 vapor 自动识别
SUFFIX=""
if [[ -n "$FLAVOR" ]]; then
  SUFFIX="_${FLAVOR}"
elif [[ "$CHANNEL" == "vapor" || "$VERSION" == *vapor* ]]; then
  SUFFIX="_vapor"
  FLAVOR="vapor"
fi
[[ -n "$SUFFIX" ]] && ok "变体: ${FLAVOR}（产物名带 ${SUFFIX} 后缀，与标准基座共存）"

ART_BASE="$base/versions/${VERSION}/artifacts"
info "拉取 manifest ..."
if fetch "$ART_BASE/manifest.json" "$TMP/manifest.json"; then
  cp "$TMP/manifest.json" "$DEST_DIR/manifest.json"
  ok "manifest.json"
else
  warn "无 manifest.json，按约定文件名拉取"
fi

download_one() {
  # 勿写成 local name="$1" url="...$name"：同语句内 $name 仍指向外层（set -u 会挂）
  local name="$1"
  local url="${ART_BASE}/${name}"
  local out="${DEST_DIR}/${name}"
  info "下载 ${name} ..."
  if fetch "$url" "$out"; then
    ok "${name} → ${out}"
    return 0
  fi
  warn "跳过 ${name}（该版本可能未发布）"
  rm -f "$out"
  return 1
}

if want_target android; then download_one "android_debug${SUFFIX}.apk" || true; fi
if want_target ios-device; then download_one "iOS_debug${SUFFIX}.ipa" || true; fi

if want_target ios-simulator; then
  if download_one "Pandora_simulator_debug${SUFFIX}.app.zip"; then
    info "解压 Pandora_simulator_debug${SUFFIX}.app.zip ..."
    rm -rf "$DEST_DIR/Pandora_simulator_debug${SUFFIX}.app"
    unzip -q -o "$DEST_DIR/Pandora_simulator_debug${SUFFIX}.app.zip" -d "$DEST_DIR"
    ok "Pandora_simulator_debug${SUFFIX}.app"
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
ok "完成 → ${DEST_DIR} (version=${VERSION})"
echo "HX：运行 → 使用自定义基座运行 → 选择对应 apk / ipa / simulator .app"
echo "同步更新：再执行一次本脚本（不指定版本）即可覆盖本地文件。"
echo "说明：真机与模拟器勿混用；iOS 真机包受证书/设备列表限制。"
