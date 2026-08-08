# 会话页面性能：可复现测试报告（复用真实会话详情页 + Mock 数据）+ 补齐列表层缺口

> 进度文档。对应分支 `feat/nuwa-zhuoda-2026.07-perf-vdom`。不考虑 vapor。
> 计划源：`~/.claude/plans/radiant-riding-shamir.md`（同内容）。

## 进度追踪

- [x] **Phase 0** — 基座 / SDK 自检（已完成，结论见下）
- [x] **Phase 1** — Mock 数据层 + 性能测试入口（复用真实会话页）✅ 编译通过（app-android 0 UTS 错误）
  - [x] 1.1 `subpackages/pages/chat-conversation-component/layers/mockStreamPerf.uts`（开关 + Mock 历史 + Mock SSE 驱动，async+await delay）
  - [x] 1.2 Service `handleConversation` 接 Mock 分支 + `seedMockHistoryIfNeeded` + 页面 `runOnLoadAsync` 读开关 seed+跳网络
  - [x] 1.3 极薄启动页 `pages/test-stream-perf/test-stream-perf.uvue` + 注册 `pages.json`
  - [x] 1.4 fps/maxGap 帧探针（async+while(flag) 自调度）+ perfTest 浮层 + logcat `[PerfProbe]`
  - [x] 1.5 编译验证（`pnpm hx:android:compile` → 编译成功）
- [x] **Phase 2** — 真机基线测量（Redmi arm64，自定义基座，Mock 驱动）✅ 抓到根因，结论见下"测量结果"
- [x] **Phase 3** — 消融对比（`INCREMENTAL_FALLBACK_ENABLED` ON vs OFF）✅ 结论见下"消融结论"
- [x] **Phase 4a（解析层治本）** — `normalizeLiveForParse`（半截块提交）+ cut-regress 钳制（不退全量）。✅ mixed@6000 验证：full_parse_large 18→3、el_stuck 73→2、解析 9ms（见下"解析层修复验证"）
- [~] **Phase 4b（渲染层·部分）** — ✅ flush 窗 `STREAM_UI_COALESCE_MS` 100→**200ms**（maxGap 381→241ms、`sse_without_parse` 14→0）。fps~14 上限已排除事件轮询（5s 间隔、非每帧）/ 排除 flush 频率（100 与 200 都 ~14）→ 是**常驻重 view 树**（mixed@6000 一大堆原生 view），突破需 list-view 回收。`uni-ai-x-msg` 模板函数记忆化未做（mock 下 resolveProcessData 因 processingList 空、本身已快）。
- [~] **Phase 4c（长历史列表层 / view 回收）** — `scroll-view`→`list-view` **代码已落地（双模板运行时切换 + mermaid 临时关闭），待真机验证**，详见 [`perf-list-view-migration.md`](./perf-list-view-migration.md)。当年 `2db9d6d2`→`bd1dfa12` 回滚根因已核实 = **mermaid 回收即崩 + 表格高度**（非公式/流式）；本次 mermaid→代码拔崩溃点 + `useListView` A/B 切换（`test-stream-perf` chip / perf 浮层）+ Phase2 `updateMessage` 自校验 id / Phase4 rebind 清解析定时器。`getMessageAttachments` 预算 / deep watch 收窄见 Phase 4 A/B/D。**fps 流畅度的真正杠杆**。

---

## 测量结果（2026-08-07，Redmi 24094RAD4C 真机，自定义基座 5.15 VDOM）

复用真实会话页（agent-detail → chat-conversation-component → ai-msg.uvue），Mock 驱动流式（排除网络）。入口页 `pages/test-stream-perf/`，mdType/H/L 可选，点「开始测试」自动流式（`AgentDetailService.runMockPerfStream`）。fps/maxGap 由帧探针（`[PerfProbe]`）+ 卡滞告警（`[SseStall]`）打 logcat。

**根因（perfProbe 实锤）**：`[SseStall] WARN el_stuck streak=N el=K body=M (解析在跑但列表结构几乎不变)`
- 流式正文 `body` 一直涨（如 5577→5894），但渲染元素数 `el` 卡住不动（~98），streak 最高 8、告警 100+ 次。
- = 增量解析器每个 flush 都重算 live 段，却**几乎不提交新可见元素**（要等闭合块）→ 主线程被解析空转吃满 → UI 不推进 → 卡死。
- 累计最坏：fps 均值 16、**maxGap 1008ms**（1 秒一帧）。

## 消融结论（同配置 tool，INCREMENTAL_FALLBACK_ENABLED ON vs OFF）

