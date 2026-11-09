#!/usr/bin/env python3
"""Own all Android test-host additions, including cleanup when leaving test mode."""
import os
import xml.etree.ElementTree as ET
from pathlib import Path

from configure_unipush import ANDROID, configure

LISTENER = "com.nuwax.voip.VoipDevControlService"
MARKER = "nuwax.voip.deviceTest"
PERMISSION = "android.permission.FOREGROUND_SERVICE_SPECIAL_USE"


def configure_test_manifest(manifest: Path, enabled: bool) -> None:
    if enabled and os.environ.get("ANDROID_BUILD_TYPE", "debug").lower() != "debug":
        raise SystemExit("VoIP device listener requires a Debug build")
    tree = ET.parse(manifest)
    root = tree.getroot()
    application = root.find("application")
    if application is None:
        raise SystemExit("Android application manifest element is missing")
    owned_services = [node for node in application.findall("service") if node.get(ANDROID + "name") == LISTENER]
    owned_markers = [node for node in application.findall("meta-data") if node.get(ANDROID + "name") == MARKER]
    if not enabled and not owned_services and not owned_markers:
        return
    for node in owned_services + owned_markers:
        application.remove(node)
    if owned_services:
        for node in list(root.findall("uses-permission")):
            if node.get(ANDROID + "name") == PERMISSION:
                root.remove(node)
    if enabled:
        if not any(node.get(ANDROID + "name") == PERMISSION for node in root.findall("uses-permission")):
            ET.SubElement(root, "uses-permission", {ANDROID + "name": PERMISSION})
        ET.SubElement(application, "meta-data", {ANDROID + "name": MARKER, ANDROID + "value": "true"})
        service = ET.SubElement(application, "service", {
            ANDROID + "name": LISTENER,
            ANDROID + "exported": "false",
            ANDROID + "foregroundServiceType": "specialUse",
        })
        ET.SubElement(service, "property", {
            ANDROID + "name": "android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE",
            ANDROID + "value": "User-enabled incoming-call QA control connection in a dedicated development test package",
        })
    tree.write(manifest, encoding="utf-8", xml_declaration=True)


def configure_test_host(project: Path, enabled: bool) -> None:
    # Earlier test builds placed these declarations in the SDK library manifest.
    # Remove that owned state before configuring the application manifest.
    legacy = project / "uniappx/src/main/AndroidManifest.xml"
    if legacy.exists():
        configure_test_manifest(legacy, False)
    configure_test_manifest(project / "app/src/main/AndroidManifest.xml", enabled)


if __name__ == "__main__":
    project = Path(os.environ["ANDROID_ESP_PROJECT"])
    enabled = os.environ.get("NUWAX_VOIP_DEVICE_TEST") == "1"
    config_path = os.environ.get("NUWAX_ANDROID_UNIPUSH_CONFIG")
    configure_test_host(project, enabled)
    configure(project, Path(config_path) if config_path else None)
