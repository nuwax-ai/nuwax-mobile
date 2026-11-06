import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const project = resolve(process.argv[2] ?? `${root}/unpackage/dist/dev/app-harmony`);
const studio = process.env.DEVECO_HOME ?? '/Applications/DevEco-Studio.app/Contents';
for (const script of ['prepare-voip-media.mjs', 'prepare-voip-harmony.mjs']) {
  const result = spawnSync(process.execPath, [`${root}/scripts/${script}`, ...(script.includes('harmony') ? [project] : [])], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const result = spawnSync(`${studio}/tools/node/bin/node`, [`${studio}/tools/hvigor/bin/hvigorw.js`, '--mode', 'module', '-p', 'product=default', 'assembleHap', '--no-daemon'], {
  cwd: project, stdio: 'inherit', env: { ...process.env, DEVECO_SDK_HOME: process.env.DEVECO_SDK_HOME ?? `${studio}/sdk`,
    NODE_HOME: `${studio}/tools/node`, JAVA_HOME: process.env.JAVA_HOME ?? `${studio}/jbr/Contents/Home` },
});
process.exitCode = result.status ?? 1;
