import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const destination = path.resolve(process.argv[2]);
const testOrigin = 'https://testagent.xspaceagi.com';
const productionOrigin = 'https://agent.nuwax.com';

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) {
    throw new Error(`iOS tester 源码模板已变化，请核对：${before}`);
  }
  return source.replace(before, after);
}

const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
  cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
}).split('\0').filter(Boolean);
const digest = createHash('sha256');
for (const file of [...new Set(files)].sort()) {
  const input = path.join(root, file);
  const info = await lstat(input).catch(() => null);
  if (!info) continue;
  const target = path.join(destination, file);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(input, target, { dereference: false, verbatimSymlinks: true });
  if (info.isFile()) digest.update(file).update(await readFile(input));
}

await cp(path.join(root, 'static/app/offline-h5'), path.join(destination, 'static/app/offline-h5'), {
  recursive: true,
});
await symlink(path.join(root, 'node_modules'), path.join(destination, 'node_modules'));

const configPath = path.join(destination, 'constants/config.uts');
let config = await readFile(configPath, 'utf8');
config = replaceOnce(config, `DEFAULT_API_BASE_URL = "${productionOrigin}";`,
  `DEFAULT_API_BASE_URL = "${testOrigin}";`);
config = replaceOnce(config, 'API_BASE_URL = readStoredApiBaseUrl();',
  'API_BASE_URL = DEFAULT_API_BASE_URL;');
config = replaceOnce(config, 'if (normalized.length == 0) return false;',
  'if (normalized != DEFAULT_API_BASE_URL) return false;');
await writeFile(configPath, config);

const updatePath = path.join(destination, 'utils/partnerAppUpdate.uts');
const update = await readFile(updatePath, 'utf8');
const checkUpdate = 'export async function checkPartnerAppUpdate(): Promise<void> {';
await writeFile(updatePath, replaceOnce(update, checkUpdate,
  `${checkUpdate}\n  return; // 保留本地签名测试包。`));

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
await writeFile(path.join(destination, 'nuwax-ios-tester.json'), JSON.stringify({
  flavor: 'ios-tester', apiOrigin: testOrigin, commit, sourceDigest: digest.digest('hex'),
  preparedAt: new Date().toISOString(),
}, null, 2) + '\n');
