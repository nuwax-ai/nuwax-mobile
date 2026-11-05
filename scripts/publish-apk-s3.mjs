#!/usr/bin/env node
/** Publish a completed HBuilderX APK; never builds or changes the source package. */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
const APK_CACHE = 'public, max-age=0, must-revalidate';
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const usage = `用法：pnpm apk:publish --file '/path/with spaces/app.apk'
      pnpm apk:publish --url 'https://download.example/app.apk?token=...'

--file PATH        本地 APK，与 --url 二选一
--url URL          HBuilderX HTTP(S) 下载链接
--notes-file PATH  UTF-8 更新说明（默认空）
--dry-run          下载、校验并展示计划，不访问 S3
--json             只向 stdout 输出结果 JSON；进度写入 stderr
--help             显示帮助

依赖：Node.js 22+、unzip、Android SDK aapt2；实际发布还需 AWS CLI。
配置：NUWAX_S3_ENDPOINT/REGION/BUCKET/PREFIX/PUBLIC_BASE_URL、AWS_PROFILE
凭证：AWS_* 或 NUWAX_S3_ACCESS_KEY_ID/SECRET_ACCESS_KEY/SESSION_TOKEN
可选：NUWAX_AAPT2 指定 aapt2；NUWAX_S3_NO_VERIFY_SSL=1 仅关闭 AWS TLS 校验。
PUBLIC_BASE_URL 是公开桶根地址（默认 endpoint/bucket），不含 PREFIX。`;

export function parseArgs(args) {
  const options = {};
  const values = { '--file': 'file', '--url': 'url', '--notes-file': 'notesFile' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') continue;
    if (values[arg]) {
      if (options[values[arg]] !== undefined || !args[i + 1] || args[i + 1].startsWith('--'))
        throw new Error(`${arg} 缺少参数或重复指定`);
      options[values[arg]] = args[++i];
    } else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error('未知参数，请使用 --help 查看用法');
  }
  if (!options.help && Boolean(options.file) === Boolean(options.url)) throw new Error('--file 与 --url 必须且只能指定一个');
  return options;
}

