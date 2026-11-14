import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('UniPush native call adapter packaging', () => {
  it('rebuilds the same single receiver and restores SDK behavior when disabled', () => {
    const result = execFileSync('python3', ['-c', `
import json, os, sys, tempfile
from pathlib import Path
import xml.etree.ElementTree as ET
sys.path.insert(0, sys.argv[1])
from configure_unipush import configure, ANDROID, TOOLS, CALL_RECEIVER, STOCK_RECEIVER, CALL_RECEIVER_FILE
with tempfile.TemporaryDirectory(prefix='voip-push-build-') as directory:
    root = Path(directory)
    (root / 'app/src/main').mkdir(parents=True)
    (root / 'uts-nuwax-voip').mkdir()
    (root / 'app/build.gradle').write_text('android { defaultConfig { } }\\ndependencies { }\\n')
    (root / 'settings.gradle').write_text('repositories { }\\n')
    manifest = root / 'app/src/main/AndroidManifest.xml'
    manifest.write_text('<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><service android:name="example.OrdinaryService"/></application></manifest>')
    config = root / 'config.json'
    config.write_text(json.dumps({'packageName':'com.nuwax.app','getuiAppId':'fixtureGetuiAppId'}))
    os.environ['ANDROID_BUNDLE_ID'] = 'com.nuwax.app'
    configure(root, config)
    configure(root, config)
    app = ET.parse(manifest).getroot().find('application')
    services = list(app.findall('service'))
    assert len([s for s in services if s.get(ANDROID+'name') == CALL_RECEIVER]) == 1
    assert len([s for s in services if s.get(ANDROID+'name') == STOCK_RECEIVER and s.get(TOOLS+'node') == 'remove']) == 1
    assert 'super.onReceiveMessageData' in (root / CALL_RECEIVER_FILE).read_text()
    assert (root / 'app/build.gradle').read_text().count("com.getui:gtsdk:3.3.7.0") == 1
    configure(root, None)
    app = ET.parse(manifest).getroot().find('application')
    assert [s.get(ANDROID+'name') for s in app.findall('service')] == ['example.OrdinaryService']
    assert not (root / CALL_RECEIVER_FILE).exists()
    assert 'com.getui:gtsdk' not in (root / 'app/build.gradle').read_text()
    (root / 'uts-nuwax-voip').rmdir()
    configure(root, config)
    app = ET.parse(manifest).getroot().find('application')
    assert [s.get(ANDROID+'name') for s in app.findall('service')] == ['example.OrdinaryService']
    assert not (root / CALL_RECEIVER_FILE).exists()
print('adapter packaging and SDK fallback verified')
`, resolve(import.meta.dirname, '../../scripts/voip-native/device')], {
      encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
    expect(result).toContain('adapter packaging and SDK fallback verified');
  });
});
