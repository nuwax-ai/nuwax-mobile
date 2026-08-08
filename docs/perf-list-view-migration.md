# 会话消息列表 scroll-view → list-view 迁移 + mermaid 临时关闭 + 运行时 A/B 切换

> 分支：`feat/nuwa-zhuoda-2026.07-rich-text-math`（基于 `feat/nuwa-zhuoda-2026.07-perf-vdom` 线）
> 日期：2026-08-08
> 计划源：`~/.claude/plans/proxy-web-mermaid-idempotent-glacier.md`
> 关联：`perf-conversation-stream-render.md` Phase 4c（长历史列表层 / view 回收）的落地；`perf-mermaid-render-fix.md`；`handoff-chat-webview-leak-deadlock.md`
> **状态：5 阶段代码已全部写完，尚未 HBuilderX / 自定义基座真机编译验证。**

---

## TL;DR

- **目标**：会话页长历史滚动卡顿（基线 `perf-verification-plan.md`：H=100 mixed 滚动 fps 均值 10 / maxGap 760ms；单聊 +~2400 View / +400~585M PSS）。结构性杠杆是 list-view 回收（View 数 2200→~200）。
- **历史教训（已核实）**：此迁移**做过并回滚**——`2db9d6d2`(纯模板一把梭)→`bd1dfa12`(同日回滚)。回滚根因（`handoff-chat-webview-leak-deadlock.md:18` 原文）：「list-view 回收模式与 mermaid/表格渲染冲突（**mermaid 靠 proxy WebView，回收即崩**；表格高度量不准），只能 scroll-view 全量渲染」。**点名崩溃源是 mermaid，不是 KaTeX 公式，也不是流式管线。**
- **本方案切入点**：mermaid→代码显示 = 直接拔掉头号崩溃点；公式保持 KaTeX（内存缓存，回收时同步命中，本就回收安全）；流式管线因「打补丁对象永远是末条可见气泡」大概率扛得住回收，加轻量防御即可。
- **用户决策**：① mermaid 临时关闭（可翻开关恢复）；② **运行时切换两套模板做 A/B 性能对比**（而非一次性切死 list-view）；③ 表格保留原生、先测。
- **结论**：代码层 5 阶段全部落地。能否上线取决于真机验证（见「待真机验证」）。

---

## Phase 0 — mermaid 临时关闭（拔掉回收崩溃点）

mermaid 不再走 proxy-web 截图，当代码块显示 → 消除「异步截图绑到会被回收的 `<image>` 节点 → 回收即崩」。临时关闭、可恢复。

| 文件 | 改动 |
|---|---|
| `uni_modules/uni-ai-x/sdk/math-render.uts` | 新增开关 `export const MERMAID_RENDER_ENABLED = false`（默认关；翻 `true` 恢复出图） |
| `subpackages/components/ai-msg/appMarkdownFallback.uts` | 引入开关；mermaid 代码围栏分支仅在 `MERMAID_RENDER_ENABLED` 时调 `renderMermaidToken`（原 `:2828`） |
| `uni_modules/uni-ai-x/sdk/parseMarkdown.uts` | 引入开关；`parseMermaid` 顶部 `if (!MERMAID_RENDER_ENABLED) { callBack(); return }`（cmark 路径，App 少走但一并关） |
| `uni_modules/uni-ai-x/components/uni-ai-msg-code/uni-ai-msg-code.uvue` | 引入开关 + 本地别名 `mermaidRenderEnabled`；图表/代码 tab 与图片盒 gate 在开关后；默认显代码 tab |

**未删**：`proxy-web.html` 的 `renderMermaid` 逻辑、`renderMermaidToken` / `mermaidCache` 等全部保留，开关翻 `true` 即恢复原出图链路。

---

## Phase 1 — scroll-view ↔ list-view 运行时切换（A/B 对比）

`chat-conversation-component.uvue` 内 `useListView` 开关，`v-if`/`v-else` 两套模板分支。

- **list-view 分支**：`<list-view v-if="useListView" ...>`，消息项 `<list-item v-for :type="1" :key>` 包单个 `<view class="msg-list-item">` shell；非消息项各给独立 `:type`（90 loading-more / 91 new-conversation-set / 92 suggestions / 93 task-loading / 94 empty-state / 95 last-msg 锚点）。参考 `pages/index/home-content/home-content.uvue` 模式。
- **scroll-view 分支**：`<scroll-view v-else ...>`，原全量渲染结构（无 list-item 包裹）。两分支内容保持同步，仅 list-item 包裹差异（模板内有 `↓↓↓/↑↑↑` 注释标注，改动任一须同步另一）。
- **正式会话**恒走 list-view（`useListView` 默认 `true`，**不读 storage** → 测试残留不污染正常会话）。