| 模式 | fps | maxGap 均值 | maxGap 最坏 |
|---|---|---|---|
| **OFF（全量解析）** | ~20 | **594ms** | **3140ms**（3 秒一帧，纯卡死） |
| **ON（增量解析）** | ~38–41（实时直读）| ~280ms | ~310ms |

1. **增量解析方向正确、收益显著**：ON ≈ 2× fps、maxGap 减半、**消除 3 秒级冻结**。全量解析（OFF）是灾难。→ 开关保持 `true`。
2. **但增量仍不够流畅**：ON 在长 body 下仍掉到 ~19fps、仍有 `el_stuck`（live 段 churn）。**根因没消除** —— live 段流式期不提交可见元素。
3. **下一步（治本）**：改 `applyAppFallbackIncremental` 的 live 段提交 —— 流式期按句/行产出可见元素、别等闭合块，让 `el` 跟着 `body` 涨。

> 测量噪声备注：logcat 缓冲易跨 run 串味（需每条 run 前 `adb logcat -c`）；fps 随 body 增长而降（早期高、后期低），单点读数取实时直读更可信；帧探针 awk 汇总踩 `>>>` 注入坑（待避）。

## 解析层修复（治本）验证 — mixed@6000 公平对比

针对根因做了两处解析层修复，并在 **mixed @ L=6000（与修前同条件）** 重测：

1. **`normalizeLiveForParse`**（`aiMsgMarkdownParser.uts`）：流式 live 段解析前合成关闭未配对的 ``` / `<markdown-custom-process-group>` / `$$` + 末尾空行，让"半截结构块"也能产出可见元素（修前 live 段是未闭合结构块 → 解析器整段丢弃 → `el` 不涨、新类型流式期不渲染）。
2. **cut-regress 钳制**（`applyAppFallbackIncremental`）：`findStableMarkdownCut` 对结构块非单调、切点偶尔回退；修前回退→退全量（`full_parse_large`，3 秒级冻结源）。改为**钳制到已冻结前缀末尾**，保留 frozen 元素、只重解析 live 尾（append-only 流式下冻结前缀仍有效）。

| 指标 | 修前 mixed@6000 | **修后（clamp+livefix）** | 变化 |
|---|---|---|---|
| `full_parse_large`（全量回退=冻结源）| 18 | **3** | ✅ ↓83% |
| `el_stuck`（live 段空转）| 73 | **2** | ✅ ↓97% |
| `sse_without_parse`（解析跟不上）| 59 | **14** | ✅ ↓76% |
| 增量解析耗时 | 经常 >80ms（slow_parse）| **avg 9ms / max 50ms** | ✅ |
| `slow_parse` | 1 | 0 | ✅ |
| `el` 是否跟 `body` 涨 | 卡死 | **跟着涨** | ✅（内容流式期可见）|

**结论：解析层"卡死/输出不全/有公式就卡死"根因已修。** 重负载下增量解析稳定 avg 9ms、不再 backstop 全量、内容边流边出。

**剩余瓶颈在渲染层**：解析 9ms 但 fps ~15 / maxGap ~381ms（max 818ms）——耗时转移到渲染正在提交的元素（表格/公式/工具卡/mermaid/图片元素 × v-for 每 ~100ms flush 全重渲染，对应 `uni-ai-x-msg` 的 `resolveProcessData`/`tableMathKey` 等模板重函数 + `scroll-view`+`v-for`）。
> 注：修前 fps 数字略高（~19）是因为**内容根本没渲染**（el 卡死、空白，渲染负担轻）；修后内容真渲染了（el 涨），渲染负担变重 → fps 数字反低，但**内容出来了、3 秒级冻结没了**。是进步，瓶颈明确转移到渲染层。

**下一步（渲染层，Phase 4 扩展）**：
- 记忆化 `uni-ai-x-msg` 的 `resolveProcessData`/`tableMathKey`/`paragraphMathKey`，降 v-for 模板函数（Agent 1 方向）。
- 拉长流式 flush 合并窗（`STREAM_UI_COALESCE_MS` 100→200ms），降渲染频率（低风险、立竿见影，略牺牲跟手感）。**✅ 已做：flush 100→200ms，mixed@6000 maxGap 381→241ms（干净单跑复测 162ms）、`sse_without_parse` 14→0。**
- 长历史场景的 `getMessageAttachments` 预算 / deep watch 收窄 / `scroll-view`→`list-view`（原 Phase 4c，fps 流畅度真正杠杆）。

## ⚠️ mermaid：proxy-web 渲染失败 + 抖动 —— 排除出本轮结论（后面单独优化）

- **只有 mermaid 有问题；公式（KaTeX）正常。** mermaid 走 **proxy-web**（WebView 截图渲染），本自定义基座里 mermaid `render: fail` → 渲不出、显示"图表渲染失败"，且每帧 flush 触发重试 → **来回抖动**。
- 这是 **proxy-web 基座环境 + 渲染层重试**问题，**不是本轮解析层根因**（解析层 `normalizeLiveForParse`/cut 钳制对不走 proxy 的内容已验证有效）。
- **本轮性能结论覆盖 plain / table / formula / code / tool / image**（mixed 已去掉 mermaid）。**mermaid 渲染与抖动单列**，需：① 修 mermaid 的 proxy-web 渲染失败；② 渲染层加按内容缓存/重试上限，避免失败每帧重试。mermaid 仍保留为单独 mdType，待后面专门优化。
- `normalizeLiveForParse` 已调整：**不再提前闭合 ```**（避免 live 区 mermaid/代码块每帧重渲抖动），让它们闭合后跨 stable cut 冻结时渲一次；保留 group 闭合（工具卡）+ `\n\n`（段落/表格）。

