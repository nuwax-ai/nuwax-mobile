# 离线 H5 方案分析

本文只描述当前实现，不改代码。运行时分层、协议字段和接入步骤以 [offline-h5-container.md](./offline-h5-container.md) 为准；这里回答两件事：方案为什么这样切，以及 `package.json` 里五条 `offline-h5:*` 命令各自做什么。

「H5 本地化」在本仓库里指把会话相关 H5 打成 App 内置静态包，WebView 用 `file://` 打开，本地超时再回退线上 `{server}/m/`。它和文案 i18n 无关。业务接口、文件内容和登录后的数据仍然走网络；离线的只是页面代码和静态资源。

## 方案结论

同一套 uni-app x 源码先按「离线页面子集」编出线上形态的 H5（ESM、资源挂在 `/m/`），再派生出 WebView 能在 `file://` 下加载的 IIFE 包，安装到 `static/app/offline-h5/`，由 HBuilderX 当作普通静态资源打进 App。运行时由通用容器决定整文档加载、软导航或远程回退；页面是否可用只认 H5 主动上报的 `OFFLINE_H5_PAGE_READY`。

这样切是因为线上 H5 和 App 内 WebView 的约束相反：

| 线上 `/m/` | App 内 `file://` |
|---|---|
| Vite ESM + 动态 chunk | 系统 WebView 禁止 `file://` 加载 ES module |
| 绝对路径 `/m/...` | 本地包没有站点根，必须相对 `index.html` |
| Cookie / 同源登录 | 无 Cookie，服务器地址和 token 只能从 URL 注入 |
| 编译器按平台过滤 `static/web` | 这条过滤在打 App 包时静默删文件，H5 侧看不见 |

派生层只改产物文本和资源布局。协议、登录注入和页面就绪约定留在源码里（`components/offline-h5-container/`），避免运行时依赖「把 ESM 改写成 IIFE」这类构建细节。

## 两端职责

```text
构建期（Node 脚本，不进 App 运行时）
  源码指纹
    → 临时工程收窄 pages.json，HBuilderX 编 H5
    → 派生 IIFE + 相对路径 + 资源清单
    → 安装到 static/app/offline-h5/
    → App 编译后再按清单核对最终产物

运行期（容器 + 协议）
  业务只组装 route / requestKey
    → 容器状态机决定本地整页 / 软导航 / 远程
    → H5 桥 postMessage 上报就绪或失败
    → 超时按链降级，旧 requestId 的迟到消息丢弃
```

业务适配停在 `utils/chatOfflineH5.uts`：拼会话路由，调用 `buildProjectOfflineH5Request`。加载、遮罩、超时和重试都在 `offline-h5-container`。当前入口是会话页（`agent-detail`，新会话可换到 `app-details`）；文件预览页已注册，尚未接到现有入口。

紧急开关是本地 storage `NUWAX_LOCAL_CHAT_H5_DISABLE=1`。打开后 `preferLocal` 为 false，直接走远程 URL，不再尝试本地包。

## 构建为什么分三步

### 1. 临时工程里编 H5 子集

`scripts/build-offline-h5.mjs` 不改仓库里的 `pages.json`。它把源码拷到系统临时目录（排除 `.git`、`node_modules`、`unpackage`、`dist`、`out`、`.diag`，以及已安装的 `static/app/offline-h5`），只在副本里写成离线页面清单，再用 HBuilderX 内置编译器执行 `uni build -p h5`。

子集目前是：

- 主包默认页 `pages/offline-h5-bootstrap/offline-h5-bootstrap`（只起运行时和桥，不挂业务组件）
- 分包 `subpackages/pages/agent-detail/agent-detail`
- 分包 `subpackages/pages/app-details/app-details`
- 无 tabBar

收窄页面是体积控制的主手段：未列入的页面及其组件不进 bundle。页内跳转默认走 `uni.webView` 交给原生；如果某页开始用纯 H5 路由跳到新页面，那个目标页必须加进子集，否则路由 miss 会白屏。

