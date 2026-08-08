# SVG 公式渲染整合 — 交接存档

> 写于 2026-08-08。分支 `feat/nuwa-zhuoda-2026.07-svg-renderer`。
> 本文供新会话/其他 agent 接手，含已完成工作、当前阻塞、极致性能架构决策。

## 一句话现状

x-svg-renderer（原生 SVG 渲染插件）已接入并修通编译；rich-text-math 的 mathjax SVG 方案已整合进当前分支；base-android 已打包上红米真机能启动。**但公式当前不显示**，卡在两个独立运行时问题（图标资源路径 + proxy-web 就绪），且经讨论确定**极致性能需走服务端预生成 SVG**。

---

## 已完成（4 commit，本地未推，origin 落后 5）

| commit | 内容 |
|---|---|
| `2a15d989` | x-svg-renderer 4 bug 修复：iOS clear() 可选链赋值、组件 watch getter `(): string`、inject_all_uts_modules.py 把 config.json dependencies 注入 uts 模块 build.gradle（+ `-aar` 坐标归一化）、AGENTS.md 同步 |
| `08606c9f` | x-svg-renderer 接入 uni-x-renderer（7 插件文件 + katex-el svg prop + test-svg-renderer 页） |
| `adbf5294` | merge feat/nuwa-zhuoda-2026.07-rich-text-math（解 pages.json 冲突，留 test-katex + test-svg-renderer） |
| `feeed01c` | 补最后一公里：mathjax → **svg 字符串** → katex-el `:svg` → x-svg-renderer（9 文件） |

## 关键产物

- **x-svg-renderer 插件**（`uni_modules/x-svg-renderer/`）：纯渲染器，`setSvg(content)` + AndroidSVG/SVGKit 原生绘制。源码对齐 `/Users/apple/workspace/uni-x-renderer`（官方源 clone）。
- **base-android**：`unpackage/debug/android_debug.apk`（BUILD SUCCESSFUL，dex 含 `uts.sdk.modules.xSvgRenderer` + androidsvg，mathjax 链路业务代码已编入）
- **红米真机** `8PNNT4TKHIJVU8RO`：base 已装，app 能启动（RESUMED，需清除重装避免 splash 卡死）
- **鸿蒙支持**：已在 `/Users/apple/workspace/uni-x-renderer` 源码仓库实现（app-harmony/ + @ohos/svg），validate.yml 自检通过，**未同步进 nuwax-mobile**，需鸿蒙模拟器/Deveco 验证

## 架构事实（重要，避免重复误解）

公式渲染分两步：
1. **LaTeX → SVG 字符串**：数学排版。mathjax 是 JS 库，**只能**在 web 桥（proxy-web）跑，uni-app x **无原生 LaTeX→SVG 库**，自研数学排版引擎成本极高。
2. **SVG 字符串 → 原生渲染**：x-svg-renderer（AndroidSVG/SVGKit）。

x-svg-renderer README 明确：「Keep LaTeX/Mermaid parsing outside the native renderer: upstream produces SVG, this plugin renders it.」即插件只做第 2 步。

当前整合 = 第 1 步用 proxy-web mathjax（web），第 2 步原生。**省掉了旧方案的 html2canvas 截图，但 mathjax 生成仍在 web，性能提升有限**。

---

## 极致性能架构（最终方案 = 整合 x-math-latex 分支）

用户要极致性能 + **原生 App 客户端生成**（不走服务端、不走 proxy-web webview）。两条独立调研收敛到同一答案：

**B 调研（agent ab151ab46efddaaa8 已完成）**：推荐嵌入 JS 引擎跑 mathjax —— Android HarlonWang `quickjs-wrapper:3.2.3` + 自定义 webpack mathjax headless bundle（~1.2MB，liteAdaptor 零外部依赖，暴露同步 `renderMath(latex,display)`，剥 `<mjx-container>`）+ 字节码预编译（冷启动 <200ms）+ iOS JavaScriptCore（系统 framework 零依赖）。可行，性能冷启动大胜（消除 proxy_not_ready 竞态）、稳态 iOS JSC 无 JIT 靠缓存+批量抵消。

