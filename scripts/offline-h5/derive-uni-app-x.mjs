#!/usr/bin/env node
/** uni-app x 产物适配器：/m/ Web ESM → 本地 IIFE。由 build-offline-h5.mjs 调用。
 * 框架产物格式相关处理只放这里；应用运行与协议不依赖这些文本改写。
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.resolve(ROOT, process.env.WEB_DIST || 'unpackage/dist/build/web');
const DESTINATION = path.resolve(ROOT, process.env.OUT_DIR || 'unpackage/offline-h5');
const OUT = `${DESTINATION}.staging-${process.pid}`;
if (DESTINATION === ROOT || DESTINATION === SRC || SRC.startsWith(DESTINATION + path.sep) || DESTINATION.startsWith(SRC + path.sep) || DESTINATION === path.parse(DESTINATION).root) throw new Error('输出目录不能覆盖项目或输入目录');
process.on('exit', () => fs.rmSync(OUT, { recursive: true, force: true }));
const ESBUILD = process.env.ESBUILD_BIN
  || '/Applications/HBuilderX.app/Contents/HBuilderX/plugins/uniapp-cli-vite/node_modules/.bin/esbuild';

const fail = (msg) => { console.error(`[offline-h5:uni-app-x] FAIL: ${msg}`); process.exit(1); };

// --- 1. 校验输入与递归防护 -------------------------------------------------
const srcIndex = path.join(SRC, 'index.html');
if (!fs.existsSync(srcIndex)) fail(`缺少 ${srcIndex}，请先用 HBuilderX 发行 H5`);
const html = fs.readFileSync(srcIndex, 'utf8');
const entryMatch = html.match(/<script type="module"[^>]* src="([^"]+)"><\/script>/);
if (!entryMatch) fail('index.html 中未找到 module 入口 script（产物格式变化？）');
const entryHref = entryMatch[1];
if (!entryHref.startsWith('/m/')) fail(`入口路径非 /m/ 前缀：${entryHref}`);
const entryRel = entryHref.slice('/m/'.length);
if (entryRel.startsWith('static/app/')) fail('入口位于 static/app 下：web 产物已被本地包污染（递归），请重新发行 H5');
const entryAbs = path.join(SRC, entryRel);
if (!fs.existsSync(entryAbs)) fail(`入口文件不存在：${entryAbs}`);
if (!fs.existsSync(ESBUILD)) fail(`esbuild 不存在：${ESBUILD_BIN_HINT()}`);
// 递归防护（输入侧）：上次发行若把 static/app 一并复制进 web 产物，这里直接拒绝派生
const srcStaticApp = path.join(SRC, 'static', 'app');
if (fs.existsSync(srcStaticApp) && fs.readdirSync(srcStaticApp).length > 0) {
  fail('web 产物 static/app/ 非空（已被本地包污染）：删除后重新发行 H5，再执行本脚本');
}

function ESBUILD_BIN_HINT() { return '设置 ESBUILD_BIN 指向可用 esbuild（>=0.20）'; }

// --- 2. esbuild 打包 IIFE --------------------------------------------------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const bundlePath = path.join(OUT, 'app-bundle.js');
// 用 HBuilderX 内置 esbuild 的 JS API：web 产物里 vite 把 __vite-browser-external 桩的
// 绝对路径编码成了「..-..-...」畸形文件名（裸包名形态），esbuild 无法按相对路径解析，需插件接管。
let esbuildPkg;
try {
  // ESBUILD 指向 .bin 启动器（用于 --version），JS API 需加载其同级包目录
  const esbuildPkgDir = path.resolve(path.dirname(ESBUILD), '..', 'esbuild');
  esbuildPkg = createRequire(import.meta.url)(esbuildPkgDir);
} catch {
  fail(`无法加载 esbuild JS API：${ESBUILD}（${ESBUILD_BIN_HINT()}）`);
}
const esbuildVersion = execFileSync(ESBUILD, ['--version'], { encoding: 'utf8' }).trim();
console.log(`[offline-h5:uni-app-x] esbuild ${esbuildVersion} <- ${entryRel}`);
try {
  await esbuildPkg.build({
    entryPoints: [entryAbs],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    outfile: bundlePath,
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'warning',
    plugins: [{
      name: 'vite-browser-external-stub',
      setup(build) {
        build.onResolve({ filter: /__vite-browser-external/ }, () => ({ path: 'stub', namespace: 'vite-stub' }));
        build.onLoad({ filter: /.*/, namespace: 'vite-stub' }, () => ({ contents: 'export default {};', loader: 'js' }));
      },
    }],
  });
} catch (e) {
  fail(`esbuild 打包失败：${e.message ? e.message.split('\n').slice(0, 8).join('\n') : e}`);
}

