#!/usr/bin/env python3
"""Check installed artifact contents for Nuwax IM VoIP and meeting runtime code."""

import argparse
import hashlib
import plistlib
import re
import sys
import zipfile
from pathlib import Path


IDENTIFIERS = re.compile(
    rb"nuwax[._/-]?(?:voip|livekit)"
    rb"|io[./]livekit|liblivekit|LiveKitWebRTC|VoipUniPushIntentService"
    rb"|VivoVoipPushMessageReceiver|static[/\\]app[/\\]voip"
    rb"|NuwaxVoipMediaAbility|PKPushRegistry|LiveCommunicationKit",
    re.IGNORECASE,
)
CALL_PERMISSIONS = ("MANAGE_OWN_CALLS", "FOREGROUND_SERVICE_PHONE_CALL", "USE_FULL_SCREEN_INTENT")
PAYLOADS = {".dex", ".abc", ".js", ".json", ".plist", ".xml", ".so", ".jar", ".arsc", ".pb", ".bc", ".bytes"}


def binary_match(stream, manifest=False):
    tail = b""
    while chunk := stream.read(1024 * 1024):
        data = tail + chunk
        match = IDENTIFIERS.search(data)
        if match:
            return match.group().decode("ascii")
        if manifest:
            for permission in CALL_PERMISSIONS:
                if any(permission.encode(encoding) in data for encoding in ("ascii", "utf-16le")):
                    return permission
        tail = data[-256:]
    return None


def findings(package):
    with zipfile.ZipFile(package) as archive:
        files = [entry for entry in archive.infolist() if not entry.is_dir()]
        names = {entry.filename for entry in files}
        if package.suffix == ".ipa":
            root_plists = [name for name in names if re.fullmatch(r"Payload/[^/]+\.app/Info\.plist", name)]
            if len(root_plists) != 1:
                raise ValueError("IPA 必须包含一个主 App Info.plist")
            info = plistlib.loads(archive.read(root_plists[0]))
            executable = root_plists[0].rsplit("/", 1)[0] + "/" + info["CFBundleExecutable"]
            if executable not in names:
                raise ValueError("找不到 IPA 主程序")
            if "voip" in info.get("UIBackgroundModes", ()):
                yield root_plists[0], "UIBackgroundModes.voip"
        else:
            executable = ""
            if not any(name.endswith("AndroidManifest.xml") for name in names):
                raise ValueError("APK/AAB 缺少 AndroidManifest.xml")

        for entry in files:
            name = entry.filename
            match = IDENTIFIERS.search(name.encode())
            if match:
                yield name, match.group().decode("ascii")
                continue
            native = "/Frameworks/" in name or name.endswith("/" + Path(name).parent.stem)
            if name != executable and not native and Path(name).suffix not in PAYLOADS:
                continue
            with archive.open(entry) as content:
                marker = binary_match(content, manifest=name.endswith("AndroidManifest.xml"))
            if marker:
                yield name, marker


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path, nargs="+")
    args = parser.parse_args()
    failed = False
    for package in args.package:
        try:
            if package.suffix not in {".apk", ".aab", ".ipa"}:
                raise ValueError("请传入 APK、AAB 或 IPA")
            matches = list(findings(package))
            if matches:
                failed = True
                for name, marker in matches:
                    print(f"{package}: {marker} in {name}", file=sys.stderr)
                continue
            with package.open("rb") as stream:
                digest = hashlib.sha256()
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
            print(f"{digest.hexdigest()}  {package}  已通过 VoIP 特征检查")
        except (OSError, ValueError, KeyError, zipfile.BadZipFile, plistlib.InvalidFileException) as error:
            failed = True
            print(f"{package}: {error}", file=sys.stderr)
    return int(failed)


if __name__ == "__main__":
    sys.exit(main())
