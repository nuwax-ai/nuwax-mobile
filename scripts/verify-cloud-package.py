#!/usr/bin/env python3
"""Check downloaded cloud packages for resource regressions."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path
from zipfile import BadZipFile, ZipFile

ROOT = Path(__file__).resolve().parents[1]
OFFLINE_MANIFEST = '/static/app/offline-h5/offline-h5-resources.json'
OTHER_PLATFORM_ASSETS = {
    '.apk': ('/static/app-ios/', '/static/app-harmony/', '/static/harmony-icon/',
             '/static/app-icon/launcher-1024.png'),
    '.ipa': ('/static/app-android/', '/static/app-harmony/', '/static/harmony-icon/'),
}


def verify(artifact: Path, expected_manifest: Path | None) -> None:
    package_type = artifact.suffix.lower()
    if package_type not in OTHER_PLATFORM_ASSETS:
        raise ValueError(f'仅支持 APK / IPA：{artifact}')
    with ZipFile(artifact) as package:
        entries = {entry.filename: entry for entry in package.infolist() if not entry.is_dir()}
        for name in entries:
            entry_path = '/' + name
            if any(segment in entry_path for segment in OTHER_PLATFORM_ASSETS[package_type]):
                raise ValueError(f'产物混入非当前平台资源：{name}')
            if '/static/app/offline-h5.installing/' in entry_path or '/static/app/offline-h5.previous/' in entry_path:
                raise ValueError(f'产物混入离线 H5 暂存文件：{name}')

        manifests = [name for name in entries if ('/' + name).endswith(OFFLINE_MANIFEST)]
        if len(manifests) != 1:
            raise ValueError('产物需包含一份离线 H5 资源清单')
        manifest_name = manifests[0]
        manifest = json.loads(package.read(manifest_name))
        if expected_manifest is not None:
            expected = json.loads(expected_manifest.read_text())
            if manifest['resourceVersion'] != expected['resourceVersion']:
                raise ValueError('云包内离线 H5 资源版本与本次准备的清单不一致')
        prefix = manifest_name.rsplit('/', 1)[0] + '/'
        offline = {name for name in entries if name.startswith(prefix)}
        listed = {prefix + entry['path'] for entry in manifest['files']}
        extra = offline - listed - {manifest_name}
        if extra:
            raise ValueError(f'离线 H5 存在清单外文件：{sorted(extra)[0]}')

        if package_type == '.apk':
            cronet_bytes = 0
            for name, entry in entries.items():
                if not name.startswith('lib/') or not name.endswith('.so'):
                    continue
                with package.open(entry) as native:
                    header = native.read(20)
                if not name.startswith('lib/arm64-v8a/') or not (
                    header.startswith(b'\x7fELF\x02\x01') and int.from_bytes(header[18:20], 'little') == 183
                ):
                    raise ValueError(f'APK 原生库不是 ARM64：{name}')
                if re.fullmatch(r'libcronet(?:\..+)?\.so', Path(name).name):
                    cronet_bytes += entry.compress_size
            print(f'[cloud-pack] Cronet 原生库 {cronet_bytes / 1_000_000:.2f} MB')

        offline_bytes = sum(entries[name].compress_size for name in offline)
    subprocess.run(['node', str(ROOT / 'scripts/verify-offline-h5-artifact.mjs'), str(artifact)], check=True)
    print(f'[cloud-pack] {artifact.name} {artifact.stat().st_size / 1_000_000:.2f} MB，离线 H5 {offline_bytes / 1_000_000:.2f} MB')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('artifacts', nargs='+', type=Path)
    parser.add_argument('--offline-manifest', type=Path, help='本次打包工作区生成的离线 H5 资源清单')
    args = parser.parse_args()
    for artifact in args.artifacts:
        try:
            verify(artifact.resolve(), args.offline_manifest)
        except (OSError, ValueError, KeyError, BadZipFile, subprocess.CalledProcessError) as error:
            parser.exit(1, f'[cloud-pack] {artifact.name} 校验失败：{error}\n')


if __name__ == '__main__':
    main()