// --- 3. 改写产物内绝对路径与 import.meta 残留 ---------------------------------
let bundle = fs.readFileSync(bundlePath, 'utf8');
const absRefs = (bundle.match(/["']\/m\//g) || []).length;
bundle = bundle.replaceAll('"/m/', '"./').replaceAll("'/m/", "'./");
// cmark/Emscripten 胶水的 import.meta.url 在 IIFE 下被 esbuild 置为空对象 → wasm 与
// scriptDirectory 定位失效；以 document.baseURI（= index.html 的 file:// 路径）为基准恢复解析。
const metaRefs = (bundle.match(/import_meta\.url/g) || []).length;
bundle = bundle.replace(/import_meta(?:_\d+)?\.url/g, 'document.baseURI');
// 避免 uni 编译器把派生包内部的 uni_modules/**/static/web 当成平台专用目录过滤。
bundle = bundle.replaceAll('uni_modules/', 'modules/');
bundle = bundle.replaceAll('static/web/', 'static/webres/');
if (!bundle.includes('OfflineH5Bridge') || !bundle.includes('offlineH5RequestId')) fail('Web 产物缺少离线协议页面适配，请先运行 pnpm offline-h5:build 完整编译');
fs.writeFileSync(bundlePath, bundle);
// --- 3b. 二次压缩：第一遍保留符号便于改写，此处回收空白与符号开销 ---
const minPath = `${bundlePath}.min`;
await esbuildPkg.build({ entryPoints: [bundlePath], minify: true, outfile: minPath, logLevel: 'silent' });
fs.renameSync(minPath, bundlePath);
bundle = fs.readFileSync(bundlePath, 'utf8');
console.log(`[offline-h5:uni-app-x] app-bundle.js ${(bundle.length / 1048576).toFixed(2)}MB（压缩后），改写 /m/ 绝对引用 ${absRefs} 处、import_meta.url ${metaRefs} 处`);

// --- 4. 复制运行期资源 -------------------------------------------------------
let fileCount = 0;
let totalBytes = 0;
function copyTree(from, to, filter) {
  if (!fs.existsSync(from)) return;
  fs.cpSync(from, to, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(SRC, src);
      if (rel.split(path.sep)[0] === 'static' && rel.split(path.sep)[1] === 'app') return false; // 递归防护
      return filter ? filter(src) : true;
    },
  });
}
copyTree(path.join(SRC, 'assets'), path.join(OUT, 'assets'),
  (src) => !src.endsWith('.js') && !src.endsWith('.js.map')); // JS 已全部内联
copyTree(path.join(SRC, 'static'), path.join(OUT, 'static'));
copyTree(path.join(SRC, 'uni_modules'), path.join(OUT, 'modules'));
copyTree(path.join(SRC, 'subpackages'), path.join(OUT, 'subpackages'));
if (!fs.existsSync(path.join(OUT, 'static/uni.webview.1.5.5.js'))) fail('缺少 static/uni.webview.1.5.5.js（桥 JSSDK）');

// uni 编译器把 static/ 下任意深度的 `static/web` 段视为 web 平台专属资源，打入 App 包时静默剔除
// （实测 iOS 编译产物 507→447，60 个 KaTeX 字体丢失）。改名 uni_modules 父目录绕不过它，
// 必须改 `static/web` 段本身；保留文件而非删除（字面扫描看不到运行时拼接路径，误删是静默白屏）。
let webRenames = 0;
function renameStaticWebSegments(dir) {
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (!fs.statSync(p).isDirectory()) continue;
    let next = p;
    if (name === 'web' && path.basename(dir) === 'static') {
      next = path.join(dir, 'webres');
      if (fs.existsSync(next)) fail(`static/web 改名冲突：${next} 已存在`);
      fs.renameSync(p, next);
      webRenames++;
    }
    renameStaticWebSegments(next);
  }
}
renameStaticWebSegments(OUT);
console.log(`[offline-h5:uni-app-x] static/web -> static/webres 改名目录 ${webRenames} 处`);

