import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('derives APNs environment from the selected profile and rejects signed-host mismatches', () => {
  const result = execFileSync('python3', ['-c', `
import os, sys, tempfile, plistlib, zipfile
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, sys.argv[1])
import ios_push_config as config
def rejects(fn):
    try: fn()
    except ValueError: return
    raise AssertionError('Invalid signing configuration was accepted')
for env in ['development', 'production']:
    info, entitlements = config.push_configuration({'aps-environment':env,'application-identifier':'TEAM.com.nuwax.app'}, 'com.nuwax.app','TEAM')
    assert info['NuwaxVoipAPNSEnvironment'] == entitlements['aps-environment'] == env
    config.verify_signed_push(dict(info, CFBundleIdentifier='com.nuwax.app'), dict(entitlements, **{'application-identifier':'TEAM.com.nuwax.app'}))
    rejects(lambda: config.verify_signed_push(dict(info, CFBundleIdentifier='com.nuwax.app'), {'aps-environment':'wrong'}))
    aggregate_info, aggregate_entitlements = config.push_configuration({'aps-environment':env,'application-identifier':'TEAM.com.nuwax.app'}, 'com.nuwax.app','TEAM','unipush')
    assert aggregate_info['NuwaxVoipPushProvider'] == 'unipush' and aggregate_entitlements == entitlements
    rejects(lambda: config.verify_signed_push(dict(aggregate_info, CFBundleIdentifier='com.nuwax.app'), dict(aggregate_entitlements, **{'application-identifier':'TEAM.com.nuwax.app'})))
rejects(lambda: config.push_configuration({'aps-environment':'development','application-identifier':'TEAM.com.other'}, 'com.nuwax.app','TEAM'))
rejects(lambda: config.push_configuration({'application-identifier':'TEAM.com.nuwax.app'}, 'com.nuwax.app','TEAM'))
with tempfile.TemporaryDirectory() as directory:
    profile = Path(directory)/'fixture.mobileprovision'; profile.touch()
    os.environ['IOS_PROVISIONING_PROFILE_PATH'] = str(profile)
    os.environ['IOS_PROVISIONING_PROFILE_UUID'] = 'fixture-id'
    os.environ['IOS_DEVELOPMENT_TEAM'] = 'TEAM'
    config.subprocess.run = lambda *args, **kwargs: SimpleNamespace(returncode=0, stdout=plistlib.dumps({'UUID':'fixture-id', 'Entitlements':{'aps-environment':'production','application-identifier':'TEAM.com.nuwax.app'}}))
    assert config.selected_push_configuration('com.nuwax.app')[0]['NuwaxVoipAPNSEnvironment'] == 'production'
    base = Path(directory)/'fixture.ipa'
    getui = {'appid':'FixtureGetuiAppId','appKey':'FixtureAppKey','appSecret':'FixtureAppSecret'}
    with zipfile.ZipFile(base, 'w') as archive:
        archive.writestr('Payload/UniAppX.app/Info.plist', plistlib.dumps({'CFBundleIdentifier':'com.nuwax.app','getui':dict(getui, masterSecret='never-export')}))
    os.environ['NUWAX_IOS_UNIPUSH_CLIENT_IPA'] = str(base)
    os.environ['NUWAX_IOS_VOIP_PUSH_PROVIDER'] = 'unipush'
    signed, entitlements = config.selected_push_configuration('com.nuwax.app')
    assert signed['getui'] == getui
    signed['CFBundleIdentifier'] = 'com.nuwax.app'
    config.verify_signed_push(signed, dict(entitlements, **{'application-identifier':'TEAM.com.nuwax.app'}))
    rejects(lambda: config.verify_signed_push(dict(signed, getui=dict(getui, appid='AnotherApp')), dict(entitlements, **{'application-identifier':'TEAM.com.nuwax.app'})))
    os.environ['IOS_PROVISIONING_PROFILE_UUID'] = 'different-id'
    rejects(lambda: config.selected_push_configuration('com.nuwax.app'))
print('APNs signing metadata verified without signing or installing')
`, resolve(import.meta.dirname, '../../scripts/voip-native/device')], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  expect(result).toContain('APNs signing metadata verified');
});

it('rejects a requested development host before copying release resources when HX compilation is incomplete', () => {
  const result = execFileSync('python3', ['-c', `
import os, sys, tempfile, shutil, subprocess
from pathlib import Path
source = Path(sys.argv[1])
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    scripts = root/'scripts/voip-native/device'; scripts.mkdir(parents=True)
    for name in ['prepare-ios.py', 'ios_push_config.py']:
        shutil.copy2(source/name, scripts/name)
    (root/'manifest.json').write_text('{}')
    resources = root/'unpackage/resources/app-ios/__UNI__8BF05E4/www'
    resources.mkdir(parents=True)
    (resources/'app-service.js').write_text('// release resource must not be used')
    sdk = root/'out/UniAppX-iOS@5.34'; (sdk/'SDK/Libs').mkdir(parents=True)
    env = dict(os.environ, UNIAPPX_SDK_ROOT=str(sdk), NUWAX_VOIP_BUSINESS_HOST='1', NUWAX_IOS_HX_DEV_NATIVE='1')
    run = subprocess.run([sys.executable, str(scripts/'prepare-ios.py')], env=env, text=True, capture_output=True)
    assert run.returncode != 0
    assert 'HX development resources missing' in run.stderr
    assert not (root/'out/voip-business-ios/App').exists()
print('Incomplete development resources rejected without copying release resources')
`, resolve(import.meta.dirname, '../../scripts/voip-native/device')], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  expect(result).toContain('Incomplete development resources rejected');
});

it('requires a real launch-hook call in AppDelegate, including an Xcode debug companion', () => {
  const result = execFileSync('python3', ['-c', `
import sys, tempfile
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, sys.argv[1])
import ios_push_config as config
method = '-[AppDelegate application:didFinishLaunchingWithOptions:]:\\n'
body = '  406c: ldr x0, [x8] ; Objc class ref: _OBJC_CLASS_$__TtC18unimoduleNuwaxVoip15NuwaxVoipBridge\\n  4070: bl _objc_msgSend$restoreOnLaunch\\n'
assert config.has_native_launch_restore(method + body)
assert not config.has_native_launch_restore('restoreOnLaunch')
assert not config.has_native_launch_restore('-[OtherClass restore]:\\n' + body)
assert not config.has_native_launch_restore(method + '  406c: ret\\n-[OtherClass restore]:\\n' + body)
assert not config.has_native_launch_restore(method + body.replace('bl _objc_msgSend$', 'adr x0, _objc_msgSend$'))
with tempfile.TemporaryDirectory() as directory:
    app = Path(directory); (app/'UniAppX.debug.dylib').touch()
    seen = []
    def run(args, **kwargs):
        seen.append(args)
        if args[0] == 'otool': return SimpleNamespace(stdout='@rpath/UniAppX.debug.dylib')
        return SimpleNamespace(stdout=method + body if args[-1].endswith('.debug.dylib') else 'stub only')
    config.subprocess.run = run
    config.verify_native_launch_restore(app, {'CFBundleExecutable':'UniAppX'})
    assert seen[-1][-1].endswith('UniAppX.debug.dylib')
print('Native launch-hook code verified without compilation or signing')
`, resolve(import.meta.dirname, '../../scripts/voip-native/device')], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  expect(result).toContain('Native launch-hook code verified');
});