**两个切换入口**（核心：A/B 同机同数据）：

1. `pages/test-stream-perf/test-stream-perf.uvue` 配置页新增「列表模式」chip（list-view / scroll-view）—— 选好 H/L/mode 后点「开始测试」以该模式进入会话页。
2. 会话页 perf 浮层新增可点文字 `{{ useListView ? 'list-view' : 'scroll-view' }} ·点击切换` —— **同一次会话内实时切**，无需回配置页，最适合滚动 fps 对比。

**配置层** `subpackages/pages/chat-conversation-component/layers/mockStreamPerf.uts`：
- 新增 storage key `PERF_STREAM_MOCK_USE_LISTVIEW` + 默认值 `PERF_MOCK_DEFAULT_USE_LISTVIEW = true`。
- `applyStreamPerfConfig(...)` 加第 6 参 `useListView`；新增 `setPerfUseListView(b)`（浮层实时切写 storage）。
- `StreamPerfConfig.useListView` 字段 + `getStreamPerfConfig()` 读取。
- 组件 `onLoad` perf 分支：`useListView.value = getStreamPerfConfig().useListView`（仅 perf 模式读，避免污染正式会话）。

---

## Phase 2 — 流式 / 回收防御

核心矛盾：`ComponentManager.uts` 按 messageId 注册 `:ref`（`chat-conversation-component.uvue` 的 `:ref="(el) => setMessageRef(el, ${id}_${index})"`）。list-view 回收 rebind 时该回调**不保证随 rebind 重触发** → `messageRefs` 残留过期引用 → `updateMessageComponent`（`ComponentManager.uts:66`）可能把流式 patch 打到已被回收复用给别的消息的实例。

**解法（自校验，无需改 ComponentManager）**：`ai-msg.uvue` 的 `updateMessage(newData)` 开头自校验——读 patch 的 `id`（`messageToJsonObject` 已带 `id`/`index`），与组件自身 `msg.value._id` 不符 → 说明是陈旧 ref 打到错位实例，**直接 return 跳过**。
- 安全性：数据源 `messageList`（`publishStreamDraftLastOnly` 只换末槽）+ `streamingAssistantText` prop 已权威更新，跳过 in-place patch 不丢内容；末条可见气泡不被回收，正常流式照常命中。
- ComponentManager 既有 `$callMethod` 失败回退 `triggerMessageListRefresh()` 不变。

---

## Phase 3 — ScrollManager

核实 uni-app x `<list-view>` 官方文档（`doc.dcloud.net.cn/uni-app-x/component/list-view.html`）：
- ✅ 支持 `upper-threshold` / `@scrolltoupper`（滚到顶加载更多历史**可用**）。
- ✅ 支持 `scroll-into-view` / `scroll-top` / `scroll-with-animation` / `@scroll`。
- ❌ **无** ref 方法（无 `scrollToItem` / `scrollTo`），编程式滚动只能走 prop。
- ⚠️ 官方明示：受回收影响，`scroll-into-view` 对「非渲染区 / 屏外」元素定位不准（蒸汽模式屏外 list-item element 不存在）。

**结论**：ScrollManager 全为 prop/event 驱动（`scroll-into-view` / `@scroll` / `upper-threshold`），两模式通用，**无需改逻辑**。唯一已知限制 `ScrollManager.scrollToMessage`（加载更多历史后保位）在 list-view 下因屏外 `scroll-into-view` 不准可能降级——**无 API 可修**，属已知限制（已在代码注释，当年 `2db9d6d2` 提交信息亦自承「历史定位可能降级」）。待真机观察实际表现再决定是否补偿。

> 滚底（`doScrollToLastMsg` 设 `scrollIntoView="last-msg"`，末条锚点屏内）与流式跟底不受此限制影响。

---

## Phase 4 — 回收 rebind 状态重置

`ai-msg.uvue` 的 `messageId` watcher（rebind 点：组件被回收复用给另一条消息时触发）在 id 变化时调 `clearStreamMdParseTimer()`（清旧消息挂起的 markdown 解析定时器 + `streamMdParsePending`），避免旧延迟解析（`runMarkdownParse`）跑到新消息上造成串内容 / 错乱。随后照旧重建 `MsgItem`、由其余 watcher（messageStatus/processingList/bodyText…）回填。

---

## A/B 性能对比怎么测

