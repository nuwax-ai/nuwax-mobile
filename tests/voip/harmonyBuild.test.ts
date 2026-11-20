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

function fixture(abilitySource: string) {
  mkdirSync(join(root, 'out'), { recursive: true });
  const directory = mkdtempSync(join(root, 'out/voip-harmony-fixture-'));
  fixtures.push(directory);
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), content);
  };
  for (const source of ['scripts/prepare-voip-harmony.mjs', 'scripts/voip-native/harmony', 'uni_modules/nuwax-voip/utssdk/app-harmony']) {
    mkdirSync(dirname(join(directory, source)), { recursive: true });
    cpSync(join(root, source), join(directory, source), { recursive: true });
  }
  write(abilityFile, abilitySource);
  write(moduleFile, JSON.stringify({ module: { abilities: [{
    name: 'EntryAbility', srcEntry: './ets/entryability/EntryAbility.ets',
    startWindowIcon: '$media:icon', startWindowBackground: '$color:background',
    skills: [{ actions: ['action.system.home'] }],
  }] } }));
  write(`${plugin}/src/main/module.json5`, '{"module":{}}');
  write(`${plugin}/utssdk/app-harmony/VoipBridge.ets`, '');
  write(`${entry}/resources/base/profile/main_pages.json`, '{"src":["pages/Index"]}');
  write('static/app/voip/media.html', '<html></html>');
  const run = () => spawnSync(process.execPath, ['scripts/prepare-voip-harmony.mjs', 'unpackage/app-harmony'], {
    cwd: directory, encoding: 'utf8',
  });
  const read = (path: string) => readFileSync(join(directory, path), 'utf8');
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
    expect(project.read(`${entry}/resources/rawfile/voip/media.html`)).toBe('<html></html>');
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
