// Register a successfully built native host with HX 5.34. Never accept an unbuilt/stale plugin.
import { createRequire } from 'node:module';
import { readFile, readdir, copyFile, mkdir, rename, stat, cp, rm, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const hx = '/Applications/HBuilderX.app/Contents/HBuilderX';
const require = createRequire(import.meta.url);
const sdk = require(`${hx}/plugins/uniapp-uts-v1/node_modules/@dcloudio/uni-uts-v1/dist/manifest/index.js`);
if (!spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print:CFBundleShortVersionString', '/Applications/HBuilderX.app/Contents/Info.plist'], { encoding: 'utf8' }).stdout?.trim().startsWith('5.34')) throw Error('This adapter requires HBuilderX 5.34');
const env = { vapor: false, compilerVersion: '5.34' };
const verifyOnly = process.argv.includes('--verify-only');
const cacheDir = `${root}/unpackage/cache/uts_custom_sdk_ios`;
const outputDir = `${root}/unpackage/dist/dev/app-ios`;
const app = `${root}/out/voip-business-ios-derived/Build/Products/Debug-iphoneos/UniAppX.app`;
if (spawnSync('codesign', ['--verify', '--deep', '--strict', app]).status !== 0) throw Error('Native host signature invalid');
const spec = JSON.parse(await readFile(`${root}/out/voip-business-ios/project.json`, 'utf8'));
if (spec.packages.LiveKit.exactVersion !== '2.19.0') throw Error('Unexpected LiveKit version');
const digest = async p => createHash('sha256').update(await readFile(p)).digest('hex');
const modules = [];
for (const dir of await readdir(`${root}/out/voip-business-ios/Modules`, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const name = dir.name;
  const dep = spec.targets.UniAppX.dependencies.find(x => x.target === name);
  if (!dep) continue;
  const plugin = (await readdir(`${outputDir}/uni_modules`)).find(id => `unimodule${id.split('-').map(p => p[0].toUpperCase() + p.slice(1)).join('')}` === name);
  if (!plugin) throw Error(`Missing HX native source for ${name}`);
  const source = `${outputDir}/uni_modules/${plugin}/utssdk/app-ios`;
  const built = `${root}/out/voip-business-ios/Modules/${name}`;
  const binaryTime = (await stat(`${app}/Frameworks/${name}.framework/${name}`)).mtimeMs;
  if ((await stat(`${built}/index.swift`)).mtimeMs > binaryTime) throw Error(`Host must be rebuilt after generated Swift changed: ${plugin}`);
  if ((await stat(`${root}/uni_modules/${plugin}/utssdk/app-ios/index.uts`)).mtimeMs > (await stat(`${built}/index.swift`)).mtimeMs) throw Error(`Native index changed since host generation: ${plugin}`);
  for (const file of await readdir(`${root}/uni_modules/${plugin}/utssdk/app-ios`)) {
    if (!/\.(swift|mm?|h|cpp)$/.test(file)) continue;
    if (await digest(`${root}/uni_modules/${plugin}/utssdk/app-ios/${file}`) !== await digest(`${built}/${file}`) || (await stat(`${built}/${file}`)).mtimeMs > binaryTime) throw Error(`Native host is stale: ${plugin}/${file}`);
  }
  if (!(await stat(`${source}/index.swift`).catch(() => null))) {
    const cached = await sdk.checkSwiftCompile('custom', { id: plugin, env, cacheDir, pluginDir: `${root}/uni_modules/${plugin}`, pluginRelativeDir: `uni_modules/${plugin}`, is_uni_modules: true });
    if (cached.expired) throw Error(`Generate and rebuild native host before registration: ${plugin}`);
    continue;
  }
  for (const file of await readdir(source)) {
    if (!/\.(swift|mm?|h|cpp)$/.test(file)) continue;
    if (await digest(`${source}/${file}`) !== await digest(`${root}/out/voip-business-ios/Modules/${name}/${file}`)) throw Error(`Native source changed after host build: ${plugin}/${file}`);
    if (file !== 'index.swift' && await digest(`${source}/${file}`) !== await digest(`${root}/uni_modules/${plugin}/utssdk/app-ios/${file}`)) throw Error(`HX source is stale: ${plugin}/${file}`);
  }
  const generated = await stat(`${source}/index.swift`);
  if ((await stat(`${root}/uni_modules/${plugin}/utssdk/app-ios/index.uts`)).mtimeMs > generated.mtimeMs) throw Error(`Regenerate HX native source: ${plugin}`);
  await stat(`${app}/Frameworks/${name}.framework/${name}`);
  modules.push({ plugin, name });
}
if (verifyOnly) { console.log(`Verified signed host, source freshness and HX caches; ${modules.length} modules can be registered`); process.exit(0); }
// Apply successful native patches from the same HX compiler before signing the host.
const patches = `${cacheDir}/modules`;
const frames = (await readdir(patches).catch(() => [])).filter(x => x.endsWith('.framework'));
const exec = (cmd, args, options = {}) => {
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  if (res.status !== 0) throw Error(`${cmd} failed: ${res.stderr?.slice(0, 200)}`);
  return res.stdout;
};
await mkdir(`${root}/out/voip-hx`, { recursive: true });
if (frames.length) {
  for (const file of frames) {
    await stat(`${app}/Frameworks/${file}`);
    const deps = exec('otool', ['-L', `${patches}/${file}/${file.slice(0, -10)}`]);
    for (const match of deps.matchAll(/@rpath\/([^/]+)\.framework\//g)) await stat(`${app}/Frameworks/${match[1]}.framework`);
  }
  const prefix = `${root}/out/voip-hx/host-public-cert-`;
  exec('codesign', ['-d', `--extract-certificates=${prefix}`, app]);
  const identity = createHash('sha1').update(await readFile(prefix + '0')).digest('hex').toUpperCase();
  for (const file of frames) {
    await rm(`${app}/Frameworks/${file}`, { recursive: true });
    await cp(`${patches}/${file}`, `${app}/Frameworks/${file}`, { recursive: true, dereference: false });
    exec('codesign', ['--force', '--sign', identity, '--timestamp=none', `${app}/Frameworks/${file}`]);
  }
  exec('codesign', ['--force', '--sign', identity, '--preserve-metadata=identifier,entitlements,requirements,flags', '--timestamp=none', app]);
}
exec('codesign', ['--verify', '--deep', '--strict', app]);
// Validate every module before updating any cache.
for (const { plugin } of modules) {
  const pluginRelativeDir = `uni_modules/${plugin}`;
  const dest = `${cacheDir}/app-ios/uts/${pluginRelativeDir}`;
  await mkdir(dest, { recursive: true });
  await copyFile(`${outputDir}/${pluginRelativeDir}/utssdk/app-ios/config.json`, `${dest}/config.json`);
  sdk.storeSourceMap('app-ios', pluginRelativeDir, outputDir, cacheDir, true);
  await sdk.genManifestFile('app-ios', { cacheDir, pluginDir: `${root}/${pluginRelativeDir}`, pluginRelativeDir, is_uni_modules: true, env });
}
// Both modes use the same HX 5.34 VDOM native ABI; populate local-base source caches.
await mkdir(`${root}/unpackage/cache/uts_custom_ios/app-ios`, { recursive: true });
await cp(`${cacheDir}/app-ios/uts`, `${root}/unpackage/cache/uts_custom_ios/app-ios/uts`, { recursive: true });
// These patches have been rebuilt into the signed host; mirrors the launcher's post-sign cleanup.
for (const file of await readdir(patches).catch(() => [])) {
  if (file.endsWith('.framework')) await stat(`${app}/Frameworks/${file}`);
}
await mkdir(`${root}/out/voip-hx`, { recursive: true });
await rename(patches, `${root}/out/voip-hx/absorbed-native-patches-${Date.now()}`).catch(e => { if (e.code !== 'ENOENT') throw e; });
const stage = `${root}/out/voip-hx/ipa-stage`;
await rm(stage, { recursive: true, force: true });
await mkdir(`${stage}/Payload`, { recursive: true });
await cp(app, `${stage}/Payload/UniAppX.app`, { recursive: true, dereference: false });
const ipa = `${root}/out/voip-business-packages/iOS_debug-hx-${Date.now()}.ipa`;
// zip keeps explicit Payload/App directory records required by HX's IPA parser.
exec('zip', ['-qr', ipa, 'Payload'], { cwd: stage });
await rm(stage, { recursive: true });
await rm(`${root}/out/voip-business-packages/iOS_debug-latest.ipa`, { force: true });
await symlink(ipa.split('/').at(-1), `${root}/out/voip-business-packages/iOS_debug-latest.ipa`);
await copyFile(ipa, `${root}/unpackage/debug/iOS_debug.ipa`);
console.log(`Registered ${modules.length} source-verified native modules already compiled into the signed HX host`);
