import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { digest, verifyResourcePackage } from './package-files.mjs';
const require = createRequire(import.meta.url);
const hx = process.env.HX_APP_ROOT || '/Applications/HBuilderX.app/Contents/HBuilderX';
const { transformSync } = require(path.join(hx, 'plugins/uniapp-cli-vite/node_modules/esbuild'));
const source = fs.readFileSync(new URL('../../components/offline-h5-container/offline-h5-session.uts', import.meta.url), 'utf8');
const { code } = transformSync(source, { loader: 'ts', format: 'cjs' });
const module = { exports: {} };
vm.runInNewContext(code, { module, exports: module.exports, Date, encodeURIComponent });
const { OfflineH5Session } = module.exports;
test('reuse and fallback reject stale ready and timeout callbacks', () => {
  const s = new OfflineH5Session();
  s.open('a', 'account1', '/index.html#/a', 'https://example.test/#/a', true);
  const first = s.requestId;
  assert.equal(s.ready(first), true);
  s.open('b', 'account1', '/index.html#/b', 'https://example.test/#/b', true);
  assert.equal(s.phase, 'navigating-local');
  assert.equal(s.ready(first), false);
  assert.equal(s.timeout(first), false);
  s.timeout(s.requestId);
  assert.equal(s.phase, 'loading-local');
  const local = s.requestId;
  s.timeout(local);
  assert.equal(s.phase, 'loading-remote');
  assert.equal(s.ready(local), false);
  s.timeout(s.requestId);
  assert.equal(s.phase, 'failed');
});
test('account changes and cancellation prevent document reuse', () => {
  const s = new OfflineH5Session();
  s.open('a', 'one', '/index.html#/a', '', true); s.ready(s.requestId);
  s.open('a', 'two', '/index.html#/a', '', true);
  assert.equal(s.phase, 'loading-local');
  const id = s.requestId; s.cancel(); assert.equal(s.ready(id), false);
});
test('ready survives late native bridge installation and stops after ACK', () => {
  let tick; const messages = [];
  const root = { addEventListener() {} };
  vm.runInNewContext(fs.readFileSync(new URL('../../components/offline-h5-container/offline-h5-bridge.js', import.meta.url), 'utf8'), {
    window: root, location: { hash: '#/a?offlineH5RequestId=one' }, URLSearchParams,
    setInterval(fn) { tick = fn; return 1; }, clearInterval() {},
  });
  root.OfflineH5Bridge.pageReady('one'); tick();
  root.uni = { webView: { postMessage(msg) { messages.push(msg.data); } } };
  tick(); assert.equal(messages.length, 1);
  assert.equal(messages[0].requestId, 'one');
  root.OfflineH5Bridge.acknowledge('OFFLINE_H5_PAGE_READY', 'one'); tick();
  assert.equal(messages.length, 1);
});
test('resource verification rejects altered files and symlink directories', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-h5-test-'));
  try {
    const files = ['index.html', 'app-bundle.js', 'offline-h5-bridge.js'].map(name => {
      fs.writeFileSync(path.join(dir, name), name);
      return { path: name, bytes: Buffer.byteLength(name), sha256: digest(name) };
    });
    fs.writeFileSync(path.join(dir, 'offline-h5-manifest.json'), JSON.stringify({ schemaVersion: 1, protocolVersion: 1, files, resourceVersion: digest(JSON.stringify(files)) }));
    verifyResourcePackage(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), 'broken');
    assert.throws(() => verifyResourcePackage(dir), /modified/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
