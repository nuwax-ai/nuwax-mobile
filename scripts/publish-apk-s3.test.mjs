import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { configuration, parseArgs, parseBadging, inspectApk, digestStream, downloadApk, publishApk, s3Store } from './publish-apk-s3.mjs';
import { digest, RESOURCE_LIST_FILE } from './offline-h5/package-files.mjs';

const identity = { version: '1.3.2', versionCode: 132, packageName: 'com.nuwax.app' };
const inspect = async () => ({ ...identity });
const apkKey = 'mobile-app/v1.3.2/nuwax-1.3.2.apk';
const versionKey = 'mobile-app/v1.3.2/latest.json';
const latestKey = 'mobile-app/latest/latest.json';
const bytesDigest = bytes => digestStream(Readable.from([bytes]));

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apk-s3-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'HB downloads/v1.3.2');
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, '__UNI__8BF05E4 old.apk');
  const body = Buffer.from('test APK payload');
  await fs.writeFile(file, body);
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({ versionName: '1.3.2', versionCode: '999',
    'app-android': { distribute: { packagename: identity.packageName } } }));
  return { root, file, body };
}

function memoryStore(entries = []) {
  const data = new Map(entries.map(([key, body]) => [key, { body: Buffer.from(body), metadata: { ContentType: 'old/type', CacheControl: 'old-cache' } }]));
  const calls = [];
  return {
    data, calls,
    async get(key, file) {
      calls.push(['get', key]);
      const value = data.get(key);
      if (!value) return null;
      await fs.writeFile(file, value.body);
      return { file, metadata: value.metadata, ...await bytesDigest(value.body) };
    },
    async put(key, file, metadata) { calls.push(['put', key]); data.set(key, { body: await fs.readFile(file), metadata }); },
    async remove(key) { calls.push(['remove', key]); data.delete(key); },
    async verify(key, file) {
      calls.push(['verify', key]);
      assert.deepEqual(data.get(key)?.body, await fs.readFile(file));
    },
  };
}

async function server(t, handler) {
  const instance = http.createServer(handler);
  instance.listen(0, '127.0.0.1');
  await once(instance, 'listening');
  t.after(() => { instance.closeAllConnections(); return new Promise(resolve => instance.close(resolve)); });
  return `http://127.0.0.1:${instance.address().port}`;
}

test('CLI requires exactly one source and does not echo unknown secrets', () => {
  assert.throws(() => parseArgs([]), /必须且只能/);
  assert.throws(() => parseArgs(['--file', 'a.apk', '--url', 'https://example.test/a']), /必须且只能/);
  assert.throws(() => parseArgs(['--file']), /缺少参数/);
  assert.throws(() => parseArgs(['--token=SECRET']), error => !error.message.includes('SECRET'));
  assert.deepEqual(parseArgs(['--', '--file', 'some path/a.apk', '--notes-file', '说明.md', '--dry-run', '--json']),
    { file: 'some path/a.apk', notesFile: '说明.md', dryRun: true, json: true });
  assert.deepEqual(parseArgs(['--file', 'a.apk', '--version', 'v1.3.2']), { file: 'a.apk', version: '1.3.2' });
  assert.throws(() => parseArgs(['--file', 'a.apk', '--version']), /缺少参数/);
  assert.throws(() => parseArgs(['--file', 'a.apk', '--version', '1.3.2', '--version', '1.3.3']), /重复指定/);
  assert.throws(() => parseArgs(['--file', 'a.apk', '--version', '../../bad']), /发布版本/);
});

test('APK metadata is read from badging, validates package and stable version', () => {
  const badging = "package: name='com.nuwax.app' versionCode='132' versionName='1.3.2' compileSdkVersion='36'";
  assert.deepEqual(parseBadging(badging, 'com.nuwax.app'), identity);
  assert.throws(() => parseBadging(badging, 'other.app'), /包名不匹配/);
  assert.throws(() => parseBadging(badging.replace("'132'", "'0'"), 'com.nuwax.app'), /versionCode/);
  assert.throws(() => parseBadging(badging.replace('1.3.2', '../../bad'), 'com.nuwax.app'), /正式版/);
  assert.throws(() => parseBadging('HTML error page', 'com.nuwax.app'), /无法读取/);
});

