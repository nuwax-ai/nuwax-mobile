import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const out = new URL('static/app/voip/', root);
await mkdir(out, { recursive: true });
await build({ entryPoints: [fileURLToPath(new URL('scripts/voip-dev/media.mjs', root))],
  outfile: fileURLToPath(new URL('media.js', out)), bundle: true, format: 'iife', target: 'es2020', minify: true });
await copyFile(new URL('scripts/voip-dev/media.html', root), new URL('media.html', out));
await writeFile(new URL('versions.json', out), JSON.stringify({ livekitClient: '2.23.0', generatedBy: 'scripts/prepare-voip-media.mjs' }) + '\n');
console.log('[voip] ArkWeb media assets generated (LiveKit JS 2.23.0)');