**x-math-latex 分支（`origin/feat/nuwa-zhuoda-2026.07-x-math-latex`，2 commit b4fd3fe6+acfa31cf，base=aec3e550）已经把 B 落地了**，且技术栈与调研推荐一致，还多了真原生 LaTeX：
- `uni_modules/nuwax-uni-math/`：完整插件（mathRendererCore 后端切换 + nativeSvgBackend/proxyWebBackend 双后端 + mathDiskCache）
- Android 原生后端 `utssdk/app-android/index.uts`（330 行）：
  - `com.agog.mathdisplay.MTMathView`（AndroidMath.aar 4.4MB）—— **真原生 LaTeX**（纯 Canvas + FreeType 矢量字形，无 SVG/webview），比 A(JLaTeXMath)更对的轮子
  - `com.whl.quickjs.wrapper.QuickJSContext`（quickjs-wrapper 3.2.3，**与调研推荐同一库**）+ MathJax → SVG
  - `com.caverock.androidsvg.SVG`（AndroidSVG，与 x-svg-renderer 同款）→ 位图
  - `MathSvgEngine`：QuickJS 单例 context 常驻（避免每次 114ms bundle load）+ 单线程 executor（QuickJS 非线程安全）+ 内存/栈上限 + console 转发 logcat
- `native/mathjax-bundle/`：自定义 mathjax bundle 构建（build-entry.js + regen.sh）
- mathRendererCore 注释明确架构：「APP-ANDROID nativeSvgBackend（QuickJS+MathJax→原生 SVG→位图）为主，失败兜底 proxyWebBackend」；「Phase2 native 分支根除 evalJS 桥死锁 + 公式可选/可复制」

**结论：整合 x-math-latex 分支**（B 的现成 + AndroidMath 加强），不从零做 B。

### 整合路径（新会话执行）
1. `git merge origin/feat/nuwa-zhuoda-2026.07-x-math-latex` 进当前分支（base 同为 aec3e550；预判冲突：当前已合的 rich-text-math 在 uni-ai-x 的 math-render/proxy-web 公式链路 vs x-math-latex 的 nuwax-uni-math 新插件 + appMarkdownFallback，需决定保留谁——x-math-latex 是更新的原生方案，倾向以它为准，rich-text-math 的 web mathjax 降为兜底或移除）
2. x-math-latex 的 nuwax-uni-math 含原生 aar（AndroidMath/quickjs/androidsvg）→ 必须自定义基座（`make base-android`，inject_all_uts_modules.py 已支持 config.json dependencies + libs/aar）
3. 验证：test-katex 页（x-math-latex 带了 98 行 test-katex）切 native/proxy 后端，红米真机看原生 LaTeX 渲染 + `[MATHSVG]` 日志
4. iOS 侧 x-math-latex 暂只有 Android 后端（mathRendererCore 注释提 iOS iosMath），iOS 需补（按 B 调研：JavaScriptCore + MathJaxBridge.swift）

### 否决的替代方案
- 服务端预生成 SVG：用户明确**不考虑**
- lime-katex（UTS 原生，付费 88/99 + lime-shared 依赖 + 项目 lime 0.x vapor 崩）：x-math-latex 自有代码更优，否决
- 从零做 B：x-math-latex 已实现，否决

---

## 当前两个运行时阻塞（与极致架构无关，是落地细节）

### 1. 图标方框（lime-icon 读 /storage 失败）
- apk `assets/.../www/uni_modules/lime-icon/static/icons.json` **打包齐全**（62KB）
- 设备 `/storage/.../www/uni_modules/lime-icon/static/icons.json` **读不到**（logcat: `No such file or directory` errCode 1300002）
- 根因：lime-icon 用 `fileSystemManager` 读 `/storage` 绝对路径，**本地 assembleDebug 基座资源在 apk assets 不落盘 /storage** → 图标方框
- 与公式整合无关（整合只改公式代码）。云端/标准基座资源释放机制不同所以之前正常
- 排查方向：lime-icon 改读 assets 路径 / debug 基座配置释放资源 / 换基座