test('S3 config separates public domain and rejects unsafe paths/credentials', () => {
  const defaults = configuration({});
  assert.equal(defaults.prefix, 'mobile-app');
  assert.equal(defaults.publicBase, 'https://s3.nuwax.com:9443/nuwax-packages');
  assert.equal(configuration({ NUWAX_S3_PUBLIC_BASE_URL: 'https://cdn.example.test/packages/' }).publicBase, 'https://cdn.example.test/packages');
  for (const prefix of ['../x', '/x', 'x//y', 'x/..', 'a b']) assert.throws(() => configuration({ NUWAX_S3_PREFIX: prefix }));
  assert.throws(() => configuration({ NUWAX_S3_ENDPOINT: 'https://user:SECRET@example.test' }), /无用户名/);
});

test('local path with spaces publishes package identity, notes and three verified objects', async t => {
  const f = await fixture(t), store = memoryStore();
  const notesFile = path.join(f.root, '更新 说明.md');
  await fs.writeFile(notesFile, '中文更新说明\n第二行\n');
  const result = await publishApk({ file: f.file, notesFile }, { root: f.root, env: {}, inspect, store });
  assert.equal(result.version, '1.3.2');
  assert.equal(result.versionCode, 132);
  assert.equal(result.apkUrl, 'https://s3.nuwax.com:9443/nuwax-packages/mobile-app/v1.3.2/nuwax-1.3.2.apk');
  assert.deepEqual(store.data.get(apkKey).body, f.body);
  assert.deepEqual(await fs.readFile(f.file), f.body);
  assert.deepEqual(store.data.get(versionKey).body, store.data.get(latestKey).body);
  const value = JSON.parse(store.data.get(latestKey).body);
  assert.equal(value.notes, '中文更新说明\n第二行\n');
  assert.deepEqual(value.platforms.android, { url: result.apkUrl, versionName: '1.3.2', versionCode: 132,
    packageName: identity.packageName, ...await bytesDigest(f.body) });
  assert.deepEqual(store.calls.filter(([action]) => action !== 'get'), [
    ['put', apkKey], ['verify', apkKey], ['put', versionKey], ['verify', versionKey], ['put', latestKey], ['verify', latestKey],
  ]);
  assert.equal(store.data.get(latestKey).metadata.CacheControl, 'no-store');
  assert.equal(store.data.get(apkKey).metadata.CacheControl, 'public, max-age=0, must-revalidate');
});

test('dry-run validates and creates JSON without S3 calls or a lock', async t => {
  const f = await fixture(t);
  const store = memoryStore();
  let checked = false;
  const result = await publishApk({ file: f.file, dryRun: true }, { root: f.root, env: {}, store,
    inspect: async file => { checked = true; assert.deepEqual(await fs.readFile(file), f.body); return identity; } });
  assert.equal(checked, true);
  assert.equal(result.dryRun, true);
  assert.deepEqual(store.calls, []);
  assert.ok((await fs.readdir(path.join(f.root, 'unpackage/apk-publish'))).every(name => !name.endsWith('.lock')));
});

