#!/usr/bin/env node
/** App 编译前安装已验证资源；产物缺失或源码已变化时自动重建，调用方无需单独执行 build。 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sourceFingerprint, verifyResourcePackage } from './offline-h5/package-files.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stage = path.join(root, 'unpackage/offline-h5');
const installed = path.join(root, 'static/app/offline-h5');
const fingerprint = sourceFingerprint(root);
let manifest = null;
try { manifest = verifyResourcePackage(stage); } catch { manifest = null; }
// 强制重建：OFFLINE_H5_FORCE=1（等价于先跑 offline-h5:build）
const force = process.env.OFFLINE_H5_FORCE === '1';
if (force || manifest == null || manifest.sourceFingerprint !== fingerprint) {
  const reason = force ? 'OFFLINE_H5_FORCE=1' : manifest == null ? '离线包缺失或校验失败' : '源码已变化';
  console.log(`[offline-h5] ${reason}，自动重建（需 HBuilderX 编译器，约 1-2 分钟）…`);
  execFileSync(process.execPath, [path.join(root, 'scripts/build-offline-h5.mjs')], { stdio: 'inherit' });
  manifest = verifyResourcePackage(stage);
} else {
  // 跳过重建时也要出声：否则只剩一行 installed，看着像命令没生效
  console.log(`[offline-h5] 源码指纹未变（${fingerprint.slice(0, 12)}），跳过重建；强制重建用 OFFLINE_H5_FORCE=1 或 npm run offline-h5:build`);
}
const temporary = installed + '.installing';
fs.rmSync(temporary, { recursive: true, force: true });
fs.mkdirSync(path.dirname(installed), { recursive: true });
fs.cpSync(stage, temporary, { recursive: true });
verifyResourcePackage(temporary);
const previous = installed + '.previous';
fs.rmSync(previous, { recursive: true, force: true });
if (fs.existsSync(installed)) fs.renameSync(installed, previous);
try { fs.renameSync(temporary, installed); }
catch (error) { if (fs.existsSync(previous)) fs.renameSync(previous, installed); throw error; }
fs.rmSync(previous, { recursive: true, force: true });
console.log(`[offline-h5] verified package installed for App compilation: ${manifest.files.length} files, ${path.relative(root, installed)}`);
