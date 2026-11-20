import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareTestPushCloud, testPushDeployment } from './prepare-test-push-cloud.mjs';

const cli = process.env.HX_CLI || '/Applications/HBuilderX.app/Contents/MacOS/cli';
const { projectName, provider, spaceId, spaceName } = testPushDeployment;
const functionName = 'push-send-test';
const collection = 'push-device-bindings';
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--init-index')) throw new Error('Usage: deploy-test-push-cloud.mjs [--init-index]');

function cloudCommand(args, step) {
  const output = execFileSync(cli, ['unicloud', ...args, '--protocol-version', '1',
    '--request-id', `nuwax-test-push-${step}`, '--json'], { encoding: 'utf8', timeout: 60_000 });
  const envelopes = output.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  const failure = envelopes.find(message => message.type === 'error');
  const result = envelopes.find(message => message.type === 'result');
  if (failure || !result) {
    throw new Error(`${step}: ${failure?.error?.message ?? 'HBuilderX did not return a result'}`);
  }
  return result.data;
}

function deploy(project) {
  if (provider !== 'alipay' || spaceId !== 'env-00jy72x2l4nj' || spaceName !== 'nuwax-push-test') {
    throw new Error('Expected a dedicated Alipay test space');
  }
  const spaces = cloudCommand(['service-space', 'list'], 'space-readback');
  if (!spaces.some(space => space.spaceId === spaceId && space.spaceName === spaceName && space.provider === provider)) {
    throw new Error(`Test space ${spaceName} (${spaceId}) was not found in the current DCloud account`);
  }
  const target = ['--project', project, '--provider', provider, '--space', spaceId];
  const cloud = prepareTestPushCloud(project);
  const path = join(cloud, 'cloudfunctions', functionName);

  const resources = cloudCommand(['database', 'list', ...target, '--kind', 'schema'], 'database-list');
  const schemaExists = resources.resources.some(resource => [collection, `${collection}.schema.json`].includes(resource.name));
  if (!schemaExists) {
    const schema = join(cloud, 'database', `${collection}.schema.json`);
    cloudCommand(['database', 'upload', ...target, '--path', schema, '--kind', 'schema', '--force'], 'schema-upload');
  }
  if (!schemaExists || args.includes('--init-index')) {
    const index = join(cloud, 'database', `${collection}.index.json`);
    cloudCommand(['database', 'upload', ...target, '--path', index, '--kind', 'index', '--force'], 'index-upload');
  }

  const functions = cloudCommand(['cloud-resource', 'list', ...target, '--kind', 'function'], 'function-list');
  const exists = functions.resources.some(resource => resource.name === functionName);
  cloudCommand(['cloud-function', 'upload', ...target, '--path', path, ...(exists ? ['--force'] : [])], 'function-upload');
  const uploaded = cloudCommand(['cloud-resource', 'list', ...target, '--kind', 'function'], 'function-readback');
  if (!uploaded.resources.some(resource => resource.name === functionName)) {
    throw new Error(`Cannot verify ${functionName} in ${spaceId}`);
  }
  console.log(`${spaceName} (${spaceId}) · ${functionName} · ${collection}`);
}

const temporary = mkdtempSync(join(realpathSync(tmpdir()), 'nuwax-push-test-deploy-'));
try {
  deploy(join(temporary, projectName));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