### 2. 公式不渲染（proxy_not_ready）
- logcat: `setSetting { error: "proxy_not_ready", imageDataURL: "", resultHtml: "" }`，全程无 `[MATHSVG]` 日志
- 根因：mathjax.js 2MB async 加载 + webview 初始化慢，test-stream-perf 快速流式公式撞上 proxy-web 未就绪窗口 → 请求失败 → svg 空 + href 空（mathjax 不生成 PNG）→ 公式完全空白
- 链路结构是通的：`runMathjaxBatch`/`runMathjaxJob`/`mathjaxSvgRenderToResult`/`MathJax.tex2svgPromise` 全部实现（proxy-web.html），svg 串→token.svg→katex-el:svg→x-svg-renderer 已接
- 排查方向：proxy-web whenReady 重试 / mathjax 加载确认 / 正常对话（非 test-stream-perf 高速）验证

---

## 关键代码位置

- 插件：`uni_modules/x-svg-renderer/`（interface.uts / app-android/index.uts / app-ios/index.uts / 组件）
- 公式入口：`uni_modules/uni-ai-x/sdk/math-render.uts`（mode 默认 mathjax，切回 katex 改 `mathRenderConfig.mode`）
- proxy-web 桥：`uni_modules/uni-ai-x/sdk/proxy-web.uts` + `static/proxy-web/proxy-web.html`（mathjax action：mathjaxSvgRender / mathjaxSvgRenderBatch / runMathjaxBatch）
- 公式回填：`subpackages/components/ai-msg/appMarkdownFallback.uts`（applyMathResultToToken：mathjax→token.svg，katex→token.href）
- 渲染调用：`uni_modules/uni-ai-x/components/uni-ai-x-msg/uni-ai-x-msg.uvue`（4 处 katex-el :svg）
- 缓存：`subpackages/components/ai-msg/mathFormulaDiskCache.uts`（mathjax svg 当前**仅 L1 内存**，未持久化）
- 测试页：`pages/test-katex/test-katex.uvue`（默认 mathjax，M1-M3 矢量公式，切 mode）+ `pages/test-svg-renderer/`

## UTS/uvue 已知坑（务必遵守，否则编译失败）

- 禁止可选链赋值 `a?.b = v` → `const x = this.foo; if (x != null) x.bar = ...`
- `watch(() => props.x, cb)` getter 必须 `(): T =>`
- 先声明后引用（异步闭包/回调内同样）
- readRawField 要 `new UTSJSONObject()` + bracket
- 带三方依赖 uts 插件：cli launch（运行流）撞 error18，用 `make app-resource`（发布流）不卡

---

## 待办（按优先级）

1. **定架构方向**：极致性能 → 服务端预生成 SVG（需后端）；或先调通当前 mathjax 链路（解 proxy_not_ready）
2. 解运行时两问题：图标 /storage 路径、proxy-web 就绪
3. mathFormulaDiskCache 持久化 svg（极致缓存层）
4. 验证 OK 后清 rich-text-math worktree：`git worktree remove .claude/worktrees/rich-text-math` + `git branch -d feat/nuwa-zhuoda-2026.07-rich-text-math`
5. 发布前：mode 默认值确认（mathjax 验证后切回 katex 或保留）、移除 `[MATHSVG]` 日志、鸿蒙代码同步进 nuwax-mobile
6. x-svg-renderer 的 4 处本地适配（iOS clear / watch getter / inject 依赖 / 坐标归一化）反哺官方源仓库 `dongdada29/uni-x-renderer`

## 验证基建（已通）

- `make app-resource && make base-android` → `unpackage/debug/android_debug.apk`
- 红米 `8PNNT4TKHIJVU8RO`：`adb uninstall com.nuwax.app && adb install ...apk`（**必须清除重装**，否则 splash 卡死 Launch timeout）
- `adb logcat | grep MATHSVG` 看公式链路；`adb exec-out screencap -p > x.png` 截图
- 注意：am start `--es pagePath` 被 App.uvue onLaunch 登录分流覆盖，进 test 页要临时改首页重打或正常对话触发
