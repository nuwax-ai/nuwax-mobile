import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const fixtures: string[] = [];
const entry = 'unpackage/app-harmony/entry/src/main';
const plugin = 'unpackage/app-harmony/uni_modules/nuwax-voip';
const abilityFile = `${entry}/ets/entryability/EntryAbility.ets`;
const moduleFile = `${entry}/module.json5`;
const listener = 'action.ohos.push.listener';

function fixture(abilitySource: string, qa = false) {
  mkdirSync(join(root, 'out'), { recursive: true });
  const directory = mkdtempSync(join(root, 'out/voip-harmony-fixture-'));
  fixtures.push(directory);
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), content);
  };
  for (const source of [
    'scripts/prepare-voip-harmony.mjs', 'scripts/voip-native/harmony',
    'scripts/voip-native/harmony-voice-qa', 'scripts/voip-native/prepare-business-qa.mjs',
    'static/voip/call-icons', 'uni_modules/nuwax-voip/utssdk/app-harmony',
  ]) {
    mkdirSync(dirname(join(directory, source)), { recursive: true });
    cpSync(join(root, source), join(directory, source), { recursive: true });
  }
  const prefix = qa ? 'out/voip-business-qa-project/' : '';
  const writeProject = (path: string, content: string) => write(prefix + path, content);
  if (qa) write(prefix + 'nuwax-local-qa.json', '{"flavor":"voip-business-qa","apiOrigin":"https://testagent.xspaceagi.com"}');
  writeProject(abilityFile, abilitySource);
  writeProject(moduleFile, JSON.stringify({ module: { abilities: [{
    name: 'EntryAbility', srcEntry: './ets/entryability/EntryAbility.ets',
    startWindowIcon: '$media:icon', startWindowBackground: '$color:background',
    skills: [{ actions: ['action.system.home'] }],
  }] } }));
  writeProject(`${plugin}/src/main/module.json5`, '{"module":{}}');
  writeProject(`${plugin}/utssdk/app-harmony/VoipBridge.ets`, '');
  writeProject(`${entry}/resources/base/profile/main_pages.json`, '{"src":["pages/Index"]}');
  writeProject('unpackage/app-harmony/entry/oh-package.json5', '{"dependencies":{}}');
  write('static/app/voip/media.html', '<html><head></head><body></body></html>');
  write('native-voice-fixture.so', 'fixture');
  const run = (voice = false) => spawnSync(process.execPath, ['scripts/prepare-voip-harmony.mjs', prefix + 'unpackage/app-harmony'], {
    cwd: directory, encoding: 'utf8',
    env: { ...process.env, NUWAX_HARMONY_VOICE_LIBRARY: voice ? join(directory, 'native-voice-fixture.so') : '' },
  });
  const read = (path: string) => readFileSync(join(directory, prefix + path), 'utf8');
  return { run, read };
}

afterEach(() => {
  for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('Harmony generated VoIP host', () => {
  it('installs one synchronous hook and one listener and is safe to run again', () => {
    const project = fixture(`import { UniEntryAbility } from '@dcloudio/uni-app-x-runtime'
export default class EntryAbility extends UniEntryAbility {
  constructor() { super('__UNI__fixture', {}) }
}`);
    const initial = project.run();
    expect(initial.status, initial.stderr).toBe(0);
    const repeat = project.run();
    expect(repeat.status, repeat.stderr).toBe(0);
    const source = project.read(abilityFile);
    expect(source).toMatch(/onCreate\([^)]*\): void \{\s+VoipBridge\.bindPush\(this\)\s+super\.onCreate/);
    expect(source.match(/VoipBridge\.bindPush\(this\)/g)).toHaveLength(1);
    const { abilities, requestPermissions } = JSON.parse(project.read(moduleFile)).module;
    expect(abilities[0].skills).toEqual([{ actions: ['action.system.home'] }, { actions: [listener] }]);
    expect(abilities[1]).toMatchObject({ name: 'NuwaxVoipMediaAbility', backgroundModes: ['voip'], exported: false });
    expect(requestPermissions.map((permission: { name: string }) => permission.name)).toContain('ohos.permission.MICROPHONE');
    expect(JSON.parse(project.read(`${entry}/resources/base/profile/main_pages.json`)).src)
      .toEqual(['pages/Index', 'pages/NuwaxVoipMedia']);
    const media = `${entry}/resources/rawfile/voip`;
    expect(project.read(`${media}/media.html`)).toBe('<html><head><link rel="stylesheet" href="harmony.css"></head><body></body></html>');
    expect(project.read(`${media}/harmony.css`)).toContain('.local-video');
    expect(project.read(`${media}/call-icons/microphone-off-ink.png`).length).toBeGreaterThan(0);
    expect(abilities[0].backgroundModes).toBeUndefined();
    expect(source).not.toContain('HarmonyNativeVoice');
  });

  it('stages native voice once in an explicitly selected test variant', () => {
    const project = fixture('export default class EntryAbility extends UniEntryAbility {}', true);
    for (let i = 0; i < 2; i++) {
      const result = project.run(true);
      expect(result.status, result.stderr).toBe(0);
    }
    const prepared = project.read(abilityFile);
    expect(prepared.match(/VoipBridge\.nativeVoiceStart =/g)).toHaveLength(1);
    expect(prepared).toMatch(/VoipBridge\.bindPush\(this\)\s+VoipBridge\.nativeVoiceStart/);
    expect(JSON.parse(project.read(moduleFile)).module.abilities[0].backgroundModes).toEqual(['voip']);
    expect(project.read('unpackage/app-harmony/entry/libs/arm64-v8a/libnuwax_harmony_rtc.so')).toBe('fixture');
    expect(project.run().stderr).toContain('Generated QA output contains native voice');
  });

  it('rejects staging the native voice library in the standard project', () => {
    const project = fixture('export default class EntryAbility extends UniEntryAbility {}');
    const original = project.read(moduleFile);
    const result = project.run(true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('isolated VoIP business QA output');
    expect(project.read(moduleFile)).toBe(original);
  });

  it('registers before existing initialization and ignores mentions of onCreate outside the lifecycle method', () => {
    const project = fixture(`// See onCreate() for initialization.
export default class EntryAbility extends UniEntryAbility {
  override onCreate(
    want: Want,
    launchParam: AbilityConstant.LaunchParam
  ): void {
    super.onCreate(want, launchParam)
  }
}`);
    const result = project.run();
    expect(result.status, result.stderr).toBe(0);
    expect(project.read(abilityFile)).toMatch(/\): void \{\s+VoipBridge\.bindPush\(this\)\s+super\.onCreate/);
  });

  it('rejects an asynchronous onCreate before modifying the generated manifest', () => {
    const project = fixture(`export default class EntryAbility extends UniEntryAbility {
  async onCreate(want: Want): Promise<void> {
    await loadConfig(want)
  }
}`);
    const original = project.read(moduleFile);
    const result = project.run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('EntryAbility.onCreate must be synchronous');
    expect(project.read(moduleFile)).toBe(original);
  });
});
