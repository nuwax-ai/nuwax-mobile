# 离线 H5 容器

把 H5 会话页编译成本地资源包内置进 App，iOS 常驻聊天壳优先从 `file://` 加载，免去远程 `/m/` 的网络加载；本地失败按超时链回退远程。容器与业务解耦，新增离线入口只需「页面就绪约定 + 业务适配函数」两处接入（见文末）。

当前接入方：iOS 常驻聊天壳（`components/resident-chat-shell`）。Android / 鸿蒙仍走远程 `/m/`。

## 实现机制

### 运行时分层

| 层 | 文件 | 职责 |
|---|---|---|
| 容器 | `components/offline-h5-container/offline-h5-container.uvue` | 持有 web-view，管理加载遮罩 / 超时 / 回退 / 重试，收发协议消息 |
| 状态机 | `utils/offlineH5/offlineH5Session.uts` | 纯状态机：阶段流转、requestId 轮换、URL 组装、复用判定 |
| 项目适配 | `utils/offlineH5/projectOfflineH5.uts` | 入口常量、token / 作用域、总开关（storage `NUWAX_LOCAL_CHAT_H5_DISABLE=1` 关闭）、request 组装 |
| 页面侧约定 | `utils/offlineH5/offlineH5Page.uts` | H5 页面上报就绪：onLoad 快照上报 + onShow 从当前路由上报 |
| 软导航 | `utils/offlineH5/offlineH5Navigation.uts` | H5 侧用公开 Vue Router 换页（经轻量过渡页强制重挂载） |
| 协议源码 | `static/offline-h5/bridge.js`、`static/offline-h5/project-bootstrap.js` | 构建时原样拷入包根；桥负责消息重发 / ACK / navigate；bootstrap 负责 file:// 下注入服务器地址与登录态 |
| 业务适配 | `utils/chatOfflineH5.uts` | 只组装聊天路由与 requestKey，不碰加载逻辑 |
| 宿主（业务） | `components/resident-chat-shell/resident-chat-shell.uvue` | iOS 常驻壳：预热、揭开时机、业务桥（语音 / 支付 / 键盘） |

### 加载与回退流程

容器接收 `request` 对象：`requestKey`（业务页面标识，如 `chat:<agentId>:<conversationId>`）、`scopeKey`（登录 / 服务器作用域）、`localUrl`、`remoteUrl`、`preferLocal`、`remoteReadyPolicy`。

```
open(request)
  ├─ 首次/换作用域 → loading-local（整文档加载本地 index.html）
  ├─ 已就绪且目标页面路径不同 → navigating-local（软导航，evalJS 调 H5 换路由）
  └─ 已就绪且同页面不同 query → loading-local（整文档重载，防 keep-alive 旧数据）
就绪：H5 页面 postMessage OFFLINE_H5_PAGE_READY（requestId 匹配）→ ready-local，揭开遮罩
超时：navigating-local 6s；文档加载（本地/远程）12s
回退链：navigating-local 超时 → loading-local → loading-remote → failed（显示重试）
```

关键设计：

- **请求身份**：每次 open / 超时 / 取消都轮换 requestId。身份放 hash query（`offlineH5RequestId`，页面 onLoad 直接读）；attempt 参数放 search 段（`offlineH5Attempt`，保证仅 hash 变化的 src 赋值也触发真实文档重载——WKWebView 对 fragment-only 变化不重载）。旧请求的迟到消息一律丢弃。
- **就绪判定**：只认页面主动上报，不得用 DOM 非空、文档 load 或旧业务事件伪造。页面两条上报路径都要接：onLoad 快照（首帧）与 onShow 现取（H5 框架缓存页面组件时切 query 只走 activated，不重新 onLoad，业务数据也不会刷新——这是「同页面不同 query 必须整文档重载」的原因）。
- **消息协议 v1**：`OFFLINE_H5_PAGE_READY` / `OFFLINE_H5_ERROR` / `OFFLINE_H5_DEBUG`，均带 `protocolVersion` + `requestId`；桥未收到 ACK 前 each 250ms 重发（上限 120 次），确保原生侧晚安装也能收到。
- **运行时不校验清单**：包完整性校验只在构建期（见下），运行时靠超时兜底。

### 入口 URL 形态

```
/static/app/offline-h5/index.html?apiBase=<server>&offlineH5Attempt=<id>
  #/subpackages/pages/agent-detail/agent-detail?id=..&conversationId=..
    &statusBarHeight=..&appEmbedded=1&accessToken=..&offlineH5RequestId=<id>
```

登录态经 hash accessToken 注入（file:// 无 Cookie，靠 URL / localStorage 传身份），由 `offline-h5-project-bootstrap.js` 在文档启动时写入 `NUWAX_API_BASE_URL` / `NUWAX_ACCESS_TOKEN`。

## 构建管线与产物

命令（`package.json`）：`offline-h5:prepare` → `offline-h5:verify` → `offline-h5:test`；`offline-h5:build` 一般无需单独执行（prepare 会按需自动调起）。