// --- 5. CSS 相对路径改写 -----------------------------------------------------
let cssCount = 0;
function walkCss(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) { walkCss(p); continue; }
    if (!name.endsWith('.css')) continue;
    let css = fs.readFileSync(p, 'utf8');
    const depth = path.relative(OUT, dir).split(path.sep).length; // 相对 index.html 的目录深度
    const prefix = '../'.repeat(dir == OUT ? 0 : depth);
    const next = css.replace(/url\((['"]?)\/m\//g, (m, q) => `url(${q}${prefix}`).replaceAll('uni_modules/', 'modules/').replaceAll('static/web/', 'static/webres/');
    if (next !== css) { fs.writeFileSync(p, next); cssCount++; }
  }
}
walkCss(OUT);

// 注意：不做任何「按引用猜测裁文件 / 改写字体声明」类体积优化。
// 字面路径扫描看不到运行时拼接的资源路径（fetch('a/'+name+'.json')、worker、动态 import），
// 误删后是静默 404（已实证：页面挂载成功 0 报错但整页白屏）。体积优化必须回到源头：
// 用官方机制出「内嵌精简版 H5」（pages 子集构建），而不是对发行产物做事后文件手术。

// --- 6. 重写 index.html ------------------------------------------------------
// 通用桥与项目配置适配脚本是源码文件，不再用“DOM 非空”猜测应用就绪。
fs.copyFileSync(path.join(ROOT, 'components/offline-h5-container/offline-h5-bridge.js'), path.join(OUT, 'offline-h5-bridge.js'));
fs.copyFileSync(path.join(ROOT, 'components/offline-h5-container/offline-h5-project-bootstrap.js'), path.join(OUT, 'offline-h5-project-bootstrap.js'));

let outHtml = html;
// 去 PC/移动端跳转脚本：file:// 下会把页面导向 file:///m/ 死链
outHtml = outHtml.replace(/<script>([\s\S]*?)<\/script>/g, (m, code) =>
  (code.includes('window.location.replace') && code.includes('isMobile')) ? '' : m);
// 去远程验证码：内嵌形态登录态由 App 经 URL hash 注入，不使用 H5 自身登录页，
// 剥离 o.alicdn.com 避免每次启动引入外网依赖（演示期曾临时保留，正式管线剥离）。
outHtml = outHtml.replace(/<script[^>]*o\.alicdn\.com[^>]*><\/script>\s*/g, '');
// module 入口 -> 经典 IIFE；JSSDK 必须排在应用包之后：uni-app x 运行时会覆盖 window.uni，
// 先加载的 JSSDK 桥会被冲掉（probe 页无应用运行时故无此问题）。
outHtml = outHtml.replace(entryMatch[0],
  `<script src="./offline-h5-bridge.js"></script>\n  <script src="./offline-h5-project-bootstrap.js"></script>\n  <script defer src="./app-bundle.js" onerror="OfflineH5Bridge.fail(OfflineH5Bridge.requestId(), 'bundle-load-failed')"></script>\n  <script defer src="./static/uni.webview.1.5.5.js"></script>`);
// 其余 /m/ 绝对引用（stylesheet 等）改为相对
outHtml = outHtml.replaceAll('href="/m/', 'href="./').replaceAll(' src="/m/', ' src="./').replaceAll(' crossorigin', '');
outHtml = outHtml.replaceAll('static/web/', 'static/webres/');
// 启动骨架：bundle（5MB 级）解析执行期间给一个轻量加载态，Vue 挂载到 #app 后自动替换
// （与 <!--app-html--> SSR 占位同机制）；白屏体感主要来自这段空窗。
outHtml = outHtml.replace(
  '<div id="app"><!--app-html--></div>',
  `<div id="app"><!--app-html--><div style="position:fixed;inset:0;background:#f5f6f7;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;font-size:14px;color:#9aa3ad;-webkit-font-smoothing:antialiased;"><div style="width:28px;height:28px;border:3px solid #e3e6ea;border-top-color:#9aa3ad;border-radius:50%;animation:localBootSpin .8s linear infinite;"></div><div>加载中…</div></div><style>@keyframes localBootSpin{to{transform:rotate(360deg)}}</style></div>`,
);
fs.writeFileSync(path.join(OUT, 'index.html'), outHtml);
if (outHtml.includes('type="module"')) fail('index.html 仍残留 module script');

// --- 6b. static/web 残留断言 --------------------------------------------------
// 目录已改名、文本已改写，产物任何位置都不应再出现 `static/web/`；出现说明上游产物
// 格式变化引入了新的引用形态（如运行时拼接），改名漏改会让 App 包静默缺文件。
const webResidue = [];
if (bundle.includes('static/web/')) webResidue.push('app-bundle.js');
if (outHtml.includes('static/web/')) webResidue.push('index.html');
function assertNoStaticWeb(dir) {
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) { assertNoStaticWeb(p); continue; }
    if (!name.endsWith('.css') && !name.endsWith('.js') && !name.endsWith('.html') && !name.endsWith('.json')) continue;
    if (fs.readFileSync(p, 'utf8').includes('static/web/')) webResidue.push(path.relative(OUT, p));
  }
}
assertNoStaticWeb(OUT);
if (webResidue.length > 0) fail(`产物仍引用 static/web（需补充改写）：${webResidue.slice(0, 5).join(', ')}`);

