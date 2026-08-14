# 会话出错后 taskStatus 固化 EXECUTING 修复说明

> 供 **nuwax-mobile** 追齐对照。  
> PC 已合入：`b8ec155a3` — `fix(conversation): 会话出错时落终态 taskStatus，避免固化执行中`

---

## 1. 现象

智能体会话详情页出现：

1. 消息区已显示「运行错误」（消息 `status = error`）
2. 输入区仍显示**停止按钮**（蓝方块），无法回到发送态
3. （若启用消息队列）排队消息**不再自动消费**
4. 会话状态轮询 / 侧栏「执行中」标记可能长期不消失

核心矛盾：**消息层已报错，会话层仍认为在执行中。**

---

## 2. 根因

### 2.1 真正卡住的是会话级 `taskStatus`，不是消息 `status`

PC 输入区「是否会话活跃」大致等价于：

```text
isSessionActive =
  isConversationActive
  || isSessionStreamBusy(messageList)
  || conversationInfo.taskStatus === EXECUTING
```

消息队列能否继续消费也依赖：

```text
canAttemptConsume 会检查 taskExecutingRef（来自 isTaskExecuting / taskStatus===EXECUTING）
```

因此：仅把消息标成 `Error` / 仅关掉本地 `isConversationActive`，只要 **`taskStatus` 仍是 `EXECUTING`**，停止按钮与队列仍会卡死。

### 2.2 为什么 `taskStatus` 会固化

| 路径 | 出错前行为 | 问题 |
|------|------------|------|
| `FINAL_RESULT` | 调用 `applyTerminalTaskStatus(...)` 写终态 | 正常结束有兜底 |
| SSE `ERROR` 事件 | **只**改消息 `status = Error` | **不写** `taskStatus` |
| SSE `onError`（网络超时等） | 消息改 Error + `disabledConversationActive()` | **不写** `taskStatus` |
| `onClose` 兜底拉详情 | 后端落库延迟仍返回 `EXECUTING` | `applyTerminalTaskStatus` **刻意跳过** `EXECUTING`，本地无法纠正 |

结果：本地 `taskStatus` 永久停在 `EXECUTING`。

### 2.3 曾经误改的方向（不要再走）

| 错误方向 | 为什么不够 |
|----------|------------|
| 只改 `RunOver` 展示文案 | 纯 UI，不改会话态 |
| 把消息 `Error` 改成 `Stopped` | 会话 `taskStatus` 仍可能是 EXECUTING |
| 只删队列里「末条 Error 阻断」 | `taskExecutingRef` 仍会拦住消费 |

**正确锚点：出错时立刻把会话 `taskStatus` 落成终态（PC 取 `FAILED`）。**

---

## 3. PC 已落地修复（对照实现）

### 3.1 Commit

- Hash：`b8ec155a3`
- 分支：以合入时分支为准（原 `feat-2026.7.31`）

### 3.2 改动文件

| 文件 | 改动要点 |
|------|----------|
| `src/models/conversationInfo.ts` | `ERROR` 事件 + `onError`：落 `TaskStatus.FAILED` + 同步侧栏列表 |
| `src/models/conversationAgent.ts` | 同上（Agent 预览会话 model 双份维护） |
| `src/components/business-component/MessageQueue/useChatMessageQueue.ts` | 去掉「末条 Error 永久阻断消费」 |

### 3.3 关键补丁形态（可直接对照）

**SSE `ERROR` 事件（消息仍保持 Error，会话落 FAILED）：**

```ts
if (eventType === ConversationEventTypeEnum.ERROR) {
  newMessage = {
    ...currentMessage,
    thinkingFinished: true,
    status: MessageStatusEnum.Error, // UI 仍显示「运行错误」
  };
  // 会话出错即终态：立刻写 FAILED，避免固化 EXECUTING
  if (params.conversationId) {
    applyTerminalTaskStatus(
      setConversationInfo,
      params.conversationId,
      TaskStatus.FAILED,
    );
    emitConversationListTaskStatus(
      params.conversationId,
      TaskStatus.FAILED,
    );
  }
}
```

