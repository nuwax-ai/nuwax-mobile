# 轮询与发消息竞态：过期快照丢弃（PC → Mobile 追齐）

> 供 **nuwax-mobile** agent 追齐对照。  
> PC 已落地（最小侵入）：仅改 `useConversationStreamResume` + 单测 + 关键日志。  
> **不要**再走已被取消的大改方案（发消息同步 bump 回调、`ensureResumeAssistantPlaceholder` 整表合并加固）。

---

## 1. 现象（PC）

智能体会话（非 AppDev）出现：

1. Network 里 `POST .../chat` 变成 `(canceled)`
2. 刚发出的用户消息 / 乐观助手气泡被冲掉或状态错乱
3. 临界窗口：**5s 状态轮询已发出、回包尚未回来时，用户立刻发下一条消息**

根因不是「轮询直接 abort 了 live `/chat`」，而是：

- in-flight 轮询的 `onSuccess` **缺少代际丢弃**
- 过期快照仍可能写回 / 误触发 `subscribe(sub)` 恢复
- 陈旧 `messageList` 整表覆盖乐观尾巴后，后续再次发送会走 `handleClearSideEffect` → 表现为 `chat (canceled)`

---

## 2. 竞态时序（PC）

```text
Poll(5s) 发出 fetchConversationSnapshot
    │
User 发消息 → isLocallyStreaming=true → 乐观 append → POST /chat
    │
Poll onSuccess 回来（仍是发送前快照）
    │  旧实现：无 generation；latestRef.isLocallyStreaming 可能仍 false（一帧滞后）
    ├─ onConversationSnapshot(stale)
    ├─ 可能 onTerminalTaskStatus
    └─ EXECUTING 时 subscribe(stale messageList)
         → ensureResumeAssistantPlaceholder 用 stale list 整表替换
         → 乐观尾巴被冲掉；live chat 变「幽灵连接」
    │
用户再发 / 重试 → handleClearSideEffect abort 上一轮 chat → Network 显示 canceled
```

要点：

| 机制 | 能否挡住 in-flight 回包 |
|------|-------------------------|
| `ready: !isLocallyStreaming` | ❌ 只停后续轮询 |
| `useRequest.cancel()` | ⚠️ 可停定时器；**已发出的 Promise 仍可能 onSuccess** |
| generation + onSuccess 整段 return | ✅ 本修复核心 |

---

## 3. PC 已落地修复（对照实现）

### 3.1 改动范围（最小侵入）

| 文件 | 改动 |
|------|------|
| `src/components/business-component/UnifiedChatSession/hooks/useConversationStreamResume.ts` | poll generation + 本地流式时 cancel + onSuccess/visibility 整段丢弃 + 日志 |
| `tests/useConversationStreamResume.test.ts` | 竞态单测：发送后旧回包不得写 snapshot/终态；断言两条关键日志 |
| `src/utils/logger.ts` | 已有 `conversationPollLogger`（无需新增） |

**未改（刻意取消）：**

- `UnifiedChatSession` 发送路径同步 bump
- `useResumeStreamHandlers.ensureResumeAssistantPlaceholder` 乐观合并
- 5s 间隔、`/chat` 协议、「立即发送」语义

### 3.2 核心算法（可直接移植思路）

```text
pollGenerationRef      // 当前代际
requestGenerationRef   // 本次请求发出时捕获的代际

当 isLocallyStreaming: false → true：
  pollGenerationRef++

发起轮询时：
  requestGenerationRef = pollGenerationRef

onSuccess / visibility then：
  if requestGeneration !== pollGeneration
     || latestRef.isLocallyStreaming
     → 整段 return（禁止 snapshot / 终态 / subscribe）

isLocallyStreaming === true 时：
  立即 cancel() 停后续轮询（effect）
```

### 3.3 PC 关键代码锚点

文件：`nuwax/src/components/business-component/UnifiedChatSession/hooks/useConversationStreamResume.ts`

1. **代际递增**（render 体，`isLocallyStreaming` false→true）

```ts
const pollGenerationRef = useRef(0);
const requestGenerationRef = useRef(0);
const prevLocallyStreamingForPollRef = useRef(!!isLocallyStreaming);
if (isLocallyStreaming && !prevLocallyStreamingForPollRef.current) {
  pollGenerationRef.current += 1;
}
prevLocallyStreamingForPollRef.current = !!isLocallyStreaming;
```

2. **发请求时打戳**

```ts
() => {
  requestGenerationRef.current = pollGenerationRef.current;
  return conversationId
    ? fetchConversationSnapshot(conversationId)
    : Promise.resolve(undefined);
}
```

3. **onSuccess 整段丢弃**

```ts
if (
  requestGenerationRef.current !== pollGenerationRef.current ||
  latestRef.current.isLocallyStreaming
) {
  conversationPollLogger.info('discard stale snapshot', { ... });
  return;
}
```

4. **发送时立即 cancel**

