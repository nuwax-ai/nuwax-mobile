#!/usr/bin/env python3
"""Restore uni-push dependencies and client configuration for an opted-in local build."""
import json
import os
import re
import xml.etree.ElementTree as ET
from pathlib import Path

ANDROID = "{http://schemas.android.com/apk/res/android}"
TOOLS = "{http://schemas.android.com/tools}"
ET.register_namespace("android", "http://schemas.android.com/apk/res/android")
ET.register_namespace("tools", "http://schemas.android.com/tools")


def clear_previous_configuration(project: Path) -> None:
    gradle = project / "app/build.gradle"
    text = gradle.read_text()
    for marker in ["NUWAX UNIPUSH", "NUWAX PUSH PLACEHOLDERS"]:
        text = re.sub(r"\n\s*// BEGIN " + marker + r".*?// END " + marker + r"\n", "\n", text, flags=re.S)
    gradle.write_text(text)
    manifest = project / "app/src/main/AndroidManifest.xml"
    tree = ET.parse(manifest)
    application = tree.getroot().find("application")
    if application is None:
        raise SystemExit("Android application manifest element is missing")
    owned = any(node.get(ANDROID + "name") == "nuwax.voip.uniPush" for node in application.findall("meta-data"))
    if owned:
        names = {"GETUI_APPID", "PUSH_APPID", "GETUI_APP_ID", "MIPUSH_APPID", "MIPUSH_APPKEY", "dcloud_unipush_auto_notification", "nuwax.voip.uniPush"}
        for node in list(application.findall("meta-data")):
            if node.get(ANDROID + "name") in names:
                application.remove(node)
        tree.write(manifest, encoding="utf-8", xml_declaration=True)


def configure(project: Path, config_file: Path | None) -> None:
    if config_file is None:
        clear_previous_configuration(project)
        return
    config = json.loads(config_file.read_text())
    package = os.environ.get("ANDROID_BUNDLE_ID", "com.nuwax.app")
    if config.get("packageName") != package:
        raise SystemExit("uni-push client configuration does not match the applicationId")
    app_id = config.get("getuiAppId", "")
    if not isinstance(app_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{10,128}", app_id):
        raise SystemExit("A valid uni-push AppID is required")
    clear_previous_configuration(project)

    # Versions from the matching HBuilderX 5.34 Android offline SDK documentation.
    dependencies = [
        "implementation 'com.getui:gtc-dcloud:3.2.16.7'",
        "implementation('com.getui:gtsdk:3.3.7.0') { exclude(group: 'com.getui') }",
    ]
    metadata = {
        "GETUI_APPID": app_id,
        "PUSH_APPID": app_id,
        "GETUI_APP_ID": app_id,
        "dcloud_unipush_auto_notification": "false",
        "nuwax.voip.uniPush": "true",
    }
    xiaomi = config.get("xiaomi")
    if xiaomi is not None:
        for key in ["appId", "appKey"]:
            if not isinstance(xiaomi.get(key), str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,128}", xiaomi[key]):
                raise SystemExit("Xiaomi client AppID and AppKey must both be configured")
        dependencies.append("implementation 'com.getui.opt:xmp:3.3.1'")
        metadata.update({
            "MIPUSH_APPID": xiaomi["appId"],
            "MIPUSH_APPKEY": xiaomi["appKey"],
        })

    gradle = project / "app/build.gradle"
    text = re.sub(r"\n\s*// BEGIN NUWAX UNIPUSH.*?// END NUWAX UNIPUSH\n", "\n", gradle.read_text(), flags=re.S)
    block = "\n    // BEGIN NUWAX UNIPUSH\n    " + "\n    ".join(dependencies) + "\n    // END NUWAX UNIPUSH\n"
    if "dependencies {" not in text:
        raise SystemExit("Android app dependencies block was not found")
    text = text.replace("dependencies {", "dependencies {" + block, 1)
    # Vendor AAR manifests consume placeholders as well as app-level metadata.
    placeholders = {"GETUI_APPID": app_id, "PUSH_APPID": app_id, "GETUI_APP_ID": app_id,
                    "dcloud_unipush_auto_notification": "false"}
    if xiaomi is not None:
        placeholders.update({"XIAOMI_APP_ID": xiaomi["appId"], "XIAOMI_APP_KEY": xiaomi["appKey"]})
    text = re.sub(r"\n\s*// BEGIN NUWAX PUSH PLACEHOLDERS.*?// END NUWAX PUSH PLACEHOLDERS\n", "\n", text, flags=re.S)
    values = ", ".join(json.dumps(key) + ": " + json.dumps(value) for key, value in placeholders.items())
    text = text.replace("defaultConfig {", "defaultConfig {\n        // BEGIN NUWAX PUSH PLACEHOLDERS\n        manifestPlaceholders += [" + values + "]\n        // END NUWAX PUSH PLACEHOLDERS\n", 1)
    gradle.write_text(text)

    settings = project / "settings.gradle"
    text = settings.read_text()
    repository = "https://mvn.getui.com/nexus/content/repositories/releases"
    if repository not in text:
        text = text.replace("repositories {", "repositories {\n        maven { url '" + repository + "' }")
        settings.write_text(text)

    manifest = project / "app/src/main/AndroidManifest.xml"
    tree = ET.parse(manifest)
    application = tree.getroot().find("application")
    if application is None:
        raise SystemExit("Android application manifest element is missing")
    for name, value in metadata.items():
        node = next((item for item in application.findall("meta-data") if item.get(ANDROID + "name") == name), None)
        if node is None:
            node = ET.SubElement(application, "meta-data", {ANDROID + "name": name})
        node.set(ANDROID + "value", value)
        node.set(TOOLS + "replace", "android:value")
    tree.write(manifest, encoding="utf-8", xml_declaration=True)
    print("✓ uni-push client configured; Xiaomi adapter " + ("enabled" if xiaomi else "not configured"))


if __name__ == "__main__":
    config_path = os.environ.get("NUWAX_ANDROID_UNIPUSH_CONFIG")
    configure(Path(os.environ["ANDROID_ESP_PROJECT"]), Path(config_path) if config_path else None)
