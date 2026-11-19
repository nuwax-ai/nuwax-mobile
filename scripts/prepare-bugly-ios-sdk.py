#!/usr/bin/env python3
"""Prepare Tencent's pinned Bugly XCFramework for the iOS UTS plugin."""

import argparse
import hashlib
import plistlib
import shutil
import subprocess
import tempfile
from pathlib import Path
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "uni_modules/nuwax-bugly/utssdk/app-ios"
SDK_URL = "https://bugly.qq.com/v2/sdk?id=cfc4620d0250dfae5e066baf227a20f3ef3105d9"
SDK_SHA256 = "dc50994abc7829061e0fe51069c25756eaa00c85929c0919c7c151c8d8989399"
ARCHITECTURES = {"device": ["arm64"], "simulator": ["arm64", "x86_64"]}


def run(*args: str | Path) -> str:
    return subprocess.check_output(args, text=True).strip()


def exported_symbols(archive: Path) -> list[str]:
    # nm also prints archive member headings. Compare only defined external symbols.
    return sorted(line for line in run("xcrun", "nm", "-gjU", archive).splitlines() if line.startswith("_"))


def prepare_framework(archive: Path, scratch: Path) -> Path:
    if hashlib.sha256(archive.read_bytes()).hexdigest() != SDK_SHA256:
        raise ValueError("Bugly iOS SDK SHA-256 does not match the pinned 2.7.1.1 archive")
    with ZipFile(archive) as bundle:
        bundle.extractall(scratch)
    framework = scratch / "Bugly.xcframework"
    info_file = framework / "Info.plist"
    info = plistlib.loads(info_file.read_bytes())

    variants = {entry.get("SupportedPlatformVariant", "device"): entry for entry in info["AvailableLibraries"]}
    if variants.keys() != ARCHITECTURES.keys():
        raise ValueError("Unexpected variants in Bugly XCFramework")
    privacy = (PLUGIN / "PrivacyInfo.xcprivacy").read_bytes()
    for variant, architectures in ARCHITECTURES.items():
        entry = variants[variant]
        folder = framework / entry["LibraryIdentifier"]
        library = folder / entry["LibraryPath"]
        binary = library / "Bugly"
        if (library / "PrivacyInfo.xcprivacy").read_bytes() != privacy:
            raise ValueError("Bugly's SDK privacy manifest changed")

        slices = []
        for architecture in architectures:
            thin = scratch / f"{variant}-{architecture}.a"
            stripped = scratch / f"{variant}-{architecture}-stripped.a"
            run("xcrun", "lipo", binary, "-thin", architecture, "-output", thin)
            run("xcrun", "strip", "-S", "-o", stripped, thin)
            if exported_symbols(thin) != exported_symbols(stripped):
                raise ValueError(f"Stripping debug data changed exported Bugly symbols for {variant}/{architecture}")
            slices.append(stripped)

        if len(slices) == 1:
            shutil.copyfile(slices[0], binary)
        else:
            run("xcrun", "lipo", "-create", *slices, "-output", binary)
        if set(run("xcrun", "lipo", "-archs", binary).split()) != set(architectures):
            raise ValueError(f"Unexpected architectures in the prepared Bugly {variant} binary")

        identifier = "ios-" + "_".join(architectures)
        if variant == "simulator":
            identifier += "-simulator"
        folder.rename(framework / identifier)
        entry["LibraryIdentifier"] = identifier
        entry["SupportedArchitectures"] = architectures

    info_file.write_bytes(plistlib.dumps(info))
    return framework


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", nargs="?", type=Path, help="Use an existing official SDK ZIP instead of downloading it")
    archive = parser.parse_args().archive
    if archive is not None:
        archive = archive.resolve()

    framework_dir = PLUGIN / "Frameworks"
    framework_dir.mkdir(exist_ok=True)
    out = ROOT / "out"
    out.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="bugly-ios-", dir=out) as temporary:
        scratch = Path(temporary)
        if archive is None:
            archive = scratch / "Bugly-iOS.zip"
            run("curl", "--fail", "--silent", "--show-error", "--location", "--retry", "2",
                "--user-agent", "Mozilla/5.0", "--referer", "https://bugly.qq.com/v2/downloads",
                "--output", archive, SDK_URL)
        framework = prepare_framework(archive, scratch)
        destination = framework_dir / framework.name
        previous = scratch / "previous-Bugly.xcframework"
        if destination.exists():
            destination.rename(previous)
        try:
            framework.rename(destination)
        except OSError:
            if previous.exists():
                previous.rename(destination)
            raise
        size = sum(path.stat().st_size for path in destination.rglob("*") if path.is_file())
        print(f"Prepared Bugly iOS 2.7.1.1 ({size:,} bytes): {destination.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
