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
    for origin in ['http://test.example', 'https://test.example/path', 'https://test.example?query']:
        try: m.configure_qa_manifest(root, None, origin)
        except SystemExit: pass
        else: raise AssertionError('Release policy must require an exact HTTPS origin')
    m.configure_qa_manifest(root, None, 'https://test.example')
    entries = ET.parse(manifest).getroot().find('application').findall('meta-data')
    assert [n.get(m.ANDROID+'value') for n in entries if n.get(m.ANDROID+'name') == m.RELEASE_ORIGIN] == ['https://test.example']
    m.configure_qa_manifest(root, None)
    entries = ET.parse(manifest).getroot().find('application').findall('meta-data')
    assert all(n.get(m.ANDROID+'name') != m.RELEASE_ORIGIN for n in entries)
print('QA host origin isolation verified')
`, resolve(import.meta.dirname, '../../scripts/voip-native/device')], { encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  expect(result).toContain('QA host origin isolation verified');
});

it('packages a playable bundled ringtone and four localized channel names, and rejects stale translations', () => {
  const result = execFileSync('python3', ['-c', `
import array, math, shutil, sys, tempfile, wave
from pathlib import Path
import xml.etree.ElementTree as ET
sys.path.insert(0, sys.argv[1])
from android_resources import RESOURCE_PATH, LOCALES, configure_resources, localized_labels
source = Path(sys.argv[2])
with wave.open(str(source/RESOURCE_PATH/'raw/nuwax_voip_ring.wav')) as audio:
    assert (audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getnframes()) == (1, 2, 22050, 88200)
    samples = array.array('h', audio.readframes(audio.getnframes()))
    if sys.byteorder != 'little': samples.byteswap()
    assert max(map(abs, samples)) < 32767
    assert math.sqrt(sum(sample*sample for sample in samples)/len(samples)) > 500
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory); project = root/'build'; fixture = root/'source'
    (project/'uts-nuwax-voip/src/main').mkdir(parents=True)
    shutil.copytree(source/RESOURCE_PATH, fixture/RESOURCE_PATH)
    shutil.copytree(source/'constants/i18n-locales', fixture/'constants/i18n-locales')
    configure_resources(project, fixture)
    native = project/'uts-nuwax-voip/src/main/res'
    assert (native/'raw/nuwax_voip_ring.wav').read_bytes() == (source/RESOURCE_PATH/'raw/nuwax_voip_ring.wav').read_bytes()
    before = {str(path): path.read_bytes() for path in native.rglob('*') if path.is_file()}
    configure_resources(project, fixture)
    assert before == {str(path): path.read_bytes() for path in native.rglob('*') if path.is_file()}
    assert len(localized_labels(fixture)) == len(LOCALES) == 4
    chinese = ET.parse(native/'values-zh-rCN/nuwax_voip.xml').getroot()
    assert chinese.find("string[@name='nuwax_voip_incoming_channel']").text == '"音视频通话邀请通知"'
    assert chinese.find("string[@name='nuwax_voip_ongoing_channel']").text == '"通话状态"'
    (fixture/RESOURCE_PATH/'values-zh-rCN/nuwax_voip.xml').write_text('<resources/>')
    try: configure_resources(project, fixture)
    except ValueError as error: assert 'Stale' in str(error)
    else: raise AssertionError('Stale native labels must fail packaging')
    (fixture/'constants/i18n-locales/zh-cn.uts').write_text('export const I18N_ZH_CN = {}')
    try: localized_labels(fixture)
    except ValueError as error: assert 'Expected one translation' in str(error)
    else: raise AssertionError('Missing canonical labels must fail packaging')
print('Native notification resources verified')
`, resolve(import.meta.dirname, '../../scripts/voip-native/device'), resolve(import.meta.dirname, '../..')],
    { encoding: 'utf8', timeout: 10_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  expect(result).toContain('Native notification resources verified');
});