---

## Context（为什么做、当前真实状态）

线上反馈：Android 会话流式输出**卡死、输出不全、有公式就卡死**。

**关键发现（已读码 + git log 核实）**：用户原方案里的 **Step 1（结构化节流）/ Step 2（KaTeX 并发闸）/ Step 5（增量分段）+ 埋点 `utils/perfProbe.uts` 都已实现并提交**（`757411e5`、`4e7021a8`、`dee034d6`、`fe174f74 Merge perf/stream-markdown-render` 等），不是待做。证据：
- `ai-msg.uvue:386-543` 结构/纯文本两路都走 `scheduleMergedParse`（`STREAM_MD_TEXT_INTERVAL_MS=160` / `STREAM_MD_STRUCT_INTERVAL_BASE_MS=280`）。
- `appMarkdownFallback.uts:108 MAX_CONCURRENT_KATEX=2` + `:121 MathBatchUiRunner` + `:211 pump()` + `:151 mathInFlightTokens` 在途去重。
- `aiMsgMarkdownParser.uts:464 applyAppFallbackIncremental`（frozen/live 分段）。
- `utils/perfProbe.uts`（`perfRecordSseUi/Parse/MathBatch/ListApply`、`perfDump`、`[SseStall]` 卡滞告警）。

**所以真正剩下的**：
1. 这些优化**已实现但未经真实管线端到端验证** —— 缺能产出性能报告的测试入口。
2. 埋点缺 **fps / 帧间隔（maxGap）** 维度。
3. 增量解析**无开关**，做不了「增量 vs 全量」消融对比。
4. **列表层**卡顿（长历史场景主因）这轮 markdown 优化**没覆盖**。

**两条硬要求**：
- ① **用专门的 Mock 数据**，保证测纯渲染、**排除接口/网络回包抖动**。
- ② **复用真实会话详情页面**做报告（`agent-detail` → `chat-conversation-component` → `ai-msg.uvue`），不另起平行测试页复刻渲染。

约束：① 自定义基座测（调试标准基座偏慢不可下结论）；② 覆盖 4 场景（冷启动进会话 / 长历史滚动 / 流式输出 / 流式+滚动）；③ 范围 **测+定位+直接修**；④ **不考虑 vapor**。

> 架构澄清：`chat-conversation-component.uvue:519 import UniAiXMsg from "@/subpackages/components/ai-msg/ai-msg.uvue"` —— 模板里 `<UniAiXMsg>` 就是 `ai-msg.uvue`（解析器组件）。生产入口 `subpackages/pages/agent-detail/agent-detail.uvue`（82 行壳）。

---

## Phase 0 — 基座 / SDK 自检（已完成）

核实结果（2026-08-07）：
- 基座 `unpackage/debug/android_debug.apk`（`pnpm base:fetch`）：`hxVersion=5.15`、`channel=debug`、`gitSha=b24ad90e`(07-30)、243MB。
- 项目 `manifest.json:175 "uni-app-x": {}` → **未开 vapor**，与 5.15 VDOM 基座自洽 ✅。
- ABI manifest 声明 arm64-v8a；modules 最小（Record/Camera/Gallery/File）；gradle 调优过；LeakCanary→`debugImplementation`；R8 默认关（`NUWAX_ENABLE_R8=0`）。

