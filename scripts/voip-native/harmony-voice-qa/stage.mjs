import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import JSON5 from 'json5';
import { fingerprintBusinessQaSource, testOrigin } from '../prepare-business-qa.mjs';

const libraryName = 'libnuwax_harmony_rtc.so';
const source = new URL('./', import.meta.url);
const voiceHooks = [
  '    VoipBridge.nativeVoiceStart = HarmonyNativeVoice.start',
  '    VoipBridge.nativeVoiceStop = HarmonyNativeVoice.stop',
  '    VoipBridge.nativeVoiceMute = HarmonyNativeVoice.mute',
].join('\n');

export async function verifyVoiceQaTarget(root, project) {
  const nested = root.endsWith('/out/voip-business-qa-project');
  const sourceRoot = nested ? dirname(dirname(root)) : root;
  const variant = `${sourceRoot}/out/voip-business-qa-project`;
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
  if (metadata.sourceDigest !== await fingerprintBusinessQaSource(sourceRoot)) {
    throw new Error('The Harmony QA source snapshot is stale. Run prepare-business-qa.mjs and regenerate the HBuilderX export.');
  }
  const { appid } = JSON5.parse(await readFile(`${variant}/manifest.json`, 'utf8'));
  if (typeof appid !== 'string' || !/^[\w-]+$/.test(appid)) throw new Error('Invalid Harmony QA app ID');
  // HBuilderX writes the build time in milliseconds next to the generated app resources.
  const stamp = await readFile(`${project}/entry/src/main/resources/resfile/uni-app-x/apps/${appid}/www/buildstamp`, 'utf8')
    .catch(error => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
  const builtAt = Number(stamp.trim());
  const preparedAt = Date.parse(metadata.preparedAt);
  if (!Number.isSafeInteger(builtAt) || !Number.isFinite(preparedAt) || builtAt < preparedAt) {
    throw new Error('The HBuilderX export predates the Harmony QA source snapshot. Regenerate the Harmony export before assembly.');
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

function wireMeetingTaskReturn(source) {
  const marker = '// nuwax-meeting-task-return';
  const hook = name => `if (VoipBridge.current == null) handleMeetingBackgroundWant(${name}) ${marker}`;
  const imports = "import { handleMeetingBackgroundWant } from '@uni_modules/nuwax-livekit'\n";
  const entryClass = /^[ \t]*export\s+default\s+class\s+EntryAbility\s+extends\s+\w+\s*\{/m;
  const lifecycle = /^[ \t]*(?:(?:public|protected|override)\s+)*onNewWant\s*\(\s*(\w+)\s*:\s*[\w.]+\s*,\s*\w+\s*:\s*[\w.]+\s*\)\s*(?::\s*void\s*)?\{/m;
  const declaration = /^[ \t]*(?:(?:public|protected|override|async)\s+)*onNewWant\s*\(/m;
  const entry = entryClass.exec(source);
  if (!entry) throw new Error('Could not find EntryAbility for the meeting notification');
  const bodyStart = entry.index + entry[0].length;
  const body = source.slice(bodyStart);
  const existing = lifecycle.exec(body);
  if (source.includes(marker)) {
    if (!existing || !source.includes(imports) ||
      !body.slice(existing.index + existing[0].length).trimStart().startsWith(hook(existing[1]))) {
      throw new Error('The existing meeting notification hook in EntryAbility is incomplete');
    }
    return source;
  }
  if (existing) {
    const at = bodyStart + existing.index + existing[0].length;
    return imports + source.slice(0, at) + '\n    ' + hook(existing[1]) + '\n' + source.slice(at);
  }
  if (declaration.test(body)) throw new Error('EntryAbility.onNewWant must accept an Ability Kit Want and LaunchParam');
  const types = "import { Want as MeetingTaskWant, AbilityConstant as MeetingTaskAbilityConstant } from '@kit.AbilityKit'\n";
  return imports + types + source.slice(0, bodyStart) + `
  onNewWant(want: MeetingTaskWant, launchParam: MeetingTaskAbilityConstant.LaunchParam): void {
    ${hook('want')}
    super.onNewWant(want, launchParam)
  }` + body;
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

  const unhooked = abilitySource.replace(importHook, '').replace('\n' + voiceHooks, '');
  const prepared = wireMeetingTaskReturn(unhooked.replace(anchor, anchor + '\n' + voiceHooks));
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
  await writeFile(entryAbility, importHook + prepared);
}
