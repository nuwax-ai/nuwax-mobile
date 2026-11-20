import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { promisify } from 'node:util';

const run = promisify(execFile);
const prefix = 'test-bucket/mobile-custom-bases';
const versionKey = (version, object) => `${prefix}/versions/${version}/${object}`;
const artifactKey = (version, name) => versionKey(version, `artifacts/${name}`);

test('publishes immutable versions and downloads or switches each channel independently', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'nuwax-custom-base-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  for (const name of ['Makefile', 'scripts/fetch-custom-base-s3.sh', 'scripts/publish-custom-base-s3.sh', 'scripts/ship-custom-bases.sh']) {
    copyFileSync(new URL(`../${name}`, import.meta.url), join(root, name));
  }
  writeFileSync(join(root, 'manifest.json'), '{"versionName":"1.3.9","versionCode":"139"}');
  execFileSync('git', ['init', '-q'], { cwd: root });

  const apkVersionDir = join(root, 'assets/uni-app-x');
  const source = join(root, 'packages');
  mkdirSync(apkVersionDir, { recursive: true });
  mkdirSync(source);
  writeFileSync(join(apkVersionDir, 'version.json'), '{"hxVersion":"5.34"}');
  function writeBundledManifest(basePath, version = { name: '1.3.9', code: 139 }) {
    const directory = join(root, basePath, '__UNI__TEST/www');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ version }));
  }
  writeBundledManifest('assets/apps');
  writeBundledManifest('Payload/Test.app/uni-app-x/apps');
  execFileSync('zip', ['-qr', join(source, 'android_debug.apk'), 'assets'], { cwd: root });
  execFileSync('zip', ['-qr', join(source, 'iOS_debug.ipa'), 'Payload'], { cwd: root });
  const simulator = join(source, 'Pandora_simulator_debug.app');
  mkdirSync(simulator);
  writeFileSync(join(simulator, 'Info.plist'), 'test simulator app');
  writeBundledManifest('packages/Pandora_simulator_debug.app/uni-app-x/apps');

  const objects = new Map();
  const reservations = [];
  const competingLists = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const key = decodeURIComponent(url.pathname.slice(1));
    if (request.method === 'GET' && url.searchParams.has('list-type')) {
      const s3Prefix = `${key.replace(/\/$/, '')}/${url.searchParams.get('prefix')}`;
      const keys = [...objects.keys()].filter((name) => name.startsWith(s3Prefix));
      const contents = keys.map((name) =>
        `<Contents><Key>${name.slice(key.replace(/\/$/, '').length + 1)}</Key><Size>1</Size><LastModified>2026-11-20T00:00:00Z</LastModified></Contents>`
      ).join('');
      const reply = () => response.end(`<ListBucketResult><KeyCount>${keys.length}</KeyCount><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`);
      if (s3Prefix.endsWith('/2.1.8/')) {
        competingLists.push(reply);
        if (competingLists.length === 2) competingLists.forEach((fn) => fn());
      } else {
        reply();
      }
      return;
    }
    if (request.method === 'PUT') {
      if (key === artifactKey('2.1.9', 'android_debug.apk')) {
        response.writeHead(403).end('<Error><Code>AccessDenied</Code></Error>');
        return;
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      if (key.endsWith('/reservation.json')) {
        reservations.push(request.headers['if-none-match']);
        if (request.headers['if-none-match'] !== '*' || objects.has(key)) {
          response.writeHead(412).end('<Error><Code>PreconditionFailed</Code></Error>');
          return;
        }
      }
      objects.set(key, Buffer.concat(chunks));
      response.writeHead(200, { ETag: '"test"' }).end();
      return;
    }
    const body = objects.get(key);
    if (body) {
      response.writeHead(200, { 'Content-Length': body.length, 'Last-Modified': new Date(0).toUTCString() })
        .end(request.method === 'HEAD' ? undefined : body);
    } else {
      response.writeHead(404).end('<Error><Code>NoSuchKey</Code></Error>');
    }
  });
  server.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');

  const env = {
    PATH: process.env.PATH,
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    AWS_ACCESS_KEY_ID: 'test-access-key',
    AWS_SECRET_ACCESS_KEY: 'test-secret-key',
    AWS_EC2_METADATA_DISABLED: 'true',
    AWS_MAX_ATTEMPTS: '1',
    AWS_REQUEST_CHECKSUM_CALCULATION: 'when_required',
    NUWAX_S3_ENDPOINT: `http://127.0.0.1:${server.address().port}`,
    NUWAX_S3_BUCKET: 'test-bucket',
    NUWAX_BASE_SOURCE: source,
  };
  const make = (target, options = {}) => run('make', [target], { cwd: root, env: { ...env, ...options }, timeout: 20_000 });
  const publish = (version, options = {}) => make('base-publish', { NUWAX_BASE_VERSION: version, ...options });
  const pointAt = (channel, version) => make('base-promote', { NUWAX_BASE_CHANNEL: channel, NUWAX_BASE_VERSION: version });
  const pointerVersion = (key) => JSON.parse(objects.get(`${prefix}/${key}`)).version;
  const localDebug = join(root, 'unpackage/debug');
  const v1 = '2.1.0';
  const v2 = '2.1.1';
  const race = '2.1.8';

  await assert.rejects(make('base-publish', { NUWAX_BASE_DRY_RUN: '1' }), /显式指定 X.Y.Z/);
  await assert.rejects(publish('2.1.0-dev', { NUWAX_BASE_DRY_RUN: '1' }), /显式指定 X.Y.Z/);
  await assert.rejects(make('base-ship'), /发布前须显式设置 NUWAX_BASE_VERSION/);
  writeBundledManifest('assets/apps', { name: '1.3.8', code: 138 });
  execFileSync('zip', ['-qr', join(source, 'android_debug.apk'), 'assets'], { cwd: root });
  await assert.rejects(publish(v1, { NUWAX_BASE_DRY_RUN: '1' }), /内置 App 1.3.8\/138 与当前源码 1.3.9\/139 不一致/);
  writeBundledManifest('assets/apps');
  execFileSync('zip', ['-qr', join(source, 'android_debug.apk'), 'assets'], { cwd: root });
  await publish(v1, { NUWAX_BASE_DRY_RUN: '1' });
  assert.equal(objects.size, 0);
  const firstPublish = await publish(v1);
  assert.match(firstPublish.stdout, /发布基座 .*App 1\.3\.9/);
  assert.equal(firstPublish.stderr, '');
  assert.equal(pointerVersion('channels/debug.json'), v1);
  const baseline = objects.get(artifactKey(v1, 'manifest.json'));
  assert.equal(JSON.parse(baseline).appVersionName, '1.3.9');
  for (const artifact of JSON.parse(baseline).artifacts) {
    assert.equal(artifact.appVersionName, '1.3.9');
    assert.equal(artifact.appVersionCode, '139');
  }
  await assert.rejects(publish(v1), /已存在或已被占用/);
  assert.equal(objects.get(artifactKey(v1, 'manifest.json')), baseline);

  await assert.rejects(publish('2.1.9', { NUWAX_BASE_TARGETS: 'android' }), /AccessDenied/);
  assert.equal(objects.has(artifactKey('2.1.9', 'manifest.json')), false);
  assert.equal(pointerVersion('channels/debug.json'), v1);

  await publish(v2, { NUWAX_BASE_TARGETS: 'android', NUWAX_BASE_NO_PROMOTE: '1', NUWAX_BASE_CHANNEL: 'dev' });
  assert.equal(objects.has(`${prefix}/channels/dev.json`), false);
  await pointAt('dev', v2);
  assert.equal(pointerVersion('channels/dev.json'), v2);
  assert.equal(pointerVersion('latest.json'), v1);

  // 通道版本和固定版本在同一工作区并存，旧默认入口仍写根目录。
  await make('base-fetch');
  const channelDownload = await make('base-fetch', { NUWAX_BASE_CHANNEL: 'dev' });
  assert.match(channelDownload.stdout, /完成 → .*2\.1\.1/);
  assert.equal(channelDownload.stderr, '');
  await make('base-fetch', { NUWAX_BASE_VERSION: v1, NUWAX_BASE_CHANNEL: 'absent' });
  assert.equal(readFileSync(join(localDebug, 'versions', v1, 'Pandora_simulator_debug.app/Info.plist'), 'utf8'), 'test simulator app');
  assert.ok(existsSync(join(localDebug, 'versions', v2, 'android_debug.apk')));
  assert.ok(existsSync(join(localDebug, 'iOS_debug.ipa')));
  await assert.rejects(make('base-fetch', { NUWAX_BASE_VERSION: v2, NUWAX_BASE_TARGETS: 'ios-device' }), /此版本未发布 ios-device/);

  const apk = objects.get(artifactKey(v2, 'android_debug.apk'));
  objects.set(artifactKey(v2, 'android_debug.apk'), Buffer.from('bad pak'));
  await pointAt('debug', v2);
  await assert.rejects(make('base-fetch'), /校验失败/);
  assert.equal(JSON.parse(readFileSync(join(localDebug, 'manifest.json'))).version, v1);
  assert.ok(existsSync(join(localDebug, 'iOS_debug.ipa')));
  objects.set(artifactKey(v2, 'android_debug.apk'), apk);
  await make('base-fetch');
  assert.equal(existsSync(join(localDebug, 'iOS_debug.ipa')), false);
  const lockFile = join(root, 'custom-base.lock.json');
  writeFileSync(lockFile, JSON.stringify({ appVersionSeries: { '1.3': v1, '1.4': v2 } }));
  const discovery = await make('base-list');
  assert.deepEqual(new Set(discovery.stdout.trim().split('\n')), new Set([v1, v2]));
  const info = await make('base-info', { NUWAX_BASE_DEST: join(root, 'info-only') });
  assert.match(info.stdout, /App 1[.]3[.]9.*仓库基座 2[.]1[.]0/);
  assert.match(info.stdout, /"hxVersion": "5.34"/);
  assert.equal(existsSync(join(root, 'info-only')), false);
  const lockedDownload = await make('base-fetch');
  assert.match(lockedDownload.stdout, /仓库基座 2[.]1[.]0/);
  assert.ok(existsSync(join(localDebug, 'iOS_debug.ipa')));
  assert.equal(pointerVersion('channels/debug.json'), v2);
  await make('base-fetch', { NUWAX_BASE_CHANNEL: 'debug' });
  assert.equal(existsSync(join(localDebug, 'iOS_debug.ipa')), false);
  writeFileSync(join(root, 'manifest.json'), '{"versionName":"1.4.0","versionCode":"140"}');
  assert.match((await make('base-info')).stdout, /App 1[.]4[.]0.*仓库基座 2[.]1[.]1/);
  writeFileSync(join(root, 'manifest.json'), '{"versionName":"1.5.0","versionCode":"150"}');
  await assert.rejects(make('base-fetch'), /缺少 App 1[.]5[.]x 的基座映射/);
  writeFileSync(join(root, 'manifest.json'), '{"versionName":"1.3.9","versionCode":"139"}');
  await make('base-fetch', { NUWAX_BASE_VERSION: v1, NUWAX_BASE_CHANNEL: 'dev' });
  await pointAt('debug', v1);
  assert.equal(pointerVersion('latest.json'), v1);
  assert.equal(pointerVersion('channels/dev.json'), v2);

  const shipVersion = '2.1.2';
  writeFileSync(join(root, 'scripts/package-custom-bases.sh'), [
    'set -eu',
    'test "$TARGETS" = android',
    'mkdir -p unpackage/debug',
    'cp "$NUWAX_BASE_SOURCE/android_debug.apk" unpackage/debug/',
  ].join('\n'));
  await make('base-ship', {
    SKIP_APP_RESOURCE: '1',
    TARGETS: 'android',
    NUWAX_BASE_VERSION: shipVersion,
    NUWAX_BASE_CHANNEL: 'stable',
    NUWAX_BASE_SOURCE: source,
    NUWAX_BASE_NO_PROMOTE: '1',
  });
  const shipManifest = JSON.parse(objects.get(artifactKey(shipVersion, 'manifest.json')));
  assert.deepEqual(shipManifest.artifacts.map(({ name }) => name), ['android_debug.apk']);
  assert.equal(objects.has(`${prefix}/channels/stable.json`), false);

  const publishRace = () => publish(race, { NUWAX_BASE_TARGETS: 'android', NUWAX_BASE_NO_PROMOTE: '1' });
  const concurrent = await Promise.allSettled([publishRace(), publishRace()]);
  assert.equal(concurrent.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.match(concurrent.find(({ status }) => status === 'rejected').reason.stderr, /PreconditionFailed/);
  assert.ok(objects.has(artifactKey(race, 'manifest.json')));
  assert.deepEqual(reservations, Array(6).fill('*'));
});

test('business releases advance both versionName and versionCode compared to the last release', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'nuwax-app-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  copyFileSync(new URL('./check-app-release-version.mjs', import.meta.url), join(root, 'scripts/check-app-release-version.mjs'));
  const manifest = join(root, 'manifest.json');
  const saveVersion = (versionName, versionCode) => writeFileSync(manifest, JSON.stringify({ versionName, versionCode }));
  const git = (...args) => execFileSync('git', args, { cwd: root });
  git('init', '-q');
  saveVersion('1.3.9', 139);
  git('add', 'manifest.json');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'last release');
  const check = (ref) => run(process.execPath, ['scripts/check-app-release-version.mjs', ref], { cwd: root });
  saveVersion('1.3.10', '140');
  assert.match((await check('HEAD')).stdout, /1\.3\.9 .*1\.3\.10/);
  saveVersion('1.3.10', '139');
  await assert.rejects(check('HEAD'), /versionCode 139 应大于 139/);
  saveVersion('1.2.99', '150');
  await assert.rejects(check('HEAD'), /versionName 1.2.99 应大于 1.3.9/);
  await assert.rejects(check('unavailable'), /无法读取上次正式发版/);
});