test('default release version comes from manifest while APK version and code remain accurate', async t => {
  const f = await fixture(t), store = memoryStore();
  const file = path.join(f.root, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  manifest.versionName = 'v9.9.9';
  await fs.writeFile(file, JSON.stringify(manifest));
  const result = await publishApk({ file: f.file }, { root: f.root, env: {}, inspect, store });
  assert.equal(result.version, '9.9.9');
  assert.equal(result.versionSource, 'manifest');
  assert.equal(result.apkVersionName, '1.3.2');
  assert.equal(result.versionCode, 132);
  assert.equal(result.apkUrl, 'https://s3.nuwax.com:9443/nuwax-packages/mobile-app/v9.9.9/nuwax-9.9.9.apk');
  assert.equal(result.metadata.version, '9.9.9');
  assert.equal(result.metadata.platforms.android.versionName, '1.3.2');
  assert.equal(result.metadata.platforms.android.versionCode, 132);
  assert.ok(store.data.has('mobile-app/v9.9.9/nuwax-9.9.9.apk'));
  assert.deepEqual(store.data.get('mobile-app/v9.9.9/latest.json').body, store.data.get(latestKey).body);
});

test('explicit release version overrides manifest and controls paths and both JSONs', async t => {
  const f = await fixture(t), store = memoryStore();
  const result = await publishApk({ file: f.file, version: 'v2.0.0' }, { root: f.root, env: {}, inspect, store });
  assert.equal(result.version, '2.0.0');
  assert.equal(result.versionSource, 'argument');
  assert.equal(result.apkVersionName, '1.3.2');
  assert.equal(result.versionCode, 132);
  assert.equal(result.apkUrl, 'https://s3.nuwax.com:9443/nuwax-packages/mobile-app/v2.0.0/nuwax-2.0.0.apk');
  const versionJson = JSON.parse(store.data.get('mobile-app/v2.0.0/latest.json').body);
  assert.equal(versionJson.version, '2.0.0');
  assert.equal(versionJson.platforms.android.versionName, '1.3.2');
  assert.deepEqual(store.data.get('mobile-app/v2.0.0/latest.json').body, store.data.get(latestKey).body);
});

test('invalid or missing manifest version fails before reading the APK or writing S3; explicit version takes precedence', async t => {
  const f = await fixture(t), store = memoryStore();
  const file = path.join(f.root, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  delete manifest.versionName;
  await fs.writeFile(file, JSON.stringify(manifest));
  await assert.rejects(publishApk({ file: f.file }, { root: f.root, env: {}, inspect, store }), /manifest.json versionName/);
  await assert.rejects(publishApk({ file: f.file, version: '../bad' }, { root: f.root, env: {}, inspect, store }), /--version/);
  assert.deepEqual(store.calls, []);
  const result = await publishApk({ file: f.file, version: '1.3.2', dryRun: true }, { root: f.root, env: {}, inspect, store });
  assert.equal(result.version, '1.3.2');
});

test('HTTP source follows redirects, retries transient failures, and never persists signed URL', async t => {
  const f = await fixture(t);
  let attempts = 0;
  const base = await server(t, (req, res) => {
    if (req.url.startsWith('/start')) { res.writeHead(302, { Location: '/apk' }); res.end(); }
    else if (++attempts === 1) { res.writeHead(503); res.end('busy'); }
    else { res.end(f.body); }
  });
  const result = await publishApk({ url: `${base}/start?token=SECRET`, version: '2.0.0', dryRun: true }, { root: f.root, env: {}, inspect });
  assert.equal(attempts, 2);
  assert.equal(result.sha256, (await bytesDigest(f.body)).sha256);
  assert.equal(result.version, '2.0.0');
  assert.ok(!JSON.stringify(result).includes('SECRET'));
  assert.ok(!(await fs.readFile(result.metadataFile, 'utf8')).includes(base));
});

test('HTTP errors and timeout clean partial downloads without leaking source query', async t => {
  const f = await fixture(t);
  const base = await server(t, (req, res) => {
    if (req.url.startsWith('/stall')) return;
    res.writeHead(403); res.end('secret error body');
  });
  const file = path.join(f.root, 'download.apk');
  await assert.rejects(downloadApk(`${base}/bad?token=SECRET`, file), error => /HTTP 403/.test(error.message) && !error.message.includes('SECRET'));
  await assert.rejects(downloadApk(`${base}/stall?token=SECRET`, file, { timeout: 20, retries: 1 }), /网络错误或超时/);
  await assert.rejects(fs.access(`${file}.part`));
});

test('same version and build can replace the APK and latest JSON', async t => {
  const f = await fixture(t), store = memoryStore();
  await publishApk({ file: f.file }, { root: f.root, env: {}, inspect, store });
  await fs.writeFile(f.file, 'replacement APK');
  const result = await publishApk({ file: f.file }, { root: f.root, env: {}, inspect, store });
  assert.equal(result.versionCode, 132);
  assert.equal(store.data.get(apkKey).body.toString(), 'replacement APK');
  assert.equal(JSON.parse(store.data.get(latestKey).body).platforms.android.sha256, result.sha256);
});

test('lower versionCode is rejected before any upload', async t => {
  const f = await fixture(t), store = memoryStore([[latestKey, JSON.stringify({ platforms: { android: { ...identity, versionCode: 133 } } })]]);
  await assert.rejects(publishApk({ file: f.file, version: '9.9.9' }, { root: f.root, env: {}, inspect, store }), /拒绝.*133.*132/);
  assert.ok(store.calls.every(([action]) => action === 'get'));
});

test('malformed latest JSON is rejected before any upload', async t => {
  const f = await fixture(t), store = memoryStore([[latestKey, '{broken']]);
  await assert.rejects(publishApk({ file: f.file }, { root: f.root, env: {}, inspect, store }), /现有 latest.json 无效/);
  assert.ok(store.calls.every(([action]) => action === 'get'));
});

for (const failure of ['apk-digest', 'version-json-write', 'latest-json-readback']) {
  test(`${failure}: failed same-version replacement restores every body and metadata`, async t => {
    const f = await fixture(t);
    const oldLatest = JSON.stringify({ version: '1.3.2', platforms: { android: identity } });
    const store = memoryStore([[apkKey, 'old APK'], [versionKey, oldLatest], [latestKey, oldLatest]]);
    const before = structuredClone([...store.data]);
    const put = store.put, verify = store.verify;
    let failed = false;
    store.put = async (...args) => {
      await put(...args);
      if (!failed && failure === 'version-json-write' && args[0] === versionKey) { failed = true; throw new Error('upload failed after mutation'); }
    };
    store.verify = async (...args) => {
      if (!failed && ((failure === 'apk-digest' && args[0] === apkKey) || (failure === 'latest-json-readback' && args[0] === latestKey))) {
        failed = true; throw new Error('public readback mismatch');
      }
      await verify(...args);
    };
    await assert.rejects(publishApk({ file: f.file }, { root: f.root, env: {}, inspect, store }), /已恢复本次修改前/);
    for (const [key, value] of before) {
      assert.deepEqual(store.data.get(key).body, Buffer.from(value.body));
      assert.deepEqual(store.data.get(key).metadata, value.metadata);
    }
    if (failure === 'apk-digest') assert.ok(!store.calls.some(([action, key]) => action === 'put' && key === latestKey));
  });
}

test('first publication failure removes new objects; rollback failure retains backups', async t => {
  const f = await fixture(t), store = memoryStore();
  store.verify = async () => { throw new Error('bad digest'); };
  await assert.rejects(publishApk({ file: f.file }, { root: f.root, env: {}, inspect, store }), /已恢复/);
  assert.equal(store.data.size, 0);
  store.remove = async () => { throw new Error('delete failed'); };
  await assert.rejects(publishApk({ file: f.file }, { root: f.root, env: {}, inspect, store }), error => /恢复失败/.test(error.message) && Boolean(error.workDir));
});

test('interruption after an upload restores the previous APK without advancing latest', async t => {
  const f = await fixture(t), store = memoryStore([[apkKey, 'old APK']]);
  const controller = new AbortController();
  const put = store.put;
  store.put = async (...args) => { await put(...args); controller.abort(new Error('test interruption')); };
  store.verify = async (_key, _file, signal) => { signal?.throwIfAborted(); };
  await assert.rejects(publishApk({ file: f.file }, { root: f.root, env: {}, inspect, store, signal: controller.signal }), /已恢复/);
  assert.equal(store.data.get(apkKey).body.toString(), 'old APK');
  assert.ok(!store.data.has(latestKey));
});

test('local lock prevents concurrent writes and is released after publication', async t => {
  const f = await fixture(t), store = memoryStore();
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const get = store.get;
  let first = true;
  store.get = async (...args) => {
    if (first) { first = false; enter(); await held; }
    return get(...args);
  };
  const running = publishApk({ file: f.file }, { root: f.root, env: {}, inspect, store });
  await entered;
  try {
    await assert.rejects(publishApk({ file: f.file }, { root: f.root, env: {}, inspect, store }), /已有发布任务/);
  } finally { release(); await running; }
  assert.ok((await fs.readdir(path.join(f.root, 'unpackage/apk-publish'))).every(name => !name.endsWith('.lock')));
});

test('real APK validation rejects corrupt ZIP, wrong package, and missing/modified offline resources', async t => {
  const f = await fixture(t);
  await assert.rejects(inspectApk(f.file, { root: f.root }), /ZIP 完整性校验/);
  const aapt = path.join(f.root, 'aapt2');
  await fs.writeFile(aapt, `#!/usr/bin/env node\nconsole.log(${JSON.stringify("package: name='com.nuwax.app' versionCode='132' versionName='1.3.2'")});\n`, { mode: 0o755 });
  const zipRoot = path.join(f.root, 'zip');
  const offline = path.join(zipRoot, 'assets/apps/__UNI__8BF05E4/www/static/app/offline-h5');
  await fs.mkdir(offline, { recursive: true });
  const files = [];
  for (const name of ['index.html', 'app-bundle.js', 'offline-h5-bridge.js']) {
    const bytes = Buffer.from(name);
    await fs.writeFile(path.join(offline, name), bytes);
    files.push({ path: name, bytes: bytes.length, sha256: digest(bytes) });
  }
  await fs.writeFile(path.join(offline, RESOURCE_LIST_FILE), JSON.stringify({ schemaVersion: 1, protocolVersion: 1, files, resourceVersion: digest(JSON.stringify(files)) }));
  await fs.rm(f.file);
  execFileSync('zip', ['-qr', f.file, '.'], { cwd: zipRoot });
  const env = { ...process.env, NUWAX_AAPT2: aapt };
  assert.deepEqual(await inspectApk(f.file, { root: f.root, env }), identity);
  await fs.writeFile(path.join(offline, 'app-bundle.js'), 'corrupted');
  execFileSync('zip', ['-qr', f.file, '.'], { cwd: zipRoot });
  await assert.rejects(inspectApk(f.file, { root: f.root, env }), /离线资源校验/);
  await fs.rm(path.join(offline, RESOURCE_LIST_FILE));
  await fs.rm(f.file);
  execFileSync('zip', ['-qr', f.file, '.'], { cwd: zipRoot });
  await assert.rejects(inspectApk(f.file, { root: f.root, env }), /离线资源校验/);
  await fs.writeFile(aapt, '#!/usr/bin/env node\nconsole.log("package: name=\'other.app\' versionCode=\'132\' versionName=\'1.3.2\'");\n');
  await assert.rejects(inspectApk(f.file, { root: f.root, env }), /包名不匹配/);
});

test('S3 public verification hashes bytes and rejects a different payload', async t => {
  const f = await fixture(t);
  const base = await server(t, (req, res) => res.end(req.url.endsWith('/correct') ? f.body : 'wrong'));
  const store = s3Store(configuration({ NUWAX_S3_PUBLIC_BASE_URL: base }), {});
  await store.verify('correct', f.file);
  await assert.rejects(store.verify('wrong', f.file), /摘要或大小不一致/);
});

test('AWS adapter distinguishes missing keys from denied access without printing credentials', async t => {
  const f = await fixture(t), bin = path.join(f.root, 'bin');
  await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, 'aws'), '#!/usr/bin/env node\nprocess.stderr.write(process.env.TEST_AWS_ERROR + " SECRET credential"); process.exit(1);\n', { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, TEST_AWS_ERROR: 'An error occurred (NoSuchKey)' };
  const store = s3Store(configuration({}), env);
  assert.equal(await store.get('missing', path.join(f.root, 'missing')), null);
  const denied = s3Store(configuration({}), { ...env, TEST_AWS_ERROR: 'An error occurred (AccessDenied)' });
  await assert.rejects(denied.get('denied', path.join(f.root, 'denied')), error => !error.message.includes('SECRET') && /执行失败/.test(error.message));
});