临时工程同时解决两件旧流程的事故：

- 直接改仓库 `pages.json` 时，正在跑的 H5 开发服务会热更新成「无首页、无 tabBar」。
- 已安装的离线包若被再次编进 Web 产物，下次派会把本地包递归打进本地包。

`node_modules` 用目录符号链接挂进临时工程（Windows 用 junction），避免整树复制。编译期间源码指纹若变化，构建直接失败，要求重跑，避免产物和源码对不上。

### 2. 把 `/m/` ESM 派生成本地 IIFE

`scripts/offline-h5/derive-uni-app-x.mjs` 消费 `unpackage/offline-h5-web`，写出 `unpackage/offline-h5`。关键变换：

1. **打成单个 IIFE。** esbuild 以 `index.html` 里的 module 入口为起点 `bundle + format: iife`。页面 JS chunk 全部内联；`assets/` 里的 `.js` 不再拷贝。Vite 的 JS `modulepreload` 被改成「非 CSS 直接 return」，否则 `file://` 上会去拉已经不存在的 chunk。CSS preload 保留。
2. **路径改相对。** `"/m/` 改成 `"./"`；CSS 里的 `url(/m/...)` 按文件深度补 `../`。`import.meta.url` 在 IIFE 里会被 esbuild 置空，wasm / `scriptDirectory` 改用 `document.baseURI`（即 `index.html` 的 `file://` 地址）。
3. **躲开 App 编译器的静默过滤。** uni 编译器把任意深度的 `static/web` 当成 Web 平台资源，打 App 时直接丢掉（历史上一次丢掉约 60 个 KaTeX 字体）。目录段改名为 `static/webres/`，JS / CSS / HTML 里的字面量同步改写，最后断言产物里不再出现 `static/web/`。`uni_modules/` 同时改名为 `modules/`。
4. **整目录排除，不做按引用删文件。** `EXCLUDED_RESOURCES` 只排除已用「全产物零引用 + 运行时闭包探测」确认过的目录（启动图、图标、已内联的 grammar、ai-provider 等）。运行时 `fetch` 拼接出来的 wasm、proxy-web 不在排除名单里。按字面引用裁单个文件曾经造成「挂载成功、零报错、整页白屏」。
5. **重写入口 HTML。** 去掉会把 `file://` 导向 `file:///m/` 的端跳转脚本，去掉阿里云验证码外链。脚本顺序是桥 → 项目 bootstrap → `app-bundle.js` → `uni.webview.1.5.5.js`。JSSDK 必须在应用包之后：uni-app x 运行时会覆盖 `window.uni`，先加载的桥会被冲掉。`#app` 里放一段纯 CSS 骨架，盖住数 MB bundle 解析前的白屏，Vue 挂载后替换掉。
6. **写资源清单。** `offline-h5-resources.json` 记录每个文件的相对路径、字节数和 sha256，外加 `sourceFingerprint`、`resourceVersion`、协议版本。文件名故意不以 `manifest.json` 结尾：HBuilderX 读自定义基座时用 `endsWith("manifest.json")` 取 appid，排在真正 manifest 后面的清单会把 appid 读空，资源被同步到 `apps/null`。

派生成功后，中间 Web 目录默认删除。排查时设 `OFFLINE_H5_KEEP_WEB=1` 可留下 `unpackage/offline-h5-web`。

### 3. 安装进 App 会打包的 static 目录

stage（`unpackage/offline-h5`）不进 App。`prepare` 把它复制到 `static/app/offline-h5/`，HBuilderX 才会把它打进安装包。该目录 gitignore，拉代码不会自带，编译 App 前必须 prepare。

安装放在 `unpackage/offline-h5-staging/` 里做临时副本，再 rename 进 `static/app/offline-h5`。rename 被编辑器或杀毒软件钉住时，退化为清旧树再整树拷贝，并在目标目录复验 sha256。临时目录不能留在 `static/app/` 旁边：2026-10-07 一次残留把约 16MB 中间文件打进包，云打包体积涨到 68.66MB。`unpackage/` 不进包，漏了也不计费。