```ts
useEffect(() => {
  if (isLocallyStreaming) {
    conversationPollLogger.info('cancel polling: local send started', { ... });
    cancel();
  }
}, [isLocallyStreaming, cancel, conversationId]);
```

5. **visibility 回调同样丢弃**（捕获 `requestGeneration` 闭包，then 里比对）

日志关键字（开发环境，`[ConversationStreamResume][Poll]`）：

- `cancel polling: local send started`
- `discard stale snapshot`
- `discard stale visibility snapshot`

### 3.4 单测契约

`nuwax/tests/useConversationStreamResume.test.ts`：

```text
用例名：轮询在途时开始发送会取消轮询并丢弃旧回包

1. renderHook isLocallyStreaming=false
2. rerender streaming=true
3. 手动触发旧 onSuccess(stale snapshot)
4. 断言：
   - cancelPolling 被调用
   - onConversationSnapshot 未调用
   - onTerminalTaskStatus 未调用
   - 日志含 cancel polling / discard stale snapshot
```

---

## 4. Mobile 对应位置（追齐入口）

PC hook ≠ Mobile 同名文件。Mobile 对等实现是：

| PC | Mobile |
|----|--------|
| `useConversationStreamResume.ts` | `subpackages/hooks/useConversationStatusPolling.uts` |
| `isLocallyStreaming` | `isConversationActiveGetter()`（busy） |
| `resumeStream` / subscribe | `onExecutingCallback` |
| `onTerminalTaskStatus` | 空闲终态不写；忙时 `onTerminalWhileBusyCallback` |
| `fetchConversationSnapshot` | `apiAgentConversation` |
| `GLOBAL_POLLING_INTERVAL=5000` | `POLLING_INTERVAL=5000` |
| ahooks `useRequest` | `setInterval` + `pollOnce` + `isProcessing` |

调用方：`subpackages/pages/chat-conversation-component/chat-conversation-component.uvue`（`startConversationPolling` / `stop` / `pause` / `resume` / `destroy`）。

### 4.1 Mobile 已有保护（不要拆掉）

`pollOnce` 里对 **EXECUTING** 路径：

- await **之后**再检 `isConversationActiveGetter` / `isSubscribedGetter`（`activeAfter` / `subscribedAfter`）
- busy/subscribed 时走「静默终态轮询」：不触发 `onExecuting`、不加速

这些是正确方向，追齐时**保留**。

### 4.2 Mobile 仍建议补的缺口（与 PC 同病）

1. **没有 poll generation**  
   `isProcessing` 只防并发进入 `pollOnce`，**挡不住**「请求发出时 idle、await 期间用户发送、回包仍按旧语义处理」的完整丢弃语义。

2. **非 EXECUTING + busy 分支用的是 await 前的 `busy` 快照**  
   ```uts
   const busy = activeGetter != null && activeGetter() == true; // await 前
   // ...
   await apiAgentConversation(...)
   // ...
   } else {
     if (busy == true || subscribed == true) {
       onTerminalWhileBusyCallback(...)  // 可能用过期 busy
     }
   }
   ```  
   更危险的对称场景：  
   **静默轮询在「上一轮 busy」时发出 → 用户已开新一轮 live → 旧回包终态触发 `onTerminalWhileBusy` 误杀新一轮。**  
   应用 generation：**回包代际 ≠ 当前代际则整段 return**，禁止 `onExecuting` / `onTerminalWhileBusy`。

3. **发送瞬间未主动停定时器**  
   PC 在 `isLocallyStreaming` 变 true 时 `cancel()`。  
   Mobile 发送时若仍跑 interval，会继续打详情接口（静默模式）。  
   追齐建议：`isConversationActive` 变 true 时 bump generation；可选暂停/降频，但**至少**回包要能丢弃。

4. **visibility / resume 立即 `pollOnce`**  
   与 PC visibility 一样，in-flight 结果也要带 generation 校验。

---

## 5. Mobile 推荐落地步骤（给追齐 agent）

### Step A — 确认是否同病

1. 打开会话，Network/日志盯 `apiAgentConversation`（5s 一次）。
2. 在请求 **pending** 时立刻发消息。
3. 观察：是否出现 live chat abort、气泡被清、`onTerminalWhileBusy` 误触发、或错误 `onExecuting` 续 sub。

### Step B — 最小补丁（对齐 PC 语义）

在 `useConversationStatusPolling.uts`：

1. 增加模块级 `pollGeneration`（number）。
2. 导出 `bumpPollGeneration()` 或在检测到 `isConversationActiveGetter()` false→true 时递增（若 getter 无法观测边沿，则在 **发送入口** `isConversationActive=true` 的同一调用栈显式 bump —— Mobile 比 PC 更容易做同步 bump）。
3. `pollOnce` 开头：`const requestGeneration = pollGeneration`。
4. `await apiAgentConversation` **之后第一行**：  
   `if (requestGeneration != pollGeneration) { log discard; return; }`  
   再执行现有 EXECUTING / 终态逻辑。