**SSE `onError`（网络错误等同终态）：**

```ts
// 在把消息标 Error / 清理 EXECUTING processing 之后：
if (params.conversationId) {
  applyTerminalTaskStatus(
    setConversationInfo,
    params.conversationId,
    TaskStatus.FAILED,
  );
  emitConversationListTaskStatus(
    params.conversationId,
    TaskStatus.FAILED,
  );
}
disabledConversationActive();
```

**消息队列（辅修，配合终态落地）：**

```ts
// canAttemptConsume 中删除：
// if (lastMessage?.status === MessageStatusEnum.Error) return false;
//
// 说明：Error 只表示本轮消息失败，不应永久阻断后续队列。
// 用户主动点停止仍由 userPaused / pauseAutoConsume 控制。
```

### 3.4 终态取值约定

- 取 **`TaskStatus.FAILED`**（不是 `CANCEL`）
- 与现有 `normalizeStopReason`：`error / fail / failed → FAILED` 一致
- `CANCEL` 留给用户主动停止

### 3.5 明确不改的部分

- 消息 `status` **保持** `Error`（或移动端等价的 `Failed` / `"error"`）
- 「运行错误」文案保留
- 用户主动停止 → 仍走 `CANCEL` / pause 自动消费，不与本修复混用

---

## 4. nuwax-mobile 对照与追齐清单

### 4.1 对应入口（移动端）

| PC | Mobile（大致对应） |
|----|--------------------|
| `conversationInfo.ts` / `conversationAgent.ts` 的 SSE 事件处理 | `subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts` → `handleChangeMessageList` |
| `applyTerminalTaskStatus` | `markConversationTaskStatusIfExecuting(TaskStatus.FAILED)` |
| `emitConversationListTaskStatus` | 若有最近会话列表「执行中」标记，需补本地补丁或事件；无侧栏则可跳过 |
| `useChatMessageQueue.canAttemptConsume` | Mobile **当前无同构消息队列**；若以后引入，勿把末条 Error 当永久阻断 |
| `isSessionActive` 含 `taskStatus===EXECUTING` | `isConversationActive` + `conversationInfo.taskStatus` 驱动停止/发送按钮 |

### 4.2 现状盘点（写文档时已核对）

Mobile **已有部分对齐**：

```text
AgentDetailService.handleChangeMessageList
  ERROR 事件：
    - 消息 status = "error"
    - isConversationActive = false
    - markConversationTaskStatusIfExecuting(TaskStatus.FAILED)   ✅

sub 流 onError / onTimeout：
    - markConversationTaskStatusIfExecuting(TaskStatus.FAILED)   ✅
```

**仍需核对 / 可能缺口：**

| 检查项 | 位置建议 | 期望 |
|--------|----------|------|
| Live SSE `onError` / 超时异常收尾 | `finalizeStreamAbnormally` | 前台异常应落 **FAILED**（或至少非 EXECUTING）。当前实现延时后调用 `markConversationTaskCompleteIfExecuting()`（标 **COMPLETE**），与 PC「出错 = FAILED」不完全一致，建议改成 FAILED 或按是否真实 ERROR 分流 |
| 消息标 error 后 processing 残留 EXECUTING | ERROR / onError 收尾 | 工具卡若长期转圈，需把 `processingList` 中 `EXECUTING` 置 `FAILED`（PC onError 已做） |
| 最近会话 / 列表「执行中」 | 列表刷新或本地补丁 | ERROR 后应清除执行中标记（对齐 PC `emitConversationListTaskStatus`） |
| 停止按钮条件 | `chat-input-phone` / 页面层 | 确认不只看 `isConversationActive`，若含 `taskStatus===EXECUTING`，必须保证 ERROR 后 taskStatus 已非 EXECUTING |
| 轮询 / sub 恢复 | `startConversationStatusPolling` 等 | ERROR 落 FAILED 后，不应再误判本轮仍在 EXECUTING 而疯狂重订 sub；下一轮用户发送再变 EXECUTING 才正常 |

