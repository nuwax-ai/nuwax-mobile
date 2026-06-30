# AgentIntervention

AI Agent 运行时干预模块，支持两种暂停-恢复流程：**ACP 权限审批** 和 **MCP Ask 结构化提问**。

对齐 Web 版 `nuwax/src/components/business-component/AgentIntervention` 的逻辑，实现层按移动端框架适配。

---

## 模块结构

```
components/agent-intervention/
├── README.md
├── intervention-card/          # 按 kind 分发到子卡片（测试页用）
├── acp-permission-card/        # ACP 权限审批卡片
└── mcp-ask-question-card/      # MCP Ask 结构化表单卡片

subpackages/pages/chat-conversation-component/
├── layers/AgentDetailService.uts         # SSE 事件处理 + handleAcpPermissionEvent / handleMcpAskEvent
└── utils/mcpAskInterventionState.uts     # DockPanel 显隐计算（getActiveAcpPermissionDockItems / getVisibleMcpAskDockItems）

subpackages/utils/
└── historyMessageAdapter.uts             # 历史消息 hydrate + applyMcpAskResumeStatuses

utils/
├── interventionAdapter.uts               # SSE 事件识别与提取（isAcpPermissionEvent / extractAcpPermissionInteraction 等）
├── mcpAskSchema.uts                      # MCP Ask JSON Schema 解析（parseMcpAskToolInput / parseInteractionFields）
└── mcpAskResumeMessage.uts               # resume 消息构建与识别（buildMcpAskResumeMessage / hasMcpAskResumeMessage）

types/intervention.uts                    # AcpPermissionInteraction / McpAskInteraction 类型定义
```

---

## 一、核心数据结构

干预数据挂载在 `MessageInfo` 上，与当前流式消息共存：

```typescript
interface MessageInfo {
  acpPermissionInteractions?: AcpPermissionInteraction[];
  mcpAskInteractions?: McpAskInteraction[];
  processingList?: ProcessingInfo[];          // 流式 PROCESSING 事件累积（含 Plan / ToolCall）
  componentExecutedList?: ComponentExecutedItem[];  // 历史消息专有（API 返回，流式消息无此字段）
}
```

### processingList vs componentExecutedList

| 字段 | 来源 | 出现时机 | 含 ASK_QUESTION / REQUEST_PERMISSION？ |
|---|---|---|---|
| `processingList` | 流式 PROCESSING SSE 事件累积 | 流式消息 | 否（这两种事件被拦截不进 processingList） |
| `componentExecutedList` | API 返回历史消息 | 历史消息 | 是（全量执行记录） |

"历史模式" 指 `componentExecutedList` 非空；"实时流模式" 指 `componentExecutedList` 为 null/空。

---

## 二、数据写入路径

### 2.1 实时流（live SSE）

```
handleSendMessage
  → StreamRequest POST /chat
    → handleChangeMessageList(chunk, currentMessageId)
        ├─ isAcpPermissionEvent? → handleAcpPermissionEvent → message.acpPermissionInteractions.push
        ├─ isMcpAskToolCallEvent? → handleMcpAskEvent → message.mcpAskInteractions.push
        └─ eventType === PROCESSING → message.processingList.push   ← ASK_QUESTION / REQUEST_PERMISSION 不在此
```

**关键细节：** ACP 和 MCP Ask 事件在 `handleChangeMessageList` 最前面被拦截并 `return`，**不会**进入 `processingList`。

### 2.2 消息恢复（sub stream）

刷新页面 / 重进会话且任务仍 EXECUTING 时触发，由页面层轮询 `taskStatus` 检测后调用 `handleSubConversation`：

```
handleSubConversation(conversationId)
  1. reload 历史: apiAgentConversation → adaptHistoryMessageList → messageList
  2. 追加占位: messageList.push(placeholder{ id: currentMessageId, status: Loading })
  3. StreamRequest GET /chat/sub/:id
       → handleChangeMessageList(chunk, currentMessageId)   ← 与 live 复用同一处理器
```

