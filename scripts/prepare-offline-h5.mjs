#!/usr/bin/env node
/** App 编译前安装已验证资源；产物缺失或源码已变化时自动重建，调用方无需单独执行 build。 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sourceFingerprint, verifyResourcePackage } from './offline-h5/package-files.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 目录 rename 小步重试：Windows 下刚写完的目录常被外部句柄（编辑器项目 watcher /
// 杀软实时扫描）短暂钉住，rename 报 EPERM/EBUSY；通常亚秒级释放，重试可穿过扫描窗口。
function renameWithRetry(from, to, attempts = 5, delayMs = 200) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    try { fs.renameSync(from, to); return; } catch (error) { lastError = error; }
  }
  throw lastError;
}
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
// 暂存/备份一律放 unpackage 下：installing/previous 曾直接放 static/app 旁，rename 被钉死
// 走拷贝兜底后 .installing 删不掉就残留在 static/app 里，被 App 编译整目录抄进包——
// 2026-10-07 实测一次泄漏 16M，云打包计费直接爆到 68.66M。unpackage 不进包，漏了零成本。
const staging = path.join(root, 'unpackage', 'offline-h5-staging');
const stagingTemporary = path.join(staging, 'installing');
const stagingPrevious = path.join(staging, 'previous');
fs.rmSync(stagingTemporary, { recursive: true, force: true });
// 历史残留清扫：老版本脚本可能在 static/app 留下 .installing/.previous（同样会被打进包）
for (const legacy of [temporary, installed + '.previous']) {
  try { fs.rmSync(legacy, { recursive: true, force: true }); } catch { /* 被钉则下次再清 */ }
}
fs.mkdirSync(path.dirname(installed), { recursive: true });
fs.cpSync(stage, stagingTemporary, { recursive: true });
verifyResourcePackage(stagingTemporary);
fs.rmSync(stagingPrevious, { recursive: true, force: true });
// 装载：优先「双 rename 换入」（原子性最好）；任一 rename 被钉（2026-10-07 实测：
// HBuilderX watcher / 杀毒句柄钉目录 rename，重试窗口内不释放，但子项可删可写）即退化为
// 「清旧树 + 整树拷贝 + 原位复验」。rmSync 半途失败残留的多余旧文件不在校验清单内，
// 最多几个废文件进包，不影响正确性；stage（unpackage/offline-h5）始终是重建源，无数据丢失路径。
try {
  if (fs.existsSync(installed)) renameWithRetry(installed, stagingPrevious);
  renameWithRetry(stagingTemporary, installed);
} catch {
  try { fs.rmSync(installed, { recursive: true, force: true }); } catch { /* 尽力清旧树 */ }
  fs.cpSync(stagingTemporary, installed, { recursive: true });
  verifyResourcePackage(installed);
}
fs.rmSync(stagingPrevious, { recursive: true, force: true });
console.log(`[offline-h5] verified package installed for App compilation: ${manifest.files.length} files, ${path.relative(root, installed)}`);
