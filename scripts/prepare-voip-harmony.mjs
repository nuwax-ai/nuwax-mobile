import { readFile, writeFile, mkdir, copyFile, cp, realpath } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSON5 from 'json5';
const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const project = await realpath(resolve(process.argv[2] ?? `${root}/unpackage/dist/dev/app-harmony`));
if (!['out/', 'unpackage/'].some(prefix => relative(root, project).startsWith(prefix))) throw new Error('Refusing to modify a project outside this worktree ignored output');
const entry = `${project}/entry/src/main`;
const modulePath = `${entry}/module.json5`;
const config = JSON5.parse(await readFile(modulePath, 'utf8'));
const main = config.module.abilities.find(value => value.name === 'EntryAbility');
if (!main) throw new Error('EntryAbility not found');
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
await copyFile(`${root}/uni_modules/nuwax-voip/utssdk/app-harmony/VoipBridge.ets`, `${project}/uni_modules/nuwax-voip/utssdk/app-harmony/VoipBridge.ets`);
config.module.requestPermissions ??= [];
for (const permission of permissions) {
  const old = config.module.requestPermissions.find(value => value.name === permission.name);
  if (!old) config.module.requestPermissions.push(permission);
  else if (permission.usedScene) old.usedScene = { ...old.usedScene, abilities: [...new Set([...(old.usedScene?.abilities ?? []), ...permission.usedScene.abilities])], when: 'inuse' };
}
await writeFile(modulePath, JSON.stringify(config, null, 2) + '\n');
const source = `${root}/scripts/voip-native/harmony`;
await mkdir(`${entry}/ets/voip`, { recursive: true });
await copyFile(`${source}/NuwaxVoipMediaAbility.ets`, `${entry}/ets/voip/NuwaxVoipMediaAbility.ets`);
await copyFile(`${source}/NuwaxVoipMedia.ets`, `${entry}/ets/pages/NuwaxVoipMedia.ets`);
await cp(`${root}/static/app/voip`, `${entry}/resources/rawfile/voip`, { recursive: true });
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
const ability = `${entry}/ets/entryability/EntryAbility.ets`;
let text = await readFile(ability, 'utf8');
text = text.replace("from '../../../../../uni_modules/nuwax-voip/utssdk/app-harmony/VoipBridge'", "from '@uni_modules/nuwax-voip'");
if (!text.includes('// nuwax-voip-entry-hook')) {
  text = `// nuwax-voip-entry-hook\nimport { VoipBridge } from '@uni_modules/nuwax-voip'\nimport { Want as VoipWant, AbilityConstant as VoipAbilityConstant } from '@kit.AbilityKit'\n` + text;
  if (/\bonCreate\s*\(/.test(text)) text = text.replace(/(\bonCreate\s*\([^)]*\)[^{]*\{)/, '$1\n    VoipBridge.bindPush(this)');
  else text = text.replace(/(export default class \w+ extends \w+\s*\{)/, '$1\n  onCreate(want: VoipWant, launchParam: VoipAbilityConstant.LaunchParam): void {\n    VoipBridge.bindPush(this)\n    super.onCreate(want, launchParam)\n  }');
}
await writeFile(ability, text);
console.log('[voip] Harmony native call host / push / background configuration regenerated');