```
pnpm offline-h5:prepare（scripts/prepare-offline-h5.mjs）
  0. 产物缺失或源码指纹过期 → 自动执行 offline-h5:build（约 1-2 分钟），无需人工干预
  1. 校验 stage → 复制到 static/app/offline-h5/（临时目录 + 原子替换）

offline-h5:build（scripts/build-offline-h5.mjs，被 prepare 自动调用）
  1. 记录源码指纹；把 static/app/offline-h5 临时移出（防递归复制）
  2. HBuilderX 内置编译器出 Web 产物 → unpackage/offline-h5-web（独立目录，不影响线上部署产物）
  3. 派生（scripts/offline-h5/derive-uni-app-x.mjs）：
     esbuild 把 ESM 入口打成 IIFE app-bundle.js（WebView 禁 file:// 加载 ES module）
     改写 /m/ 绝对引用、import_meta.url、uni_modules/ → modules/
     **/static/web/ 目录段改名 static/webres/（uni 编译器把它当 web 平台资源静默剔除）
     重写 index.html：注入桥脚本、去跳转/验证码脚本、启动骨架
     生成 offline-h5-manifest.json（全量文件 sha256 清单 + 源码指纹）
  4. stage 校验后原子替换
```

### 产物与入库

| 路径 | 内容 | 入库 |
|---|---|---|
| `static/offline-h5/` | 协议源码（bridge.js / project-bootstrap.js） | ✅ 需提交，勿当产物删除 |
| `scripts/offline-h5/`、`scripts/*-offline-h5.mjs` | 构建脚本与单测 | ✅ |
| `unpackage/offline-h5-web/` | 中间 Web 产物 | ❌ 已 ignore |
| `unpackage/offline-h5/` | 派生后的离线包 stage（507 文件 / ~25MB：app-bundle.js、index.html、assets/、static/、modules/、subpackages/、offline-h5-bridge.js、offline-h5-project-bootstrap.js、offline-h5-manifest.json） | ❌ |
| `unpackage/offline-h5-source.json` | 源码指纹戳 | ❌ |
| `static/app/offline-h5/`（及 `.installing/` / `.previous/`） | 安装目录，HBuilderX 据此打进 App | ❌ |
| `unpackage/dist/dev/app-*/static/app/offline-h5/` | 最终 App 编译产物里的包 | ❌（自动校验对象） |

## 上线打包

1. **CLI 路线**（`pnpm hx:ios:device`、`make app-resource`、发基座等经 `scripts/hx-cli.sh`）全自动：编译前 prepare（产物过期自动重建，无需单独跑 build），编译后对最终产物目录（`unpackage/dist/dev/app-*/...`、`unpackage/resources/app-*/...`）跑清单校验，缺文件即构建失败。云打包本地无产物目录时告警跳过。
2. **HBuilderX 界面路线**没有可挂接的编译前钩子：点菜单编译前手动跑一次 `pnpm offline-h5:prepare`（同样自动按需重建），发行后手动 `pnpm offline-h5:verify -- unpackage/resources/app-ios/static/app/offline-h5` 核对。**编译成功不代表离线文件完整**（static/web 过滤就是静默发生的），上线前务必校验。
3. iOS 真机 / 模拟器调试运行时，HBuilderX 把编译产物推到应用沙盒 `Documents/uni-app-x/apps/__UNI__8BF05E4/www/`；日志用 `cli logcat app-ios` 或 `simctl launch --console-pty` 看 `[offline-h5]` 前缀。

## 如何新增离线 H5 入口

以文件预览为参照（`subpackages/pages/offline-h5-page/offline-h5-page.uvue`，参数 `cId` / `fileProxyUrl`；已注册 pages.json，暂未接线到现有入口）：

1. **目标页面接就绪约定**（页面本身仍在 H5 包里编译）：
   - `onLoad`：`const id = readOfflineH5RequestId(options); nextTick(() => notifyOfflineH5PageReady(id));`
   - `onShow`：`notifyOfflineH5PageReadyFromLocation();`（两条都要，缺 onShow 时切 query 不上报；缺 onLoad 时首次加载不上报）
   - 不要等租户配置、历史消息等网络结果才上报；业务数据保留页面自己的加载态。
2. **写业务适配函数**（参照 `utils/chatOfflineH5.uts`）：组装目标路由 + 唯一 requestKey，调 `buildProjectOfflineH5Request(route, key)` 得到完整 request。
3. **宿主挂容器**：模板放 `<offline-h5-container :request="..." :paused="..." @ready @failed @message ...>`；`@ready` 里校验 requestKey / scopeKey 后揭开，`@message` 分发业务桥消息。
4. **重建**：页面代码进 H5 包，编译 App 前 prepare 会自动按需重建；也可手动 `pnpm offline-h5:build`。

## 排查

日志词表（均不含 token / 完整 URL）：

- `[offline-h5] open phase=... key=...`：本次请求走哪条路径、目标是谁
- `[offline-h5] recv <TYPE> code=... id=...`：收到的协议消息（含 `show-route` 页面当前路由摘要）
- `[offline-h5] ready phase=... elapsed=...ms` / `fallback phase=... elapsed=...ms`：就绪 / 降级时机
- `[offline-h5] stale <TYPE> dropped id=...`：旧请求迟到消息被丢弃

排查顺序：先校验最终 App 资源目录（缺文件→本地必超时回退）；再看 open 的 key 与 show-route 是否一致（不一致=页面路由错误）；最后看 ready/fallback 耗时定位慢在加载还是上报。离线包只含页面代码与静态资源，业务 API、文件内容仍需网络。
