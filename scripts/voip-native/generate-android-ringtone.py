#!/usr/bin/env python3
"""Generate an original, deterministic incoming-call chime (PCM WAV, no downloaded media)."""
import math
import struct
import sys
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / 'device'))
from android_resources import RESOURCE_PATH, localized_labels

source = Path(__file__).resolve().parents[2]
target = source / RESOURCE_PATH / 'raw/nuwax_voip_ring.wav'
target.parent.mkdir(parents=True, exist_ok=True)
rate = 22050
frames = bytearray()
for sample in range(rate * 4):
    t = sample / rate
    value = 0.0
    for start, frequency in [(0.0, 660.0), (0.22, 880.0), (0.44, 1100.0), (1.1, 660.0), (1.32, 880.0), (1.54, 1100.0)]:
        local = t - start
        if 0 <= local < 0.5:
            envelope = min(local / 0.012, 1.0) * math.exp(-local * 8) * min((0.5-local)/0.02, 1.0)
            value += 0.24 * envelope * (math.sin(2*math.pi*frequency*local) + 0.18*math.sin(4*math.pi*frequency*local))
    frames.extend(struct.pack('<h', round(max(-1, min(1, value)) * 32767)))
with wave.open(str(target), 'wb') as audio:
    audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(rate); audio.writeframes(frames)
print('Generated original four-second incoming-call chime: ' + str(target))
for path, data in localized_labels(source).items():
    destination = source / RESOURCE_PATH / path
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
print('Generated native call notification labels from the four mobile locales')
