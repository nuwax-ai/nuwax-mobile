#!/usr/bin/env bash
# 公开 S3 下载入口，同时作为独立 bootstrap 分发。
set -euo pipefail

ENDPOINT="${NUWAX_S3_ENDPOINT:-https://s3.nuwax.com:9443}"
BUCKET="${NUWAX_S3_BUCKET:-nuwax-packages}"
PREFIX="${NUWAX_S3_PREFIX:-mobile-custom-bases}"
CHANNEL="${NUWAX_BASE_CHANNEL:-debug}"
VERSION="${NUWAX_BASE_VERSION:-}"
TARGETS="${NUWAX_BASE_TARGETS:-}"
DEST_DIR="${NUWAX_BASE_DEST:-}"

usage() {
  cat <<'HELP'
Usage: bash scripts/fetch-custom-base-s3.sh [options]

  --version ID    固定基座版本；优先于通道
  --channel NAME  跟随通道（默认 debug）
  --targets LIST  android,ios-device,ios-simulator,harmony；默认下载清单中所有已发布平台
  --dest DIR      指定输出目录；默认固定版本/独立通道存入 unpackage/debug/versions/<ID>/
                  默认 debug 通道使用 unpackage/debug/
  -h, --help

Environment:
  NUWAX_BASE_VERSION / NUWAX_BASE_CHANNEL / NUWAX_BASE_TARGETS / NUWAX_BASE_DEST
  NUWAX_S3_ENDPOINT / NUWAX_S3_BUCKET / NUWAX_S3_PREFIX / NUWAX_S3_INSECURE
Dependencies: bash, curl, node, shasum 或 sha256sum；目录压缩包另需 unzip。
HELP
}

fail() { echo "错误：$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version|--channel|--targets|--dest)
      [[ -n "${2:-}" && "$2" != --* ]] || fail "$1 需要参数"
      case "$1" in
        --version) VERSION="$2" ;;
        --channel) CHANNEL="$2" ;;
        --targets) TARGETS="$2" ;;
        --dest) DEST_DIR="$2" ;;
      esac
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *) fail "未知参数：$1" ;;
  esac
done

