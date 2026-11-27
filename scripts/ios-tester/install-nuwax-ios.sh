#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo '用法：bash install-nuwax-ios.sh <CoreDevice 设备 ID> <已签名的 IPA 或 .app 路径>' >&2
  echo '查设备：xcrun devicectl list devices' >&2
  exit 2
fi

device_id="$1"
package_path="${2%/}"
staging_dir=""

cleanup() {
  if [[ -n "$staging_dir" ]]; then
    rm -rf -- "$staging_dir"
  fi
}
trap cleanup EXIT

case "$package_path" in
  *.ipa)
    staging_dir="$(mktemp -d "${TMPDIR:-/tmp}/nuwax-ios-install.XXXXXX")"
    ditto -x -k "$package_path" "$staging_dir"
    shopt -s nullglob
    apps=("$staging_dir"/Payload/*.app)
    if [[ ${#apps[@]} -ne 1 ]]; then
      echo 'IPA 的 Payload 中应有一个主 App。' >&2
      exit 1
    fi
    app_path="${apps[0]}"
    ;;
  *.app)
    app_path="$package_path"
    ;;
  *)
    echo '请传入已签名的 .ipa 文件或 .app 目录。' >&2
    exit 2
    ;;
esac

info="$app_path/Info.plist"
bundle_id="$(plutil -extract CFBundleIdentifier raw -o - "$info")"
if [[ "$bundle_id" != "com.nuwax.app" ]]; then
  echo "包名不匹配，实际为 ${bundle_id}，预期为 com.nuwax.app。" >&2
  exit 1
fi
version="$(plutil -extract CFBundleShortVersionString raw -o - "$info")"
build="$(plutil -extract CFBundleVersion raw -o - "$info")"
codesign --verify --deep --strict "$app_path"

echo "目标设备 ${device_id}，待安装 $bundle_id $version ($build)"
xcrun devicectl device install app --device "$device_id" "$app_path"
xcrun devicectl device info apps --device "$device_id" --include-default-apps \
  --bundle-id "$bundle_id" --json-output - |
  python3 -c '
import json
import sys

bundle_id, version, build = sys.argv[1:]
apps = json.load(sys.stdin)["result"]["apps"]
app = next((entry for entry in apps if entry.get("bundleIdentifier") == bundle_id), {})
installed = (app.get("version"), app.get("bundleVersion"))
if installed != (version, build):
    sys.exit(f"安装后回读版本不匹配。预期 {version} ({build})，实际 {installed[0]} ({installed[1]})。")
print(f"设备回读通过：{bundle_id} {version} ({build})")
' "$bundle_id" "$version" "$build"