function httpUrl(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} 必须是有效的 HTTP(S) 地址`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
    throw new Error(`${label} 必须是无用户名、密码和片段的 HTTP(S) 地址`);
  return url;
}

export function configuration(env = process.env) {
  const endpoint = httpUrl(env.NUWAX_S3_ENDPOINT || 'https://s3.nuwax.com:9443', 'S3 endpoint');
  const bucket = env.NUWAX_S3_BUCKET || 'nuwax-packages';
  const prefix = env.NUWAX_S3_PREFIX || 'mobile-app';
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(bucket)) throw new Error('非法 S3 bucket');
  if (!prefix.split('/').every(part => /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(part))) throw new Error('非法 S3 prefix');
  const publicBase = httpUrl(env.NUWAX_S3_PUBLIC_BASE_URL || `${endpoint.href.replace(/\/$/, '')}/${bucket}`, '公开桶地址');
  if (endpoint.search || publicBase.search) throw new Error('S3 endpoint 和公开桶地址不得包含查询参数');
  return { endpoint: endpoint.href.replace(/\/$/, ''), bucket, prefix,
    region: env.NUWAX_S3_REGION || 'us-east-1', publicBase: publicBase.href.replace(/\/$/, ''),
    noVerifySsl: env.NUWAX_S3_NO_VERIFY_SSL === '1' };
}

async function command(program, args, label, options = {}) {
  try { return await execute(program, args, { timeout: 300_000, maxBuffer: 4 * 1024 * 1024, ...options }); }
  catch (error) {
    // execFile errors include the entire command; never expose a signed URL or credentials.
    const safe = new Error(error.code === 'ENOENT' ? `缺少依赖：${program === 'aws' ? 'AWS CLI (aws)' : label}` : `${label} 执行失败（${error.code ?? 'unknown'}）`);
    safe.missingObject = /\(NoSuchKey\)|\(404\)|\(NotFound\)/.test(String(error.stderr || ''));
    throw safe;
  }
}

export async function findAapt2(env = process.env) {
  const executable = process.platform === 'win32' ? 'aapt2.exe' : 'aapt2';
  const candidates = env.NUWAX_AAPT2 ? [env.NUWAX_AAPT2] : (env.PATH || '').split(path.delimiter).filter(Boolean).map(p => path.join(p, executable));
  if (!env.NUWAX_AAPT2) {
    const sdkRoots = [env.ANDROID_SDK_ROOT, env.ANDROID_HOME, path.join(os.homedir(), 'Library/Android/sdk'),
      path.join(os.homedir(), 'workspace/Android/sdk'), path.join(os.homedir(), 'Android/Sdk'),
      '/opt/homebrew/share/android-commandlinetools', '/usr/local/share/android-commandlinetools',
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Android/Sdk')].filter(Boolean);
    for (const sdk of sdkRoots) {
      const builds = await fsp.readdir(path.join(sdk, 'build-tools')).catch(() => []);
      for (const build of builds.sort((a, b) => b.localeCompare(a, 'en', { numeric: true })))
        candidates.push(path.join(sdk, 'build-tools', build, executable));
    }
  }
  for (const candidate of candidates) {
    try { await fsp.access(candidate, fs.constants.X_OK); return candidate; } catch { /* next SDK */ }
  }
  throw new Error('找不到 aapt2，请安装 Android SDK build-tools 或设置 NUWAX_AAPT2');
}

export function parseBadging(text, expectedPackage) {
  const match = /^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m.exec(text);
  if (!match) throw new Error('无法读取 APK 包名和版本');
  const [, packageName, code, version] = match;
  const versionCode = Number(code);
  if (packageName !== expectedPackage) throw new Error(`APK 包名不匹配：预期 ${expectedPackage}`);
  if (!VERSION.test(version)) throw new Error('首版只支持 X.Y.Z 格式的安卓正式版');
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2100000000) throw new Error('APK versionCode 无效');
  return { packageName, version, versionCode };
}

export async function inspectApk(file, { root = ROOT, env = process.env, signal } = {}) {
  const manifest = JSON.parse(await fsp.readFile(path.join(root, 'manifest.json'), 'utf8'));
  const expectedPackage = manifest['app-android']?.distribute?.packagename;
  if (!expectedPackage) throw new Error('manifest.json 未配置安卓包名');
  await command('unzip', ['-tqq', file], 'APK ZIP 完整性校验', { signal });
  const aapt2 = await findAapt2(env);
  const { stdout } = await command(aapt2, ['dump', 'badging', file], 'aapt2 APK 检查', { signal });
  const identity = parseBadging(stdout, expectedPackage);
  await command(process.execPath, [path.join(ROOT, 'scripts/verify-offline-h5-artifact.mjs'), file], 'APK 离线资源校验', { signal });
  return identity;
}

export async function digestStream(stream) {
  const sha256 = createHash('sha256'), sha512 = createHash('sha512');
  let size = 0;
  for await (const chunk of stream) { size += chunk.length; sha256.update(chunk); sha512.update(chunk); }
  return { size, sha256: sha256.digest('hex'), signature: sha512.digest('base64') };
}
const digestFile = file => digestStream(fs.createReadStream(file));
const sameDigest = (a, b) => a.size === b.size && a.sha256 === b.sha256;

async function request(url, consume, { signal, timeout = 300_000, retries = 3 } = {}) {
  for (let attempt = 0; attempt < retries; attempt++) {
    signal?.throwIfAborted();
    let status;
    try {
      const response = await fetch(url, { redirect: 'follow', cache: 'no-store', headers: { 'Cache-Control': 'no-cache' },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout) });
      status = response.status;
      if (!response.ok) { await response.body?.cancel(); throw new Error(); }
      if (!response.body) throw new Error();
      return await consume(response);
    } catch {
      signal?.throwIfAborted();
      const retryable = !status || status >= 500 || status === 429 || status === 408 || status < 400;
      if (!retryable || attempt === retries - 1) throw new Error(`HTTP 下载或回读失败${status ? `（HTTP ${status}）` : '（网络错误或超时）'}`);
      await new Promise(resolve => setTimeout(resolve, 250 * (2 ** attempt)));
    }
  }
}

export async function downloadApk(url, destination, options = {}) {
  httpUrl(url, '下载链接');
  const partial = `${destination}.part`;
  try {
    await request(url, response => pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partial)), options);
    await fsp.rename(partial, destination);
  } finally { await fsp.rm(partial, { force: true }); }
}

export function s3Store(config, env = process.env) {
  const childEnv = { ...env };
  for (const [awsName, ownName] of [['AWS_ACCESS_KEY_ID', 'NUWAX_S3_ACCESS_KEY_ID'], ['AWS_SECRET_ACCESS_KEY', 'NUWAX_S3_SECRET_ACCESS_KEY'], ['AWS_SESSION_TOKEN', 'NUWAX_S3_SESSION_TOKEN']])
    if (!childEnv[awsName] && childEnv[ownName]) childEnv[awsName] = childEnv[ownName];
  const common = ['--endpoint-url', config.endpoint, '--region', config.region, '--no-cli-pager'];
  if (config.noVerifySsl) common.push('--no-verify-ssl');
  const aws = (args, label, signal) => command('aws', [...args, ...common], label, { env: childEnv, signal, timeout: 900_000 });
  return {
    async get(key, file, signal) {
      try {
        const { stdout } = await aws(['s3api', 'get-object', '--bucket', config.bucket, '--key', key, file], 'S3 对象备份/回读', signal);
        const headers = JSON.parse(stdout);
        const metadata = {};
        for (const name of ['ContentType', 'CacheControl', 'ContentDisposition', 'ContentEncoding', 'ContentLanguage', 'Expires', 'Metadata'])
          if (headers[name] !== undefined) metadata[name] = headers[name];
        return { file, metadata, ...await digestFile(file) };
      } catch (error) { if (error.missingObject) return null; throw error; }
    },
    async put(key, file, metadata, signal) {
      const args = ['s3', 'cp', file, `s3://${config.bucket}/${key}`, '--only-show-errors'];
      for (const [name, flag] of Object.entries({ ContentType: '--content-type', CacheControl: '--cache-control',
        ContentDisposition: '--content-disposition', ContentEncoding: '--content-encoding', ContentLanguage: '--content-language', Expires: '--expires', Metadata: '--metadata' }))
        if (metadata[name] !== undefined) args.push(flag, typeof metadata[name] === 'object' ? JSON.stringify(metadata[name]) : metadata[name]);
      await aws(args, 'S3 上传', signal);
    },
    async remove(key) { await aws(['s3api', 'delete-object', '--bucket', config.bucket, '--key', key], 'S3 恢复（删除新对象）'); },
    async verify(key, file, signal) {
      const actual = await request(`${config.publicBase}/${key}`, response => digestStream(Readable.fromWeb(response.body)), { signal });
      if (!sameDigest(actual, await digestFile(file))) throw new Error(`公开对象摘要或大小不一致：${key}`);
    },
  };
}

