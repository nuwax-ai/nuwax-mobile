#!/usr/bin/env python3
"""USB installation and bounded evidence for the existing UniPush real-App path.

No permissions/settings are changed. Reclaim uses am kill (cached processes),
never force-stop, and is refused while a call service is running.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = "com.nuwax.app"
APK = ROOT / "out/voip-business-packages/Nuwax-VoIP-Test-latest.apk"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("action", choices=["install", "snapshot", "reclaim", "logs"])
parser.add_argument("--device", help="ADB serial; required when multiple Android devices are connected")
parser.add_argument("--label", default="manual")
args = parser.parse_args()
adb = Path(os.environ.get("ADB", str(Path.home() / "Library/Android/sdk/platform-tools/adb")))
if not adb.is_file():
    adb = Path.home() / "workspace/Android/sdk/platform-tools/adb"


def command(*values, check=True):
    result = subprocess.run([str(adb), *values], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if check and result.returncode:
        raise SystemExit(result.stdout.strip())
    return result.stdout.strip()


devices = [line.split()[0] for line in command("devices").splitlines()[1:] if len(line.split()) >= 2 and line.split()[1] == "device"]
device = args.device or (devices[0] if len(devices) == 1 else None)
if device is None or device not in devices:
    raise SystemExit("Connect and authorize the Honor/Huawei Android phone; specify --device when multiple devices are connected.")


def shell(*values, check=True):
    return command("-s", device, "shell", *values, check=check)


manufacturer = shell("getprop", "ro.product.manufacturer")
if manufacturer.lower() not in ["honor", "huawei"]:
    raise SystemExit("This handoff targets Honor/Huawei Android; detected manufacturer: " + manufacturer)
evidence = ROOT / "out" / ("voip-android-qa-" + time.strftime("%Y%m%d"))
evidence.mkdir(exist_ok=True)


def snapshot(label):
    process_lines = shell("ps", "-A", "-o", "PID,NAME").splitlines()
    processes = [line.strip() for line in process_lines if re.search(r"\scom\.nuwax\.app(?::[^\s]+)?$", line)]
    dump = shell("dumpsys", "package", PACKAGE, check=False)
    users = re.findall(r"User (\d+):[^\n]*stopped=(true|false)", dump)
    platform_sdk = int(shell("getprop", "ro.build.version.sdk"))
    window = shell("dumpsys", "window", "policy", check=False)
    lock = [line.strip() for line in window.splitlines() if re.search(r"(?:showing|keyguard|lockscreen)\w*=(?:true|false)", line, re.I)]
    result = {"time": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "label": label,
              "manufacturer": manufacturer, "model": shell("getprop", "ro.product.model"),
              "android": shell("getprop", "ro.build.version.release"), "sdk": str(platform_sdk),
              "magicVersion": shell("getprop", "ro.build.version.magic"), "emuiVersion": shell("getprop", "ro.build.version.emui"),
              "processes": processes, "allAppProcessesAbsent": not processes, "currentUser": shell("am", "get-current-user"), "stoppedByUser": dict(users),
              "keyguard": lock,
              "fullScreenManifestPermission": bool(re.search(r"android\.permission\.USE_FULL_SCREEN_INTENT: granted=true", dump)),
              "fullScreenAppOpApplicable": platform_sdk >= 34,
              "presentationAppOps": shell("cmd", "appops", "get", PACKAGE, "USE_FULL_SCREEN_INTENT", check=False)
                  if platform_sdk >= 34 else "not applicable before Android 14; manufacturer presentation policy still requires device verification"}
    label = re.sub(r"[^a-zA-Z0-9_-]", "_", label)
    output = evidence / (time.strftime("%H%M%S") + "-" + label + ".json")
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({**result, "evidence": str(output)}, ensure_ascii=False, indent=2))
    return result


if args.action == "install":
    artifact = APK.resolve(strict=True)
    meta = json.loads(Path(str(artifact) + ".json").read_text())
    assert meta["packageName"] == PACKAGE and meta["apiOrigin"] == "https://testagent.xspaceagi.com"
    assert hashlib.sha256(artifact.read_bytes()).hexdigest() == meta["sha256"], "APK changed since verification"
    build_tools = Path.home() / "workspace/Android/sdk/build-tools/35.0.0"
    env = {**os.environ, "JAVA_HOME": os.environ.get("JAVA_HOME", "/opt/homebrew/opt/openjdk@17")}
    def cert(path):
        output = subprocess.check_output([str(build_tools / "apksigner"), "verify", "--print-certs", str(path)], text=True, env=env)
        return re.search(r"Signer #1 certificate SHA-256 digest: ([0-9a-f]+)", output).group(1)
    assert cert(artifact) == meta["certificateSha256"]
    existing = shell("pm", "path", PACKAGE, check=False)
    paths = [line.removeprefix("package:") for line in existing.splitlines() if line.startswith("package:")]
    if paths:
        old = evidence / "existing-base.apk"
        try:
            command("-s", device, "pull", next((path for path in paths if path.endswith('/base.apk')), paths[0]), str(old))
            assert cert(old) == meta["certificateSha256"], "Existing App signature differs; preserve data and stop"
        finally:
            old.unlink(missing_ok=True)
    print(command("-s", device, "install", "-r", "-d", str(artifact)))
    installed = shell("dumpsys", "package", PACKAGE)
    assert re.search(r"\bversionCode=" + re.escape(meta["versionCode"]) + r"\b", installed)
    paths = [line.removeprefix("package:") for line in shell("pm", "path", PACKAGE).splitlines() if line.startswith("package:")]
    installed_hash = shell("sha256sum", next((path for path in paths if path.endswith('/base.apk')), paths[0])).split()[0]
    assert installed_hash == meta["sha256"], "Installed APK differs from the verified test artifact"
    badging = subprocess.check_output([str(build_tools / "aapt"), "dump", "badging", str(artifact)], text=True)
    activity = re.search(r"launchable-activity: name='([^']+)'", badging).group(1)
    print(shell("am", "start", "-n", PACKAGE + "/" + activity))
    snapshot("installed-test-environment")
elif args.action == "snapshot":
    snapshot(args.label)
elif args.action == "reclaim":
    state = snapshot("before-controlled-reclaim")
    assert state["stoppedByUser"].get(state["currentUser"]) == "false", "Already force-stopped or unverified; not a reclaim test"
    services = shell("dumpsys", "activity", "services", PACKAGE)
    assert not re.search(r"ServiceRecord\{[^\n]*(?:VoipCallService|VoipDevControlService)", services), "Finish the call/listener first; do not interrupt a call"
    shell("am", "kill", PACKAGE)
    time.sleep(1)
    result = snapshot("after-controlled-reclaim")
    if not result["allAppProcessesAbsent"]:
        raise SystemExit("App processes remain; do not classify this as an all-processes-absent wake test. No stronger kill or force-stop was used.")
    assert result["stoppedByUser"].get(result["currentUser"]) == "false"
    print("Controlled cached-process reclaim only. Natural system reclaim must be recorded separately. Do not open the App before the incoming call.")
else:
    output = evidence / (time.strftime("%H%M%S") + "-native-call-stages.log")
    print("Recording credential-free NuwaxVoip lifecycle stages; Ctrl+C stops: " + str(output), flush=True)
    with output.open("w") as handle:
        try:
            subprocess.run([str(adb), "-s", device, "logcat", "-v", "threadtime", "-T", "1", "NuwaxVoip:D", "*:S"], stdout=handle, check=True)
        except KeyboardInterrupt:
            pass
