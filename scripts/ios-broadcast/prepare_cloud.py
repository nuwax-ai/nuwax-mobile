#!/usr/bin/env python3
"""Validate an exported broadcast extension and stage DCloud cloud-build inputs.

Does not compile, sign, upload, or replace a custom base. Git tracks the shared
configuration and ignores profiles and signed binaries.
"""
import argparse
import json
import plistlib
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PLUGIN = Path('uni_modules/nuwax-livekit/utssdk/app-ios')


def profile_data(path):
    return plistlib.loads(subprocess.check_output(['security', 'cms', '-D', '-i', str(path)]))


def validate_profile(profile, identifier, group, team=None):
    ent = profile['Entitlements']
    teams = profile.get('TeamIdentifier', [])
    if not teams or (team is not None and teams[0] != team):
        raise ValueError('Host and extension must use the same signing team')
    application_id = ent.get('application-identifier', '')
    # Explicit App IDs are required for the App Group integration.
    if application_id.split('.', 1)[-1] != identifier:
        raise ValueError('Provisioning profile App ID does not match ' + identifier)
    if group not in ent.get('com.apple.security.application-groups', []):
        raise ValueError('Provisioning profile does not allow App Group ' + group)
    return teams[0]


def merge_plist(path, additions):
    current = plistlib.loads(path.read_bytes()) if path.exists() else {}
    current.update(additions)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(plistlib.dumps(current))


def stage(root, appex, host_profile, extension_profile, bundle, group):
    info = plistlib.loads((appex / 'Info.plist').read_bytes())
    extension_id = bundle + '.broadcast'
    if info.get('CFBundleIdentifier') != extension_id:
        raise ValueError('Extension Bundle ID must be ' + extension_id)
    if info.get('NSExtension', {}).get('NSExtensionPointIdentifier') != 'com.apple.broadcast-services-upload':
        raise ValueError('Expected a Broadcast Upload Extension')
    if info.get('RTCAppGroupIdentifier') != group:
        raise ValueError('Exported extension App Group differs from requested configuration')
    if not (appex / info.get('CFBundleExecutable', '')).is_file():
        raise ValueError('Extension executable is missing; export a real archive first')
    manifest = json.loads((root / 'manifest.json').read_text())
    if str(info.get('CFBundleVersion')) != str(manifest['versionCode']) or info.get('CFBundleShortVersionString') != manifest['versionName']:
        raise ValueError('Extension version must match manifest.json; regenerate and export the extension')
    team = validate_profile(profile_data(host_profile), bundle, group)
    validate_profile(profile_data(extension_profile), extension_id, group, team)
    # Verify exported code before staging. Cloud packaging will sign it again with the supplied profile.
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(appex)], check=True)
    destination = root / PLUGIN / 'Plugins/MeetingBroadcast.appex'
    resource_dir = root / 'nativeResources/ios'
    destination.parent.mkdir(parents=True, exist_ok=True)
    resource_dir.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        shutil.rmtree(destination)
    shutil.copytree(appex, destination)
    shutil.copyfile(extension_profile, resource_dir / 'MeetingBroadcast.mobileprovision')
    config_file = resource_dir / 'ios-extension.json'
    config = json.loads(config_file.read_text()) if config_file.exists() else {}
    config['MeetingBroadcast.appex'] = {
        'identifier': extension_id,
        'profile': 'MeetingBroadcast.mobileprovision',
        'plists': {'RTCAppGroupIdentifier': group, 'RTCScreenSharingExtension': extension_id},
        'entitlements': {'com.apple.security.application-groups': [group]},
    }
    config_file.write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n')
    merge_plist(root / PLUGIN / 'Info.plist', {
        'RTCAppGroupIdentifier': group, 'RTCScreenSharingExtension': extension_id,
    })
    entitlements_file = root / PLUGIN / 'UTS.entitlements'
    entitlements = plistlib.loads(entitlements_file.read_bytes()) if entitlements_file.exists() else {}
    groups = entitlements.get('com.apple.security.application-groups', [])
    if group not in groups:
        groups.append(group)
    merge_plist(entitlements_file, {'com.apple.security.application-groups': groups})
    print('Prepared broadcast extension and cloud configuration. No base was built or replaced.')
    print('Use the validated main App profile in HBuilderX for both custom-base and release builds.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--appex', type=Path, required=True)
    parser.add_argument('--host-profile', type=Path, required=True)
    parser.add_argument('--extension-profile', type=Path, required=True)
    parser.add_argument('--bundle-id', required=True)
    parser.add_argument('--app-group', required=True)
    args = parser.parse_args()
    stage(ROOT, args.appex, args.host_profile, args.extension_profile, args.bundle_id, args.app_group)


if __name__ == '__main__':
    main()
