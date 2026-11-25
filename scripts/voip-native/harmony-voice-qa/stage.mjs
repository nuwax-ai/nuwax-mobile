import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import JSON5 from 'json5';
import { testOrigin } from '../prepare-business-qa.mjs';

const libraryName = 'libnuwax_harmony_rtc.so';
const source = new URL('./', import.meta.url);
const voiceHooks = [
  '    VoipBridge.nativeVoiceStart = HarmonyNativeVoice.start',
  '    VoipBridge.nativeVoiceStop = HarmonyNativeVoice.stop',
  '    VoipBridge.nativeVoiceMute = HarmonyNativeVoice.mute',
].join('\n');

export async function verifyVoiceQaTarget(root, project) {
  const variant = root.endsWith('/out/voip-business-qa-project') ? root : `${root}/out/voip-business-qa-project`;
  if (!relative(variant, project).startsWith('unpackage/')) {
    throw new Error('Native Harmony voice must target the isolated VoIP business QA output');
  }
  const metadata = JSON.parse(await readFile(`${variant}/nuwax-local-qa.json`, 'utf8'));
  if (metadata.flavor !== 'voip-business-qa' || metadata.apiOrigin !== testOrigin) {
    throw new Error('Native Harmony voice requires the VoIP business QA test origin');
  }
  const dependencies = JSON5.parse(await readFile(`${project}/oh-package.json5`, 'utf8')).dependencies;
  if (!dependencies?.['@uni_modules/nuwax-livekit']) {
    throw new Error('Regenerate the Harmony QA project from the current source to include nuwax-livekit');
  }
}

export function pinVoiceQaBridge(source) {
  const initialize = '  static initialize(config: Configuration, restoring: boolean = false): void {\n';
  const restore = 'const config = VoipBridge.readSession(true) ?? VoipBridge.readSession(false)\n      if (config) {';
  if (source.split(initialize).length !== 2 || source.split(restore).length !== 2) {
    throw new Error('The Harmony VoIP session entry points changed; review test origin isolation');
  }
  return source
    .replace(initialize, initialize + '    if (config.apiBaseUrl !== VoipBridge.nativeVoiceTestOrigin) return\n')
    .replace(restore, restore.replace('if (config)', 'if (config && config.apiBaseUrl === VoipBridge.nativeVoiceTestOrigin)'));
}

export async function stageVoiceQa(project, library, entryAbility, abilitySource, abilityConfig) {
  const entry = `${project}/entry`;
  const nativeLibrary = `${entry}/libs/arm64-v8a/${libraryName}`;
  const types = `${entry}/src/main/cpp/types/libnuwax_harmony_rtc`;
  const nativeHost = `${entry}/src/main/ets/voip/HarmonyNativeVoice`;
  const importPath = relative(dirname(entryAbility), nativeHost);
  const importHook = `import { HarmonyNativeVoice } from '${importPath.startsWith('.') ? importPath : './' + importPath}'\n`;
  const packageFile = `${entry}/oh-package.json5`;
  const entryPackage = JSON5.parse(await readFile(packageFile, 'utf8'));
  const dependency = 'file:./src/main/cpp/types/libnuwax_harmony_rtc';
  const anchor = '    VoipBridge.bindPush(this)';
  const existingDependency = entryPackage.dependencies?.[libraryName];
  if (abilitySource.split(anchor).length !== 2 || (existingDependency && existingDependency !== dependency)) {
    throw new Error('Native Harmony voice conflicts with the generated QA entry configuration');
  }

  await mkdir(dirname(nativeLibrary), { recursive: true });
  await mkdir(types, { recursive: true });
  if (library !== nativeLibrary) await copyFile(library, nativeLibrary);
  await copyFile(new URL('HarmonyNativeVoice.ets', source), `${nativeHost}.ets`);
  await copyFile(new URL('index.d.ts', source), `${types}/index.d.ts`);
  await writeFile(`${types}/oh-package.json5`, JSON.stringify({ name: libraryName, version: '0.1.0', types: './index.d.ts' }, null, 2) + '\n');
  entryPackage.dependencies ??= {};
  entryPackage.dependencies[libraryName] = dependency;
  await writeFile(packageFile, JSON.stringify(entryPackage, null, 2) + '\n');

  abilityConfig.backgroundModes ??= [];
  if (!abilityConfig.backgroundModes.includes('voip')) abilityConfig.backgroundModes.push('voip');
  const unhooked = abilitySource.replace(importHook, '').replace('\n' + voiceHooks, '');
  await writeFile(entryAbility, importHook + unhooked.replace(anchor, anchor + '\n' + voiceHooks));
}