### 4.3 Mobile 建议补丁伪代码

**优先核对 live 异常收尾（若确认属于「出错」而非「正常结束缺 FINAL_RESULT」）：**

```uts
// finalizeStreamAbnormally 前台路径（示意）
setTimeout(() => {
  if (genAtAbnormal != this.streamGeneration) {
    return
  }
  this.data.isConversationActive.value = false
  // 对齐 PC：异常/出错落 FAILED，避免 COMPLETE 掩盖失败语义
  this.markConversationTaskStatusIfExecuting(TaskStatus.FAILED)
}, 150)
```

> 若该路径同时承接「流正常结束但未带 FINAL_RESULT」的兜底，需拆分支：真正 ERROR/onError → FAILED；仅缺 FINAL_RESULT → 再考虑 COMPLETE 或拉详情确认。

**ERROR 事件（已有则可只加 processing 清理）：**

```uts
if (eventTypeStr == `${ConversationEventTypeEnum.ERROR}`) {
  // ... 消息 status = "error"
  this.data.isConversationActive.value = false
  this.markConversationTaskStatusIfExecuting(TaskStatus.FAILED)
  // 建议：同步把当前消息 processingList 中 EXECUTING → FAILED
}
```

### 4.4 Mobile 验收清单

1. 触发一轮会报错的会话（或 mock SSE `ERROR`）
2. 气泡显示错误态（运行错误 / Failed）
3. 输入区停止按钮消失，恢复发送
4. `conversationInfo.taskStatus` 本地值为 `FAILED`（非 `EXECUTING`）
5. 会话列表若有「执行中」标记应清除
6. 可立刻发送下一条；轮询不应卡在旧 EXECUTING
7. 用户主动点停止：仍为 `CANCEL` / 主动停止语义，不被本修复改成 FAILED

---

## 5. 回归注意

- **不要**在 `applyTerminalTaskStatus` / `markConversationTaskStatusIfExecuting` 里写入 `EXECUTING`（PC 工具函数明确跳过 EXECUTING，防止后端落库竞态把执行中固化回来）。
- ERROR 与用户取消要区分：`FAILED` vs `CANCEL`。
- PC `conversationInfo` 与 `conversationAgent` 是双份逻辑；Mobile 若只有 `AgentDetailService` 一处，改一处即可，但临时会话 / sub 恢复两条链路都要测。

---

## 6. 相关文档

- `docs/message-queue-design.md` — 队列设计（其中「Error 暂停消费」已被本修复调整：Error 不再永久阻断）
- `docs/conversation-stream-resume-and-intervention.md` — 轮询 / sub 恢复
- PC 工具：`src/utils/conversationTaskStatusSync.ts`（`applyTerminalTaskStatus` / `emitConversationListTaskStatus`）

---

## 7. 一句话结论

**会话报错后，必须立刻把会话级 `taskStatus` 从 `EXECUTING` 落成终态 `FAILED`（消息可继续显示 Error）。**  
否则停止按钮、队列、轮询都会被「仍在执行」卡住。Mobile 的 ERROR 事件路径大体已对齐，请重点核对 **live 异常收尾是否误标 COMPLETE**，以及 **列表执行中标记 / processing EXECUTING 残留**。

---

## 8. Mobile 落地记录（2026-08-15）

按 §4.2 清单逐项核对后落地，编译验证通过（app-resource，Android/iOS 业务资源）。

### 核对结论