sub 流重放历史 SSE 时，ASK_QUESTION / REQUEST_PERMISSION 事件同样经由 `handleMcpAskEvent` / `handleAcpPermissionEvent` 写入占位消息。此时历史消息（步骤 1 加载）已含 resume 消息，`hasMcpAskResumeMessage` 可过滤已回答的 MCP Ask，避免重复展示。

### 2.3 历史消息 hydrate

```
handleQueryConversation / handleLoadMoreMessages
  → adaptHistoryMessageList(rawList)
      → per message: adaptHistoryMessage
            ├─ convertComponentExecutedListToProcessingList  → message.processingList
            └─ hydrateMcpAskInteractionsFromExecutedComponents
                   → componentExecutedList 中的 ASK_QUESTION 条目
                   → createMcpAskInteractionFromToolInput
                   → message.mcpAskInteractions.push (responseStatus 默认 'pending')
      → applyMcpAskResumeStatusesInMessageList
            → 遍历 messageList，对每条 pending MCP Ask 在后续消息中搜索 resume 文本
            → 找到则置 responseStatus = 'submitted' / 'cancelled' / 'skipped' / 'timeout'
```

**注意：** ACP 权限审批**不从历史 hydrate**，仅存在于实时流消息中。

---

## 三、DockPanel 渲染：何时显示卡片

DockPanel 在 `chat-conversation-component.uvue` 的 `intervention-dock` 区域渲染，由两个 `computed` 驱动：

```typescript
const activeAcpPermissionDockItems = computed(() => getActiveAcpPermissionDockItems(messageList.value))
const visibleMcpAskDockItems = computed(() => getVisibleMcpAskDockItems(messageList.value))
```

两者均只处理 `messageList` 中的**最后一条消息**（`latestMessage`），历史消息上残留的 pending 审批不进 DockPanel。

---

### 3.1 ACP 权限审批卡片（`getActiveAcpPermissionDockItems`）

```
latestMessage = messageList[last]
isHistory = componentExecutedList 非空

[历史模式] componentExecutedList 末项 subEventType !== 'REQUEST_PERMISSION'  → 返回空
[任意模式] isMessageTerminal(Complete / Error / Stopped)                     → 返回空

currentProcessingLength = isHistory ? 0 : latestMessage.processingList.length

对 latestMessage.acpPermissionInteractions 逐条过滤：
  × responseStatus 不是 pending / submitting / failed  → 跳过
  × [实时流] processingListLengthAtAdd 已设置
         且 currentProcessingLength > processingListLengthAtAdd  → 跳过（过期）
  ✓ 其余 → 加入队列显示
```

**关闭时机：**

| 原因 | 触发方式 |
|---|---|
| 用户审批 | `responseStatus` → `submitted` |
| Agent 推进 | `processingList` 新增项，`currentProcessingLength > processingListLengthAtAdd` |
| 会话结束 | `status` → `Complete / Error / Stopped` |
| 切换到非 REQUEST_PERMISSION 末项 | 历史模式 `componentExecutedList` 末项变化 |

---

### 3.2 MCP Ask 卡片（`getVisibleMcpAskDockItems`）

```
latestMessage = messageList[last]
isHistory = componentExecutedList 非空

[历史模式] componentExecutedList 末项 subEventType !== 'ASK_QUESTION'  → 返回空

currentProcessingLength = isHistory ? 0 : latestMessage.processingList.length

收集 pending ACP 的抑制 ID（来自 latestMessage.acpPermissionInteractions）：
  pendingAcpToolCallIds   = { acp.toolCallId }
  pendingAskRequestIds    = { acp.toolCall.rawInput.requestId }   ← rawInput 为 MCP Ask 参数时有值

对 latestMessage.mcpAskInteractions 逐条过滤：
  × responseStatus 不是 pending / submitting / failed  → 跳过
  × [实时流] processingListLengthAtAdd 已设置
         且 currentProcessingLength > processingListLengthAtAdd  → 跳过（过期）
  × toolCallId ∈ pendingAcpToolCallIds     → 跳过（第一路 ACP 抑制）
  × requestId  ∈ pendingAskRequestIds      → 跳过（第二路 ACP 抑制）
  × hasMcpAskResumeMessage(messageList, interaction)  → 跳过（已回答）
  ✓ 其余 → 加入队列显示
```