5. （推荐）发送开始时 bump，并 `clearInterval` 暂停；live 结束后再 `start/resume`（勿在 cooldown 逻辑上引入自激循环）。
6. 加日志前缀建议：`[ConversationStatusPolling]`  
   - `cancel/bump: local send started`  
   - `discard stale poll result`

### Step C — 回归

- 单测若 UTS 难跑：至少手工按 Step A 复现，确认 discard 日志出现且新消息不被终态回调打断。
- 不要回归破坏：EXECUTING 用户门禁加速、`RESTART_COOLDOWN_MS`、静默终态检测（他端结束本端 busy 仍应收尾 —— 但必须是**同代际**回包）。

### Step D — 非目标

- 不改 5s 基础间隔语义（加速等待用户除外）。
- 不改 `/chat` / `/chat/sub` 协议。
- 不把 PC 的 React + ahooks 实现原样抄进 UTS；只追齐 **generation + 整段丢弃** 语义。

---

## 6. 验收标准

| 项 | 通过条件 |
|----|----------|
| 过期回包 | 发送后旧 poll 结果不得触发 `onExecuting` / `onTerminalWhileBusy` / 写 UI 列表 |
| 正常续接 | 空闲且 EXECUTING + 门禁通过时仍能 `onExecuting` |
| 他端结束 | **同代际** busy 轮询拿到终态仍可 `onTerminalWhileBusy` |
| 日志 | 能看到 bump/cancel 与 discard（开发环境） |
| 侵入面 | 优先只动 `useConversationStatusPolling.uts` + 发送处一次 bump；避免大范围改 chat-conversation-component |

---

## 7. PC 参考路径速查

```text
nuwax/
  src/components/business-component/UnifiedChatSession/hooks/useConversationStreamResume.ts
  tests/useConversationStreamResume.test.ts
  src/utils/logger.ts                    # conversationPollLogger
  src/utils/conversationTaskStatusSync.ts # fetchConversationSnapshot
  .cursor/plans/轮询发消息竞态排查_ed75f90e.plan.md  # 排查全文（含已取消的大改项）
```

Mobile 本文件：`nuwax-mobile/docs/poll-send-race-stale-snapshot-fix.md`

---

## 8. 一句话给追齐 agent

**PC 修复本质：轮询回包必须带「代际」；本地一开始发送就升代际，旧回包整段丢弃。**  
Mobile 请在 `useConversationStatusPolling.uts` 的 `pollOnce` await 之后做同样的 generation guard，并重点防止过期终态误触 `onTerminalWhileBusy`。

---

## 9. Mobile 落地记录（2026-08-15）

已按 Step B 最小补丁落地，编译验证通过（app-resource，Android/iOS 业务资源）。

### 改动

| 文件 | 改动 |
|------|------|
| `subpackages/hooks/useConversationStatusPolling.uts` | 模块级 `pollGeneration` + 导出 `bumpPollGeneration()`；`pollOnce` 请求前打戳 `requestGeneration`，`await apiAgentConversation` 之后第一件事比对代际，不符**整段 return**（EXECUTING 与终态分支都丢弃）。visibility resume 走同一 `pollOnce`，天然覆盖 |
| `subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts` | `handleSendMessage` 在掐断上一轮 SSE/sub 的同一同步调用栈调用 `bumpPollGeneration()`（比 PC 的 render 体边沿观测更早，无一帧窗口） |

### 与 PC 的差异（刻意）

- **不 cancel 定时器**：Mobile 轮询在本地流式期间按设计保留（静默终态轮询，检测他端结束/暂停），只丢回包，不停 interval。
- **同步 bump**：发送入口直接 bump，不存在 PC `latestRef` 一帧滞后问题（`isConversationActive` 是同步 ref 写）。
- **既有三层保护保留不动**：`pollOnce` EXECUTING 分支的 await 后复检、页面 `onExecuting` 回调里的 `isLocalConversationBusy()` 复检、`handleSubConversation` reload 后的 `isSubscribed/isCurrentlyStreaming` 复检。

### 与 `29019dcb`（终态两轮确认）的合并形态

同日另一实现（`29019dcb` 高频连续发送保护）合入后，`pollOnce` 现为**多套防护叠加**，顺序：pollGeneration 整段丢弃（本修复）→ `streamGeneration` 快照对比（await 前后流代数变化 = 新一轮已发出）→ 忙判定复核 → 终态「连续两轮确认」（`pendingTerminalObserved`，单轮陈旧终态不触发强制收尾）。两套机制互补不冲突：generation 挡「发送瞬间的在途回包」，两轮确认挡「高频连发时上一轮任务的陈旧终态回包」。

### 日志（自证修复生效）

前缀 `[ConversationStatusPolling]`：

- `bump: local send started gen=N` —— 发送瞬间代际递增
- `discard stale poll result gen=old cur=new` —— 在途旧回包被整段丢弃（命中竞态兜底）

只有 bump 没有 discard 也算修复有效：说明发送时轮询不在途。discard 是 bump 挡不住已在途请求时的安全网（对齐 PC `cancel` / `discard` 日志对语义）。