## 五条命令

定义在 `package.json` 的 `scripts`。日常入口是 `pnpm offline-h5:prepare`。`build` 由它按需调用；`verify` / `verify-artifact` 在编译或出包之后核对交付物；`test` 不产生包。

### `offline-h5:build`

```bash
pnpm offline-h5:build
```

对应 `scripts/build-offline-h5.mjs`。从头编一版离线包，默认不安装、不发布、不跑到设备。

顺序：

1. 定位 HBuilderX。优先 `HX_APP_ROOT`；否则从当前 node 可执行文件上溯（经 HBuilderX 内置 node 启动时能推出来）；再回落 Mac `/Applications/HBuilderX.app/Contents/HBuilderX` 或 Windows 常见安装路径。显式写了 `HX_APP_ROOT` 但目录不对时直接失败，不会悄悄换一台编译器。esbuild 也用这份 HBuilderX 自带的，可用 `ESBUILD_BIN` 覆盖。
2. 计算源码指纹（见下一节），复制工程到临时目录并写入离线 `pages.json`。
3. 用 HBuilderX 内置 node 调 `uni.js build -p h5`，输出到 `unpackage/offline-h5-web`。环境固定 `UNI_APP_X`、`UNI_PLATFORM=h5`、`NODE_ENV=production`。
4. 指纹未变则把指纹写入 `unpackage/offline-h5-source.json`，再执行 `scripts/offline-h5/derive-uni-app-x.mjs`。
5. 对 `unpackage/offline-h5` 跑 `verifyResourcePackage`。通过后删除中间 Web 产物（除非 `OFFLINE_H5_KEEP_WEB=1`）。`finally` 里删除临时工程。

耗时大约 1–2 分钟，取决于 HBuilderX H5 编译。单独跑它的场景：想先产出 stage、或 prepare 报错后要看完整编译日志。它不会更新 `static/app/offline-h5/`，所以只 build、不 prepare，下一次 App 编译仍可能用旧安装目录。

### `offline-h5:prepare`

```bash
pnpm offline-h5:prepare
```

对应 `scripts/prepare-offline-h5.mjs`。App 编译前的安装命令，也是 CLI 钩子实际调用的入口。

判定要不要重建：

| 条件 | 行为 |
|---|---|
| `OFFLINE_H5_FORCE=1` | 强制调用 `build-offline-h5.mjs` |
| stage 缺失，或清单校验失败 | 自动 build |
| 清单里的 `sourceFingerprint` 与当前源码不一致 | 自动 build |
| 指纹一致且清单通过 | 跳过编译，打印指纹前 12 位 |

然后把已校验的 stage 安装到 `static/app/offline-h5/`，并再验一次副本。成功日志形如 `verified package installed ... N files`。

源码指纹（`scripts/offline-h5/package-files.mjs` 的 `sourceFingerprint`）覆盖仓库内 `.uts/.uvue/.vue/.js/.mjs/.css/.scss/.html`，以及 `pages.json`、`manifest.json`、`package.json`。跳过 `.git`、`node_modules`、`unpackage`、`.hbuilderx`、`.diag`、符号链接，以及 `static/app/`（安装目录本身不能参与指纹，否则每次安装都算源码变化）。指纹是这些路径与文件 sha256 的稳定 JSON 再做一次 sha256。

`scripts/hx-cli.sh` 在 `launch app-*`、`publish app`、`pack app*` 之前自动跑 prepare。HBuilderX 菜单编译没有编译前钩子，界面路线要自己先执行这条命令。

### `offline-h5:verify`

```bash
pnpm offline-h5:verify -- <最终资源目录>/static/app/offline-h5
```

对应 `scripts/verify-offline-h5-package.mjs`。参数是**已经打进某次 App 资源目录**的离线包路径，不是 stage，也不是仓库里的 `static/app/offline-h5`（虽然对后者调用同样能验「安装是否完整」）。

它只调用 `verifyResourcePackage`：

