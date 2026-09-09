import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function sourceFingerprint(root) {
  const entries = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      if (['.git', 'node_modules', 'unpackage', '.hbuilderx', '.diag'].includes(name)) continue;
      const file = path.join(dir, name);
      const relative = path.relative(root, file).split(path.sep).join('/');
      if (relative.startsWith('static/app/')) continue;
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) walk(file);
      else if (/\.(uts|uvue|vue|js|css|scss|html)$/.test(name) || ['pages.json', 'manifest.json', 'package.json'].includes(relative)) entries.push([relative, digest(fs.readFileSync(file))]);
    }
  }
  walk(root);
  return digest(JSON.stringify(entries));
}
export function verifyResourcePackage(directory) {
  directory = path.resolve(directory);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'offline-h5-manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.protocolVersion !== 1 || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Unsupported or empty offline H5 package');
  const seen = new Set();
  for (const entry of manifest.files) {
    if (typeof entry.path !== 'string' || entry.path.includes('\\') || entry.path.startsWith('/') || entry.path.split('/').some(p => !p || p === '.' || p === '..') || seen.has(entry.path)) throw new Error('Invalid resource path');
    seen.add(entry.path);
    const file = path.join(directory, entry.path);
    for (let current = file; current !== path.resolve(directory); current = path.dirname(current)) {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symlink resource: ${entry.path}`);
    }
    const bytes = fs.readFileSync(file);
    if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256) throw new Error(`Offline resource missing or modified: ${entry.path}`);
  }
  if (!seen.has('index.html') || !seen.has('app-bundle.js') || !seen.has('offline-h5-bridge.js')) throw new Error('Missing offline entry or bridge');
  if (digest(JSON.stringify(manifest.files)) !== manifest.resourceVersion) throw new Error('Resource manifest version mismatch');
  return manifest;
}