/** Back up all objects before writing; include an attempted write in rollback even if its command failed. */
export async function publishObjects(objects, { store, workDir, identity, signal, log = () => {} }) {
  const backups = [];
  for (const [i, object] of objects.entries()) {
    signal?.throwIfAborted();
    backups.push(await store.get(object.key, path.join(workDir, `backup-${i}`), signal));
  }
  const previous = backups.at(-1);
  if (previous) {
    let android;
    try { android = JSON.parse(await fsp.readFile(previous.file, 'utf8')).platforms.android; }
    catch { throw new Error('现有 latest.json 无效，拒绝覆盖'); }
    if (!Number.isSafeInteger(android?.versionCode) || android.versionCode < 1 || android.packageName !== identity.packageName)
      throw new Error('现有 latest.json 缺少有效的安卓构建号或包名');
    if (identity.versionCode < android.versionCode) throw new Error(`拒绝将 latest 从构建号 ${android.versionCode} 降到 ${identity.versionCode}`);
  }
  const touched = [];
  try {
    for (const [i, object] of objects.entries()) {
      signal?.throwIfAborted();
      log(`上传并校验：${object.key}`);
      touched.push(i);
      await store.put(object.key, object.file, object.metadata, signal);
      await store.verify(object.key, object.file, signal);
    }
  } catch (error) {
    const failures = [];
    log('发布失败，正在恢复旧对象…');
    for (const i of touched.reverse()) {
      const object = objects[i], backup = backups[i];
      try {
        if (backup) await store.put(object.key, backup.file, backup.metadata);
        else await store.remove(object.key);
        const restored = await store.get(object.key, path.join(workDir, `restored-${i}`));
        if (backup ? !restored || !sameDigest(backup, restored) : restored !== null) throw new Error('恢复回读不一致');
      } catch { failures.push(object.key); }
    }
    const recovery = failures.length ? `恢复失败：${failures.join(', ')}；备份保留在 ${workDir}` : '已恢复本次修改前的对象';
    throw new Error(`${error.message}；${recovery}`);
  }
}

