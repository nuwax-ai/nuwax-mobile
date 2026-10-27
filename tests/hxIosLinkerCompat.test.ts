import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const compatPath = path.resolve('scripts/hx-ios-linker-compat.cjs');
const { withoutLegacyLd64, raisePodDeploymentTargets } = require(compatPath);

describe('HBuilderX / Xcode 27 链接兼容', () => {
  it('移除遗留参数，同时保留继承、ObjC、第三方库和同名前缀', () => {
    const flags = ['-ld64', '-ObjC', '"$(inherited)"', '-framework', 'Security', '-lc++', '-ld64_custom'];
    expect(withoutLegacyLd64(flags)).toEqual(flags.slice(1));
    expect(flags[0]).toBe('-ld64');
  });
  it('没有遗留参数或 SDK 改变字段形态时保留原值', () => {
    expect(withoutLegacyLd64(undefined)).toBeUndefined();
    expect(withoutLegacyLd64('-ObjC $(inherited)')).toBe('-ObjC $(inherited)');
    expect(withoutLegacyLd64(['-ObjC'])).toEqual(['-ObjC']);
  });
  it.each([true, false])('兼容开关=%s：仅在子进程处理指定 SDK 模块，不改磁盘文件', enabled => {
    const root = mkdtempSync(path.join(tmpdir(), 'nuwax-ios-compat-'));
    try {
      const target = path.join(root, 'plugins/uts-development-ios/dependences/buildFramework/xcode_buildsetting.js');
      const other = path.join(root, 'other/xcode_buildsetting.js');
      const source = "module.exports = { builBaseSetting: () => ({ OTHER_LDFLAGS: ['-ld64', '-ObjC', '-lc++'], KEEP: 'unchanged' }) };";
      for (const file of [target, other]) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, source); }
      const script = `const a = require(${JSON.stringify(target)}); const b = require(${JSON.stringify(other)}); require(${JSON.stringify(target)}); console.log(JSON.stringify([a.builBaseSetting(), b.builBaseSetting()]));`;
      const output = execFileSync(process.execPath, ['--require', compatPath, '-e', script], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, HX_APP_ROOT: root, NUWAX_HX_IOS_LINKER_COMPAT: enabled ? '1' : '0' },
      });
      const [selected, unrelated] = JSON.parse(output);
      expect(selected.OTHER_LDFLAGS).toEqual(enabled ? ['-ObjC', '-lc++'] : ['-ld64', '-ObjC', '-lc++']);
      expect(selected.KEEP).toBe('unchanged');
      expect(unrelated.OTHER_LDFLAGS).toEqual(['-ld64', '-ObjC', '-lc++']);
      expect(readFileSync(target, 'utf8')).toBe(source);
      expect(readFileSync(other, 'utf8')).toBe(source);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});


describe('当前 SDK 对生成 Pods 的最低部署目标', () => {
  it('只提高较低目标，保留更高版本、其他字段和变量', () => {
    const source = '\tIPHONEOS_DEPLOYMENT_TARGET = 9.0;\n  IPHONEOS_DEPLOYMENT_TARGET = "13.0";\n  IPHONEOS_DEPLOYMENT_TARGET = 15.0;\n  IPHONEOS_DEPLOYMENT_TARGET = 17.0;\n  IPHONEOS_DEPLOYMENT_TARGET = "$(inherited)";\n  SWIFT_VERSION = 5.0;\n';
    const updated = raisePodDeploymentTargets(source, '15.0');
    expect(updated).toBe(source.replace('= 9.0;', '= 15.0;').replace('= "13.0";', '= 15.0;'));
    expect(raisePodDeploymentTargets(updated, '15.0')).toBe(updated);
  });
  it('拒绝不明确的版本输入', () => {
    expect(() => raisePodDeploymentTargets('anything', 'unknown')).toThrow();
  });
  it.each([true, false])('开关=%s 时仅处理生成的 Pods，不重写 SDK 文件', enabled => {
    const root = mkdtempSync(path.join(tmpdir(), 'nuwax-ios-pods-'));
    try {
      const sdk = path.join(root, 'plugins/uts-development-ios/dependences/buildFramework');
      const work = path.join(root, 'generated');
      const pod = path.join(work, 'probe/Pods/Pods.xcodeproj/project.pbxproj');
      const source = '  IPHONEOS_DEPLOYMENT_TARGET = 9.0;\n';
      mkdirSync(sdk, { recursive: true }); mkdirSync(path.dirname(pod), { recursive: true });
      writeFileSync(pod, source);
      writeFileSync(path.join(sdk, 'const.js'), `exports.plugin_work_dir_x = ${JSON.stringify(work)};`);
      writeFileSync(path.join(sdk, 'tools.js'), 'exports.adapterPluginWorkPath = (work, name) => require("node:path").join(work, name);');
      const entry = path.join(sdk, 'export_framework.js');
      const entrySource = 'exports.exportFramework = (...args) => args;';
      writeFileSync(entry, entrySource);
      const script = `const a = require(${JSON.stringify(entry)}).exportFramework('probe','out',1,false,'source',1,'extra'); console.log(JSON.stringify(a));`;
      const output = execFileSync(process.execPath, ['--require', compatPath, '-e', script], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, HX_APP_ROOT: root, NUWAX_HX_IOS_LINKER_COMPAT: enabled ? '1' : '0', NUWAX_HX_IOS_SDK_MIN_TARGET: '15.0' },
      });
      expect(JSON.parse(output)).toEqual(['probe', 'out', 1, false, 'source', 1, 'extra']);
      expect(readFileSync(pod, 'utf8')).toBe(enabled ? source.replace('9.0', '15.0') : source);
      expect(readFileSync(entry, 'utf8')).toBe(entrySource);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