**体积/清洁度不合理项**（fetch 的是 stock debug 基座，绕过本地 `scripts/android-esp/` 瘦身）：
- **5 个 ABI 全在**：arm64-v8a 57MB / x86 44MB / armeabi-v7a 38MB / x86_64 38MB / armeabi 7MB → 非 arm64 **~127MB 死重量**。
- 应排除模块**仍在**：阿里人脸 `libAPSE_7.0.1.so`(3.6M)+`libfacedevice.so`(3.7M)+`libaliyunaf.so`、直播推流 `libpldroid_streaming_*`、画布 `libgcanvas.so`(1.5M)。
- `helloUniAppX` demo 源**已不在** APK ✅；`uni-stat` 在本地构建剔除清单 `SAMPLE_MODULES`（`configure_app.py:66-80`）。
- 瘦身逻辑脚本里都有（arm64-only `:313`、AAR 排除、`strip_project_deps:856`、`strip_optional_remote_deps:858`）——**仅本地 `make base-android`/`make android-tester` 生效**。

**关键判断**：体积/清洁度问题**不影响 arm64 运行时帧率测量**（其它 ABI so 不加载），**相对前后对比可用此 fetch 基座**。注意：
1. debug 基座（debuggable + 无 R8 + LeakCanary）→ 仅适合相对对比；**最终数字须 release tester 包**（`make android-tester`）。
2. **必须 arm64 真机/arm64 模拟器**（x86 模拟器走翻译，不可信）。
3. 干净/接近线上的基座：本地 `make android-tester`（memory 记脚本就绪、待端到端跑通）。

---

## Phase 1 — Mock 数据层 + 性能测试入口（复用真实会话页）

