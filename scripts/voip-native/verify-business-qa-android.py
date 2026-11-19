#!/usr/bin/env python3
"""Check the signed, standalone real-App APK before offering it for installation."""
import hashlib
import json
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/voip-native/device"))
from android_resources import RESOURCE_PATH, localized_labels

QA = ROOT / "out/voip-business-qa-project"
SDK = ROOT / "out/voip-native-work/android"
PROJECT, = SDK.glob("Android-uni-app-x-SDK@*-5.34/uniappxnativepackage")
APK = Path(sys.argv[1]).resolve()
ORIGIN = "https://testagent.xspaceagi.com"


def run(*args):
    return subprocess.check_output(list(map(str, args)), text=True, stderr=subprocess.STDOUT)


def sha(data):
    return hashlib.sha256(data).hexdigest()


tools = Path(os.environ.get("ANDROID_HOME", str(Path.home() / "workspace/Android/sdk"))) / "build-tools/35.0.0"
os.environ.setdefault("JAVA_HOME", "/opt/homebrew/opt/openjdk@17")
signature = run(tools / "apksigner", "verify", "--verbose", "--print-certs", APK)
cert = re.search(r"Signer #1 certificate SHA-256 digest: ([0-9a-f]+)", signature).group(1)
store = run(Path(os.environ["JAVA_HOME"]) / "bin/keytool", "-list", "-v", "-keystore", os.environ["ANDROID_RELEASE_STORE_FILE"],
            "-storepass:env", "ANDROID_RELEASE_STORE_PASSWORD", "-alias", os.environ["ANDROID_RELEASE_KEY_ALIAS"])
expected_cert = re.search(r"SHA256: ([0-9A-F:]+)", store).group(1).replace(":", "").lower()
assert cert == expected_cert, "APK does not use the controlled existing App signing certificate"
badging = run(tools / "aapt", "dump", "badging", APK)
manifest = json.loads((ROOT / "manifest.json").read_text())
assert "package: name='com.nuwax.app'" in badging
assert f"versionCode='{manifest['versionCode']}'" in badging
assert f"versionName='{manifest['versionName']}'" in badging
assert f"application-label:'{manifest['name']}'" in badging
xml = run(tools / "aapt", "dump", "xmltree", APK, "AndroidManifest.xml")
resources = run(tools / "aapt", "dump", "--values", "resources", APK)
for label in ["nuwax_voip_incoming_channel", "nuwax_voip_ongoing_channel", "音视频通话邀请通知", "通话状态",
              "Audio and video call invitations", "音視訊通話邀請通知", "音視像通話邀請通知"]:
    assert label in resources, f"Missing native notification translation: {label}"
for icon in ["hangup", "phone", "video", "video_off", "switch_camera", "microphone", "microphone_off", "speaker", "minimize"]:
    name = "nuwax_voip_" + icon
    assert f"drawable/{name}" in resources, f"Missing native call drawable: {name}"
    shared = ROOT / "static/voip/call-icons" / (icon.replace("_", "-") + "-white.png")
    native = ROOT / RESOURCE_PATH / "drawable-nodpi" / (name + ".png")
    assert native.read_bytes() == shared.read_bytes(), f"Native call drawable differs from the in-app icon: {name}"
assert "nuwax.voip.qaApiOrigin" in xml and ORIGIN in xml
assert "com.nuwax.voip.VoipUniPushIntentService" in xml
assert "com.igexin.sdk.HonorPushMessageService" in xml and "com.igexin.sdk.HmsPushMessageService" in xml
assert "com.nuwax.voip.VoipIncomingActivity" in xml and "com.nuwax.voip.VoipCallService" in xml
for excluded in ["DCLOUD_DEBUG", "nuwax.voip.deviceTest", 'android:name(0x01010003)="com.nuwax.voip.VoipDevControlService"']:
    assert excluded not in xml, f"Development host declaration remains: {excluded}"
