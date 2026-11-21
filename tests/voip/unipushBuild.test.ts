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
from configure_unipush import VIVO_STOCK_RECEIVER, VIVO_PUSH_RECEIVER, VIVO_CALL_RECEIVER, VIVO_RECEIVER_FILE
with tempfile.TemporaryDirectory(prefix='voip-push-build-') as directory:
    root = Path(directory)
    (root / 'app/src/main').mkdir(parents=True)
    (root / 'uts-nuwax-voip').mkdir()
    (root / 'app/build.gradle').write_text('android { defaultConfig { } }\\ndependencies { }\\n')
    (root / 'settings.gradle').write_text('repositories { }\\n')
    manifest = root / 'app/src/main/AndroidManifest.xml'
    manifest.write_text('<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><meta-data android:name="com.vivo.push.app_id" android:value="111"/><meta-data android:name="com.vivo.push.api_key" android:value="111"/><service android:name="example.OrdinaryService"/></application></manifest>')
    config = root / 'config.json'
    config.write_text(json.dumps({'packageName':'com.nuwax.app','getuiAppId':'fixtureGetuiAppId',
        'huawei':{'appId':'123456789'}, 'honor':{'appId':'987654321'},
        'vivo':{'appId':'567891234', 'appKey':'fixtureVivoAppKey'}}))
    os.environ['ANDROID_BUNDLE_ID'] = 'com.nuwax.app'
    configure(root, config)
    configure(root, config)
    app = ET.parse(manifest).getroot().find('application')
    services = list(app.findall('service'))
    assert len([s for s in services if s.get(ANDROID+'name') == CALL_RECEIVER]) == 1
    assert len([s for s in services if s.get(ANDROID+'name') == STOCK_RECEIVER and s.get(TOOLS+'node') == 'remove']) == 1
    assert 'super.onReceiveMessageData' in (root / CALL_RECEIVER_FILE).read_text()
    assert (root / 'app/build.gradle').read_text().count("com.getui:gtsdk:3.3.7.0") == 1
    gradle = (root / 'app/build.gradle').read_text()
    assert gradle.count('com.getui.opt:hwp:3.1.4') == 1
    assert gradle.count('com.getui.opt:honor:3.6.0') == 1
    assert gradle.count('com.assist-v3:vivo:3.1.2') == 1
    assert '"HUAWEI_APP_ID": "appid=123456789"' in gradle
    assert '"HONOR_APP_ID": "987654321"' in gradle
    assert '"VIVO_APP_ID": "567891234"' in gradle
    assert '"VIVO_APP_KEY": "fixtureVivoAppKey"' in gradle
    assert 'https://developer.hihonor.com/repo/' in (root / 'settings.gradle').read_text()
    metadata = {n.get(ANDROID+'name'):n.get(ANDROID+'value') for n in app.findall('meta-data')}
    assert metadata['com.huawei.hms.client.appid'] == 'appid=123456789'
    assert metadata['com.hihonor.push.app_id'] == '987654321'
    assert metadata['com.vivo.push.app_id'] == '\${VIVO_APP_ID}'
    assert metadata['com.vivo.push.api_key'] == '\${VIVO_APP_KEY}'
    configure(root, config, enable_vivo_voip=True)
    configure(root, config, enable_vivo_voip=True)
    app = ET.parse(manifest).getroot().find('application')
    names = [r.get(ANDROID+'name') for r in app.findall('receiver')]
    assert names == [VIVO_STOCK_RECEIVER, VIVO_PUSH_RECEIVER, VIVO_CALL_RECEIVER]
    stock, push, call = app.findall('receiver')
    assert stock.get(TOOLS+'node') == 'remove'
    assert push.get(ANDROID+'process') == ':pushservice'
    assert push.find('intent-filter/action').get(ANDROID+'name') == 'com.vivo.pushclient.action.RECEIVE'
    assert call.get(ANDROID+'exported') == 'false' and call.get(ANDROID+'process') is None
    assert (root / VIVO_RECEIVER_FILE).is_file()
    assert (root / 'app/build.gradle').read_text().count('com.assist-v3:vivo:3.3.0') == 1
    configure(root, config)
    app = ET.parse(manifest).getroot().find('application')
    assert not app.findall('receiver') and not (root / VIVO_RECEIVER_FILE).exists()
    assert (root / 'app/build.gradle').read_text().count('com.assist-v3:vivo:3.1.2') == 1
    configure(root, None)
    app = ET.parse(manifest).getroot().find('application')
    assert [s.get(ANDROID+'name') for s in app.findall('service')] == ['example.OrdinaryService']
    assert not (root / CALL_RECEIVER_FILE).exists()
    assert 'com.getui:gtsdk' not in (root / 'app/build.gradle').read_text()
    assert 'com.getui.opt:honor' not in (root / 'app/build.gradle').read_text()
    assert 'com.assist-v3:vivo' not in (root / 'app/build.gradle').read_text()
    assert 'VIVO_APP_' not in (root / 'app/build.gradle').read_text()
    assert not any(n.get(ANDROID+'name') in ['com.huawei.hms.client.appid','com.hihonor.push.app_id','com.vivo.push.app_id','com.vivo.push.api_key'] for n in app.findall('meta-data'))
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
