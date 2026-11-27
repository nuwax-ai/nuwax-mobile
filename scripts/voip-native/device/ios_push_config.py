"""APNs metadata comes from the selected signing profile; no private material is printed."""
import os
import plistlib
import re
import subprocess
import zipfile
from pathlib import Path


IOS_VOIP_RINGTONE = (Path(__file__).resolve().parents[3]
    / 'uni_modules/nuwax-voip/utssdk/app-ios/Resources/nuwax_voip_ring.wav')
IOS_LAUNCH_STORYBOARD = 'LaunchScreen'


def verify_bundled_ringtone(app):
    embedded = app / IOS_VOIP_RINGTONE.name
    if not embedded.is_file() or embedded.read_bytes() != IOS_VOIP_RINGTONE.read_bytes():
        raise ValueError('Missing or stale native VoIP ringtone in the main iOS App bundle')


def verify_launch_storyboard(app, info):
    if (info.get('UILaunchStoryboardName') != IOS_LAUNCH_STORYBOARD
            or not (app / 'Base.lproj' / f'{IOS_LAUNCH_STORYBOARD}.storyboardc' / 'Info.plist').is_file()):
        raise ValueError('Missing launch storyboard declaration or compiled resource in the iOS App bundle')


def validate_getui(config):
    keys = ('appid', 'appKey', 'appSecret')
    if not isinstance(config, dict) or any(
        not isinstance(config.get(key), str) or not re.fullmatch(r'[A-Za-z0-9]+', config[key])
        or config[key].lower() in ('appid', 'appkey', 'appsecret', 'placeholder')
        for key in keys
    ):
        raise ValueError('Missing valid Getui SDK credentials in the iOS base')
    return {key: config[key] for key in keys}


def getui_client_configuration(bundle_id):
    source = os.environ.get('NUWAX_IOS_UNIPUSH_CLIENT_IPA')
    if not source:
        raise ValueError('Set NUWAX_IOS_UNIPUSH_CLIENT_IPA to a trusted iOS base for this UniPush app')
    with zipfile.ZipFile(Path(source).expanduser()) as ipa:
        plists = [name for name in ipa.namelist() if re.fullmatch(r'Payload/[^/]+\.app/Info\.plist', name)]
        if len(plists) != 1:
            raise ValueError('Expected one App Info.plist in the iOS base')
        info = plistlib.loads(ipa.read(plists[0]))
    if info.get('CFBundleIdentifier') != bundle_id:
        raise ValueError('Getui credentials must come from a base for the same bundle ID')
    return validate_getui(info.get('getui'))


def push_configuration(entitlements, bundle_id, team_id, provider='apns'):
    environment = entitlements.get('aps-environment')
    if environment not in ('development', 'production'):
        raise ValueError('Signing profile has no supported APNs environment')
    if entitlements.get('application-identifier') != f'{team_id}.{bundle_id}':
        raise ValueError('Signing profile does not match the App bundle/team')
    if provider not in ('apns', 'unipush'):
        raise ValueError('Unsupported iOS VoIP provider')
    return {'NuwaxVoipPushProvider': provider, 'NuwaxVoipAPNSEnvironment': environment}, {'aps-environment': environment}


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
    provider = os.environ.get('NUWAX_IOS_VOIP_PUSH_PROVIDER', 'apns')
    info, entitlements = push_configuration(decoded.get('Entitlements', {}), bundle_id,
                                           os.environ['IOS_DEVELOPMENT_TEAM'], provider)
    if provider == 'unipush':
        info['getui'] = getui_client_configuration(bundle_id)
    return info, entitlements


def verify_signed_push(info, entitlements):
    environment = info.get('NuwaxVoipAPNSEnvironment')
    if environment not in ('development', 'production') or environment != entitlements.get('aps-environment'):
        raise ValueError('Signed APNs environment and VoIP metadata differ')
    if info.get('NuwaxVoipPushProvider') not in ('apns', 'unipush'):
        raise ValueError('Signed host is missing a supported VoIP provider')
    bundle = info.get('CFBundleIdentifier')
    identifier = entitlements.get('application-identifier', '')
    if not bundle or not identifier.endswith('.' + bundle):
        raise ValueError('Signed App identifier differs from its bundle ID')
    if info['NuwaxVoipPushProvider'] == 'unipush':
        getui = validate_getui(info.get('getui'))
        if os.environ.get('NUWAX_IOS_UNIPUSH_CLIENT_IPA') and getui != getui_client_configuration(bundle):
            raise ValueError('Signed Getui configuration differs from the selected iOS base')


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
    metadata = json.loads((Path(project) / 'nuwax-local-qa.json').read_text()) if project else None
    if metadata and (metadata.get('flavor') != 'voip-business-qa' or metadata.get('apiOrigin') != 'https://testagent.xspaceagi.com'):
        raise ValueError('Unexpected QA source metadata')
    if info.get('CFBundleIdentifier') != 'com.nuwax.app' or info.get('NuwaxVoipDeviceTest'):
        raise ValueError('QA must package the real business App')
    if metadata and (info.get('NuwaxBuildFlavor') != metadata['flavor'] or info.get('NuwaxAPIOrigin') != metadata['apiOrigin'] or info.get('NuwaxSourceDigest') != metadata['sourceDigest']):
        raise ValueError('QA host and compiled source metadata differ')
    if not metadata and any(key in info for key in ('NuwaxBuildFlavor', 'NuwaxAPIOrigin', 'NuwaxSourceDigest')):
        raise ValueError('Unexpected stale QA metadata in current-project host')
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
    print('Standalone real App verified: embedded resources, signing profile and no private signing material')


if __name__ == '__main__':
    import sys
    app = Path(sys.argv[1])
    result = subprocess.run(['codesign', '-d', '--entitlements', ':-', str(app)], capture_output=True)
    if result.returncode:
        raise ValueError('Cannot read signed App entitlements')
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    verify_signed_push(info, plistlib.loads(result.stdout))
    verify_launch_storyboard(app, info)
    if not info.get('NuwaxVoipDeviceTest'):
        verify_bundled_ringtone(app)
        verify_native_launch_restore(app, info)
    if os.environ.get('NUWAX_IOS_QA_PROJECT') or os.environ.get('NUWAX_IOS_STANDALONE') == '1':
        verify_business_qa(app, info, os.environ.get('NUWAX_IOS_QA_PROJECT'))
    print('Signed APNs VoIP metadata verified (no installation or upload)')
