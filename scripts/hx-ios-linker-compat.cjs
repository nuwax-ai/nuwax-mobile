'use strict';

// HBuilderX 5.26 的 UTS 工程生成器会添加 -ld64；Xcode 27 将其作为 -l d64。
// 仅当前编译子进程加载此文件；Pods 目标只在生成工程内对齐 SDK 下限。
// 不修改 HBuilderX 安装目录、依赖源码或全局 Node 设置。
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');

function withoutLegacyLd64(flags) {
  return Array.isArray(flags) ? flags.filter(flag => flag !== '-ld64') : flags;
}
function raisePodDeploymentTargets(source, minimum) {
  if (!/^\d+(?:\.\d+){0,2}$/.test(minimum)) throw new Error('无效的 iOS SDK 最低目标版本');
  const lower = version => {
    const a = version.split('.').map(Number), b = minimum.split('.').map(Number);
    for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0); }
    return false;
  };
  return source.replace(/^([ \t]*IPHONEOS_DEPLOYMENT_TARGET[ \t]*=[ \t]*)"?(\d+(?:\.\d+){0,2})"?([ \t]*;)/gm,
    (line, prefix, version, suffix) => lower(version) ? prefix + minimum + suffix : line);
}
module.exports = { withoutLegacyLd64, raisePodDeploymentTargets };

if (process.env.NUWAX_HX_IOS_LINKER_COMPAT === '1' && process.env.HX_APP_ROOT) {
  const configured = path.join(process.env.HX_APP_ROOT, 'plugins/uts-development-ios/dependences/buildFramework/xcode_buildsetting.js');
  const expected = fs.existsSync(configured) ? fs.realpathSync(configured) : configured;
  const sdkDir = path.dirname(configured);
  const frameworkFile = path.join(sdkDir, 'export_framework.js');
  const originalLoad = Module._load;
  const wrapped = Symbol.for('nuwax.hx.ios.linker.compat');
  let reported = false;
  Module._load = function(request, parent, isMain) {
    const value = originalLoad.apply(this, arguments);
    if (!request.includes('xcode_buildsetting') && !request.includes('export_framework')) return value;
    const resolved = fs.realpathSync(Module._resolveFilename(request, parent));
    if (fs.existsSync(frameworkFile) && resolved === fs.realpathSync(frameworkFile) &&
        typeof value.exportFramework === 'function' && !value.exportFramework[wrapped]) {
      const originalExport = value.exportFramework;
      const exportFramework = function(targetName, outputDir, type, isSimulator, utsPath, uniVersion, ...rest) {
        const minimum = process.env.NUWAX_HX_IOS_SDK_MIN_TARGET;
        if (minimum) {
          const constants = require(path.join(sdkDir, 'const.js'));
          const tools = require(path.join(sdkDir, 'tools.js'));
          const work = uniVersion === 1 ? constants.plugin_work_dir_x : uniVersion === 2 ? constants.plugin_work_dir_dom2 : constants.plugin_work_dir;
          const pod = path.join(tools.adapterPluginWorkPath(work, targetName, type), 'Pods/Pods.xcodeproj/project.pbxproj');
          if (fs.existsSync(pod)) {
            // 只修改生成工作目录内的 Pods 工程，禁止越界到 SDK/依赖源码。
            const actual = fs.realpathSync(pod);
            if (!actual.startsWith(fs.realpathSync(work) + path.sep)) throw new Error('Pods 工程超出当前生成工作目录');
            const source = fs.readFileSync(actual, 'utf8');
            const updated = raisePodDeploymentTargets(source, minimum);
            if (source !== updated) {
              fs.writeFileSync(actual, updated);
              process.stderr.write('[ios-compile] 已将生成 Pods 工程的过低目标对齐 SDK 最低版本 ' + minimum + '。\n');
            }
          }
        }
        return originalExport.call(this, targetName, outputDir, type, isSimulator, utsPath, uniVersion, ...rest);
      };
      exportFramework[wrapped] = true;
      value.exportFramework = exportFramework;
    }
    if (resolved !== expected) return value;
    if (typeof value.builBaseSetting !== 'function' || value.builBaseSetting[wrapped]) return value;
    const original = value.builBaseSetting;
    const buildSettings = function(...args) {
      const settings = original.apply(this, args);
      const flags = settings.OTHER_LDFLAGS;
      if (Array.isArray(flags) && flags.includes('-ld64')) {
        settings.OTHER_LDFLAGS = withoutLegacyLd64(flags);
        if (!reported) {
          reported = true;
          process.stderr.write('[ios-compile] 已移除 UTS 生成器的过时 -ld64；保留其他链接参数。\n');
        }
      }
      return settings;
    };
    buildSettings[wrapped] = true;
    value.builBaseSetting = buildSettings;
    return value;
  };
}
