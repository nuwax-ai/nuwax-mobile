"""APNs metadata comes from the selected signing profile; no private material is printed."""
import os
import plistlib
import subprocess
from pathlib import Path


def push_configuration(entitlements, bundle_id, team_id):
    environment = entitlements.get('aps-environment')
    if environment not in ('development', 'production'):
        raise ValueError('Signing profile has no supported APNs environment')
    if entitlements.get('application-identifier') != f'{team_id}.{bundle_id}':
        raise ValueError('Signing profile does not match the App bundle/team')
    return {'NuwaxVoipPushProvider': 'apns', 'NuwaxVoipAPNSEnvironment': environment}, {'aps-environment': environment}


def selected_profile():
    profile_id = os.environ['IOS_PROVISIONING_PROFILE_UUID']
    profile_path = os.environ.get('IOS_PROVISIONING_PROFILE_PATH')
    candidates = [Path(profile_path).expanduser()] if profile_path else [
        Path.home() / directory / f'{profile_id}.mobileprovision'
        for directory in ('Library/MobileDevice/Provisioning Profiles', 'Library/Developer/Xcode/UserData/Provisioning Profiles')
    ]
    profile = next((p for p in candidates if p.is_file()), None)
    if profile is None:
        raise ValueError('Selected signing profile not found; set IOS_PROVISIONING_PROFILE_PATH')
    result = subprocess.run(['security', 'cms', '-D', '-i', str(profile)], capture_output=True)
    if result.returncode:
        raise ValueError('Cannot decode selected signing profile')
    decoded = plistlib.loads(result.stdout)
    if decoded.get('UUID', '').lower() != profile_id.lower():
        raise ValueError('Selected signing profile UUID mismatch')
    return decoded


def selected_push_configuration(bundle_id):
    decoded = selected_profile()
    return push_configuration(decoded.get('Entitlements', {}), bundle_id, os.environ['IOS_DEVELOPMENT_TEAM'])


def verify_signed_push(info, entitlements):
    environment = info.get('NuwaxVoipAPNSEnvironment')
    if environment not in ('development', 'production') or environment != entitlements.get('aps-environment'):
        raise ValueError('Signed APNs environment and VoIP metadata differ')
    if info.get('NuwaxVoipPushProvider') != 'apns':
        raise ValueError('Signed host is missing the APNs VoIP provider')
    bundle = info.get('CFBundleIdentifier')
    identifier = entitlements.get('application-identifier', '')
    if not bundle or not identifier.endswith('.' + bundle):
        raise ValueError('Signed App identifier differs from its bundle ID')


def has_native_launch_restore(disassembly):
    import re
    method = re.search(r'(?ms)^-\[AppDelegate application:didFinishLaunchingWithOptions:\]:\n(.*?)(?=^\S[^\n]*:\n|\Z)', disassembly)
    return bool(method and 'NuwaxVoipBridge' in method[1]
                and re.search(r'\bbl\s+[^\n]*_objc_msgSend\$restoreOnLaunch\b', method[1]))


def verify_native_launch_restore(app, info):
    """Inspect code in the signed host, including Xcode's loaded debug companion."""
    binary = app / info['CFBundleExecutable']
    linked = subprocess.run(['otool', '-L', str(binary)], capture_output=True, text=True, check=True).stdout
    candidates = [binary]
    companion = binary.with_name(binary.name + '.debug.dylib')
    if '@rpath/' + companion.name in linked:
        if not companion.is_file():
            raise ValueError('Signed host is missing its loaded debug companion')
        candidates.append(companion)
    for candidate in candidates:
        code = subprocess.run(['xcrun', 'llvm-objdump', '--macho', '--disassemble', '--symbolize-operands', str(candidate)],
                              capture_output=True, text=True, check=True).stdout
        if has_native_launch_restore(code):
            return
    raise ValueError('Signed business AppDelegate does not call the native VoIP launch restore hook')


def verify_business_qa(app, info, project):
    import json
    metadata = json.loads((Path(project) / 'nuwax-local-qa.json').read_text())
    if metadata.get('flavor') != 'voip-business-qa' or metadata.get('apiOrigin') != 'https://testagent.xspaceagi.com':
        raise ValueError('Unexpected QA source metadata')
    if info.get('CFBundleIdentifier') != 'com.nuwax.app' or info.get('NuwaxVoipDeviceTest'):
        raise ValueError('QA must package the real business App')
    if info.get('NuwaxBuildFlavor') != metadata['flavor'] or info.get('NuwaxAPIOrigin') != metadata['apiOrigin'] or info.get('NuwaxSourceDigest') != metadata['sourceDigest']:
        raise ValueError('QA host and compiled source metadata differ')
    if info.get('uniapp-x', {}).get('ipatype') != 2 or (app / 'Frameworks/DCloudDebugServe.framework').exists():
        raise ValueError('Standalone QA must not depend on the HBuilderX debug host')
    if not {'audio', 'voip', 'remote-notification'}.issubset(info.get('UIBackgroundModes', [])):
        raise ValueError('Missing call background modes')
    if not all(info.get(key) for key in ('NSMicrophoneUsageDescription', 'NSCameraUsageDescription')):
        raise ValueError('Missing call privacy descriptions')
    if info.get('NSAppTransportSecurity', {}).get('NSAllowsArbitraryLoads'):
        raise ValueError('Real business QA must retain secure transport defaults')
    for file in app.rglob('*'):
        if file.is_file() and (file.suffix.lower() in ('.p8', '.p12', '.jks', '.pem') or file.name == 'local-secrets.env'):
            raise ValueError('Signing secret found in client payload')
    profile_result = subprocess.run(['security', 'cms', '-D', '-i', str(app / 'embedded.mobileprovision')], capture_output=True, check=True)
    embedded, expected = plistlib.loads(profile_result.stdout), selected_profile()
    if embedded.get('UUID', '').lower() != expected['UUID'].lower() or set(embedded.get('ProvisionedDevices', [])) != set(expected.get('ProvisionedDevices', [])):
        raise ValueError('Signed QA does not contain the selected device profile')
    if embedded['Entitlements'].get('aps-environment') != info.get('NuwaxVoipAPNSEnvironment'):
        raise ValueError('Embedded profile APNs environment mismatch')
    www = app / 'uni-app-x/apps/__UNI__8BF05E4/www'
    script = (www / 'app-service.js').read_text()
    if not all(route in script for route in ('subpackages/pages/voip-call/voip-call', 'subpackages/pages/voip-history/voip-history', 'pages/message/chat')):
        raise ValueError('Missing real App business resources')
    print('Standalone real App QA verified: test origin, embedded resources, signing profile and no private signing material')


if __name__ == '__main__':
    import sys
    app = Path(sys.argv[1])
    result = subprocess.run(['codesign', '-d', '--entitlements', ':-', str(app)], capture_output=True)
    if result.returncode:
        raise ValueError('Cannot read signed App entitlements')
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    verify_signed_push(info, plistlib.loads(result.stdout))
    if not info.get('NuwaxVoipDeviceTest'):
        verify_native_launch_restore(app, info)
    if os.environ.get('NUWAX_IOS_QA_PROJECT'):
        verify_business_qa(app, info, os.environ['NUWAX_IOS_QA_PROJECT'])
    print('Signed APNs VoIP metadata verified (no installation or upload)')