// --- 7. 校验清单（所有资源，不仅 JS）与原子替换 -------------------------------
const entries = [];
function inventory(dir) {
  for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name);
    if (fs.statSync(file).isDirectory()) { inventory(file); continue; }
    const bytes = fs.readFileSync(file);
    entries.push({ path: path.relative(OUT, file).split(path.sep).join('/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
}
inventory(OUT);
const stampPath = path.join(ROOT, 'unpackage/offline-h5-source.json');
if (!fs.existsSync(stampPath)) fail('缺少 HBuilderX 编译来源记录，请运行 pnpm offline-h5:build');
const sourceStamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'));
const manifest = {
  schemaVersion: 1, protocolVersion: 1, bundleId: 'nuwax-mobile',
  resourceVersion: createHash('sha256').update(JSON.stringify(entries)).digest('hex'),
  sourceFingerprint: sourceStamp.sourceFingerprint,
  sourceEntry: entryRel,
  sourceEntrySha256: createHash('sha256').update(fs.readFileSync(entryAbs)).digest('hex'),
  tool: `esbuild ${esbuildVersion} (uni-app-x adapter)`,
  files: entries,
  totalBytes: entries.reduce((total, entry) => total + entry.bytes, 0),
};
fs.writeFileSync(path.join(OUT, 'offline-h5-manifest.json'), JSON.stringify(manifest, null, 2));
const backup = `${DESTINATION}.previous-${process.pid}`;
if (fs.existsSync(DESTINATION)) fs.renameSync(DESTINATION, backup);
try { fs.renameSync(OUT, DESTINATION); }
catch (error) { if (fs.existsSync(backup)) fs.renameSync(backup, DESTINATION); throw error; }
fs.rmSync(backup, { recursive: true, force: true });
console.log(`[offline-h5] built ${entries.length} resources, ${(manifest.totalBytes / 1048576).toFixed(2)}MB -> ${path.relative(ROOT, DESTINATION)}`);
