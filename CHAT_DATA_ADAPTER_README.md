# 聊天数据适配器使用说明

## 概述

`ChatDataAdapter` 是一个用于解决数据对齐问题的工具类，它可以将您的 `MessageInfo` 格式转换为 uni-ai-x 期望的 `MsgItem` 格式，实现现有SSE渲染Markdown会话输出功能与uni-ai-x的无缝集成。

## 问题背景

您的web PC项目已经实现了SSE渲染Markdown会话输出功能，数据格式为 `MessageInfo`，但uni-ai-x期望的是 `MsgItem` 格式。这个适配器解决了两种数据格式之间的转换问题。

## 主要功能

### 1. 数据格式转换
- `convertToMsgItem()`: 将 `MessageInfo` 转换为 `MsgItem`
- `convertToMessageInfo()`: 将 `MsgItem` 转换为 `MessageInfo`
- `convertMessageListToMsgItems()`: 批量转换消息列表
- `convertMsgItemsToMessageList()`: 批量转换回消息列表

### 2. SSE数据处理
- `convertSSEChunkToMsgItem()`: 将SSE数据块转换为MsgItem
- `processSSEChunks()`: 批量处理SSE数据块，自动累积文本内容

### 3. 消息创建
- `createUserMessage()`: 创建用户消息
- `createAIMessage()`: 创建AI消息

### 4. 状态映射
- 自动处理消息状态转换
- 自动处理角色映射
- 自动处理时间格式转换

## 使用方法

### 1. 导入适配器

```typescript
import { chatDataAdapter, SSEChunk } from '@/utils/chatDataAdapter'
import { createSSEProcessor, processCompleteSSEResponse } from '@/utils/sseDataProcessor'
```

### 2. 处理SSE流式数据（推荐方式）

```typescript
// 在您的聊天页面中
export default {
  setup() {
    // 创建SSE处理器
    const sseProcessor = createSSEProcessor('chat-' + conversationId.value)
    
    // 用于渲染的MsgItem列表
    const msgItemsForRender = ref<MsgItem[]>([])
    
    // 处理SSE数据块
    const handleSSEChunk = (chunk: SSEChunk) => {
      // 处理数据块并获取更新后的消息列表
      const updatedMessages = sseProcessor.processChunk(chunk)
      
      // 更新渲染列表
      msgItemsForRender.value = updatedMessages
    }
    
    // 处理流式响应
    const handleStreamResponse = (chunk: string) => {
      try {
        // 解析SSE数据
        const sseChunk: SSEChunk = JSON.parse(chunk)
        handleSSEChunk(sseChunk)
      } catch (error) {
        console.error('解析SSE数据失败:', error)
      }
    }
    
    return {
      msgItemsForRender,
      handleStreamResponse
    }
  }
}
```

### 3. 处理完整SSE响应

```typescript
// 如果您有完整的SSE响应字符串
const handleCompleteSSEResponse = (sseString: string) => {
  const msgItems = processCompleteSSEResponse(sseString, 'chat-' + conversationId.value)
  msgItemsForRender.value = msgItems
}
```

### 4. 模板渲染

```vue
<template>
  <view class="chat">
    <scroll-view class="msg-list">
      <template v-for="item in msgItemsForRender" :key="item._id">
        <!-- AI消息使用uni-ai-x组件渲染 -->
        <uni-ai-x-msg 
          v-if="item.from_uid == 'uni-ai'" 
          :msg="item" 
          @longpress="onlongTapMsg(item)" 
        />
        <!-- 用户消息使用普通文本渲染 -->
        <text v-else class="user-msg" @longpress="onlongTapMsg(item)">
          {{item.body}}
        </text>
      </template>
    </scroll-view>
  </view>
</template>
```

### 5. 发送消息

