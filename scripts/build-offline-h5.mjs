#!/usr/bin/env node
/** 先 HBuilderX 编译 Web，再派生离线包。默认仅本地构建，不托管、不发布。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { sourceFingerprint, verifyResourcePackage } from './offline-h5/package-files.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hxRoot = process.env.HX_APP_ROOT || '/Applications/HBuilderX.app/Contents/HBuilderX';
const compiler = path.join(hxRoot, 'plugins/uniapp-cli-vite/node_modules/@dcloudio/vite-plugin-uni/bin/uni.js');
const node = path.join(hxRoot, 'plugins/node/node');
const webOutput = path.join(root, 'unpackage/offline-h5-web');
const before = sourceFingerprint(root);
const stage = path.join(root, 'unpackage/offline-h5');
// static/app 为派生安装目录；编译 Web 前临时移出，结束后恢复，避免递归复制。
const installed = path.join(root, 'static/app/offline-h5');
const saved = path.join(root, `unpackage/offline-h5-installed-${process.pid}`);
fs.mkdirSync(path.dirname(stage), { recursive: true });
if (fs.existsSync(installed)) fs.renameSync(installed, saved);
try {
  execFileSync(node, [compiler, 'build', '-p', 'h5'], { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production', HX_APP_ROOT: hxRoot, UNI_INPUT_DIR: root, UNI_OUTPUT_DIR: webOutput, UNI_APP_X: 'true', UNI_PLATFORM: 'h5', UNI_UTS_PLATFORM: 'web', RUN_BY_HBUILDERX: '1' } });
  if (sourceFingerprint(root) !== before) throw new Error('源码在编译期间发生变化，请重新构建');
  fs.writeFileSync(path.join(root, 'unpackage/offline-h5-source.json'), JSON.stringify({ sourceFingerprint: before }));
  execFileSync(process.execPath, [path.join(root, 'scripts/offline-h5/derive-uni-app-x.mjs')], { stdio: 'inherit', env: { ...process.env, WEB_DIST: webOutput } });
  verifyResourcePackage(stage);
} finally {
  if (fs.existsSync(saved)) fs.renameSync(saved, installed);
}
