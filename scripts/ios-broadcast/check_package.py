#!/usr/bin/env python3
"""Read-only broadcast packaging audit. Never builds or replaces a custom base."""
import argparse
import json
import plistlib
import subprocess
import sys
import zipfile
from datetime import datetime
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
PLUGIN = Path('uni_modules/nuwax-livekit/utssdk/app-ios')


def decode_profile(raw):
    # Read CMS content without requiring a login-keychain session. This checks
    # profile capabilities, not certificate trust or device installation.
    result = subprocess.run(['openssl', 'smime', '-verify', '-inform', 'DER', '-noverify'],
                            input=raw, capture_output=True, check=True)
    return plistlib.loads(result.stdout)


def check_profile(profile, bundle, group, errors, label):
    ent = profile.get('Entitlements', {})
    if ent.get('application-identifier', '').split('.', 1)[-1] != bundle:
        errors.append(label + '描述文件的 App ID 不匹配')
    if not group or group not in ent.get('com.apple.security.application-groups', []):
        errors.append(label + '描述文件未授权共享 App Group')
    expiry = profile.get('ExpirationDate')
    if expiry is None or expiry <= datetime.utcnow():
        errors.append(label + '描述文件已过期或缺少有效期')
    return profile.get('TeamIdentifier', [])


def check_pair(host, extension, errors):
    if extension.get('NSExtension', {}).get('NSExtensionPointIdentifier') != 'com.apple.broadcast-services-upload':
        errors.append('扩展不是 Broadcast Upload Extension')
    if not extension.get('NSExtension', {}).get('NSExtensionPrincipalClass'):
        errors.append('扩展缺少 SampleHandler 入口')
    if extension.get('RTCAppGroupIdentifier') != host.get('RTCAppGroupIdentifier'):
        errors.append('主 App 与扩展的 App Group 不一致')
    for key in ['CFBundleVersion', 'CFBundleShortVersionString']:
        if str(extension.get(key, '')) != str(host.get(key, '')):
            errors.append('主 App 与扩展版本不一致：' + key)


def audit_ipa(path, profile_reader=decode_profile):
    errors = []
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        hosts = [n for n in names if len(PurePosixPath(n).parts) == 3
                 and n.startswith('Payload/') and n.endswith('.app/Info.plist')]
        if len(hosts) != 1:
            return ['IPA 中未找到唯一的主 App'], {}
        host_root = hosts[0].rsplit('/', 1)[0]
        host = plistlib.loads(archive.read(hosts[0]))
        bundle = host.get('CFBundleIdentifier', '')
        group = host.get('RTCAppGroupIdentifier', '')
        extension_id = host.get('RTCScreenSharingExtension', '')
        if not group:
            errors.append('主 App 缺少 RTCAppGroupIdentifier')
        if not extension_id:
            errors.append('主 App 缺少 RTCScreenSharingExtension')
        candidates = [n for n in names if n.startswith(host_root + '/PlugIns/')
                      and len(PurePosixPath(n).parts) == 5 and n.endswith('.appex/Info.plist')]
        extensions = [(n, plistlib.loads(archive.read(n))) for n in sorted(candidates)]
        selected = [(n, p) for n, p in extensions if p.get('CFBundleIdentifier') == extension_id]
        if not selected:
            errors.append('IPA 未嵌入指定的屏幕广播扩展（.appex）')
        def read_profile(root, identifier, label):
            entry = root + '/embedded.mobileprovision'
            if entry not in names:
                errors.append(label + '缺少 embedded.mobileprovision')
                return []
            try:
                profile = profile_reader(archive.read(entry))
                return check_profile(profile, identifier, group, errors, label)
            except (ValueError, subprocess.SubprocessError, OSError):
                errors.append(label + '描述文件无法读取')
                return []
        host_team = read_profile(host_root, bundle, '主 App ')
        if selected:
            name, extension = selected[0]
            check_pair(host, extension, errors)
            extension_root = name.rsplit('/', 1)[0]
            if extension_root + '/' + extension.get('CFBundleExecutable', '') not in names:
                errors.append('广播扩展缺少可执行文件')
            extension_team = read_profile(extension_root, extension_id, '广播扩展 ')
            if not host_team or host_team != extension_team:
                errors.append('主 App 与广播扩展签名 Team 不一致')
        return errors, {'bundleId': bundle, 'version': host.get('CFBundleShortVersionString'),
                        'appGroup': group, 'extensionId': extension_id, 'embeddedExtensions': len(extensions)}


def audit_inputs(root):
    errors = []
    required = [PLUGIN / 'Plugins/MeetingBroadcast.appex/Info.plist', PLUGIN / 'Info.plist',
                PLUGIN / 'UTS.entitlements', Path('nativeResources/ios/ios-extension.json')]
    for relative in required:
        if not (root / relative).is_file():
            errors.append('缺少云打包输入：' + str(relative))
    if errors:
        return errors
    host = plistlib.loads((root / PLUGIN / 'Info.plist').read_bytes())
    extension_dir = root / PLUGIN / 'Plugins/MeetingBroadcast.appex'
    extension = plistlib.loads((extension_dir / 'Info.plist').read_bytes())
    manifest = json.loads((root / 'manifest.json').read_text())
    host.update(CFBundleVersion=manifest['versionCode'], CFBundleShortVersionString=manifest['versionName'])
    check_pair(host, extension, errors)
    group = host.get('RTCAppGroupIdentifier', '')
    ent = plistlib.loads((root / PLUGIN / 'UTS.entitlements').read_bytes())
    if not group or group not in ent.get('com.apple.security.application-groups', []):
        errors.append('主 App UTS.entitlements 缺少共享 App Group')
    if host.get('RTCScreenSharingExtension') != extension.get('CFBundleIdentifier'):
        errors.append('主 App 配置的扩展 ID 不匹配')
    if not (extension_dir / extension.get('CFBundleExecutable', '')).is_file():
        errors.append('广播扩展缺少编译后的可执行文件')
    config = json.loads((root / 'nativeResources/ios/ios-extension.json').read_text()).get('MeetingBroadcast.appex', {})
    if config.get('identifier') != extension.get('CFBundleIdentifier'):
        errors.append('云打包配置的扩展 ID 不匹配')
    profile = root / 'nativeResources/ios' / config.get('profile', '')
    if not profile.is_file():
        errors.append('云打包配置缺少广播扩展描述文件')
    else:
        check_profile(decode_profile(profile.read_bytes()), extension.get('CFBundleIdentifier'), group, errors, '广播扩展 ')
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ipa', type=Path, help='检查实际 IPA；不传则检查云打包输入')
    args = parser.parse_args()
    try:
        if args.ipa:
            errors, metadata = audit_ipa(args.ipa)
            print(json.dumps(metadata, ensure_ascii=False, indent=2))
        else:
            errors = audit_inputs(ROOT)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, subprocess.SubprocessError) as error:
        errors = ['无法完成检查：' + str(error)]
    for error in errors:
        print('[FAIL] ' + error)
    if errors:
        print('整屏共享配置不完整。请先完成 docs/engineering/meeting-whole-screen-sharing.md 中的扩展签名与嵌入步骤；重复打包不会补齐缺项。')
    else:
        print('打包配置检查通过；仍需签名校验及真机验证开始广播、切换其他 App 和接收端画面。')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
