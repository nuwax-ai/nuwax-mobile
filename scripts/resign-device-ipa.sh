#!/bin/bash
# 重签真机自定义基座 IPA：换描述文件 + 逐级 codesign + 重打包。
# 用法：bash scripts/resign-device-ipa.sh <profile.mobileprovision> "证书名" [输出.ipa]
#   证书名示例："Apple Development: Wu GuiFu (XH56FF7Y93)"
#   输出默认覆盖 unpackage/debug/iOS_debug.device-signed.ipa（不动原始 iOS_debug.ipa）
# 前置：profile 须包含目标设备 UDID 且 App ID 匹配 com.nuwax.app（或通配）。
set -euo pipefail

PROF=$(realpath "$1")
IDENT="$2"
OUT=${3:-"$(pwd)/unpackage/debug/iOS_debug.device-signed.ipa"}
SRC="$(pwd)/unpackage/debug/iOS_debug.ipa"

[ -f "$PROF" ] || { echo "profile 不存在: $PROF"; exit 1; }
[ -f "$SRC" ] || { echo "基座不存在: $SRC（先 pnpm base:fetch）"; exit 1; }
security find-identity -v -p codesigning | grep -q "$IDENT" || { echo "钥匙串中找不到证书: $IDENT"; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
unzip -q "$SRC" -d "$TMP"
APP=$(ls -d "$TMP"/Payload/*.app | head -1)

# 从 profile 提取 entitlements（保留 aps-environment 等）
security cms -D -i "$PROF" > "$TMP/prof.plist"
python3 - "$TMP/prof.plist" "$TMP/ents.plist" <<'PY'
import plistlib, sys
p = plistlib.load(open(sys.argv[1], 'rb'))
ents = p.get('Entitlements', {})
ents.setdefault('application-identifier', p.get('ApplicationIdentifierPrefix', [''])[0] + '.com.nuwax.app')
ents.setdefault('get-task-allow', True)
plistlib.dump(ents, open(sys.argv[2], 'wb'))
PY

cp "$PROF" "$APP/embedded.mobileprovision"

# 先签动态库 / framework，再签主 App（codesign 由内向外）
# framework 的签名 identifier 必须等于其 Info.plist 的 CFBundleIdentifier，
# 否则安装时报 MismatchedBundleIDSigningIdentifier（如 com.dcloud.scopeparser4ios）
find "$APP" -type d -name "*.framework" | while read -r fw; do
  FWID=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$fw/Info.plist" 2>/dev/null || echo "$(basename "$fw" .framework)")
  codesign --force --identifier "$FWID" -s "$IDENT" "$fw"
done
find "$APP" -name "*.dylib" | while read -r dy; do
  codesign --force -s "$IDENT" "$dy"
done
codesign --force --identifier "com.nuwax.app" --entitlements "$TMP/ents.plist" -s "$IDENT" "$APP"

mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
(cd "$TMP" && zip -qry "$(realpath --relative-to="$TMP" "$OUT" 2>/dev/null || echo "$OUT")" Payload) 2>/dev/null || (cd "$TMP" && zip -qry "$OUT" Payload)
echo "重签完成: $OUT"
codesign -vv "$APP" 2>&1 | tail -1
