import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const testSource = join(root, 'cloud/test-push/uniCloud-alipay');
export const testPushDeployment = Object.freeze(JSON.parse(
  readFileSync(join(root, 'cloud/test-push/deployment.json'), 'utf8'),
));

// Always prepare a new tree so an old deployment or space binding cannot be inherited.
export function prepareTestPushCloud(output) {
  const cloud = join(output, 'uniCloud-alipay');
  mkdirSync(output);
  const { projectName, appId } = testPushDeployment;
  writeFileSync(join(output, 'manifest.json'), JSON.stringify({ name: projectName, appid: appId }));
  writeFileSync(join(output, 'pages.json'), '{"pages":[]}\n');
  writeFileSync(join(output, 'App.vue'), '<script></script>\n');
  // HBuilderX keeps local environment variables in .env. Keep them out of the upload.
  cpSync(testSource, cloud, {
    recursive: true,
    filter: path => !basename(path).startsWith('.') && basename(path) !== 'node_modules',
  });
  return cloud;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const staging = mkdtempSync(join(realpathSync(tmpdir()), 'nuwax-push-test-preview-'));
  try {
    process.stdout.write(`${prepareTestPushCloud(join(staging, testPushDeployment.projectName))}\n`);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}