**与 ACP 的重要区别：**
- MCP Ask **不受** `isMessageTerminal` 影响——消息 `Complete` 后用户仍可能在填表，由 `responseStatus` 独立控制关闭。
- MCP Ask 可被 pending ACP 双路抑制（ACP 优先显示）。

**关闭时机：**

| 原因 | 触发方式 |
|---|---|
| 本端用户提交 | `removeMcpAskInteractionFromMessageList` 直接从 list 移除（`handleMcpAskRespond`） |
| Agent 推进 | `processingList` 新增项，过期检查生效 |
| 跨端感知 | resume 消息出现在 `messageList`，`hasMcpAskResumeMessage` 返回 true |
| 本端历史 hydrate | `applyMcpAskResumeStatusesInMessageList` 置 `responseStatus` = `submitted` |

---

## 四、过期机制（`processingListLengthAtAdd`）

对齐 PC 端 `focusExecuteId` / `isExpired` 机制，移动端用 `processingList.length` 作为时间戳。

**工作原理：**

1. ACP 或 MCP Ask SSE 事件到来时，`handleAcpPermissionEvent` / `handleMcpAskEvent` 记录此时 `processingList.length` 为 `processingListLengthAtAdd`。
2. 后续 PROCESSING（Plan/ToolCall）事件使 `processingList.length` 增长。
3. DockPanel 渲染时：`currentProcessingLength > processingListLengthAtAdd` → agent 已推进到下一步 → 该卡片过期关闭。

```
t=0  processingList=[A,B]          MCP Ask arrives  → processingListLengthAtAdd=2
t=1  PROCESSING(C)  processingList=[A,B,C]
t=2  REQUEST_PERMISSION            ACP arrives      → processingListLengthAtAdd=3
     currentProcessingLength=3 > 2  ∴ MCP Ask 过期  ✓ 仅 ACP 显示
```

**注意：** ASK_QUESTION 和 REQUEST_PERMISSION 事件本身**不进** `processingList`（被拦截 return），因此不影响 `processingListLengthAtAdd` 计算。

---

## 五、ACP 双路抑制 MCP Ask

当 ask-question 工具本身需要 ACP 授权才能执行时，同一工具调用会同时产生 ACP 和 MCP Ask 两个事件。此时应只显示 ACP，不显示 MCP Ask。

**第一路（toolCallId 匹配）：** MCP Ask 的 `toolCallId === ACP 的 toolCallId`

**第二路（requestId 匹配）：** MCP Ask 的 `requestId === ACP 的 toolCall.rawInput.requestId`（ask-question 的 rawInput 里带有 requestId 字段时适用）

两路互补，覆盖不同的后端事件格式。

**不触发抑制的场景（正常分时序出现）：**
ACP 的 `rawInput` 是 bash 命令（无 requestId 字段）、且与 MCP Ask 的 toolCallId 不同 → 两路均不命中 → 两者各自独立判断显示。

---

## 六、跨端感知（`hasMcpAskResumeMessage`）

用户在 PC 端答完 MCP Ask 后，PC 会发一条 resume 用户消息进入会话。Mobile sub 流或历史加载时会收到该消息，`hasMcpAskResumeMessage` 在 `messageList` 全局搜索 resume 签名，命中则关闭对应卡片。

