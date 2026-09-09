#!/usr/bin/env node
/** 参数为最终 App 资源目录中的 static/app/offline-h5，逐个校验实际交付文件。 */
import path from 'node:path';
import { verifyResourcePackage } from './offline-h5/package-files.mjs';
const directory = process.argv[2];
if (!directory) throw new Error('用法: node scripts/verify-offline-h5-package.mjs <最终资源目录/static/app/offline-h5>');
const manifest = verifyResourcePackage(path.resolve(directory));
console.log(`[offline-h5] final package verified: ${manifest.files.length} files, ${manifest.resourceVersion.slice(0, 12)}`);
