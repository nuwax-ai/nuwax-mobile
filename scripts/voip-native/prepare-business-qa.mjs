// Create a source build variant in ignored out/. Never changes production defaults in the checkout.
import { cp, mkdir, readFile, writeFile, rm, lstat, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const testOrigin = 'https://testagent.xspaceagi.com';
export function qaConfig(source) {
  const replacements = [
    ['DEFAULT_API_BASE_URL = "https://agent.nuwax.com";', `DEFAULT_API_BASE_URL = "${testOrigin}";`],
    ['API_BASE_URL = readStoredApiBaseUrl();', `API_BASE_URL = "${testOrigin}";`],
    ['if (normalized.length == 0) return false;', `if (normalized != "${testOrigin}") return false;`],
  ];
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw Error('QA configuration source changed; review the variant');
    source = source.replace(before, after);
  }
  return source;
}
export function qaManager(source) {
  const before = 'process.env.NODE_ENV == "development" && getApiBaseUrl() == "https://testagent.xspaceagi.com"';
  if (source.split(before).length !== 2) throw Error('QA VoIP gate source changed; review the variant');
  return source.replace(before, 'getApiBaseUrl() == "https://testagent.xspaceagi.com"');
}

export function qaUpdate(source) {
  const before = 'export async function checkPartnerAppUpdate(): Promise<void> {';
  if (source.split(before).length !== 2) throw Error('QA update source changed; review the variant');
  // A store update would replace the signed internal test build during this QA run.
  return source.replace(before, before + '\n  return; // Internal standalone QA: retain this signed build.');
}

async function prepare() {
  const root = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
  const dest = `${root}/out/voip-business-qa-project`;
  const listing = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  if (listing.status !== 0) throw Error('Cannot inventory source');
  await rm(dest, { recursive: true, force: true }); await mkdir(dest, { recursive: true });
  const hash = createHash('sha256');
  for (const file of [...new Set(listing.stdout.split('\0').filter(Boolean))].sort()) {
    const src = path.join(root, file);
    if (!(await lstat(src).catch(() => null))) continue;
    await mkdir(path.dirname(path.join(dest, file)), { recursive: true });
    await cp(src, path.join(dest, file), { dereference: false });
    if ((await lstat(src)).isFile()) hash.update(file).update(await readFile(src));
  }
  // Reuse generated, verified offline assets and locally supplied native libraries; no signing files.
  for (const file of ['static/app/offline-h5', 'uni_modules/nuwax-esp-provisioning/utssdk/app-ios/Frameworks']) {
    if (await lstat(path.join(root, file)).catch(() => null)) await cp(path.join(root, file), path.join(dest, file), { recursive: true });
  }
  for (const module of await readdir(`${root}/uni_modules`)) {
    const file = `uni_modules/${module}/utssdk/app-ios/Frameworks`;
    if (await lstat(path.join(root, file)).catch(() => null)) await cp(path.join(root, file), path.join(dest, file), { recursive: true });
  }
  for (const [file, transform] of [['constants/config.uts', qaConfig], ['features/voip/callManager.uts', qaManager], ['utils/partnerAppUpdate.uts', qaUpdate]]) {
    await writeFile(path.join(dest, file), transform(await readFile(path.join(dest, file), 'utf8')));
  }
  // Only build dependencies are shared; all generated resources/caches stay in this worktree.
  const { symlink } = await import('node:fs/promises');
  await symlink(`${root}/node_modules`, `${dest}/node_modules`);
  await writeFile(`${dest}/nuwax-local-qa.json`, JSON.stringify({ flavor: 'voip-business-qa', apiOrigin: testOrigin, sourceDigest: hash.digest('hex'), preparedAt: new Date().toISOString() }, null, 2));
  console.log(`Prepared standalone real App test variant: ${dest}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepare();
