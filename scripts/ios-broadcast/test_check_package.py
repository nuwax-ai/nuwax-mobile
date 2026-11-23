import plistlib
import tempfile
import unittest
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
import check_package as audit


class PackageAuditTests(unittest.TestCase):
    def fixture(self, path, missing_extension=False, group=True, team='TEAM', version='141'):
        host = dict(CFBundleIdentifier='com.nuwax.app', CFBundleVersion='141',
                    CFBundleShortVersionString='1.4.1', RTCAppGroupIdentifier='group.com.nuwax.app',
                    RTCScreenSharingExtension='com.nuwax.app.broadcast')
        ext = dict(host, CFBundleIdentifier='com.nuwax.app.broadcast', CFBundleVersion=version,
                   CFBundleExecutable='MeetingBroadcast', NSExtension={
                       'NSExtensionPointIdentifier': 'com.apple.broadcast-services-upload',
                       'NSExtensionPrincipalClass': 'MeetingBroadcast.SampleHandler'})
        def profile(bundle, team):
            return dict(TeamIdentifier=[team], ExpirationDate=datetime.utcnow() + timedelta(days=7),
                        Entitlements={'application-identifier': team + '.' + bundle,
                                      'com.apple.security.application-groups': ['group.com.nuwax.app'] if group else []})
        with zipfile.ZipFile(path, 'w') as archive:
            root = 'Payload/App.app/'
            archive.writestr(root + 'Info.plist', plistlib.dumps(host))
            archive.writestr(root + 'embedded.mobileprovision', plistlib.dumps(profile('com.nuwax.app', 'TEAM')))
            if not missing_extension:
                root += 'PlugIns/MeetingBroadcast.appex/'
                archive.writestr(root + 'Info.plist', plistlib.dumps(ext))
                archive.writestr(root + 'MeetingBroadcast', b'fixture-executable')
                archive.writestr(root + 'embedded.mobileprovision', plistlib.dumps(profile('com.nuwax.app.broadcast', team)))

    def test_ipa_configuration_cases(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'fixture.ipa'
            for options, expected in [({}, None), ({'missing_extension': True}, '未嵌入'),
                                      ({'group': False}, '未授权共享'), ({'team': 'OTHER'}, 'Team 不一致'),
                                      ({'version': '140'}, '版本不一致')]:
                with self.subTest(options=options):
                    self.fixture(path, **options)
                    before = path.read_bytes()
                    errors, metadata = audit.audit_ipa(path, profile_reader=plistlib.loads)
                    self.assertEqual(path.read_bytes(), before)
                    self.assertEqual(metadata['bundleId'], 'com.nuwax.app')
                    if expected:
                        self.assertTrue(any(expected in error for error in errors), errors)
                    else:
                        self.assertEqual(errors, [])

    def test_profile_identity_and_expiry(self):
        errors = []
        audit.check_profile({'ExpirationDate': datetime(2020, 1, 1), 'Entitlements': {
            'application-identifier': 'TEAM.com.other', 'com.apple.security.application-groups': ['group.ok']}},
            'com.nuwax.app', 'group.ok', errors, '主 App ')
        self.assertTrue(any('App ID' in error for error in errors))
        self.assertTrue(any('过期' in error for error in errors))

    def test_missing_inputs_are_reported_without_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertEqual(len(audit.audit_inputs(root)), 4)
            self.assertEqual(list(root.iterdir()), [])
