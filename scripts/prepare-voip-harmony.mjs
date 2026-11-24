import { readFile, writeFile, mkdir, copyFile, cp, realpath } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSON5 from 'json5';
import { pinVoiceQaBridge, stageVoiceQa, verifyVoiceQaTarget } from './voip-native/harmony-voice-qa/stage.mjs';

function prepareEntryAbility(source) {
  const marker = '// nuwax-voip-entry-hook';
  const hook = 'VoipBridge.bindPush(this)';
  const entryClass = /^[ \t]*export\s+default\s+class\s+EntryAbility\s+extends\s+\w+\s*\{/m;
  const lifecycle = /^[ \t]*(?:(?:public|protected|override)\s+)*onCreate\s*\([^)]*\)\s*(?::\s*void\s*)?\{/m;
  const lifecycleDeclaration = /^[ \t]*(?:(?:public|protected|override|async)\s+)*onCreate\s*\(/m;
  const entry = entryClass.exec(source);
  if (!entry) throw new Error('Cannot locate the generated EntryAbility class for the VoIP hook');
  const bodyStart = entry.index + entry[0].length;
  const body = source.slice(bodyStart);
  const onCreate = lifecycle.exec(body);
  if (source.includes(marker)) {
    if (!onCreate || !body.slice(onCreate.index + onCreate[0].length).trimStart().startsWith(hook)) {
      throw new Error('VoIP hook marker exists but EntryAbility.onCreate does not register push first');
    }
    return source;
  }
  if (!onCreate && lifecycleDeclaration.test(body)) {
    throw new Error('EntryAbility.onCreate must be synchronous to register VoIP push');
  }
  const imports = `${marker}\nimport { VoipBridge } from '@uni_modules/nuwax-voip'\n`;
  if (onCreate) {
    return imports + source.slice(0, bodyStart) + body.replace(lifecycle, `$&\n    ${hook}`);
  }
  return imports + "import { Want as VoipWant, AbilityConstant as VoipAbilityConstant } from '@kit.AbilityKit'\n" +
    source.slice(0, bodyStart) + `\n  onCreate(want: VoipWant, launchParam: VoipAbilityConstant.LaunchParam): void {
    ${hook}
    super.onCreate(want, launchParam)
  }` + body;
}

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const project = await realpath(resolve(process.argv[2] ?? `${root}/unpackage/dist/dev/app-harmony`));
if (!['out/', 'unpackage/'].some(prefix => relative(root, project).startsWith(prefix))) throw new Error('Refusing to modify a project outside this worktree ignored output');
const voiceQaLibrary = process.env.NUWAX_HARMONY_VOICE_LIBRARY;
if (voiceQaLibrary) await verifyVoiceQaTarget(root, project);
const entry = `${project}/entry/src/main`;
const modulePath = `${entry}/module.json5`;
const config = JSON5.parse(await readFile(modulePath, 'utf8'));
const main = config.module.abilities.find(value => value.name === 'EntryAbility');
if (!main) throw new Error('EntryAbility not found');
const abilityPath = await realpath(resolve(entry, main.srcEntry ?? './ets/entryability/EntryAbility.ets'));
if (!relative(entry, abilityPath).startsWith('ets/')) throw new Error('EntryAbility must be inside the generated entry source directory');
const abilitySource = (await readFile(abilityPath, 'utf8')).replace(
  "from '../../../../../uni_modules/nuwax-voip/utssdk/app-harmony/VoipBridge'", "from '@uni_modules/nuwax-voip'");
const preparedAbility = prepareEntryAbility(abilitySource);
if (!voiceQaLibrary && preparedAbility.includes('VoipBridge.nativeVoiceStart = HarmonyNativeVoice.start')) {
  throw new Error('Generated QA output contains native voice. Supply NUWAX_HARMONY_VOICE_LIBRARY or regenerate the standard project.');
}
const receiverOwners = config.module.abilities.filter(value => value.name !== 'EntryAbility' && value.skills?.some(skill => skill.actions?.includes('action.ohos.push.listener')));
if (receiverOwners.length) throw new Error('Native push listener already belongs to another Ability; reconcile it before building');
main.skills ??= [];
if (!main.skills.some(skill => skill.actions?.includes('action.ohos.push.listener'))) main.skills.push({ actions: ['action.ohos.push.listener'] });
if (!config.module.abilities.some(value => value.name === 'NuwaxVoipMediaAbility')) config.module.abilities.push({
  name: 'NuwaxVoipMediaAbility', srcEntry: './ets/voip/NuwaxVoipMediaAbility.ets', exported: false,
  launchType: 'singleton', backgroundModes: ['voip'], label: '$string:voip_call_label',
});
const callAbility = config.module.abilities.find(value => value.name === 'NuwaxVoipMediaAbility');
callAbility.startWindowIcon = main.startWindowIcon;
callAbility.startWindowBackground = main.startWindowBackground;
const permissions = JSON5.parse(await readFile(`${root}/uni_modules/nuwax-voip/utssdk/app-harmony/module.json5`, 'utf8')).module.requestPermissions;
const pluginModule = `${project}/uni_modules/nuwax-voip/src/main/module.json5`;
const plugin = JSON5.parse(await readFile(pluginModule, 'utf8'));
delete plugin.requestPermissions;
plugin.module.requestPermissions = permissions;
await writeFile(pluginModule, JSON.stringify(plugin, null, 2) + '\n');
await cp(`${root}/uni_modules/nuwax-voip/utssdk/app-harmony/resources`, `${project}/uni_modules/nuwax-voip/src/main/resources`, { recursive: true });
const bridgePath = 'uni_modules/nuwax-voip/utssdk/app-harmony/VoipBridge.ets';
const bridgeSource = await readFile(`${root}/${bridgePath}`, 'utf8');
await writeFile(`${project}/${bridgePath}`, voiceQaLibrary ? pinVoiceQaBridge(bridgeSource) : bridgeSource);
config.module.requestPermissions ??= [];
for (const permission of permissions) {
  const old = config.module.requestPermissions.find(value => value.name === permission.name);
  if (!old) config.module.requestPermissions.push(permission);
  else if (permission.usedScene) old.usedScene = { ...old.usedScene, abilities: [...new Set([...(old.usedScene?.abilities ?? []), ...permission.usedScene.abilities])], when: 'inuse' };
}
const source = `${root}/scripts/voip-native/harmony`;
await mkdir(`${entry}/ets/voip`, { recursive: true });
await mkdir(`${entry}/ets/pages`, { recursive: true });
await copyFile(`${source}/NuwaxVoipMediaAbility.ets`, `${entry}/ets/voip/NuwaxVoipMediaAbility.ets`);
await copyFile(`${source}/NuwaxVoipMedia.ets`, `${entry}/ets/pages/NuwaxVoipMedia.ets`);
await cp(`${root}/static/app/voip`, `${entry}/resources/rawfile/voip`, { recursive: true });
const media = `${entry}/resources/rawfile/voip`;
await cp(`${root}/static/voip/call-icons`, `${media}/call-icons`, { recursive: true });
await copyFile(`${source}/media.css`, `${media}/harmony.css`);
const mediaHtml = await readFile(`${media}/media.html`, 'utf8');
if (!mediaHtml.includes('</head>')) throw new Error('Cannot find the head of the generated VoIP media page');
await writeFile(`${media}/media.html`, mediaHtml.replace('</head>', '<link rel="stylesheet" href="harmony.css"></head>'));
const pagesFile = `${entry}/resources/base/profile/main_pages.json`;
const pages = JSON5.parse(await readFile(pagesFile, 'utf8'));
if (!pages.src.includes('pages/NuwaxVoipMedia')) pages.src.push('pages/NuwaxVoipMedia');
await writeFile(pagesFile, JSON.stringify(pages, null, 2) + '\n');
for (const locale of ['base', 'en_US', 'zh_CN', 'zh_TW', 'zh_HK']) {
  const dir = `${entry}/resources/${locale}/element`; await mkdir(dir, { recursive: true });
  const path = `${dir}/string.json`; let strings;
  try { strings = JSON5.parse(await readFile(path, 'utf8')); } catch { strings = { string: [] }; }
  const values = locale === 'en_US' ? { voip_call_label: 'Call', voip_microphone_reason: 'Microphone access for voice calls', voip_camera_reason: 'Camera access for video calls' } :
    { voip_call_label: '通话', voip_microphone_reason: '用于语音通话', voip_camera_reason: '用于视频通话' };
  for (const [name, value] of Object.entries(values)) { const old = strings.string.find(item => item.name === name); if (old) old.value = value; else strings.string.push({ name, value }); }
  await writeFile(path, JSON.stringify(strings, null, 2) + '\n');
}
if (voiceQaLibrary) await stageVoiceQa(project, resolve(voiceQaLibrary), abilityPath, preparedAbility, main);
else await writeFile(abilityPath, preparedAbility);
await writeFile(modulePath, JSON.stringify(config, null, 2) + '\n');
console.log('[voip] Harmony native call host / push / background configuration regenerated');