- 清单 `schemaVersion` / `protocolVersion` 必须为 1，且 `files` 非空。
- 每条路径拒绝绝对路径、`..`、空段、重复项和符号链接。
- 磁盘文件的长度和 sha256 必须与清单一致。
- 必须含 `index.html`、`app-bundle.js`、`offline-h5-bridge.js`。
- `resourceVersion` 必须等于 `files` 数组的 sha256。

失败即非零退出。CLI 在编译成功后自动对本次平台产物调用它，因为 **App 编译成功不等于离线文件还在**：`static/web` 一类目录段会被 uni 编译器静默剔除。校验目标：

| CLI 动作 | 核对目录 |
|---|---|
| `launch app-ios` / `app-android` | `unpackage/dist/dev/app-<平台>/static/app/offline-h5` |
| `launch app-harmony` | `unpackage/dist/dev/app-harmony/.../resfile/uni-app-x/apps/*/www/static/app/offline-h5` |
| `publish app` | `unpackage/resources/app-*/static/app/offline-h5` |
| `pack` 且本地没有 resources 目录 | 告警跳过（云打包在服务端出包，本地无目录可验） |

界面发行后需要手动执行，例如：

```bash
pnpm offline-h5:verify -- unpackage/resources/app-ios/static/app/offline-h5
```

运行时不做这份校验。包坏了或被裁掉，表现为本地加载超时，再按回退链走远程。

### `offline-h5:verify-artifact`

```bash
pnpm offline-h5:verify-artifact -- unpackage/release/xxx.ipa
pnpm offline-h5:verify-artifact -- unpackage/release/xxx.apk
```

对应 `scripts/verify-offline-h5-artifact.mjs`。输入是已打好的 `.ipa` 或 `.apk`，用来补上云打包本地没有 resources 目录的缺口。

它用 `unzip` 只解 `*static/app/offline-h5/*` 到临时目录，再递归找到带 `offline-h5-resources.json` 的 `offline-h5` 目录，复用同一套 `verifyResourcePackage`。iOS / Android 包内层级不同，所以不写死路径，只搜清单文件。解压无匹配或找不到清单时非零退出，并提示打包前未 prepare 或编译时包缺失。临时目录在 `finally` 删除。

它不理解业务页面是否真能打开，只证明「清单里的每个文件都原样躺在安装包里」。

### `offline-h5:test`

```bash
pnpm offline-h5:test
```

对应 `node --test scripts/offline-h5/offline-h5.test.mjs`。不调用 HBuilderX，不写 `static/app/offline-h5`。用 Node 内置 test runner 把容器、状态机、桥和会话页里与离线协议相关的逻辑抽出来跑。覆盖大致是：

- 暂停期间只在恢复时打开最新一次 request；批量 postMessage 逐条处理，不能只留最后一条。
- 过期的 document load / error、过期的原生桥，不能完成或打掉更新的请求；软导航失败仍要武装回退计时器。
- 会话页：租户缓存缺失或损坏仍能进普通会话；首帧 ready 之后，初始化失败、历史失败或超时仍要露出重试；临时会话继续等验证码配置。
- 登录分流：内嵌 App 发 `OFFLINE_H5_AUTH_REQUIRED`，浏览器和小程序保留各自登录路由；旧 request / 旧账号不能登出新账号。
- 状态机：同页不同 query 不复用文档；换账号或取消后不能复用；迟到 ready 被拒绝。
- 桥：未 ACK 前按 250ms 重发，收到 ACK 后停止。
- 清单校验拒绝被改过的文件和符号链接目录；IIFE preload 跳过 JS、保留 CSS，并把 CSS 错误传出去。

这是协议和回退链的回归，不能代替真机上的 WebView 加载。

## 运行时怎么用这包

容器收到的 request 由 `buildProjectOfflineH5Request` 组装：

