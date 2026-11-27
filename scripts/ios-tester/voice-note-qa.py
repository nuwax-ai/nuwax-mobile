#!/usr/bin/env python3
"""Play synthetic markers and verify which phases an iOS voice note actually captured."""

import argparse
import array
import json
import math
import subprocess
import tempfile
import wave
from datetime import datetime, timezone
from pathlib import Path


SAMPLE_RATE = 16000
MARKERS = {
    "before": (520, 730),
    "during": (840, 1060),
    "after": (1190, 1450),
    "returned": (1590, 1790),
}
DEFAULT_OUTPUT = Path(__file__).resolve().parents[2] / "out" / "ios-voice-note-qa"
WINDOW = 1024


def write_marker(path, frequencies):
    samples = array.array("h")
    for _ in range(4):
        for i in range(SAMPLE_RATE * 4 // 5):
            gain = min(1.0, i / 400, (SAMPLE_RATE * 4 // 5 - i) / 400)
            tone = sum(math.sin(2 * math.pi * hz * i / SAMPLE_RATE) for hz in frequencies)
            samples.append(round(4200 * gain * tone))
        samples.extend([0] * (SAMPLE_RATE // 5))
    with wave.open(str(path), "wb") as output:
        output.setparams((1, 2, SAMPLE_RATE, 0, "NONE", "not compressed"))
        output.writeframes(samples.tobytes())


def generate(folder):
    folder.mkdir(parents=True, exist_ok=True)
    for phase, frequencies in MARKERS.items():
        write_marker(folder / f"{phase}.wav", frequencies)


def log_playback(folder, phase, event):
    row = {"phase": phase, "event": event, "time": datetime.now(timezone.utc).isoformat()}
    with (folder / "playback.jsonl").open("a", encoding="utf-8") as log:
        log.write(json.dumps(row) + "\n")
    print(json.dumps(row), flush=True)


def play(folder, phase, repeat):
    marker = folder / f"{phase}.wav"
    if not marker.exists():
        generate(folder)
    log_playback(folder, phase, "start")
    for _ in range(repeat):
        subprocess.run(["afplay", str(marker)], check=True)
    log_playback(folder, phase, "end")


def power(samples, frequency):
    coefficient = 2 * math.cos(2 * math.pi * frequency / SAMPLE_RATE)
    previous = 0.0
    earlier = 0.0
    for sample in samples:
        current = sample + coefficient * previous - earlier
        earlier, previous = previous, current
    return previous * previous + earlier * earlier - coefficient * previous * earlier


def scan_wav(path):
    detected = {name: [] for name in MARKERS}
    with wave.open(str(path), "rb") as source:
        if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (1, 2, SAMPLE_RATE):
            raise ValueError(f"Expected mono 16 kHz 16-bit PCM: {path}")
        frames = source.getnframes()
        for first in range(0, frames - WINDOW + 1, WINDOW):
            samples = array.array("h", source.readframes(WINDOW))
            energy = sum(sample * sample for sample in samples)
            if energy < WINDOW * 25**2:
                continue
            for phase, (low, high) in MARKERS.items():
                low_power = power(samples, low)
                high_power = power(samples, high)
                if min(low_power, high_power) > energy * WINDOW * 0.045:
                    detected[phase].append(round(first / SAMPLE_RATE, 3))

    # A single coincidental tone in speech or a notification cannot pass the marker check.
    return {
        phase: {"windows": len(offsets), "firstSecond": offsets[0]}
        for phase, offsets in detected.items()
        if len(offsets) >= 5
    }


def scan(path, folder, index):
    if path.suffix.lower() == ".wav":
        return scan_wav(path)
    decoded = folder / f"{index}.wav"
    subprocess.run(
        ["afconvert", "-f", "WAVE", "-d", f"LEI16@{SAMPLE_RATE}", "-c", "1", str(path), str(decoded)],
        check=True,
    )
    return scan_wav(decoded)


def check(files, expectation):
    with tempfile.TemporaryDirectory(prefix="voice-note-qa-") as temp:
        rows = [{"file": str(path), "markers": scan(path, Path(temp), i)} for i, path in enumerate(files)]
    phases = [row["markers"] for row in rows]
    failures = []
    if "before" not in phases[0]:
        failures.append("The first segment does not contain the pre-call marker.")
    if any("during" in markers for markers in phases):
        failures.append("The call-period marker was recorded.")
    if expectation == "background":
        if not any("after" in markers for markers in phases[1:]):
            failures.append("No new segment captured the marker played after hangup, before app re-entry.")
    elif expectation == "foreground":
        if any("after" in markers for markers in phases):
            failures.append("The recording resumed before app re-entry.")
        if not any("returned" in markers for markers in phases[1:]):
            failures.append("No new segment captured the marker after re-entry.")
    else:
        if any("after" in markers or "returned" in markers for markers in phases):
            failures.append("A manually stopped or paused session unexpectedly resumed.")
    print(json.dumps({"passed": not failures, "expectation": expectation, "files": rows, "failures": failures},
                     ensure_ascii=False, indent=2))
    return 1 if failures else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    verbs = parser.add_subparsers(dest="verb", required=True)
    verbs.add_parser("generate")
    playback = verbs.add_parser("play")
    playback.add_argument("phase", choices=MARKERS)
    playback.add_argument("--repeat", type=int, choices=range(1, 11), default=2)
    analysis = verbs.add_parser("check")
    analysis.add_argument("--expect", required=True, choices=("background", "foreground", "no-resume"))
    analysis.add_argument("files", nargs="+", type=Path, help="Recorded segments in chronological order")
    args = parser.parse_args()
    if args.verb == "generate":
        generate(args.out)
        print(args.out)
    elif args.verb == "play":
        play(args.out, args.phase, args.repeat)
    else:
        return check(args.files, args.expect)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