> **必须自定义基座真机**——标准调试基座会误判性能 / 泄漏（见 `handoff-chat-webview-leak-deadlock.md:102-106`）。CLI 编译避开用户正在调试的 HBuilderX（缓存竞争，见 memory）。

1. HBuilderX「使用自定义基座运行」到真机。
2. 进 `test-stream-perf`：选 mdType=mixed、预置历史 H=100、流式字符 L、**列表模式**（list-view / scroll-view）→ 开始测试。
3. 会话页滚动历史，看 perf 浮层 fps/maxGap（每 500ms 刷新）+ logcat `[PerfProbe]`。
4. 点浮层「列表模式 ·点击切换」实时切到另一模式，再滚一次 → 同机同数据对比。
5. 对照 `perf-verification-plan.md` 基线（H=100 mixed：fps 10 / maxGap 760ms）。

---

## 待真机验证

1. **回收不崩**：含 mermaid 的会话反复快速滚 → 不崩（对比当年「回收即崩」）。
2. **长历史滚动 fps**：H=100 mixed，list-view vs scroll-view，目标 fps 10→~30、maxGap 显著降。
3. **流式跟底**：发新消息流式时贴底跟得好、上滑打断即停（`autoToLastMsg`）、滚回底恢复跟。
4. **历史定位**：滚到顶 `@scrolltoupper` 加载更多 → 观察是否跳位（`scrollToMessage` 已知可能降级）。
5. **回收回滚正确性**：含公式/表格的历史消息滚出屏再滚回 → 内容/公式图/表格正确重渲（无残留旧消息内容 / 旧图）。
6. **list-view `@scroll` 的 scrollHeight 精度**：`applyScrollBottomState` 用 `scrollHeight - scrollTop - offsetHeight` 判 `isInBottom`；回收下若 scrollHeight 只计已渲染项会误判 → 影响跟底判定，需真机确认。
7. **内存**：返回聊天页后 View/PSS 回落（本方案不解决离线基座框架泄漏，那是独立线）。

---

## 不在范围（明确）

- **离线基座 WebView/Activity 框架泄漏**（DCloud SDK bug，`handoff-chat-webview-leak-deadlock.md`）—— 云打包 workaround，与 list-view 独立。
- **MathJax-SVG 的「native `<image>` 是否解码 SVG」命门**（`rich-text-math-acceptance.md`）—— 与 list-view 独立；且 MathJax-SVG 仍走 proxy-web，非 list-view 必需项。
- **公式**：保持 KaTeX 现状（内存缓存回收安全），不动。
- **图片预览**：`关闭 uni.previewImage` 与回收正交（真正影响回收的是原地 `mode="widthFix"` 异步高度），不动。
- **表格**：保留原生（`uni-ai-msg-table`，无 web-view），先测；若回收下高度抖动严重再降级。

---

## 改动文件清单

| 文件 | 阶段 | 改动 |
|---|---|---|
| `uni_modules/uni-ai-x/sdk/math-render.uts` | P0 | 新增 `MERMAID_RENDER_ENABLED` 开关 |
| `subpackages/components/ai-msg/appMarkdownFallback.uts` | P0 | gate `renderMermaidToken` + 引入开关 |
| `uni_modules/uni-ai-x/sdk/parseMarkdown.uts` | P0 | gate `parseMermaid` + 引入开关 |
| `uni_modules/uni-ai-x/components/uni-ai-msg-code/uni-ai-msg-code.uvue` | P0 | gate 图表 tab / 默认代码 + 引入开关 |
| `subpackages/pages/chat-conversation-component/chat-conversation-component.uvue` | P1 | list-view/scroll-view 双模板 + `useListView` + 浮层切换 chip + CSS + perf 读配置 |
| `subpackages/pages/chat-conversation-component/layers/mockStreamPerf.uts` | P1 | `useListView` 配置（key/默认/apply/setter/getter） |
| `pages/test-stream-perf/test-stream-perf.uvue` | P1 | 「列表模式」chip + 传参 `applyStreamPerfConfig` |
| `subpackages/components/ai-msg/ai-msg.uvue` | P2/P4 | `updateMessage` 自校验 id；`messageId` watcher rebind 清解析定时器 |
| `subpackages/pages/chat-conversation-component/layers/ScrollManager.uts` | P3 | `scrollToMessage` 注释 list-view 已知限制（逻辑不动） |

回滚安全网：当年 `2db9d6d2` 的 56 行模板 diff 在 git 历史；本次为双模板运行时切换，压测不过可点浮层切回 scroll-view（正式会话默认值改 `useListView = false` 即全局回退），零编译回滚成本。
