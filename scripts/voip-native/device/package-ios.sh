#!/usr/bin/env bash
set -euo pipefail
VOIP_REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$VOIP_REPO_ROOT"
if [[ -n "${NUWAX_SIGNING_ENV:-}" ]]; then
  set -a
  source "$NUWAX_SIGNING_ENV"
  set +a
fi
export UNIAPPX_SDK_ROOT="${UNIAPPX_SDK_ROOT:-$VOIP_REPO_ROOT/out/voip-native-work/ios-sdk/UniAppX-iOS@5.34}"
python3 "$VOIP_REPO_ROOT/scripts/voip-native/device/prepare-ios.py"
xcodebuild -project "$VOIP_REPO_ROOT/out/voip-device-ios/VoipDeviceTest.xcodeproj" -scheme UniAppX -configuration Debug -destination 'generic/platform=iOS' -derivedDataPath "$VOIP_REPO_ROOT/out/voip-device-ios-derived" -clonedSourcePackagesDirPath "$VOIP_REPO_ROOT/out/voip-native-ios-derived/SourcePackages" build
VOIP_APP="$VOIP_REPO_ROOT/out/voip-device-ios-derived/Build/Products/Debug-iphoneos/UniAppX.app"
codesign --verify --deep --strict "$VOIP_APP"
python3 - "$VOIP_APP" <<'PY'
import sys,plistlib,re,subprocess
from pathlib import Path
app=Path(sys.argv[1]); info=plistlib.loads((app/'Info.plist').read_bytes())
assert info.get('CFBundleIdentifier')=='com.nuwax.app' and info.get('CFBundlePackageType')=='APPL'
assert info.get('NuwaxVoipDeviceTest') is True and (app/info['CFBundleExecutable']).is_file()
assert (app/'uni-app-x/apps/__UNI__8BF05E4/www/app-service.js').is_file()
for binary in [app/info['CFBundleExecutable']]+[f/f.stem for f in (app/'Frameworks').glob('*.framework')]:
 for name in re.findall(r'@rpath/([^/]+)\.framework/',subprocess.check_output(['otool','-L',str(binary)],text=True)):
  assert (app/'Frameworks'/f'{name}.framework').exists(), f'Missing embedded framework: {name}'
print('Verified signed iOS test host, metadata, resources and embedded frameworks')
PY
VOIP_OUT="$VOIP_REPO_ROOT/out/voip-device-packages"
mkdir -p "$VOIP_OUT/Payload" "$VOIP_REPO_ROOT/unpackage/debug"
cp -R "$VOIP_APP" "$VOIP_OUT/Payload/UniAppX.app"
VOIP_IPA="nuwax-voip-ios-$(date +%Y%m%d-%H%M%S).ipa"
(cd "$VOIP_OUT" && zip -qr "$VOIP_IPA" Payload)
rm -rf "$VOIP_OUT/Payload"
ln -sfn "$VOIP_IPA" "$VOIP_OUT/iOS_debug-latest.ipa"
cp "$VOIP_OUT/$VOIP_IPA" "$VOIP_REPO_ROOT/unpackage/debug/iOS_debug.ipa"
echo "Signed device test IPA: $VOIP_OUT/$VOIP_IPA (not installed)"
