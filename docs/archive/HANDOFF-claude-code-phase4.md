# 交接任务:Android 会话详情页卡顿修复 —— 承接已有 perf 计划,补齐 Phase 4 列表层

> 本任务由主线 agent(CC) 交付给 Claude Code 实现,CC 负责验收。
> 分支:`feat/nuwa-zhuoda-2026.07-perf-vdom`(已在当前分支)。

---

## 0. 背景与现状(务必先读,避免重复劳动)

线上反馈:**Android 会话流式输出卡死、loading 动画冻结、有公式就卡死**。

**重要:markdown 层的优化早已实现并提交,不要重做**。已有且已落地:
- `ai-msg.uvue:386-543` 结构化/纯文本两路 `scheduleMergedParse` 合并窗
- `appMarkdownFallback.uts` KaTeX 并发闸(`MAX_CONCURRENT_KATEX=2`)、MathBatchUiRunner
- `aiMsgMarkdownParser.uts:415` 增量分段 `applyAppFallbackIncremental`(`INCREMENTAL_FALLBACK_ENABLED=true`)
- `utils/perfProbe.uts` 埋点(`perfRecordSseUi/Parse/MathBatch`、`[SseStall]` 告警)
- Mock 数据层 `layers/mockStreamPerf.uts` + 帧探针 + 启动页 `pages/test-stream-perf/`(Phase 1)

**真正缺的是以下两块,这才是本任务的交付范围**:
- [ ] **Phase 2**:真机跑基线 + 边界矩阵(需自定义基座/真机,CC 侧环境可能无法跑,推到验收阶段)
- [x] **Phase 4**:列表层修复(**可静态实现 + 编译验证,本任务主体**)

进度文档:`docs/perf-conversation-stream-render.md`(已核实,Phase 0-3 完成)。

**本次只交付 Phase 4 的代码实现**,不开 Phase 2(那需要真机环境,另安排)。

---

## 1. 任务范围(Phase 4 列表层修复)

目标文件:`subpackages/pages/chat-conversation-component/chat-conversation-component.uvue`(3563 行大文件)

### 任务 A:消除 `getMessageAttachments` 每 cell 多次分配新数组(低风险·高收益)

**现状**:`chat-conversation-component.uvue:1039` 每次调用都 `return [] as any[]`(无附件时)或 `raw as any[]`(有附件时)。模板里每 cell 调约 4 次(引用于 `:165` `hasMessageAttachments`、`:178` v-for、`:180` onPreview、`:1099`)。

**改法**:把附件列表结果**预算进 item 字段**(`item.attachments`),模板直接读预算值,不再反复调用函数分配。
- 在 `parseMessageList`(刷新消息列表)处,对每条 message 预算一次 `attachments`;无附件时写入一个**共享空数组常量**(不新建),避免每 cell `[]` 分配。
- 模板 `:165/:178/:180` 改为读预算字段。
- **必须保留**:Android 上元素是 `UTSJSONObject`,禁止 `as AttachmentFile[]`;附件对象不可变引用。

### 任务 B:模板函数收敛(低风险)

**现状**:
- `isLastMessage(listIndex)` 每 cell 调 2 次(`:135` class、`:151/:153`),每次 `messageList[listIndex]` 查找。
- `:ref="(el: any) => setMessageRef(el, ...)"` 是内联箭头函数(每次渲染新建,且 VDOM diff 阶段损耗)。

**改法**:
- `isLastMessage` 结果预算进 item(`item.isLast`),模板直接读。
- 内联箭头 ref 改命名函数:`setMessageRef(el, `${item.id}_${item.index}`)`(需确认 UTS 支持模板字符串作第二参,原代码已这么写)。

### 任务 C:收窄 deep watch(低风险)

**现状**:`:2379 watch(lastMessage, handleScrollToLastMsgFromListWatch, { deep: true })`。流式期 `messageList.value` 每 ~100ms 换新数组,deep watch 每帧深遍历嵌套字段。

**改法**:只 watch 标量(如 `messageList.value.length` + last message 的 id/text 长度变化),去掉 `deep: true`,改为浅比较。下方已有"仅监听条数变化"的 watch,注意与其合并避免重复触发滚动。

### 任务 D(仅当 A/B/C 做完仍不达标,且需真机确认后才动):`scroll-view`+`v-for` → `list-view`+`list-item`

**最高风险·最大结构收益**。当前 `:97-126` 是 `scroll-view` + `v-for` 全量渲染所有 message。长历史(100/500+ 条)时滚动区全是活节点。
**本次默认只做 A/B/C,不做 D**——除非验收发现长历史仍卡,再单独开 D 并必须真机验证。D 涉及滚动位置/上滑打断逻辑,风险高,不放进本次默认范围。

---

## 2. 硬约束(违反=验收不过)

1. **不改 `ai-msg.uvue` / `appMarkdownFallback.uts` 的核心 markdown 优化逻辑**(已落地,别动)。
2. **不引入 vapor**(`manifest.json` 未开)。
3. 编译必须过:`pnpm hx:android:compile` → **0 UTS 错误**。
4. Android UTS 兼容:`readRawField` 读字段,禁止 `as UTSJSONObject` 断言(注释已多次强调 Android Record=Map)。
5. **不改变渲染结果**:附件、公式、表格、工具卡片、加载更多、流式滚底/上滑打断行为与现状逐字一致;只是消除多余计算与分配。
6. 不删/不改已有埋点 `perfRecordSseUi` 等。
7. 改动只落在 `chat-conversation-component.uvue` 及必要的小文件,不扩到无关页面。

---

## 3. 验收标准(CC 验收)

- [ ] `pnpm hx:android:compile` 编译 0 UTS 错误,CSS 无本次引入的新报错。
- [ ] A:模板内 `getMessageAttachments` 函数调用次数从每 cell ~4 次降至 ≤1 次(或预算后为 0 次函数调用),无附件 cell 不再每次新建数组。
- [ ] B:`isLastMessage` 每 cell 不再重复查表;`setMessageRef` ref 用命名函数。
- [ ] C:`lastMessage` deep watch 已移除或改为浅/标量,流式期不再每帧深遍历。
- [ ] 渲染回归冒烟(静态评审):发消息/收流式、上滑翻历史+加载更多、流式期滚底/上滑打断、附件预览、表格/公式、工具卡片——行为与改动前一致。
- [ ] 代码 diff 范围收敛到约定文件。

---

## 4. 涉及文件(预期)

- 主:`subpackages/pages/chat-conversation-component/chat-conversation-component.uvue`
- 视需要:`layers/AgentDetailService.uts` 或 `utils/messageInfoClass.uts`(若 A 需在 parseMessageList 预算;不得大改)

---

## 5. 交付方式

Claude Code 在 `nuwax-mobile_diff` 工作区直接改代码并跑编译,完成后汇报改动清单。CC 负责按第 3 节验收。
