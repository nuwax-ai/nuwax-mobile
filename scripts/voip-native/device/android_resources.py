"""Reproduce VoIP-owned Android resources from the existing mobile translations."""
import json
import re
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path

RESOURCE_PATH = Path("uni_modules/nuwax-voip/utssdk/app-android/res")
LOCALES = {"values": "en-us", "values-zh-rCN": "zh-cn", "values-zh-rTW": "zh-tw", "values-zh-rHK": "zh-hk"}
LABELS = {"nuwax_voip_incoming_channel": "Mobile.Voip.notificationIncoming",
          "nuwax_voip_ongoing_channel": "Mobile.Voip.notificationOngoing"}


def localized_labels(source: Path) -> dict[Path, bytes]:
    result = {}
    for folder, locale in LOCALES.items():
        text = (source / f"constants/i18n-locales/{locale}.uts").read_text()
        root = ET.Element("resources")
        for name, key in LABELS.items():
            matches = re.findall(r'"' + re.escape(key) + r'"\s*:\s*("(?:[^"\\]|\\.)*")', text)
            if len(matches) != 1:
                raise ValueError(f"Expected one translation for {locale}: {key}")
            value = json.loads(matches[0])
            if not value.strip():
                raise ValueError(f"Empty translation for {locale}: {key}")
            # Quoting preserves whitespace; Android string escaping is separate from XML escaping.
            escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("'", "\\'").replace("\n", "\\n")
            ET.SubElement(root, "string", {"name": name, "translatable": "false"}).text = '"' + escaped + '"'
        ET.indent(root)
        result[Path(folder) / "nuwax_voip.xml"] = ET.tostring(root, encoding="utf-8", xml_declaration=True) + b"\n"
    return result


def configure_resources(project: Path, source: Path) -> None:
    module = project / "uts-nuwax-voip/src/main"
    if not module.is_dir():
        raise ValueError("VoIP Android module must be injected before configuring its resources")
    resources = source / RESOURCE_PATH
    ringtone = resources / "raw/nuwax_voip_ring.wav"
    if not ringtone.is_file():
        raise ValueError("Missing bundled VoIP ringtone; run generate-android-ringtone.py")
    labels = localized_labels(source)
    # The tracked resources also support direct HBuilderX plugin packaging / cold start.
    for path, expected in labels.items():
        if not (resources / path).is_file() or (resources / path).read_bytes() != expected:
            raise ValueError("Stale VoIP native translations; run generate-android-ringtone.py")
    shutil.copytree(resources, module / "res", dirs_exist_ok=True)
