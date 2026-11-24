import importlib.util
import json
import plistlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('prepare_cloud', Path(__file__).with_name('prepare_cloud.py'))
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


def profile(bundle, team='TEAM', group='group.example.app'):
    return {'TeamIdentifier': [team], 'Entitlements': {
        'application-identifier': team + '.' + bundle,
        'com.apple.security.application-groups': [group],
    }}


class BroadcastPackagingTests(unittest.TestCase):
    def test_wrong_profile_or_group_is_rejected(self):
        for value, bundle, group, team in [
            (profile('example.other'), 'example.app', 'group.example.app', None),
            (profile('example.app'), 'example.app', 'group.other', None),
            (profile('example.app'), 'example.app', 'group.example.app', 'OTHER'),
        ]:
            with self.subTest(bundle=bundle, group=group, team=team), self.assertRaises(ValueError):
                prepare.validate_profile(value, bundle, group, team)

    def test_stage_preserves_other_plugins_and_custom_base(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'manifest.json').write_text(json.dumps({'versionName': '1.0.0', 'versionCode': '100'}))
            appex = root / 'exported.appex'
            appex.mkdir()
            (appex / 'MeetingBroadcast').write_bytes(b'exported-binary-placeholder')
            info = {'CFBundleIdentifier': 'example.app.broadcast', 'CFBundleExecutable': 'MeetingBroadcast',
                    'CFBundleVersion': '100', 'CFBundleShortVersionString': '1.0.0',
                    'RTCAppGroupIdentifier': 'group.example.app',
                    'NSExtension': {'NSExtensionPointIdentifier': 'com.apple.broadcast-services-upload'}}
            (appex / 'Info.plist').write_bytes(plistlib.dumps(info))
            resource = root / 'nativeResources/ios'
            resource.mkdir(parents=True)
            (resource / 'ios-extension.json').write_text('{"Other.appex":{"identifier":"example.app.other"}}')
            custom_base = root / 'unpackage/debug/iOS_debug.ipa'
            custom_base.parent.mkdir(parents=True)
            custom_base.write_bytes(b'user-custom-base')
            plugin = root / prepare.PLUGIN
            plugin.mkdir(parents=True)
            (plugin / 'UTS.entitlements').write_bytes(plistlib.dumps({'aps-environment': 'development'}))
            main_profile = root / 'main.mobileprovision'
            extension_profile = root / 'extension.mobileprovision'
            main_profile.write_bytes(b'profile')
            extension_profile.write_bytes(b'profile')
            with patch.object(prepare, 'profile_data', side_effect=[profile('example.app'), profile('example.app.broadcast')]), \
                 patch.object(prepare.subprocess, 'run') as verify:
                prepare.stage(root, appex, main_profile, extension_profile, 'example.app', 'group.example.app')
                self.assertEqual(verify.call_args.args[0][0], 'codesign')
            config = json.loads((resource / 'ios-extension.json').read_text())
            self.assertIn('Other.appex', config)
            self.assertEqual(config['MeetingBroadcast.appex']['profile'], 'MeetingBroadcast.mobileprovision')
            self.assertEqual(custom_base.read_bytes(), b'user-custom-base')
            ent = plistlib.loads((plugin / 'UTS.entitlements').read_bytes())
            self.assertEqual(ent['aps-environment'], 'development')
            self.assertIn('group.example.app', ent['com.apple.security.application-groups'])
            info['CFBundleVersion'] = '99'
            (appex / 'Info.plist').write_bytes(plistlib.dumps(info))
            with self.assertRaisesRegex(ValueError, 'version must match'):
                prepare.stage(root, appex, main_profile, extension_profile, 'example.app', 'group.example.app')


if __name__ == '__main__':
    unittest.main()
