#!/usr/bin/env python3
"""Restore uni-push dependencies and client configuration for an opted-in local build."""
from __future__ import annotations

import json
import os
import re
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path

ANDROID = "{http://schemas.android.com/apk/res/android}"
TOOLS = "{http://schemas.android.com/tools}"
STOCK_RECEIVER = "uts.sdk.modules.DCloudUniPush.UniPushIntentService"
CALL_RECEIVER = "com.nuwax.voip.VoipUniPushIntentService"
CALL_RECEIVER_FILE = "app/src/main/java/com/nuwax/voip/VoipUniPushIntentService.kt"
VIVO_STOCK_RECEIVER = "com.igexin.sdk.VivoPushMessageReceiver"
VIVO_PUSH_RECEIVER = "com.nuwax.voip.VivoVoipPushMessageReceiver"
VIVO_CALL_RECEIVER = "com.nuwax.voip.VivoVoipCallReceiver"
VIVO_RECEIVER_FILE = "app/src/main/java/com/nuwax/voip/VivoVoipPushMessageReceiver.kt"
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
    owned = any(node.get(ANDROID + "name") == "nuwax.voip.uniPush" for node in application.findall("meta-data")) or any(
        node.get(ANDROID + "name") == CALL_RECEIVER for node in application.findall("service")
    )
    if owned:
        names = {"GETUI_APPID", "PUSH_APPID", "GETUI_APP_ID", "MIPUSH_APPID", "MIPUSH_APPKEY", "com.huawei.hms.client.appid", "com.hihonor.push.app_id", "dcloud_unipush_auto_notification", "nuwax.voip.uniPush", "com.vivo.push.app_id", "com.vivo.push.api_key"}
        names.update(("OPPOPUSH_APPKEY", "OPPOPUSH_APPSECRET"))
        for node in list(application.findall("meta-data")):
            if node.get(ANDROID + "name") in names:
                application.remove(node)
        for node in list(application.findall("service")):
            if node.get(ANDROID + "name") == CALL_RECEIVER or (
                node.get(ANDROID + "name") == STOCK_RECEIVER and node.get(TOOLS + "node") == "remove"
            ):
                application.remove(node)
        for node in list(application.findall("receiver")):
            if node.get(ANDROID + "name") in (VIVO_PUSH_RECEIVER, VIVO_CALL_RECEIVER) or (
                node.get(ANDROID + "name") == VIVO_STOCK_RECEIVER and node.get(TOOLS + "node") == "remove"
            ):
                application.remove(node)
        (project / CALL_RECEIVER_FILE).unlink(missing_ok=True)
        (project / VIVO_RECEIVER_FILE).unlink(missing_ok=True)
        tree.write(manifest, encoding="utf-8", xml_declaration=True)


