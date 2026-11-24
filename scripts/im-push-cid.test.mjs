import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const raw = readFileSync(new URL('../utils/im/imPushClient.uts', import.meta.url), 'utf8');
const start = raw.indexOf('function applyPushCid(');
const end = raw.indexOf('/** 登录态判定', start);
const source = stripTypeScriptTypes(raw.slice(start, end));
for (const fails of [false, true]) {
  test(`iOS VoIP CID sync fails=${fails}: ordinary IM CID registration continues`, () => {
    const reports = [];
    const diagnostics = [];
    let syncs = 0;
    const context = vm.createContext({
      cachedPushCid: '', PUSH_CID_STORAGE_KEY: 'fixture-cid',
      getImPushCid: () => '', isLoggedIn: () => true,
      uni: { setStorageSync() {} }, reportPushCid: cid => reports.push(cid),
      syncVoipPushCid: () => { syncs++; if (fails) throw new Error('plugin unavailable'); },
      console: { error: text => diagnostics.push(text) },
    });
    vm.runInContext(source, context);
    assert.doesNotThrow(() => context.applyPushCid('cid-fixture'));
    assert.deepEqual(reports, ['cid-fixture']);
    assert.equal(syncs, 1);
    assert.equal(diagnostics.length, fails ? 1 : 0);
    assert.equal(context.cachedPushCid, 'cid-fixture');
  });
}
