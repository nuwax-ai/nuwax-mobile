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

// static/app 为派生安装目录；编译 Web 前临时移出，结束后恢复，避免递归复制。
const installed = path.join(root, 'static/app/offline-h5');
const saved = path.join(root, `unpackage/offline-h5-installed-${process.pid}`);
// pages.json 同理：编译前临时替换为离线子集，编译结束（无论成败）立即恢复——
// 源码指纹校验要求编译前后源码一致，pages.json 属于指纹覆盖范围。
const pagesJson = path.join(root, 'pages.json');
const savedPagesJson = path.join(root, `unpackage/pages.json.offline-${process.pid}`);
fs.mkdirSync(path.dirname(stage), { recursive: true });
if (fs.existsSync(installed)) fs.renameSync(installed, saved);
fs.copyFileSync(pagesJson, savedPagesJson);
fs.writeFileSync(pagesJson, JSON.stringify(OFFLINE_PAGES, null, 2));
let pagesSwapped = true;
try {
  execFileSync(node, [compiler, 'build', '-p', 'h5'], { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production', HX_APP_ROOT: hxRoot, UNI_INPUT_DIR: root, UNI_OUTPUT_DIR: webOutput, UNI_APP_X: 'true', UNI_PLATFORM: 'h5', UNI_UTS_PLATFORM: 'web', RUN_BY_HBUILDERX: '1' } });
  fs.renameSync(savedPagesJson, pagesJson);
  pagesSwapped = false;
  if (sourceFingerprint(root) !== before) throw new Error('源码在编译期间发生变化，请重新构建');
  fs.writeFileSync(path.join(root, 'unpackage/offline-h5-source.json'), JSON.stringify({ sourceFingerprint: before }));
  execFileSync(process.execPath, [path.join(root, 'scripts/offline-h5/derive-uni-app-x.mjs')], { stdio: 'inherit', env: { ...process.env, WEB_DIST: webOutput } });
  verifyResourcePackage(stage);
  // 打包成功后清理中间 Web 产物（仅派生排查时需要，OFFLINE_H5_KEEP_WEB=1 可保留现场）
  if (process.env.OFFLINE_H5_KEEP_WEB !== '1') fs.rmSync(webOutput, { recursive: true, force: true });
} finally {
  if (pagesSwapped && fs.existsSync(savedPagesJson)) fs.renameSync(savedPagesJson, pagesJson);
  if (fs.existsSync(saved)) fs.renameSync(saved, installed);
}