export async function publishApk(options, { root = ROOT, env = process.env, signal, log = () => {}, inspect = inspectApk, store } = {}) {
  if (Boolean(options.file) === Boolean(options.url)) throw new Error('--file 与 --url 必须且只能指定一个');
  const config = configuration(env);
  const cache = path.join(root, 'unpackage/apk-publish');
  await fsp.mkdir(cache, { recursive: true });
  const workDir = await fsp.mkdtemp(path.join(cache, 'run-'));
  let lock;
  try {
    const input = path.join(workDir, 'input.apk');
    if (options.file) {
      const source = path.resolve(options.file);
      if (!/\.apk$/i.test(source) || !(await fsp.stat(source)).isFile()) throw new Error('--file 必须是本地 APK 文件');
      await fsp.copyFile(source, input);
    } else {
      log('正在下载 APK…');
      await downloadApk(options.url, input, { signal });
    }
    log('正在校验 APK、版本和离线资源…');
    const identity = await inspect(input, { root, env, signal });
    const digest = await digestFile(input);
    const filename = `nuwax-${identity.version}.apk`;
    const apkFile = path.join(workDir, filename);
    await fsp.rename(input, apkFile);
    const versionRoot = `${config.prefix}/v${identity.version}`;
    const apkKey = `${versionRoot}/${filename}`;
    const versionKey = `${versionRoot}/latest.json`;
    const latestKey = `${config.prefix}/latest/latest.json`;
    const apkUrl = `${config.publicBase}/${apkKey}`;
    const metadata = { version: identity.version, notes: options.notesFile ? await fsp.readFile(path.resolve(options.notesFile), 'utf8') : '',
      pub_date: new Date().toISOString(), platforms: { android: { url: apkUrl, versionCode: identity.versionCode,
        packageName: identity.packageName, ...digest } } };
    const metadataFile = path.join(workDir, 'latest.json');
    await fsp.writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`);
    if (!options.dryRun) {
      const lockName = createHash('sha256').update(`${config.endpoint}/${config.bucket}/${config.prefix}`).digest('hex').slice(0, 16);
      const lockPath = path.join(cache, `${lockName}.lock`);
      try { await fsp.mkdir(lockPath); } catch (error) {
        if (error.code === 'EEXIST') throw new Error(`同一 S3 前缀已有发布任务；如确认是异常退出残留，请检查 ${lockPath}`);
        throw error;
      }
      lock = lockPath;
      await fsp.writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), workDir }));
      await publishObjects([
        { key: apkKey, file: apkFile, metadata: { ContentType: 'application/vnd.android.package-archive', CacheControl: APK_CACHE } },
        { key: versionKey, file: metadataFile, metadata: { ContentType: 'application/json', CacheControl: APK_CACHE } },
        { key: latestKey, file: metadataFile, metadata: { ContentType: 'application/json', CacheControl: 'no-store' } },
      ], { store: store || s3Store(config, env), workDir, identity, signal, log });
      for (const name of await fsp.readdir(workDir))
        if (/^(backup|restored)-\d+$/.test(name)) await fsp.rm(path.join(workDir, name), { force: true });
    }
    const result = { ok: true, dryRun: Boolean(options.dryRun), ...identity, ...digest, apkUrl,
      versionJsonUrl: `${config.publicBase}/${versionKey}`, latestUrl: `${config.publicBase}/${latestKey}`, metadataFile, metadata };
    await fsp.writeFile(path.join(workDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } catch (error) {
    error.workDir = workDir;
    throw error;
  } finally { if (lock) await fsp.rm(lock, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error('发布被中断'));
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  let options;
  try {
    if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('需要 Node.js 22 或更新版本');
    options = parseArgs(process.argv.slice(2));
    if (options.help) console.log(usage);
    else {
      const result = await publishApk(options, { signal: controller.signal, log: message => console.error(message) });
      if (options.json) console.log(JSON.stringify(result));
      else {
        console.log(`${result.dryRun ? '预演完成（未访问 S3）' : '发布完成'}：${result.version} (${result.versionCode})`);
        console.log(`APK：${result.apkUrl}\n版本 JSON：${result.versionJsonUrl}\n最新 JSON：${result.latestUrl}\n本地 JSON：${result.metadataFile}`);
        if (result.dryRun) console.log(JSON.stringify(result.metadata, null, 2));
      }
    }
  } catch (error) {
    // Never print native exec/fetch errors: their diagnostic may contain credentials or source URLs.
    const message = error.workDir ? `${error.message}；工作目录：${error.workDir}` : error.message;
    if (options?.json) console.log(JSON.stringify({ ok: false, error: message, workDir: error.workDir }));
    else console.error(message);
    process.exitCode = 1;
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}
