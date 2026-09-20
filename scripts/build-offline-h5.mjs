#!/usr/bin/env node
/** 先 HBuilderX 编译 Web，再派生离线包。默认仅本地构建，不托管、不发布。 */
import fs from 'node:fs';
import os from 'node:os';
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

// 离线包 pages 子集：容器只从离线包进这几个页面，其余入口一律经 uni.webView 桥交原生处理，
// 编译期收窄 pages.json，未列页面及其组件不进 bundle。改离线入口时同步维护此清单：
// 页内新增「纯 H5 路由跳转」（非 uni.webView 桥）的目标页必须加入，否则路由 miss 白屏。
// 当前依据：agent-detail/app-details 图内跳转全走 uni.webView 桥；应用智能体会话经
// history.replaceState 把 hash 换到 app-details（AgentDetailService.uts 新会话跳转）。
const OFFLINE_PAGES = {
  pages: [
    // 极简默认页：只初始化运行时与桥，不挂载业务组件（与全量 pages.json 中同名页面同构）
    { path: 'pages/offline-h5-bootstrap/offline-h5-bootstrap', style: { navigationStyle: 'custom' } },
  ],
  subPackages: [
    {
      root: 'subpackages',
      pages: [
        { path: 'pages/agent-detail/agent-detail', style: { enablePageCache: false, enableShareAppMessage: true, navigationStyle: 'custom', softinputMode: 'nothing' } },
        { path: 'pages/app-details/app-details', style: { enablePageCache: false, enableShareAppMessage: true, navigationStyle: 'custom' } },
      ],
    },
  ],
  easycom: { autoscan: true },
  globalStyle: { navigationStyle: 'custom', navigationBarTextStyle: 'black', navigationBarBackgroundColor: '#F8F8F8', navigationBarTitleText: '加载中', backgroundColor: '#F8F8F8', rpxCalcMaxDeviceWidth: 960, rpxCalcBaseDeviceWidth: 375, rpxCalcIncludeWidth: 750, dynamicRpx: true },
};

// 离线子集必须在独立输入目录里编译。旧流程会临时覆盖仓库 pages.json，并移走
// static/app/offline-h5；若 H5 开发服务同时运行，文件监听会立刻热更新成「无首页、无
// tabBar」的离线清单，表现为白屏或底栏消失。临时工程既隔离 watcher，也天然避免
// 已安装离线包被递归复制进 Web 产物。
const buildRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nuwax-offline-h5-'));
const excludedTopLevel = new Set(['.git', 'node_modules', 'unpackage', 'dist', 'out', '.diag']);

function copyProjectInput() {
  for (const name of fs.readdirSync(root)) {
    if (excludedTopLevel.has(name)) continue;
    const source = path.join(root, name);
    const target = path.join(buildRoot, name);
    fs.cpSync(source, target, {
      recursive: true,
      filter: (entry) => {
        const relative = path.relative(root, entry).split(path.sep).join('/');
        return relative !== 'static/app/offline-h5' && !relative.startsWith('static/app/offline-h5/');
      },
    });
  }
  fs.writeFileSync(path.join(buildRoot, 'pages.json'), JSON.stringify(OFFLINE_PAGES, null, 2));
  const modules = path.join(root, 'node_modules');
  if (fs.existsSync(modules)) fs.symlinkSync(modules, path.join(buildRoot, 'node_modules'), 'dir');
}

fs.mkdirSync(path.dirname(stage), { recursive: true });
try {
  copyProjectInput();
  fs.rmSync(webOutput, { recursive: true, force: true });
  execFileSync(node, [compiler, 'build', '-p', 'h5'], { cwd: buildRoot, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production', HX_APP_ROOT: hxRoot, UNI_INPUT_DIR: buildRoot, UNI_OUTPUT_DIR: webOutput, UNI_APP_X: 'true', UNI_PLATFORM: 'h5', UNI_UTS_PLATFORM: 'web', RUN_BY_HBUILDERX: '1' } });
  if (sourceFingerprint(root) !== before) throw new Error('源码在编译期间发生变化，请重新构建');
  fs.writeFileSync(path.join(root, 'unpackage/offline-h5-source.json'), JSON.stringify({ sourceFingerprint: before }));
  execFileSync(process.execPath, [path.join(root, 'scripts/offline-h5/derive-uni-app-x.mjs')], { stdio: 'inherit', env: { ...process.env, WEB_DIST: webOutput } });
  verifyResourcePackage(stage);
  // 打包成功后清理中间 Web 产物（仅派生排查时需要，OFFLINE_H5_KEEP_WEB=1 可保留现场）
  if (process.env.OFFLINE_H5_KEEP_WEB !== '1') fs.rmSync(webOutput, { recursive: true, force: true });
} finally {
  fs.rmSync(buildRoot, { recursive: true, force: true });
}
