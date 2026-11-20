import { copyFileSync, cpSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const testSource = join(root, 'cloud/test-push/uniCloud-alipay');
const productionSource = join(root, 'uniCloud-alipay/cloudfunctions/push-send');

// Always prepare a new tree so an old deployment or space binding cannot be inherited.
export function prepareTestPushCloud(output) {
  const cloud = join(output, 'uniCloud-alipay');
  const testFunction = join(cloud, 'cloudfunctions/push-send-test');
  mkdirSync(output);
  cpSync(testSource, cloud, { recursive: true });
  for (const file of ['device-routes.js', 'voip.js']) {
    copyFileSync(join(productionSource, file), join(testFunction, file));
  }
  return cloud;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const parent = join(root, 'unpackage/push-test-deploy');
  mkdirSync(parent, { recursive: true });
  const output = join(parent, new Date().toISOString().replace(/[:.]/g, '-'));
  process.stdout.write(`${prepareTestPushCloud(output)}\n`);
}