config = (QA / "constants/config.uts").read_text()
assert f'API_BASE_URL = "{ORIGIN}";' in config and f'if (normalized != "{ORIGIN}") return false;' in config
assert 'return supported && getApiBaseUrl() == "https://testagent.xspaceagi.com";' in (QA / "features/voip/callManager.uts").read_text()

with zipfile.ZipFile(APK) as archive:
    assert archive.testzip() is None
    assert archive.read("res/raw/nuwax_voip_ring.wav") == (ROOT / RESOURCE_PATH / "raw/nuwax_voip_ring.wav").read_bytes(), "Missing or stale bundled ringtone"
    assert not any(re.search(r"\.(p8|p12|jks|keystore|mobileprovision)$|local-secrets\.env", name, re.I) for name in archive.namelist())
    assets = QA / "unpackage/resources/app-android/__UNI__8BF05E4/www"
    count = 0
    for path in assets.rglob("*"):
        if path.is_file():
            name = "assets/apps/__UNI__8BF05E4/www/" + path.relative_to(assets).as_posix()
            assert archive.read(name) == path.read_bytes(), f"Stale or missing bundled resource: {name}"
            count += 1
    assert count > 100
    dex = b"".join(archive.read(name) for name in archive.namelist() if re.fullmatch(r"classes[0-9]*\.dex", name))
    for value in [ORIGIN, "Lcom/nuwax/voip/VoipBridge;", "Lcom/nuwax/voip/VoipNativeCallView;", "Lcom/igexin/sdk/HonorPushMessageService;", "Lcom/igexin/sdk/HmsPushMessageService;",
                  "nuwax-voip-incoming-v2", "nuwax-voip-ongoing-v1"]:
        assert value.encode() in dex, f"Missing compiled implementation: {value}"
    assert b"Lio/dcloud/debug/" not in dex, "HX debug server is bundled"

native = ROOT / "uni_modules/nuwax-voip/utssdk/app-android/src/com/nuwax/voip"
for path in native.glob("*.kt"):
    assert path.read_bytes() == (PROJECT / "uts-nuwax-voip/src/main/java/com/nuwax/voip" / path.name).read_bytes(), f"Stale native source: {path.name}"
receiver = ROOT / "uni_modules/nuwax-voip/native/android-unipush/VoipUniPushIntentService.kt"
assert receiver.read_bytes() == (PROJECT / "app/src/main/java/com/nuwax/voip" / receiver.name).read_bytes()
for path, data in localized_labels(ROOT).items():
    assert (ROOT / RESOURCE_PATH / path).read_bytes() == data
    assert (PROJECT / "uts-nuwax-voip/src/main/res" / path).read_bytes() == data
variant = json.loads((QA / "nuwax-local-qa.json").read_text())
result = {**variant, "platform": "android", "packageName": "com.nuwax.app", "versionName": manifest["versionName"],
          "versionCode": str(manifest["versionCode"]), "apk": str(APK), "sha256": sha(APK.read_bytes()),
          "certificateSha256": cert, "bundledResourceCount": count, "hxDebugServer": False,
          "developmentListener": False, "uniPushVendorAdapters": ["huawei", "honor"], "installed": False,
          "incomingNotificationChannel": "nuwax-voip-incoming-v2", "incomingNotificationLabel": "音视频通话邀请通知",
          "ongoingNotificationChannel": "nuwax-voip-ongoing-v1", "bundledRingtone": "res/raw/nuwax_voip_ring.wav",
          "notificationFixes": ["bundledRingtoneAudioAttributes", "preservedUserSoundChoices", "insistentIncomingOnly", "deduplicatedIncomingPublication", "silentCallProgress", "ringingWithoutOwnForegroundServiceOnAndroid12Plus", "presentationDiagnostics"],
          "deviceAcceptance": "pending; lock screen and all-processes-absent wake require real-device evidence"}
Path(str(APK) + ".json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
Path(str(APK) + ".sha256").write_text(result["sha256"] + "  " + APK.name + "\n")
print(json.dumps(result, ensure_ascii=False, indent=2))
