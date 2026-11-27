import fs from 'node:fs';
import path from 'node:path';

const proxyFonts = 'modules/uni-ai-x/static/proxy-web/libs/fonts';
const unusedConversationResources = [
  { resource: 'static/ringtones', reference: /ringtones|ringtone\.m4a/ },
  { resource: 'static/voip', reference: /static\/voip|call-icons/ },
  { resource: 'modules/uni-highlight/static/_onig.wasm', reference: /uni-highlight\/static/, copy: 'static/uni-highlight/_onig.wasm' },
  { resource: 'modules/uni-ai-x/static/webres/kaTeX-fonts', reference: /kaTeX-fonts/, copy: proxyFonts },
  { resource: 'subpackages/uni_modules/mp-html/static/fonts', reference: /mp-html\/static/, copy: proxyFonts },
];

function isIdenticalCopy(resource, copy) {
  if (!fs.existsSync(copy)) return false;
  if (!fs.statSync(resource).isDirectory()) {
    return fs.statSync(copy).isFile() && fs.readFileSync(resource).equals(fs.readFileSync(copy));
  }
  return fs.statSync(copy).isDirectory() && fs.readdirSync(resource, { withFileTypes: true }).every(entry =>
    entry.isFile() && isIdenticalCopy(path.join(resource, entry.name), path.join(copy, entry.name)));
}

export function pruneConversationResources(directory) {
  // 只处理会话页外的通话资源和已知副本。会话 H5 的 KaTeX 样式使用 assets 下的字体，
  // 公式代理保留自己的字体，H5 高亮加载的是 static/uni-highlight 下的 WASM。
  // 如果后续页面或编译器开始从这些副本路径加载，保留对应资源。
  const referenced = new Set();
  function collectReferences(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) collectReferences(file);
      else if (/\.(?:js|css|scss|html|json)$/i.test(entry.name)) {
        const content = fs.readFileSync(file, 'utf8');
        for (const { reference } of unusedConversationResources) {
          if (reference.test(content)) referenced.add(reference);
        }
      }
    }
  }
  collectReferences(directory);

  for (const { resource, reference, copy } of unusedConversationResources) {
    const file = path.join(directory, resource);
    if (!fs.existsSync(file) || referenced.has(reference) || (copy && !isIdenticalCopy(file, path.join(directory, copy)))) continue;
    fs.rmSync(file, { recursive: true });
  }
}
