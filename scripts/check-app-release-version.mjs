import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

function readVersion(manifest, source) {
  const { versionName, versionCode } = JSON.parse(manifest);
  if (typeof versionName !== 'string' || !versionPattern.test(versionName)) {
    throw new Error(`${source} 的 versionName 应为 X.Y.Z`);
  }
  const code = typeof versionCode === 'number' && !Number.isSafeInteger(versionCode)
    ? '' : String(versionCode ?? '');
  if (!/^[1-9][0-9]*$/.test(code)) {
    throw new Error(`${source} 的 versionCode 应为正整数`);
  }
  return { name: versionName, parts: versionName.split('.').map(BigInt), code: BigInt(code) };
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

try {
  const [lastRelease, ...rest] = process.argv.slice(2);
  if (!lastRelease || rest.length) {
    throw new Error('用法：pnpm app:version:check <上次正式发版的 tag 或 commit>');
  }

  let baseline;
  try {
    const commit = git('rev-parse', '--verify', '--end-of-options', `${lastRelease}^{commit}`).trim();
    baseline = git('show', `${commit}:manifest.json`);
  } catch {
    throw new Error(`无法读取上次正式发版 ${lastRelease} 的 manifest.json`);
  }
  const previous = readVersion(baseline, lastRelease);
  const current = readVersion(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'), '当前 manifest.json');
  const changedIndex = current.parts.findIndex((part, index) => part !== previous.parts[index]);
  const errors = [];
  if (changedIndex < 0 || current.parts[changedIndex] < previous.parts[changedIndex]) {
    errors.push(`versionName ${current.name} 应大于 ${previous.name}`);
  }
  if (current.code <= previous.code) {
    errors.push(`versionCode ${current.code} 应大于 ${previous.code}`);
  }
  if (errors.length) throw new Error(errors.join('，'));
  console.log(`App 版本检查通过：${previous.name} (${previous.code}) → ${current.name} (${current.code})`);
} catch (error) {
  console.error(`App 版本检查失败：${error.message}`);
  process.exitCode = 1;
}
