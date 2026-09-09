#!/usr/bin/env node
/** 校验云打包产物（.ipa / .apk）里的离线 H5 资源是否完整。
 *  用法：node scripts/verify-offline-h5-artifact.mjs <path/to/app.ipa|app.apk>
 *  解包到临时目录，自动定位 static/app/offline-h5（两种端产物目录层级不同，直接搜清单），
 *  复用 verifyResourcePackage 逐文件核对 sha256。缺资源 = 非零退出。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyResourcePackage } from './offline-h5/package-files.mjs';

const artifact = process.argv[2];
if (!artifact || !fs.existsSync(artifact)) {
  console.error('用法: node scripts/verify-offline-h5-artifact.mjs <app.ipa|app.apk>');
  process.exit(2);
}
const ext = path.extname(artifact).toLowerCase();
if (ext !== '.ipa' && ext !== '.apk') {
  console.error(`仅支持 .ipa / .apk，收到: ${artifact}`);
  process.exit(2);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-h5-artifact-'));
try {
  // 只解离线包相关路径，几十 MB 的产物不必全量解压；无匹配 = 包内没有离线资源
  try {
    execFileSync('unzip', ['-o', '-q', artifact, '*static/app/offline-h5/*', '-d', tmp]);
  } catch (_eUnzip) {
    console.error('[offline-h5] ✗ 产物中未找到 static/app/offline-h5（打包前未执行 pnpm offline-h5:prepare，或编译时包缺失）');
    process.exit(1);
  }
  let pkgDir = null;
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) {
        if (name === 'offline-h5' && fs.existsSync(path.join(p, 'offline-h5-manifest.json'))) { pkgDir = p; return; }
        walk(p);
      }
    }
  };
  walk(tmp);
  if (pkgDir == null) {
    console.error('[offline-h5] ✗ 产物中未找到 static/app/offline-h5（打包前未执行 pnpm offline-h5:prepare？）');
    process.exit(1);
  }
  const manifest = verifyResourcePackage(pkgDir);
  console.log(`[offline-h5] artifact verified (${ext.slice(1)}): ${manifest.files.length} files, ${manifest.resourceVersion.slice(0, 12)}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