### 1.1 Mock 数据模块（新建，仿 `servers/vox/mockVoxData.uts`）
新建 `subpackages/pages/chat-conversation-component/layers/mockStreamPerf.uts`：
- `isStreamPerfMockEnabled(): boolean` —— 读 storage（默认 false）。
- `buildMockMessageList(history, mdType): MessageInfo[]` —— 预置 H 条含目标 mdType 的历史。
- `startMockStream(params, chunkCb, doneCb, mdType, streamLen, intervalMs)` —— `setInterval` 喂 **JSON 字符串** chunk（走真实 `chunkCb` 内的 `JSON.parse`，无需手搓 UTSJSONObject）。事件 schema：`{eventType:"MESSAGE", data:{text:增量, type, id, finished}}`（对齐 `AgentDetailService.uts:1420-1445`/`:1516-1936`）。
- mdType 样例：纯文本 / 表格 / 公式（`$$`/`\[/\(`）/ 代码（` ``` `）/ 混合。

### 1.2 Service 最小门控分支（真实页零改动）
- `AgentDetailService.handleSendMessage`（`:2195 await chatService.sendMessage(...)`）：`if (isStreamPerfMockEnabled()) { await startMockStream(...) } else { await chatService.sendMessage(...) }`，复用既有 `chunkCb`/`doneCb`。
- 历史 seed：Mock 模式下会话初始化处 `data.messageList.value = buildMockMessageList(H, mdType)`。
- `chat-conversation-component.uvue` `onLoad`（`:3208`）读可选 `perfTest/mdType/history/streamLen` 透传 Service。

### 1.3 极薄启动页 + 真实路由
- 新建 `pages/test-stream-perf/test-stream-perf.uvue`：仅控制面板（mdType/H/L/chunk 间隔 +「开始」）→ 写 storage → `uni.navigateTo` 到真实 `/subpackages/pages/agent-detail/agent-detail?id=perf&conversationId=0&perfTest=1&mdType=...&history=...&streamLen=...`。
- `pages.json` 注册该页。

### 1.4 帧率/帧间隔探针
- `perfProbe` 现无 fps/maxGap。补 `setInterval(tick, 16)` 记 `Date.now()` delta → `avgFps≈1000/avgDelta`、`maxGap=max(delta)`。perfTest 模式挂浮层进真实页，显示 avgFps/maxGap + `perfDump()`，同时打 logcat。

### 1.5 编译验证
- `pnpm hx:android:compile`（HX CLI `--compile true`）0 UTS 错误；CSS 报错只看是否本次引入。

---

## Phase 2 — 基线 + 边界矩阵（自定义基座，4 场景，Mock 驱动）

```bash
pnpm base:fetch                 # 拉最新自定义基座
pnpm hx:android:custom          # 自定义基座跑 Android（HX 需已启动）
pnpm hx:android:log | grep -E "PerfProbe|SseStall|perf|uts|console"
```
- **基线**：每种 mdType 在 H=0 跑流式，记 `avgFps / maxGap / 平均解析ms / 最大解析ms / 公式缓存命中率 / 输出完整Y-N`。Mock 保证可复现、无网络抖动。
- **边界矩阵**：每种 mdType 二分增大 H 与 L，直到 `avgFps<24` 或 `maxGap>100ms`，记临界 `(H,L)`。
- **4 场景**：入口页覆盖冷启动/流式/流式+滚动；真机操作长历史滚动 + load-more（`MESSAGE_LIST_SIZE=10`，`messageList` 无上界，可到 100/500+ 条）。
- 最终数字：release tester 包（`make android-tester`）复测。

---

## Phase 3 — 消融实验（证明已落地优化有效 = 定位哪段代码出问题）

- `aiMsgMarkdownParser.uts` 加 `const INCREMENTAL_FALLBACK_ENABLED=true`，`applyAppFallback` 据此在 `applyAppFallbackIncremental`/`applyAppFallbackFull` 间切。`MAX_CONCURRENT_KATEX`（2 vs 调大）、`STREAM_MD_STRUCT_INTERVAL_BASE_MS`（280 vs 0）本就是 const。
- mdType=混合 固定 H/L，跑 ① 全关（≈优化前）② 仅节流 ③ 仅并发闸 ④ 仅增量 ⑤ 全开，产出消融表。
- **验收**：增量 vs 全量渲染结果一致（`markdownElList` 序列化 `type+text` 比对，不能丢公式/丢块）。

---

## Phase 4 — 补齐列表层缺口（「直接修」，针对长历史场景）

markdown 这轮没覆盖、确属卡顿源（按风险/收益排序）：
- **【低风险·高收益】`getMessageAttachments` 预算**（`chat-conversation-component.uvue:1034-1048`）：无附件时每次 `return [] as any[]` 分配新数组，每用户 cell 调 3+N 次（`:161/:167/:174/:176`）。改读预算好的 `item.attachments` 字段。
- **【低风险】模板函数收敛**：`isLastMessage` 每 cell 调 2 次（`:131/:147`）、内联箭头 `:ref="(el)=>setMessageRef(el,...)"`（`:154`）。改命名函数 ref + `isLast` 预算进 item。
- **【低风险】收窄 deep watch**（`:2379 watch(lastMessage,{deep:true})`）：流式期 `messageList.value` 每 ~100ms 换新数组（`:730 publishStreamDraftLastOnly`），deep watch 每帧深遍历。改只 watch 标量。
- **【最高风险·最大结构收益】`scroll-view`+`v-for` → `list-view`+`list-item`**（`:97-:126`）：仅当矩阵显示长历史仍卡、上面三项修完仍不达标时再做。**必须自定义基座真机验证后再合**。

---

## 涉及文件
- 新建 `subpackages/pages/chat-conversation-component/layers/mockStreamPerf.uts` —— Phase 1 Mock 数据。
- 新建 `pages/test-stream-perf/test-stream-perf.uvue` —— Phase 1 极薄启动页。
- `utils/perfProbe.uts` —— Phase 1 视情况补 fps/maxGap。
- `subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts`（`handleSendMessage:2195` 加 Mock 分支；历史 seed）+ `chat-conversation-component.uvue`（`onLoad:3208` 读 perfTest）—— Phase 1 接线。
- `subpackages/components/ai-msg/aiMsgMarkdownParser.uts` —— Phase 3 加 `INCREMENTAL_FALLBACK_ENABLED`。
- `chat-conversation-component.uvue` + `layers/AgentDetailService.uts`（`parseMessageList` 预算）—— Phase 4。
- **不改**：`ai-msg.uvue`/`appMarkdownFallback.uts` 核心优化逻辑（已落地，仅 Phase 3 临时改 const 做消融，测完还原）。

## 验证（端到端）
1. 编译：`pnpm hx:android:compile` 0 UTS 错误。
2. 基座：`pnpm base:fetch` → HX「使用自定义基座运行」。
3. Mock 隔离校验：perfTest 模式断网仍能跑完整流式报告。
4. Phase 2 产出：基线表 + 边界矩阵（达标 avgFps≥24、maxGap<100ms）。
5. Phase 3 产出：消融对比表 + 增量/全量渲染 diff 一致。
6. Phase 4 回归冒烟：发消息/收流式、长按复制、附件预览、工具卡片、表格/公式、上滑翻历史 + 加载更多、流式期滚底/上滑打断。每批单独验证。

## 备注
- 不涉及 vapor；在 `feat/nuwa-zhuoda-2026.07-perf-vdom` 上做。
- Phase 1 Mock 开关/启动页/帧探针、Phase 3 消融开关与 const 改值均为开发期产物，**正式包前默认关闭/移除**（storage key + 编译开关门控，仿 `isVoxMockEnabled` 硬编码 false）。