[[ "$CHANNEL" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || fail "无效通道：$CHANNEL"
for tool in curl node; do
  command -v "$tool" >/dev/null 2>&1 || fail "需要 $tool"
done

base="${ENDPOINT%/}/$BUCKET/$PREFIX"
fetch() {
  local url="$1" dest="$2" status
  local opts=(-fsSL -H "Cache-Control: no-cache")
  [[ "${NUWAX_S3_INSECURE:-0}" == 1 ]] && opts+=(-k)
  if curl "${opts[@]}" -o "$dest" "$url"; then
    return
  else
    status=$?
  fi
  # 保留自签证书环境的兼容行为；HTTP 失败直接返回。
  [[ "$status" == 60 ]] && curl "${opts[@]}" -k -o "$dest" "$url"
}

versioned=1
if [[ -n "$VERSION" ]]; then
  [[ "$VERSION" =~ ^v[0-9] ]] && VERSION="${VERSION#v}"
else
  if [[ "$CHANNEL" == debug ]]; then versioned=0; fi
  VERSION="$(fetch "$base/channels/$CHANNEL.json" - | node -e '
    const pointer = JSON.parse(require("fs").readFileSync(0, "utf8"));
    if (typeof pointer.version === "string") process.stdout.write(pointer.version);
  ')" || fail "无法读取通道 $CHANNEL 的版本"
  echo "通道 $CHANNEL → $VERSION"
fi
[[ "$VERSION" =~ ^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$ && "$VERSION" != *..* ]] || fail "无效基座版本：$VERSION"

if [[ -z "$DEST_DIR" ]]; then
  root="$PWD"
  if [[ -f "${BASH_SOURCE[0]:-}" ]]; then
    script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    if [[ -f "$script_root/Makefile" || -d "$script_root/unpackage" ]]; then
      root="$script_root"
    fi
  fi
  DEST_DIR="$root/unpackage/debug"
  if [[ "$versioned" == 1 ]]; then DEST_DIR="$DEST_DIR/versions/$VERSION"; fi
fi

mkdir -p "$DEST_DIR"
lock="$DEST_DIR/.base-fetch.lock"
mkdir "$lock" 2>/dev/null || fail "目标目录有下载正在进行：$DEST_DIR"
stage=""
cleanup() {
  if [[ -n "$stage" ]]; then rm -rf "$stage"; fi
  rmdir "$lock"
}
trap cleanup EXIT
stage="$(mktemp -d "$DEST_DIR/.base-fetch.XXXXXX")"

art_base="$base/versions/$VERSION/artifacts"
fetch "$art_base/manifest.json" "$stage/manifest.json" || fail "无法读取版本 $VERSION 的发布清单"
# 用标准输入读取 JSON，兼容 Git Bash 调用 Windows 版 Node。
VERSION="$VERSION" TARGETS="$TARGETS" node -e '
  const manifest = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const platforms = {
    android: ["android_debug.apk", "android_debug_vapor.apk"],
    "ios-device": ["iOS_debug.ipa", "iOS_debug_vapor.ipa"],
    "ios-simulator": ["Pandora_simulator_debug.app.zip"],
    harmony: ["harmony_debug.hap", "harmony_debug.app.zip", "harmony_debug.app"],
  };
  if (manifest.version !== process.env.VERSION || !Array.isArray(manifest.artifacts)) {
    throw new Error("发布清单与请求版本不匹配");
  }
  const requested = process.env.TARGETS;
  const entries = new Map(manifest.artifacts.map(file => [file.name, file]));
  if (entries.size !== manifest.artifacts.length) throw new Error("清单中有重复文件名");
  for (const target of new Set(requested ? requested.split(",") : Object.keys(platforms))) {
    if (!Object.hasOwn(platforms, target)) throw new Error("未知平台：" + target);
    const files = platforms[target].filter(name => entries.has(name) &&
      (name !== "harmony_debug.app" || !entries.has("harmony_debug.app.zip")));
    if (requested && !files.length) throw new Error("此版本未发布 " + target);
    for (const name of files) {
      const {sha256, bytes} = entries.get(name);
      if (!/^[0-9a-f]{64}$/i.test(sha256) || !Number.isSafeInteger(bytes) || bytes <= 0) {
        throw new Error("产物校验信息无效：" + name);
      }
      console.log([name, sha256.toLowerCase(), bytes].join("\t"));
    }
  }
' < "$stage/manifest.json" > "$stage/downloads"
[[ -s "$stage/downloads" ]] || fail "版本 $VERSION 无可下载的基座"

if command -v shasum >/dev/null 2>&1; then
  checksum=(shasum -a 256)
else
  command -v sha256sum >/dev/null 2>&1 || fail "需要 shasum 或 sha256sum"
  checksum=(sha256sum)
fi

outputs=()
while IFS=$'\t' read -r name sha256 bytes; do
  echo "下载 $VERSION/$name"
  file="$stage/$name"
  fetch "$art_base/$name" "$file" || fail "下载失败：$name"
  actual_hash="$("${checksum[@]}" < "$file")"
  [[ "${actual_hash%% *}" == "$sha256" && $(wc -c < "$file") -eq "$bytes" ]] || fail "校验失败：$name"
  outputs+=("$name")
done < "$stage/downloads"

for name in "${outputs[@]}"; do
  if [[ "$name" == *.app.zip ]]; then
    unzip -q "$stage/$name" -d "$stage/extracted" || fail "解压失败：$name"
    app="${name%.zip}"
    [[ -d "$stage/extracted/$app" ]] || fail "压缩包缺少 $app"
    mv "$stage/extracted/$app" "$stage/$app"
    outputs+=("$app")
  fi
done

# 只清理这个目录中由下载器管理的旧包，保留其他本地文件。
installed="$DEST_DIR/.base-fetch-files"
printf '%s\n' "${outputs[@]}" > "$stage/.base-fetch-files"
if [[ -f "$installed" ]] && cmp -s "$stage/manifest.json" "$DEST_DIR/manifest.json"; then
  sort -u "$installed" "$stage/.base-fetch-files" > "$stage/merged-files"
  mv "$stage/merged-files" "$stage/.base-fetch-files"
fi

# 先完成所有下载、校验和解压，再替换已有文件。
for name in "${outputs[@]}" manifest.json .base-fetch-files; do
  if [[ "$name" == .base-fetch-files && -f "$installed" ]]; then
    while IFS= read -r previous; do
      case "$previous" in
        android_debug.apk|android_debug_vapor.apk|iOS_debug.ipa|iOS_debug_vapor.ipa|\
        Pandora_simulator_debug.app|Pandora_simulator_debug.app.zip|harmony_debug.hap|harmony_debug.app|harmony_debug.app.zip)
          if ! grep -Fxq -- "$previous" "$stage/.base-fetch-files"; then
            rm -rf "$DEST_DIR/$previous"
          fi
          ;;
      esac
    done < "$installed"
  fi
  if [[ -d "$DEST_DIR/$name" && ! -L "$DEST_DIR/$name" ]]; then
    mv "$DEST_DIR/$name" "$stage/previous-$name"
    if ! mv "$stage/$name" "$DEST_DIR/$name"; then
      mv "$stage/previous-$name" "$DEST_DIR/$name"
      fail "无法替换 $name"
    fi
  else
    # 目标如果是 symlink，先移走链接，避免 mv 跟随目录链接。
    if [[ -L "$DEST_DIR/$name" ]]; then rm "$DEST_DIR/$name"; fi
    mv -f "$stage/$name" "$DEST_DIR/$name"
  fi
done
printf '完成 → %s（基座 %s）\n' "$DEST_DIR" "$VERSION"
echo "HBuilderX：运行 → 使用自定义基座运行 → 选择该目录的基座"