- `localUrl`：`/static/app/offline-h5/index.html?apiBase=<server>#<业务路由>&appEmbedded=1&appNativeLogin=1&accessToken=...`
- `remoteUrl`：`<server>/m/#<同一套 hash>`
- `preferLocal`：总开关未关时为 true
- `remoteReadyPolicy: 'document'`：线上旧 H5 还没有页面协议时，远程侧用文档加载完成作为就绪，避免回退后永远等一个不会来的 `PAGE_READY`。只有本地 `PAGE_READY` 之后才允许软导航。

`offline-h5-project-bootstrap.js` 仅在 `location.protocol === 'file:'` 时执行。它把 search 里的 `apiBase` 写成 `NUWAX_API_BASE_URL`，把 hash 里的 `accessToken` 写成 `ACCESS_TOKEN` / `ACCESS_TOKEN_ORIGIN`。每次新文档都覆盖，避免同一个 `file://` origin 留下上一个服务器或账号。`apiBase` 必须是无用户名、无路径、无 query 的 `http(s)` origin，否则桥上报 `runtime-configuration-failed`。

状态机 `OfflineH5Session` 的阶段：

```text
open
  已 ready-local、同一 scope、目标页面路径不同 → navigating-local（evalJS 软导航）
  需要本地且不能复用（含同路径不同 query）   → loading-local（整文档）
  preferLocal 为 false                        → loading-remote

超时（容器持有计时器；软导航 6s，文档加载 12s）
  navigating-local → loading-local → （remoteUrl 非空）loading-remote → failed
```

每次 open、超时、取消都换 `requestId`。身份放在 hash query（`offlineH5RequestId`，页面 `onLoad` 能读到）。另有一个 `offlineH5Attempt` 放在 search 段：WKWebView 对「只改了 fragment」的 src 赋值不重新加载文档，软导航超时后的本地重载会变成空等。旧 id 的消息、load、error 一律丢弃。

预热请求（`createChatWarmupRequest`）把 `remoteUrl` 置空：后台预热失败时停在本地，不悄悄去拉远程 `/m/`。

iOS 用常驻壳，WebView 不随页面销毁，换会话优先软导航。Android / 鸿蒙每次进详情页挂容器；首页用 1px 隐藏容器预热，提前落下 WebView 的 JS 编译缓存。两端共用同一包和同一协议。

## 产物落点

| 路径 | 谁写出 | 是否入库 | 作用 |
|---|---|---|---|
| `unpackage/offline-h5-web/` | build 的 H5 编译 | 否，成功后默认删除 | `/m/` ESM 中间产物 |
| `unpackage/offline-h5-source.json` | build | 否 | 本次编译对应的源码指纹 |
| `unpackage/offline-h5/` | derive | 否 | 已派生、已列清单的 stage |
| `unpackage/offline-h5-staging/` | prepare | 否 | 安装过程的临时副本 |
| `static/app/offline-h5/` | prepare | 否（gitignore） | HBuilderX 打进 App 的安装目录 |
| `unpackage/dist/dev/app-*/.../offline-h5/` | App 编译 | 否 | verify 的对象 |
| `*.ipa` / `*.apk` 内的同名目录 | 打包 | 发布物 | verify-artifact 的对象 |

协议源码 `offline-h5-bridge.js`、`offline-h5-project-bootstrap.js` 随仓库提交，构建时原样拷进包根。改桥或 bootstrap 会改变源码指纹，下一次 prepare 会重建整包。

## 和线上 H5 的边界

- 离线包不是线上 `/m/` 的镜像全站。它只有 bootstrap、会话详情、应用详情，以及这些页面运行时真正要的静态资源。
- 本地失败的用户仍然能用远程 H5。回退链的终点是 `failed` 加原生重试，中间会先试远程文档。
- 远程旧包没有 `appNativeLogin` 能力标记时继续走 H5 自己的登录路由；新宿主在 URL 上显式带 `appNativeLogin=1`，登录过期由原生接 `OFFLINE_H5_AUTH_REQUIRED`。
- 清单校验保证字节没丢、没被改，不保证页面路由写对。路由是否打开，要看运行日志里的 `open` key 和 `show-route` 是否一致，以及 `ready` / `fallback` 的耗时。
