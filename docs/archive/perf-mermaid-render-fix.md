# 任务：修复会话页 mermaid 渲染失败 + 流式抖动（交接给优化 agent）

> 来源：会话流式渲染性能优化一轮（分支 `feat/nuwa-zhuoda-2026.07-perf-vdom`）。解析层根因已修（见 `docs/perf-conversation-stream-render.md`），**本任务只解决 mermaid 渲染**。不考虑 vapor。

## 目标
mermaid 图在会话流式输出时能**正常渲染成图**（不再"图表渲染失败"）、**不抖动**（不每帧重渲/闪烁）。**公式（KaTeX）正常，只有 mermaid 有问题。**

## 症状（真机 Redmi 24094RAD4C，自定义基座 5.15 VDOM 实测）
- mermaid 块显示"**图表渲染失败，可切换到「代码」查看源码**"，且**来回抖动**（每 ~flush 重新初始化渲染）。
- logcat：mermaid `render: fail`；启动期 `setSetting error=proxy_not_ready`（`uni_modules/uni-ai-x/sdk/index.uts:160`）。
- **只有 mermaid；公式/表格/代码/工具卡/图片都正常。**

## 复现
1. `pnpm base:fetch` → HBuilderX「使用自定义基座运行」（标准基座不行，需自定义基座含 uni-ai-x）。
2. 入口页 `pages/test-stream-perf/test-stream-perf`（已注册 `pages.json`）：`mdType = mermaid`、`H=0`、`L=4000` →「开始测试」。
3. 进入会话页后**自动流式**（`AgentDetailService.runMockPerfStream`，Mock 数据排除网络抖动），观察 mermaid 块：失败提示 + 抖动。
4. 抓日志：`adb -s <dev> logcat | grep -iE "PerfProbe|SseStall|render:|proxy|mermaid"`。
   - 性能埋点/mocks 见 `utils/perfProbe.uts`、`subpackages/pages/chat-conversation-component/layers/mockStreamPerf.uts`。

## 渲染链路（关键代码，按调用顺序）
1. 解析：`subpackages/components/ai-msg/aiMsgMarkdownParser.uts` → ```` ```mermaid ```` 闭合后跨 stable cut 冻结成 `code_block`（lang=mermaid）元素。
2. 渲染组件：`uni_modules/uni-ai-x/components/uni-ai-msg-code/uni-ai-msg-code.uvue`
   - `language == 'mermaid'` 分支（:4/:16/:26）。
   - `:83 watch((): string | null => props.href, …)` —— 由 **`props.href`**（proxy 截图 base64）驱动出图，写入 `mermaidInfos`(:82)。
   - `:125 mermaidFailed = computed(...)` —— mermaid 且 href 空/无 mermaidInfo → 显示"图表渲染失败"(:26)。
   - `:165 watch(props.codeText)` —— codeText 变也触发重算。
3. 出图源：**proxy-web**（WebView 截图）—— `uni_modules/uni-ai-x/sdk/proxy-web.uts`
   - `:67 isReady()`、`:159 callMethod(param, callback)`（mermaid render 走某个 action）、未就绪 → `error: "proxy_not_ready"`(:99)。
   - `setSetting` 失败打点：`uni_modules/uni-ai-x/sdk/index.uts:160`。
   - mermaid 的 base64 截图作为 `href` 回传 → 喂给 `uni-ai-msg-code.props.href`。

## 根因假设（请 agent 确认并修）
- **H1（渲染失败本身）**：proxy-web 里 mermaid 出图失败——可能 proxy WebView 未加载 mermaid.js / `callMethod` 的 mermaid action 报错或超时 / proxy 未 ready 时调用即 fail。→ 查 `proxy-web.uts:callMethod` 的 mermaid action、proxy WebView 注入的库、`isReady` 时序；对比公式（KaTeX）为什么成功、mermaid 为什么失败。
- **H2（抖动=每帧重渲）**：流式每个 flush（`STREAM_UI_COALESCE_MS=200ms`）都会让 mermaid 元素重渲——`props.href`/`props.codeText` 每帧重新触发 `watch`(:83/:165) → `mermaidInfos` 重建 / `mermaidFailed` 反复跳变 → 抖动。**没有"按内容缓存 / 失败后退避"**。
- **H3（冻结不及时）**：mermaid 块可能久留 live 区（`findStableMarkdownCut` 对结构块非单调），未及时冻结 → 反复重解析重渲。见 `utils/markdownStableCut.uts`。

## 修复方向（按优先级）
1. **让 mermaid 真能出图（H1）**：修 proxy-web 的 mermaid 渲染（加载 mermaid 库 / 修 action / 等 ready 再调 / 错误兜底）。先在真机抓一次 `callMethod` 的请求与 proxy 回包，定位是"未就绪"还是"渲染报错"。
2. **停止抖动（H2，必做）**：在 `uni-ai-msg-code.uvue` 加 **按内容缓存**——同一 `codeText` 已渲过/已失败则不重渲；失败给稳定兜底（不每帧重试）。即 `watch(href)`/`watch(codeText)` 先判缓存命中。
3. **及时冻结（H3）**：必要时让 `findStableMarkdownCut` 对闭合 ```` ```mermaid ```` 块稳定推进（只渲一次）。注意不要破坏既有 stable-cut 逻辑。