| 检查项 | 结论 |
|--------|------|
| ERROR 事件落 FAILED | ✅ 原已对齐（`AgentDetailService.handleChangeMessageList`） |
| sub onError / onTimeout 落 FAILED | ✅ 原已对齐 |
| live 异常收尾误标 COMPLETE | ❌→✅ 已修：`finalizeStreamAbnormally` 增加 `isRealError` 分流（见下） |
| ERROR 事件 processing EXECUTING 残留 | ❌→✅ 已修：ERROR 分支把 `processingList` 中 EXECUTING 置 FAILED（见下） |
| 停止按钮条件 | ✅ 无需改：`chat-input-phone` 只看 `isConversationActive`（+`isStoppingConversation`），不含 `taskStatus===EXECUTING`，ERROR 后即恢复发送态 |
| 最近会话列表「执行中」标记 | ✅ 无需改：首页列表是 server-truth（`fetchConversationList`），onShow / ChatFinished 事件静默刷新，无 PC 式乐观写入残留 |
| 消息队列 | N/A：Mobile 无同构队列 |

### 改动（`AgentDetailService.uts`）

> 2026-08-15 合并 `29019dcb`（高频连续发送保护：fail 不关态 → 续接 / 阈值强关）后，本节 1 的语义有调整，以合并后为准：

1. **`finalizeStreamAbnormally(isTempChat, streamGen, onTimeout, isRealError)`**：
   - 临时会话：无法续接，延时收尾（`isRealError` 区分 FAILED/COMPLETE 语义保留在签名上；临时会话通常无 conversationInfo，实为空操作）
   - 普通会话（合并后最终形态）：fail **不关态**（保持 loading 视觉，避免「消失→续接→又出现」翻转），置 `streamResumePending` 并立即 `scheduleRecoverIfAssistantLoading` 续接；**FAILED 终态不在 fail 时刻写**——若立即落 FAILED，网络抖动后续接成功时会与「任务实际仍在执行」矛盾。终态出口：
     - 续接成功 → sub 接管，任务继续
     - 后端已结束 / 不能续接 → 收尾关态
     - 连续续接失败达 `MAX_RESUME_FAIL_STREAK` → 强制关态并落 **FAILED**（`cleanupSub` 阈值路径）
     - 轮询终态两轮确认（`29019dcb`）→ `onTerminalWhileBusy` 收尾
   - `isRealError` 现用于日志区分来源（真实网络 error vs timeout/异常关闭兜底）
2. **ERROR 事件分支**：新增 `patchDraftExecutingProcessingToFailed(m)`，消息标 `error` 的同时把 EXECUTING 工具卡置 FAILED（live 路径原先漏了这步，工具卡会一直旋转；sub 路径原已由 `cleanupSub(true)→finalizeTerminalAssistantMessage` 覆盖，现幂等）。
3. **`finalizeTerminalAssistantMessage`** 内联的 processing 收口重构为同一个 `patchDraftExecutingProcessingToFailed`（返回转换数量），消除重复。

### 日志（确认修复生效）

- `[AgentDetailService] ERROR event terminal: taskStatus->FAILED toolsFailed=N msgId=...` —— ERROR 事件即终态，N 为收口的 EXECUTING 工具卡数
- `[SSE-Stream] abnormal finalize: isRealError=0|1 gen=N -> resumePending` —— live 异常收尾进入保持态续接（isRealError 区分真实网络 error / timeout 兜底）
- `[AgentDetailService] taskStatus terminal: EXECUTING -> FAILED|COMPLETE|CANCEL convId=...` —— 终态真实写入
- `[AgentDetailService] taskStatus terminal skip: cur=... next=...` —— 未写入（当前本就不在 EXECUTING；排查固化时 `cur=` 是关键证据）

### 回归要点

- 用户主动停止仍为 `CANCEL`（`handleStopConversation` 未动）。
- 不在任何路径把 `taskStatus` 写回 `EXECUTING`（`markConversationTaskStatusIfExecuting` 仅接受从 EXECUTING 向终态迁移）。
