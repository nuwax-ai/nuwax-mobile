# ask-question 干预卡片 Android 渲染修复 · 团队简述

## 背景
ask-question（结构化提问）和 ACP（权限审批）卡片在 **iOS / H5 正常，唯独 Android 不渲染**：表单控件、审批选项空白，部分路径直接 CCE 崩溃；历史会话不弹出提问、流式提问也不弹。排查后确认根因都是 **Android(Kotlin) uvue 与 iOS/H5 的运行时差异**，与业务逻辑无关。

相关提交（`feat/nuwa-zhuoda-2026.07`）：
- `ce2ae7bd` fix(intervention): 修复 Android 上 ask-question/ACP 卡片控件不渲染（主提交，8 文件）
- `71d5b144` fix(mcp-ask-question-card): 调整按钮宽度以适应长文案
- `6efcd8ce` fix(mcp-ask-question-card): 表单区封顶高度并支持滚动

## 根因（Android uvue 特性，记一下避免重踩）
1. **class 实例不能 `as UTSJSONObject` / 不能被 `readRawField` 读** — iOS/H5 能，Android 直接 CCE 或读空。
2. **联合类型/对象上的 `===` 是引用比较** — 和字面量永不相等；纯 `string` 的 `===` 才是值比较。
3. **原生 `<input>` 无默认高度** — 缺 `height` 塌成 0（iOS/H5 会给）。
4. **`<scroll-view>` 渲染 v-for 子项需确定高度** — `flex:1`/`max-height` 不稳。
5. **访问 class 上未初始化的非空属性会 NPE**。

## 改动清单（按模块）

### ① 数据抽取 / 历史 hydrate — `utils/mcpAskSchema.uts`、`subpackages/utils/interventionAdapter.uts`
- `extractMcpAskStructuredInputFromResult` 支持 `result.data` 为 **JSON 字符串 / 对象 / 数组** 三种形态（历史 ASK_QUESTION 常以字符串塞 `result.data`，原来只认数组 → 历史不重建 → 不弹卡）。
- `getJsonSchemaPrimaryType` 加 null guard（字段无 JsonSchema `type` 时 `as any` NPE）。

### ② 渲染规则 / 队列 — `subpackages/pages/chat-conversation-component/utils/mcpAskInterventionState.uts`
- ask 卡片**只展示最后一条消息上的提问**（位置即状态：未答=最后一条→展示，作答后 resume 成新最后一条→自动消失）。"最后一条"按**数组追加序**而非 `index`（修流式消息 `index` 为 null 时匹配不到、dock 不弹）。
- `asReadableMcp` 把 `ui.steps` 转成 raw UTSJSONObject（class 实例读不到 `fields`，导致 wizard `visibleFields` 恒空、步骤描述丢）。

### ③ class → UTSJSONObject 转换 — `subpackages/utils/interventionAdapter.uts`
- `normalizeAcpPermissionInteraction` 重写：先建 `out`、`request`/`options` 先抄、**逐字段 try**、始终返回 `out`（某个未初始化属性 NPE 不再连累整段 → ACP 选项读得出）。

### ④ ask 卡片 — `components/agent-intervention/mcp-ask-question-card/mcp-ask-question-card.uvue`
- 控件分发 `field.widget === 'x'` → `==`（**这是"控件全不渲染"的主因**）。
- `.field-input` 补 `height: 80rpx`。
- `.card-form` 去 `flex:1`；`.card-form-scroll` 用 `<scroll-view>` + `max-height`（封顶滚动）。
- `.action-button` `flex: 1 1 0` → `1 1 auto`（长文案「提交并生成」不再被挤换行）。
- `readUtsField` 等 null-cast 修复、下游入参放宽 `any | null`。

### ⑤ intervention-card 包装 — `components/agent-intervention/intervention-card/intervention-card.uvue`
- props 去掉 class 类型声明（`Object as () => ClassType` 在 Android CCE：`cannot be cast to Function0`）→ plain `Object`；`resolved*` 返回 `any | null`。

### ⑥ ACP 卡 — `components/agent-intervention/acp-permission-card/acp-permission-card.uvue`
- `visibleOptions` 的 `Set.has` / `===` → `==`。

### ⑦ test 演示页 — `pages/test-intervention/test-intervention.uvue`
- 加 `scroll-view`；mock 经 `readableMcp`/`readableAcp` 转 UTSJSONObject 再传卡片（否则 class 进卡片即 CCE）。路由 `/pages/test-intervention/test-intervention`，覆盖全部控件。

### ⑧ chat 组件 — `subpackages/pages/chat-conversation-component/chat-conversation-component.uvue`
- `activeInterventionQueue` 由 computed 改 **ref + watch**（避免流式 40ms flush 触发 `getActiveInterventionQueue` 全表重跑、卡片出现后整体假死）。

## 测试要点
- **历史**：重开「最后一条是 ask-question」的会话 → 卡片弹出、表单可填可提交；作答后卡片自动消失；更早的提问不再重弹。
- **流式**：会话中触发 ask → dock 当场弹出（不用重进）。
- **Android 控件**：text / textarea / number / radio / select / checkboxes / file 全部渲染、可交互；wizard 步骤条 + 描述 + 分步字段正常。
- **ACP**：选项（允许/拒绝）+ 取消/确认按钮渲染、可审批。
- **性能**：ask 卡片出现后不卡顿。
- iOS / H5 回归无变化。

## ⚠️ 踩坑提醒
- **别点 HBuilderX 报错里的 `[AI修复]`**：它会自动改卡片文件（删诊断、塞带 NPE 的 helper），反复把修好的东西改坏，是这次反复"没有变化"的一大元凶。报错晾着，手动改。
- 新增/改干预卡片或 class↔UTSJSONObject 转换时，按上面 5 条 Android 特性自查；诊断用 on-card DBG（parsed/visible 等）比看代码快。