```typescript
// 发送用户消息
const sendUserMessage = (content: string) => {
  // 创建用户消息
  const userMsg = chatDataAdapter.createUserMessage(
    content, 
    'chat-' + conversationId.value
  )
  
  // 添加到消息列表
  msgItemsForRender.value.push(userMsg)
  
  // 创建AI消息占位
  const aiMsg = chatDataAdapter.createAIMessage(
    '', 
    'chat-' + conversationId.value
  )
  msgItemsForRender.value.push(aiMsg)
  
  // 调用API发送消息
  handleConversation(params, aiMsg._id)
}
```

### 6. 在您的聊天服务中使用

```typescript
// 修改您的chatService.uts中的流式处理
const handleStreamResponse = (chunk: string) => {
  try {
    // 解析SSE数据
    const sseChunk: SSEChunk = JSON.parse(chunk)
    
    // 使用SSE处理器处理数据
    const updatedMessages = sseProcessor.processChunk(sseChunk)
    
    // 更新消息列表
    msgItemsForRender.value = updatedMessages
    
    // 滚动到底部
    scrollToLastMsg(false)
  } catch (error) {
    console.error('处理SSE数据失败:', error)
  }
}
```

## SSE数据格式说明

您的SSE接口返回的数据格式如下：

```json
{
  "requestId": "87074904bef4461b81e1a9feebad5a20",
  "eventType": "MESSAGE",
  "data": {
    "id": "87074904bef4461b81e1a9feebad5a20",
    "role": "ASSISTANT",
    "type": "CHAT",
    "text": "消息",
    "time": null,
    "attachments": null,
    "think": null,
    "quotedText": null,
    "ext": null,
    "finished": false,
    "executeId": null,
    "messageType": "ASSISTANT"
  },
  "completed": false
}
```

## 数据字段映射

| SSE数据字段 | MsgItem字段 | 说明 |
|-------------|-------------|------|
| `data.id` | `_id` | 消息ID |
| `data.role` | `from_uid` | 角色标识 |
| `data.text` | `body` | 消息内容（自动累积） |
| `data.time` | `create_time` | 时间戳 |
| `data.finished` | `state` | 消息状态 |
| `data.messageType` | - | 消息类型 |

## 状态映射

| SSE finished | MsgItem.state | 说明 |
|--------------|---------------|------|
| `false` | 2 | 未完成（正在流式输出） |
| `true` | 3 | 完成 |

## 角色映射

| SSE role | from_uid | 说明 |
|----------|----------|------|
| `USER` | 'user' | 用户 |
| `ASSISTANT` | 'uni-ai' | AI助手 |
| `SYSTEM` | 'system' | 系统 |
| `FUNCTION` | 'tool' | 工具 |

## 文本累积机制

SSE处理器会自动处理文本累积：

1. **首次接收**: 创建新的MsgItem，设置初始文本
2. **后续接收**: 将新文本追加到现有MsgItem的body字段
3. **完成标记**: 当`finished: true`时，将状态设置为完成

这样可以实现流式文本的平滑显示效果。

## 注意事项

1. **chat_id**: 创建MsgItem时必须提供有效的chat_id
2. **文本累积**: SSE处理器会自动累积文本内容，无需手动处理
3. **状态同步**: 根据`finished`字段自动更新消息状态
4. **错误处理**: 包含完整的错误处理机制
5. **性能优化**: 使用Map结构高效管理消息

## 完整示例

参考 `pages/chat/chat.uvue` 文件中的实现，展示了如何完整集成这个适配器。

## 优势

1. **无缝集成**: 无需修改现有的业务逻辑
2. **数据一致性**: 保持原有数据结构的同时支持uni-ai-x
3. **类型安全**: 完整的TypeScript类型支持
4. **易于维护**: 集中管理数据转换逻辑
5. **向后兼容**: 不影响现有功能
6. **流式支持**: 专门优化SSE流式数据处理
7. **自动累积**: 智能处理文本累积和状态更新

通过使用这个适配器，您可以轻松地将现有的SSE渲染Markdown会话输出功能接入到uni-ai-x中，实现数据格式的统一和功能的复用。