## 约束
- **不要回退解析层已修的根因**：`aiMsgMarkdownParser.uts` 的 `normalizeLiveForParse`（现只闭合 group + `\n\n`，**不闭合 ```**）+ cut-regress 钳制 + `INCREMENTAL_FALLBACK_ENABLED=true` + `STREAM_UI_COALESCE_MS=200`。这些已验证（mixed@6000 full_parse_large 0 / el_stuck 1 / 解析 3-9ms）。
- UTS/uvue 5.15 编译坑（function 不提升 / const 不可自引用 / setInterval 内联箭头解体 / `any`→具体类型形参报 Any?）见 memory `uniappx-perf-gotchas`。
- 不考虑 vapor。

## 验证
1. 编译：`pnpm hx:android:compile`（HX CLI `--compile true`）0 UTS 错误（CSS 噪声忽略）。
2. 真机：`pages/test-stream-perf` → `mdType=mermaid` → mermaid **出图**（不再"图表渲染失败"）、**不抖动**。
3. 回归：`mdType=mixed`（现 = 表格+公式+代码+工具卡+图片，已不含 mermaid）仍 fps~24 / full_parse 0 / el_stuck 1（不回退解析层修复）；公式仍正常。
4. 把 mermaid 重新加回 `mockStreamPerf.uts:buildMixedSample` 后，mixed 流式 mermaid 也不抖。

## 相关
- 总方案 + 数据：`docs/perf-conversation-stream-render.md`（含「⚠️ mermaid」一节）。
- memory：`conv-stream-perf-status`（进度）、`uniappx-perf-gotchas`（UTS 坑）。
- 测试入口：`pages/test-stream-perf/test-stream-perf.uvue`；mock：`subpackages/.../layers/mockStreamPerf.uts`（mdType 已含 mermaid，10 个图）。

---

## 已实施（2026-08-07）

### 精确根因（对比公式链路确认）
公式（KaTeX）有完整去重 → 流式不抖：`MathDedupeGroup`（同 latex 去重）+ `mathInFlightTokens`（在途扇出）+ 磁盘缓存 + 并发闸 `MAX_CONCURRENT_KATEX=2`（`appMarkdownFallback.uts`）。
**mermaid 的 `renderMermaidToken` 原先零去重**：活跃流式路径 live 区每 flush 重解析（`aiMsgMarkdownParser.uts:572-583`），闭合 mermaid 块滞留 live 区时（cut 没越过它）每 200ms 重发一次 proxy 截图 → 灌满 proxy 串行 `mermaidQueue` → 全部超时失败（"图表渲染失败"）+ href 每帧变 → 抖动。
**故 H1（渲染失败）与 H2（抖动）同根：缺去重。** 上面"修复方向 #2"方向对，但正确层是解析层 `renderMermaidToken`（mirror 公式去重），非仅渲染组件。`proxy-web.html` 本身已健壮（waitForMermaid 3s + try/catch + html2canvas 8s 超时），无需改（也避免改静态资源触发基座重建）。

### 改动（2 文件，纯 UTS，热更即可，已编译 0 UTS 错误）
1. `subpackages/components/ai-msg/appMarkdownFallback.uts` — `renderMermaidToken` 加（mirror 公式）：
   - **成功缓存**：`mermaidCache: Map<text, {href,width,height}>`，命中 → 同步回填 token.href，零 proxy 调用、零抖动。
   - **在途去重**：`mermaidInFlight: Map<text, MermaidWaiter[]>`，同 text 已 dispatch 未回调 → 挂 waiter，回调统一扇出（含已冻结进 stableEls 的 token，防漏填后不再重解析）。
   - **失败 2s 冷却**：`MERMAID_FAIL_COOLDOWN_MS=2000`，失败 text 2s 内不重发，落代码 Tab 兜底（不每帧重试打满队列）。
2. `uni_modules/uni-ai-x/components/uni-ai-msg-code/uni-ai-msg-code.uvue` — `watch(props.href)` 加同 href 不重复入栈防御（避免 `mermaidInfos` 堆积/闪烁）。

未改：`proxy-web.html`、`findStableMarkdownCut`（H3 高风险，去重已让重解析无害，不必动 stable-cut）、解析层根因（`normalizeLiveForParse` 等保持）。

### ✅ 真机已验证（2026-08-07）
真机（自定义基座）`pages/test-stream-perf` → `mdType=mermaid`：**mermaid 正常出图、不抖动**。
结论：H1（渲染失败）与 H2（抖动）确为同根（无去重 → 灌满 proxy 串行 mermaidQueue → 全超时 + 每帧 href 变）。dedup 缓存修完即好，mermaid.min.js 在该 WebView 本身可正常渲染，无需动 proxy-web.html。
- 顺带修：测试页 `mdType` 原用 `<picker>`，其 `@change` 事件在 uni-app x 取不到值（`detail` 为空 → 回退当前值 → 切不动）。已改为可点 chip（`@click="onSelectType(i)"`），编译 0 UTS 错误。
- 回归待补：`mdType=mixed`（现不含 mermaid）仍 fps~24 / full_parse 0 / el_stuck 1 / 公式正常；可把 mermaid 加回 `buildMixedSample` 做联合回归。
