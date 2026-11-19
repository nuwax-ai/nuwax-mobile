#!/usr/bin/env python3
"""Temporarily raise HX's compiler heap for the full App; restore the setting even on failure."""
import re, signal, subprocess, sys
from pathlib import Path

settings = Path.home()/'Library/Application Support/HBuilder X/user/settings.json'
cli = '/Applications/HBuilderX.app/Contents/MacOS/cli'
original = settings.read_bytes()
text = original.decode('utf-8')
pattern = r'("node\.run\.memoryParam"\s*:\s*)("[^"\n]*"|[0-9]+)'
matches = list(re.finditer(pattern, text))
assert len(matches) <= 1, 'Ambiguous HX memory setting; review manually'
previous = matches[0].group(2) if matches else None
cached = subprocess.check_output([cli, 'config', 'get', '--key', 'node.run.memoryParam'], text=True).strip()
assert cached.isdigit(), 'Unexpected HX compiler heap configuration'

def interrupted(_signal, _frame):
    raise KeyboardInterrupt()

signal.signal(signal.SIGTERM, interrupted)
patched = None
try:
    # Editing JSON alone leaves the running extension's configuration cache stale.
    subprocess.run([cli, 'config', 'set', '--key', 'node.run.memoryParam', '--value', '8192', '--type', 'number'], check=True)
    patched = settings.read_text()
    result = subprocess.run([cli, *sys.argv[1:]])
finally:
    current = settings.read_text()
    subprocess.run([cli, 'config', 'set', '--key', 'node.run.memoryParam', '--value', cached, '--type', 'number'], check=True)
    if current == patched:
        settings.write_bytes(original)
    elif previous is not None:
        settings.write_text(re.sub(pattern, lambda m: m.group(1)+previous, current))
    else:
        settings.write_text(re.sub(r'\n?\s*"node\.run\.memoryParam"\s*:\s*8192,?', '', current, count=1))
    print('[voip] HX compiler memory setting restored')
sys.exit(result.returncode)
