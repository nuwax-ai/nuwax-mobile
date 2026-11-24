import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const lock = JSON.parse(readFileSync(join(root, 'custom-base.lock.json'), 'utf8'));
const result = spawnSync('git', ['-C', root, 'symbolic-ref', '--quiet', 'HEAD'], { encoding: 'utf8' });
const branch = result.stdout?.trim().replace(/^refs\/heads\//, '') ?? '';
const matched = branch && Object.hasOwn(lock.branches ?? {}, branch);
const profile = matched ? lock.branches[branch] : (lock.default ?? {});
const label = matched ? branch : 'default';
const { baseVersion, sdkVersion } = profile;

if (baseVersion !== undefined && (typeof baseVersion !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(baseVersion))) {
  throw new Error(`custom-base.lock.json 的 ${label}.baseVersion 必须采用 X.Y.Z`);
}
if (sdkVersion !== undefined && (typeof sdkVersion !== 'string' || !/^\d+\.\d+$/.test(sdkVersion))) {
  throw new Error(`custom-base.lock.json 的 ${label}.sdkVersion 必须采用 HBuilderX 主次版本（例如 5.34）`);
}
if (matched && (!baseVersion || !sdkVersion)) {
  throw new Error(`custom-base.lock.json 的 ${label} 必须同时设置 baseVersion 和 sdkVersion`);
}

switch (process.argv[2]) {
  case 'publish-base':
    if (matched) process.stdout.write(baseVersion);
    break;
  case 'base':
    process.stdout.write(baseVersion ? `${baseVersion}\t${label}\n` : '');
    break;
  case 'info':
  case 'sdk': {
    const version = process.argv[3] || process.env.NUWAX_HX_VERSION || sdkVersion;
    if (!version || !sdkVersion) break;
    if (!/^\d+\.\d+$/.test(version)) throw new Error(`无效 HBuilderX SDK 版本 ${version}`);
    // iOS 构建会直接改写解包后的 SDK。每个 checkout 和分支都需要自己的副本。
    const workspace = process.env.NUWAX_WORKSPACE_ROOT || join(homedir(), 'workspace');
    const name = (branch || 'default').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 48);
    const id = createHash('sha256').update(root).update('\0').update(branch).digest('hex').slice(0, 12);
    const destination = join(workspace, 'nuwax-mobile-offline-sdk', 'projects', `${name}-${id}`, version);
    if (process.argv[2] === 'info') {
      console.log(`当前分支 ${branch || '(detached HEAD)'}，离线 SDK ${version} → ${process.env.NUWAX_OFFLINE_SDK_HOME || destination}`);
    } else {
      process.stdout.write(`${version}\t${destination}\n`);
    }
    break;
  }
  default:
    throw new Error('Usage: node scripts/resolve-package-profile.mjs base|publish-base|info|sdk [HX_VERSION]');
}
