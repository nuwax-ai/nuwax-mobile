#!/usr/bin/env python3
"""Verify the signed standalone QA host against exported HX resources and current native source."""
import hashlib, json, plistlib, subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[2]
app = root/'out/voip-business-ios-derived/Build/Products/Debug-iphoneos/UniAppX.app'
qa = root/'out/voip-business-qa-project'
export = qa/'unpackage/resources/app-ios/__UNI__8BF05E4/www'
www = app/'uni-app-x/apps/__UNI__8BF05E4/www'
info = plistlib.loads((app/'Info.plist').read_bytes())
assert info['CFBundleIdentifier'] == 'com.nuwax.app'
assert info['CFBundleDisplayName'] == json.loads((root/'manifest.json').read_text())['name']
assert info['NuwaxBuildFlavor'] == 'voip-business-qa'
assert info['NuwaxAPIOrigin'] == 'https://testagent.xspaceagi.com'
assert info['uniapp-x']['ipatype'] == 2 and info['uniapp-x']['uniRuntimeVersion'] == '5.34'
assert 'NuwaxVoipDeviceTest' not in info
assert not (app/'Frameworks/DCloudDebugServe.framework').exists(), 'Standalone QA must not depend on the HX debug service'
assert {'audio', 'voip', 'remote-notification'}.issubset(set(info['UIBackgroundModes']))

def digest(file): return hashlib.sha256(file.read_bytes()).hexdigest()

# Full exported resource inventory, not just a successful compiler exit code.
files = [file for file in export.rglob('*') if file.is_file()]
assert export.is_dir() and files, 'Fresh HX exported QA resources are required for verification'
for file in files:
    target = www/file.relative_to(export)
    assert target.is_file() and digest(file) == digest(target), f'Embedded resource mismatch: {file.relative_to(export)}'
assert (www/'app-service.js').stat().st_size > 0
assert b'https://testagent.xspaceagi.com' in (www/'app-service.js').read_bytes()

native = {}
for file in (root/'uni_modules/nuwax-voip/utssdk/app-ios').glob('*.swift'):
    built = root/'out/voip-business-ios/Modules/unimoduleNuwaxVoip'/file.name
    assert digest(file) == digest(built), f'Stale native module: {file.name}'
    native[file.name] = digest(file)

subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
subprocess.run(['python3', str(root/'scripts/voip-native/device/ios_push_config.py'), str(app)], check=True)
result = {'bundleId': info['CFBundleIdentifier'], 'version': info['CFBundleShortVersionString'], 'build': info['CFBundleVersion'],
          'flavor': info['NuwaxBuildFlavor'], 'apiOrigin': info['NuwaxAPIOrigin'], 'ipatype': 2,
          'hxRuntime': '5.34', 'embeddedResourceFiles': len(files), 'nativeSources': native,
          'independentResources': True, 'realDeviceAcceptance': False}
output = root/'out/voip-ios-audit-20261117/ipa-verification.json'
output.parent.mkdir(parents=True, exist_ok=True); output.write_text(json.dumps(result, indent=2))
print(f'Verified standalone real App QA host: {len(files)} embedded resource files; real-device acceptance pending')
