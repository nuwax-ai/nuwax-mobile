#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

// 与 run-uni-build.sh 一样调用 HBuilderX 内置编译器；只编译、不安装、不签名。
// 用显式输入目录避免 HBuilderX CLI 将同名 worktree 解析成另一个检出。
const args = process.argv.slice(2);
const options = { project: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), timeout: 300000 };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--no-compat') { options.noCompat = true; continue; }
  if (!['--project', '--output', '--log', '--timeout-ms'].includes(args[i]) || !args[i + 1]) {
    throw new Error('用法：node scripts/run-ios-compile.mjs [--project <目录>] [--output <目录>] [--log <文件>] [--timeout-ms <毫秒>] [--no-compat]');
  }
  const key = args[i++];
  if (key === '--timeout-ms') options.timeout = Number(args[i]);
  else options[key.slice(2)] = path.resolve(args[i]);
}
if (process.platform !== 'darwin') throw new Error('iOS 编译需在 macOS 安装 HBuilderX 与 Xcode。');
if (!Number.isFinite(options.timeout) || options.timeout < 1000) throw new Error('timeout-ms 必须至少为 1000。');
const hx = process.env.HX_APP_ROOT || '/Applications/HBuilderX.app/Contents/HBuilderX';
const node = process.env.HX_NODE || path.join(hx, 'plugins/node/node');
const compiler = path.join(hx, 'plugins/uniapp-cli-vite/node_modules/@dcloudio/vite-plugin-uni/bin/uni.js');
for (const file of [node, compiler, path.join(options.project, 'manifest.json')]) {
  if (!fs.existsSync(file)) throw new Error('缺少编译输入：' + file);
}
const xcodeVersion = execFileSync('xcodebuild', ['-version'], { encoding: 'utf8' });
const xcodeMajor = Number(xcodeVersion.match(/Xcode\s+(\d+)/)?.[1]);
if (!Number.isFinite(xcodeMajor)) throw new Error('无法确定 Xcode 版本。');
const hxVersion = process.env.HX_Version || execFileSync('/usr/libexec/PlistBuddy',
  ['-c', 'Print :CFBundleShortVersionString', path.resolve(hx, '../Info.plist')], { encoding: 'utf8' }).trim();
const output = options.output || path.join(options.project, 'unpackage/dist/dev/app-ios');
const logPath = options.log || path.join(options.project, 'unpackage/logs/ios-compile.log');
fs.mkdirSync(path.dirname(logPath), { recursive: true });
const log = fs.createWriteStream(logPath);
const compat = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hx-ios-linker-compat.cjs');
const useCompat = xcodeMajor >= 27 && !options.noCompat;
let sdkMinimum = '';
if (useCompat) {
  const sdk = execFileSync('xcrun', ['--sdk', 'iphoneos', '--show-sdk-path'], { encoding: 'utf8' }).trim();
  sdkMinimum = JSON.parse(fs.readFileSync(path.join(sdk, 'SDKSettings.json'), 'utf8')).SupportedTargets?.iphoneos?.MinimumDeploymentTarget;
  if (!/^\d+(?:\.\d+){0,2}$/.test(sdkMinimum || '')) throw new Error('无法确定当前 iOS SDK 支持的最低目标版本。');
  const manifest = JSON.parse(fs.readFileSync(path.join(options.project, 'manifest.json'), 'utf8'));
  const appMinimum = manifest['app-ios']?.distribute?.deploymentTarget;
  if (appMinimum && parseFloat(appMinimum) < parseFloat(sdkMinimum)) {
    throw new Error(`App 配置的最低 iOS ${appMinimum} 低于当前 SDK 下限 ${sdkMinimum}；请选择匹配 SDK，不自动更改产品配置。`);
  }
}
const env = { ...process.env, HX_APP_ROOT: hx, APP_ROOT: hx, HX_Version: hxVersion.split('.').slice(0, 2).join('.'),
  UNI_INPUT_DIR: options.project, UNI_OUTPUT_DIR: output, NODE_ENV: 'development',
  UNI_APP_X: 'true', UNI_PLATFORM: 'app', UNI_UTS_PLATFORM: 'app-ios', RUN_BY_HBUILDERX: '1',
  NUWAX_HX_IOS_LINKER_COMPAT: useCompat ? '1' : '0', NUWAX_HX_IOS_SDK_MIN_TARGET: sdkMinimum };
// NODE_OPTIONS 是 Node 的参数环境变量，不经过 shell；引号支持仓库路径中的空格。
if (useCompat) env.NODE_OPTIONS = [process.env.NODE_OPTIONS || '', '--require=' + JSON.stringify(compat)].filter(Boolean).join(' ');
console.log(`[ios-compile] source=${options.project}\n[ios-compile] HBuilderX=${hxVersion}, Xcode=${xcodeMajor}, linkerCompat=${useCompat}\n[ios-compile] log=${logPath}`);
const heapMb = Number(process.env.NUWAX_IOS_HEAP_MB || '8192');
if (!Number.isInteger(heapMb) || heapMb < 1024) throw new Error('NUWAX_IOS_HEAP_MB 必须是至少 1024 的整数。');
const child = spawn(node, ['--max-old-space-size=' + heapMb, compiler, '-p', 'app'],
  { cwd: options.project, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
let tail = '';
let failed = false;
let completed = false;
let settled = false;
let stopReason = '';
let forceTimer;
let failureTimer;
function stop(reason) {
  if (stopReason) return;
  stopReason = reason;
  // 只终止本次创建的进程组，绝不使用 pkill 或清理其他 HBuilderX 会话。
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  forceTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 5000);
}
function receive(chunk) {
  const text = chunk.toString();
  log.write(text);
  tail = (tail + text).slice(-32768);
  if (!failed && /Build failed|编译失败/.test(tail)) {
    failed = true;
    // UTS 先输出失败标题，下一条才是诊断；留出刷新时间，避免丢失真正原因。
    failureTimer = setTimeout(() => stop('compile-failed'), 750);
  }
  if (/ready in\s+\d/.test(tail)) { completed = true; stop('compiled'); }
}
child.stdout.on('data', receive);
child.stderr.on('data', receive);
const timeout = setTimeout(() => stop('timeout'), options.timeout);
const interrupt = () => stop('interrupted');
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
await new Promise(resolve => {
  function finish(error) {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    clearTimeout(forceTimer);
    clearTimeout(failureTimer);
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    const passed = !error && completed && !failed && stopReason === 'compiled';
    log.end(() => {
      if (!passed) console.error(error || tail.split('\n').slice(-45).join('\n'));
      console.log(`[ios-compile] ${passed ? '通过' : '失败'} (${stopReason || 'process-exited'})，完整日志：${logPath}`);
      process.exitCode = passed ? 0 : 1;
      resolve();
    });
  }
  child.once('error', finish);
  child.once('close', () => finish());
});