```typescript
// 任意一条消息文本 includes 以下签名之一即为 true
submit:  "我已填写「{title}」"  /  "我已填寫「{title}」"  /  `I filled out "{title}"`
cancel:  "我取消了「{title}」"  /  `I cancelled "{title}"`
skip:    "我跳过了「{title}」"  /  "我跳過了「{title}」"  /  `I skipped "{title}"`
timeout: "「{title}」已超时"   /  "「{title}」已逾時"    /  `"{title}" timed out`
```

**变更风险：** 修改 `buildMcpAskResumeMessage` 的输出格式，或修改上述签名字符串，必须同步更新 `collectResumeMessageSignatures`，否则历史 resume 消息无法被识别，导致已回答的卡片重新出现。

---

## 七、用户响应处理

### 7.1 ACP 权限审批（`handleAcpPermissionRespond`）

```typescript
// 1. 更新 responseStatus → 'submitting'
updateAcpPermissionInteractionStatus(interaction, 'submitting')
// 2. POST /api/agent/conversation/chat/permission-request/response
// 3. 成功 → 'submitted'；失败 → 'failed'（卡片关闭，toast 报错）
```

### 7.2 MCP Ask 提交（`handleMcpAskRespond`）

```typescript
// 1. 更新 responseStatus → 'submitting'
updateMcpAskInteractionStatusInMessageList(messageList, interaction, 'submitting')
// 2. isConversationActive = true（锁定输入框）
// 3. 立即从 messageList 移除该 interaction（卡片消失，无需等 API）
removeMcpAskInteraction(interaction)
// 4. buildMcpAskResumeMessage → handleSendMessage 将 resume 文本发回会话
```

---

## 八、规则速查

```
ACP visible  =  responseStatus ∈ {pending, submitting, failed}
             && !isMessageTerminal
             && !expired (processingList.length ≤ processingListLengthAtAdd)
             [history: componentExecutedList last subEventType == REQUEST_PERMISSION]

MCP visible  =  responseStatus ∈ {pending, submitting, failed}
             && !expired (processingList.length ≤ processingListLengthAtAdd)
             && !hasMcpAskResumeMessage(messageList, interaction)
             && toolCallId ∉ pendingAcpToolCallIds          // ACP 双路抑制
             && requestId  ∉ pendingAskRequestIds
             [history: componentExecutedList last subEventType == ASK_QUESTION]
             [NOT affected by isMessageTerminal]
```

---

## 九、与 PC 版对应关系

| 机制 | PC（`useActiveInterventionQueue`） | Mobile（`mcpAskInterventionState.uts`） |
|---|---|---|
| 过期检查 | `isExpired(executeId)` vs `focusExecuteId`（processingList 末尾 executeId） | `processingList.length > processingListLengthAtAdd` |
| 本端提交关闭 | `dismissedMcpAskRequestIds` Set，API 失败可回滚 | `removeMcpAskInteractionFromMessageList`，直接移除 |
| 跨端感知关闭 | `hasMcpAskResumeMessage`（搜索签名） | 同左 |
| 历史状态恢复 | `hydrateMcpAskInteractionsInMessageList` | `applyMcpAskResumeStatusesInMessageList` |
| ACP 抑制 MCP Ask | `permissionPendingToolCallIds` + `permissionPendingAskRequestIds` | 同左 |
| 卡片渲染方式 | `DockPanel` 堆叠（多卡叠放，最新在前） | ACP + MCP Ask 分列 `v-for` 渲染，同时有值则并排 |
| ACP 不受 terminal 影响 | ACP 受影响（isMessageTerminal 过滤），MCP Ask 不受 | 同左 |
| 历史模式判断 | `executeId` 对比（统一使用 focusExecuteId） | `componentExecutedList` 末项 `subEventType` 判断 |

---

## 十、示例页面

| 环境 | 地址 |
|---|---|
| 路由 path | `/pages/test-intervention/test-intervention` |
| 代码跳转 | `uni.navigateTo({ url: '/pages/test-intervention/test-intervention' })` |

示例页源码：`pages/test-intervention/test-intervention.uvue`  
Mock 数据：`utils/mockInterventionData.uts`
