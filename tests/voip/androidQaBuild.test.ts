import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('adds a fixed test origin only to the QA host, removes it on a normal rebuild, and rejects a production variant', () => {
  const result = execFileSync('python3', ['-c', `
import importlib.util, json, sys, tempfile
from pathlib import Path
import xml.etree.ElementTree as ET
sys.path.insert(0, sys.argv[1])
spec = importlib.util.spec_from_file_location('android_host', Path(sys.argv[1])/'configure-android.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory); (root/'app/src/main').mkdir(parents=True)
    manifest = root/'app/src/main/AndroidManifest.xml'
    manifest.write_text('<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><meta-data android:name="existing" android:value="kept"/></application></manifest>')
    variant = root/'qa'; variant.mkdir()
    settings = variant/'nuwax-local-qa.json'
    settings.write_text(json.dumps({'flavor':'voip-business-qa','apiOrigin':'https://testagent.xspaceagi.com'}))
    m.configure_qa_manifest(root, variant); m.configure_qa_manifest(root, variant)
    entries = ET.parse(manifest).getroot().find('application').findall('meta-data')
    assert len([n for n in entries if n.get(m.ANDROID+'name') == m.QA_ORIGIN]) == 1
    before = manifest.read_bytes()
    settings.write_text(json.dumps({'flavor':'voip-business-qa','apiOrigin':'https://agent.nuwax.com'}))
    try: m.configure_qa_manifest(root, variant)
    except SystemExit: pass
    else: raise AssertionError('Production origin must fail closed')
    assert manifest.read_bytes() == before
    m.configure_qa_manifest(root, None)
    entries = ET.parse(manifest).getroot().find('application').findall('meta-data')
    assert len(entries) == 1 and entries[0].get(m.ANDROID+'name') == 'existing'
print('QA host origin isolation verified')
`, resolve(import.meta.dirname, '../../scripts/voip-native/device')], { encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  expect(result).toContain('QA host origin isolation verified');
});