def configure(project: Path, config_file: Path | None, *, enable_vivo_voip: bool = False) -> None:
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

    oppo = config.get("oppo")
    if oppo is not None:
        if not isinstance(oppo, dict) or any(
            not isinstance(oppo.get(key), str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,128}", oppo[key])
            for key in ("appKey", "appSecret")
        ):
            raise SystemExit("OPPO Android SDK client AppKey and AppSecret must both be configured")
        dependencies.append("implementation 'com.assist-v3:oppo:3.4.0'")
        metadata.update({"OPPOPUSH_APPKEY": "${OPPO_APP_KEY}", "OPPOPUSH_APPSECRET": "${OPPO_APP_SECRET}"})

    vivo = config.get("vivo")
    voip_module = (project / "uts-nuwax-voip").is_dir()
    vivo_voip = enable_vivo_voip and vivo is not None and voip_module
    if vivo is not None:
        app_id_vivo = vivo.get("appId") if isinstance(vivo, dict) else None
        app_key_vivo = vivo.get("appKey") if isinstance(vivo, dict) else None
        if not isinstance(app_id_vivo, str) or not re.fullmatch(r"[0-9]{5,20}", app_id_vivo):
            raise SystemExit("A valid vivo client AppID is required")
        if not isinstance(app_key_vivo, str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,128}", app_key_vivo):
            raise SystemExit("A valid vivo client AppKey is required")
        vivo_version = "3.3.0" if vivo_voip else "3.1.2"
        dependencies.append(f"implementation 'com.assist-v3:vivo:{vivo_version}'")
        # The vivo SDK reads these before the adapter's app_id and api_key aliases.
        metadata.update({"com.vivo.push.app_id": "${VIVO_APP_ID}", "com.vivo.push.api_key": "${VIVO_APP_KEY}"})

    gradle = project / "app/build.gradle"
    text = re.sub(r"\n\s*// BEGIN NUWAX UNIPUSH.*?// END NUWAX UNIPUSH\n", "\n", gradle.read_text(), flags=re.S)
    if "dependencies {" not in text:
        raise SystemExit("Android app dependencies block was not found")
    # Vendor AAR manifests consume placeholders as well as app-level metadata.
    placeholders = {"GETUI_APPID": app_id, "PUSH_APPID": app_id, "GETUI_APP_ID": app_id,
                    "dcloud_unipush_auto_notification": "false"}
    if oppo is not None:
        placeholders.update({"OPPO_APP_KEY": oppo["appKey"], "OPPO_APP_SECRET": oppo["appSecret"]})
    if vivo is not None:
        placeholders.update({"VIVO_APP_ID": app_id_vivo, "VIVO_APP_KEY": app_key_vivo})
    # Existing UniPush vendor channels; client AppIDs are supplied locally, never server secrets.
    vendor_repositories = []
    for vendor, placeholder, name, libraries, repository in [
        ("huawei", "HUAWEI_APP_ID", "com.huawei.hms.client.appid",
         ["com.getui.opt:hwp:3.1.4", "com.huawei.hms:push:6.12.0.300"], "https://developer.huawei.com/repo/"),
        ("honor", "HONOR_APP_ID", "com.hihonor.push.app_id",
         ["com.getui.opt:honor:3.6.0", "com.hihonor.mcs:push:7.0.61.303"], "https://developer.hihonor.com/repo/"),
    ]:
        entry = config.get(vendor)
        if entry is None:
            continue
        value = entry.get("appId") if isinstance(entry, dict) else None
        if not isinstance(value, str) or not re.fullmatch(r"[0-9]{5,20}", value):
            raise SystemExit(f"A valid {vendor} client AppID is required")
        # Both SDKs accept the manifest configuration used by the existing cloud package.
        placeholders[placeholder] = "appid=" + value if vendor == "huawei" else value
        metadata[name] = placeholders[placeholder]
        dependencies.extend("implementation '" + library + "'" for library in libraries)
        vendor_repositories.append(repository)
    # Build the dependency block after optional vendor dependencies have been collected.
    block = "\n    // BEGIN NUWAX UNIPUSH\n    " + "\n    ".join(dependencies) + "\n    // END NUWAX UNIPUSH\n"
    text = text.replace("dependencies {", "dependencies {" + block, 1)
    if xiaomi is not None:
        placeholders.update({"XIAOMI_APP_ID": xiaomi["appId"], "XIAOMI_APP_KEY": xiaomi["appKey"]})
    text = re.sub(r"\n\s*// BEGIN NUWAX PUSH PLACEHOLDERS.*?// END NUWAX PUSH PLACEHOLDERS\n", "\n", text, flags=re.S)
    values = ", ".join(json.dumps(key) + ": " + json.dumps(value) for key, value in placeholders.items())
    text = text.replace("defaultConfig {", "defaultConfig {\n        // BEGIN NUWAX PUSH PLACEHOLDERS\n        manifestPlaceholders += [" + values + "]\n        // END NUWAX PUSH PLACEHOLDERS\n", 1)
    gradle.write_text(text)

    settings = project / "settings.gradle"
    text = settings.read_text()
    for repository in ["https://mvn.getui.com/nexus/content/repositories/releases", *vendor_repositories]:
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
    # Getui 3.x discovers the one GTIntentService declared in the merged manifest.
    # Its subclass keeps UniPush behavior and can receive before UTS/JS is resumed.
    if voip_module:
        source = Path(__file__).resolve().parents[3] / "uni_modules/nuwax-voip/native/android-unipush"
        target = project / CALL_RECEIVER_FILE
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / target.name, target)
        ET.SubElement(application, "service", {ANDROID + "name": STOCK_RECEIVER, TOOLS + "node": "remove"})
        ET.SubElement(application, "service", {ANDROID + "name": CALL_RECEIVER, ANDROID + "exported": "false"})
        if vivo_voip:
            target = project / VIVO_RECEIVER_FILE
            shutil.copyfile(source / target.name, target)
            ET.SubElement(application, "receiver", {ANDROID + "name": VIVO_STOCK_RECEIVER, TOOLS + "node": "remove"})
            receiver = ET.SubElement(application, "receiver", {
                ANDROID + "name": VIVO_PUSH_RECEIVER, ANDROID + "exported": "false", ANDROID + "process": ":pushservice"
            })
            intent_filter = ET.SubElement(receiver, "intent-filter")
            ET.SubElement(intent_filter, "action", {ANDROID + "name": "com.vivo.pushclient.action.RECEIVE"})
            ET.SubElement(application, "receiver", {ANDROID + "name": VIVO_CALL_RECEIVER, ANDROID + "exported": "false"})
    tree.write(manifest, encoding="utf-8", xml_declaration=True)
    print("✓ uni-push client configured; vendor adapters: " + ", ".join(vendor for vendor in ["huawei", "honor", "xiaomi", "vivo", "oppo"] if config.get(vendor)))


if __name__ == "__main__":
    config_path = os.environ.get("NUWAX_ANDROID_UNIPUSH_CONFIG")
    configure(Path(os.environ["ANDROID_ESP_PROJECT"]), Path(config_path) if config_path else None)
