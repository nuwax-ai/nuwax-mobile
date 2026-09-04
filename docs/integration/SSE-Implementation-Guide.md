# SSE (Server-Sent Events) 流式请求实现指南

## 📋 目录

- [概述](#概述)
- [核心架构](#核心架构)
- [快速开始](#快速开始)
- [实现细节](#实现细节)
- [平台差异处理](#平台差异处理)
- [数据处理器](#数据处理器)
- [现有示例](#现有示例)
- [最佳实践](#最佳实践)
- [常见问题](#常见问题)
- [总结](#总结)

## 概述

本项目使用 **SSE (Server-Sent Events)** 技术实现流式数据传输，支持 H5、微信小程序和 App 多端。SSE 是一种服务器推送技术，允许服务器向客户端推送实时数据流，非常适合聊天、实时通知等场景。

### 核心优势

- ✅ **多端支持**：统一接口，自动适配 H5、微信小程序、App
- ✅ **流式传输**：实时接收数据，无需轮询
- ✅ **自动重连**：H5 端支持自动重连机制
- ✅ **错误处理**：完善的错误处理和超时监控
- ✅ **UTF-8 支持**：正确处理多字节字符，避免截断问题
- ✅ **类型安全**：完整的 TypeScript 类型定义

### 技术栈

- **H5 端**：`@microsoft/fetch-event-source` 库
- **微信小程序**：`uni.request` + `enableChunked: true`
- **App 端**：`uni.request` 标准请求
- **数据处理**：自定义 SSE 数据处理器
- **类型系统**：UTS (UniApp TypeScript)

## 核心架构

### 架构图

```
┌─────────────────────────────────────────┐
│         业务层 (Business Layer)          │
│  - chatService.uts                      │
│  - AgentDetailService.uts                │
└──────────────┬──────────────────────────┘
               │
               │ 调用
               ▼
┌─────────────────────────────────────────┐
│      流式请求层 (StreamRequest)          │
│  - StreamRequest 类                      │
│  - 统一接口: request()                   │
│  - 平台适配: requestH5/Weapp/App         │
└──────────────┬──────────────────────────┘
               │
               ├─────────────────┬─────────────────┐
               ▼                 ▼                 ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │  H5 实现      │  │  小程序实现   │  │  App 实现     │
    │  createSSE    │  │  uni.request │  │  uni.request  │
    │  Connection   │  │  + chunked   │  │  + 流处理     │
    └──────────────┘  └──────────────┘  └──────────────┘
               │                 │                 │
               └─────────────────┴─────────────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │   数据处理器层           │
                    │  - SSEDataProcessor     │
                    │  - ChatDataAdapter      │
                    └────────────────────────┘
```

### 核心文件结构

```
utils/
├── streamRequest.uts          # 流式请求核心类
├── sseDataProcessor.uts        # SSE 数据处理器
├── chatDataAdapter.uts         # 数据格式适配器
└── utf8.uts                    # UTF-8 编码处理

servers/
└── useRequest.uts              # H5 SSE 连接创建

types/interfaces/
└── chat.uts                   # 类型定义
```

## 快速开始

### 第一步：导入必要的模块

```typescript
import { streamRequest } from '@/utils/streamRequest'
import { StreamRequestConfig, StreamChunk } from '@/types/interfaces/chat'
```

### 第二步：配置请求参数

```typescript
const config: StreamRequestConfig = {
  url: 'https://api.example.com/chat/stream',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: {
    message: '你好',
    conversationId: 'conv-123',
    stream: true
  },
  onChunk: (chunk: StreamChunk) => {
    // 处理数据块
    console.log('收到数据:', chunk.data)
  },
  onError: (error: any) => {
    // 处理错误
    console.error('请求错误:', error)
  },
  onComplete: () => {
    // 请求完成
    console.log('请求完成')
  },
  onOpen: (response: any) => {
    // 连接建立
    console.log('连接已建立:', response)
  },
  onTimeout: () => {
    // 超时处理（仅小程序）
    console.log('请求超时')
  }
}
```

### 第三步：发起请求

```typescript
try {
  await streamRequest.request(config)
} catch (error) {
  console.error('请求失败:', error)
}
```

### 第四步：中止请求（可选）

```typescript
// 在需要时中止请求
streamRequest.abort()
```

## 实现细节

### H5 端实现

H5 端使用 `@microsoft/fetch-event-source` 库实现 SSE 连接。

#### 核心代码

**文件位置**：`servers/useRequest.uts`

```typescript
import { fetchEventSource, EventSourceMessage } from '@microsoft/fetch-event-source'

export async function createSSEConnection<T = any>(options: SSEOptions<T>) {
  const controller = options.abortController || new AbortController()
  
  // H5 需要添加 fragment 参数（用于路由识别）
  const fragment = (window.location.hash || "#/").replace("#/", "/")
  
  try {
    await fetchEventSource(options.url, {
      method: options.method || "POST",
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
        ...(fragment && { fragment }), // 添加 fragment
      },
      body: typeof options.body === "object" 
        ? JSON.stringify(options.body) 
        : options.body,
      signal: controller.signal,
      openWhenHidden: true, // 页面不可见时保持连接

      onopen: async (response) => {
        if (response.status >= 400) {
          throw new Error(`SSE连接失败: ${response.statusText}`)
        }
        options.onOpen?.(response)
      },

      onmessage: (event: EventSourceMessage) => {
        try {
          const data = event.data ? JSON.parse(event.data) : null
          options.onMessage(data)
        } catch (error) {
          const normalizedError = error instanceof Error 
            ? error 
            : new Error(String(error))
          options.onError?.(normalizedError)
        }
      },

      onclose: () => {
        options.onClose?.()
      },

      onerror: (error) => {
        // 如果是中止错误，不抛出异常
        if (error.name === "AbortError") {
          console.log("SSE连接已被中止")
          return
        }
        options.onError?.(error)
        throw error // 停止自动重试
      },
    })
  } catch (error) {
    // 静默处理所有 AbortError
    if (error.name === "AbortError") {
      console.log("SSE连接已被中止")
      return
    }
    // 只有真正的错误才触发错误回调
    const normalized = error instanceof Error 
      ? error 
      : new Error(String(error))
    options.onError?.(normalized)
    throw normalized
  }
}
```

#### 关键特性

1. **Fragment 参数**：H5 端自动添加 `fragment` 请求头，用于服务端路由识别
2. **AbortController**：支持请求中止
3. **错误处理**：区分中止错误和真实错误
4. **自动重连**：`fetch-event-source` 库内置自动重连机制

#### 在 StreamRequest 中的使用

**文件位置**：`utils/streamRequest.uts`

```typescript
private async requestH5(config: StreamRequestConfig): Promise<void> {
  try {
    // 启动超时监控
    this.startTimeoutMonitor()

    await createSSEConnection({
      url: config.url,
      method: config.method,
      headers: config.headers as any,
      body: config.body,
      abortController: this.abortController,
      onMessage: (data: any) => {
        if (this.isAborted) return
        this.updateLastChunkTime() // 更新接收时间

        try {
          // 检查是否完成
          if (data && data.completed) {
            this.clearTimeoutMonitor()
            config.onComplete?.()
            return
          }

          // 处理数据块
          const chunk: StreamChunk = {
            type: "content",
            data: data ? JSON.stringify(data) : "",
          }
          config.onChunk?.(chunk)
        } catch (e) {
          console.error("Parse chunk error:", e)
        }
      },
      onError: (error: Error) => {
        this.clearTimeoutMonitor()
        if (error.name === "AbortError" || this.isAborted) {
          return
        }
        config.onError?.(error)
      },
      onOpen: (response: any) => {
        console.log("SSE连接已建立:", response)
      },
      onClose: () => {
        console.log("SSE连接已关闭")
      },
    })
  } catch (error) {
    // 错误处理...
  }
}
```

### 微信小程序端实现

微信小程序使用 `uni.request` 的 `enableChunked` 选项实现流式传输。

#### 核心代码

**文件位置**：`utils/streamRequest.uts`

```typescript
private async requestWeapp(config: StreamRequestConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    this.requestTask = uni.request({
      url: config.url,
      method: config.method,
      header: config.headers as any,
      data: config.body,
      enableChunked: true, // 启用分块传输
      responseType: "arraybuffer", // 响应类型为 ArrayBuffer
      timeout: 1000 * 60 * 60 * 12, // 设置超时时间为 12 小时
      success: (res) => {
        if (res.statusCode === 200) {
          config.onOpen?.(res)
          resolve() // 请求成功建立连接后即可 resolve
        } else {
          this.clearTimeoutMonitor()
          reject(new Error(`HTTP error! status: ${res.statusCode}`))
        }
      },
      fail: (err) => {
        this.clearTimeoutMonitor()
        if (!this.isAborted) {
          // 忽略超时错误（流式请求的正常现象）
          if (err.errMsg && (err.errMsg.includes("time out") || err.errMsg.includes("timeout"))) {
            console.log("请求超时警告（流式请求正常现象）:", err)
            return
          }
          config.onError?.(err)
          reject(err)
        }
      },
    })

    // 启动超时监控
    this.startTimeoutMonitor()

    // 监听分块数据接收
    this.requestTask?.onChunkReceived?.((res) => {
      if (this.isAborted) return
      this.updateLastChunkTime()

      try {
        // 使用 decodeUTF8 处理分块数据，解决字符截断问题
        const str = this.decodeUTF8(res.data as ArrayBuffer)

        // 将新数据添加到缓冲区
        this.buffer += str

        // SSE 协议：完整的消息以 \n\n 结尾
        const messages = this.buffer.split("\n\n")
        this.buffer = messages.pop() || "" // 保存最后一个可能不完整的消息块

        // 处理所有完整的消息块
        for (const message of messages) {
          if (!message.trim()) continue

          const lines = message.split("\n")
          let dataContent = ""

          // 提取所有 data: 开头的行
          for (const line of lines) {
            if (line.startsWith("data:")) {
              const content = line.slice(5).trim()
              if (dataContent.length > 0) {
                dataContent += "\n" + content
              } else {
                dataContent = content
              }
            }
          }

          // 处理完整的 SSE 消息
          if (dataContent.length > 0) {
            this.processSSEMessage(dataContent, config, resolve)
          }
        }
      } catch (error) {
        console.error("处理分块数据失败:", error)
        if (!this.isAborted) {
          config.onError?.(error)
        }
      }
    })
  })
}
```

#### 关键特性

1. **enableChunked**：启用分块传输，支持流式数据
2. **responseType: "arraybuffer"**：接收二进制数据，需要手动解码
3. **UTF-8 解码**：使用 `decodeUTF8` 方法处理多字节字符，避免截断
4. **消息缓冲**：使用 `buffer` 缓存不完整的消息（以 `\n\n` 为完整标记）
5. **超时监控**：60 秒内无数据流动时自动断开

#### UTF-8 解码处理

小程序端接收的是 `ArrayBuffer`，需要正确处理 UTF-8 编码，避免字符截断：

```typescript
private decodeUTF8(chunk: ArrayBuffer): string {
  const newBytes = new Uint8Array(chunk)
  let combined = newBytes

  // 合并之前未完成的字节
  if (this.pendingBytes.length > 0) {
    combined = new Uint8Array(this.pendingBytes.length + newBytes.length)
    combined.set(this.pendingBytes)
    combined.set(newBytes, this.pendingBytes.length)
    this.pendingBytes = new Uint8Array(0)
  }

  if (combined.length === 0) return ""

  // 寻找最后一个安全的字节边界
  let safeEnd = combined.length
  let i = combined.length - 1
  let backtrack = 0

  // 向前回溯，检查末尾是否被截断
  // UTF-8 最大字符长度为 4 字节
  while (backtrack < 4 && i >= 0) {
    const b = combined[i]

    // ASCII (0xxxxxxx) - 字符结束
    if ((b & 0x80) === 0) {
      safeEnd = combined.length - backtrack
      break
    }

    // Start byte (11xxxxxx)
    if ((b & 0xc0) === 0xc0) {
      let need = 2
      if ((b & 0xe0) === 0xe0) need = 3
      else if ((b & 0xf0) === 0xf0) need = 4

      const have = combined.length - i
      if (have < need) {
        // 不完整，需要保留从 i 开始的所有字节
        safeEnd = i
      } else {
        safeEnd = combined.length
      }
      break
    }

    i--
    backtrack++
  }

  // 如果 safeEnd 小于总长度，保存剩余字节
  if (safeEnd < combined.length) {
    this.pendingBytes = combined.slice(safeEnd)
    return utf8ArrayToString(combined.slice(0, safeEnd))
  }

  return utf8ArrayToString(combined)
}
```

### App 端实现

App 端使用标准的 `uni.request`，在响应完成后统一处理流式数据。

#### 核心代码

```typescript
private async requestApp(config: StreamRequestConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    this.requestTask = uni.request({
      url: config.url,
      method: config.method,
      header: config.headers as any,
      data: config.body,
      success: (res) => {
        if (res.statusCode === 200) {
          // 处理流式响应
          this.handleStreamResponse(res.data as string, config)
          resolve()
        } else {
          reject(new Error(`HTTP error! status: ${res.statusCode}`))
        }
      },
      fail: (err) => {
        if (!this.isAborted) {
          reject(err)
        }
      },
    })
  })
}

private handleStreamResponse(data: string, config: StreamRequestConfig): void {
  const lines = data.split("\n")

  for (const line of lines) {
    if (line.trim() === "") continue

    if (line.startsWith("data:")) {
      const content = line.slice(5).trim()

      if (!content) continue

      // 检查是否完成
      if (content === "[DONE]") {
        config.onComplete?.()
        return
      }

      // 检查是否看起来像 JSON
      const looksLikeJSON = content.startsWith("{") || content.startsWith("[")

      if (looksLikeJSON) {
        try {
          const parseData = JSON.parse(content)
          if (parseData && parseData.completed) {
            config.onComplete?.()
            return
          }
        } catch (e) {
          // JSON 解析失败，继续处理为普通数据
        }
      }

      // 处理数据块
      const chunk: StreamChunk = {
        type: "content",
        data: content,
      }
      config.onChunk?.(chunk)
    }
  }
}
```

## 平台差异处理

### 条件编译

项目使用 uni-app 的条件编译功能，根据平台自动选择实现：

```typescript
// #ifdef H5 || WEB
await this.requestH5(config)
// #endif

// #ifdef MP-WEIXIN
await this.requestWeapp(config)
// #endif

// #ifdef APP-PLUS
await this.requestApp(config)
// #endif
```

### 平台特性对比

| 特性 | H5 | 微信小程序 | App |
|------|----|-----------|-----|
| 实现方式 | fetch-event-source | uni.request + enableChunked | uni.request |
| 数据格式 | JSON 对象 | ArrayBuffer (需解码) | 字符串 |
| 自动重连 | ✅ 支持 | ❌ 不支持 | ❌ 不支持 |
| 超时监控 | ✅ 60秒 | ✅ 60秒 | ❌ 不支持 |
| Fragment 参数 | ✅ 需要 | ❌ 不需要 | ❌ 不需要 |
| UTF-8 处理 | ✅ 自动 | ✅ 手动解码 | ✅ 自动 |

## 数据处理器

### SSEDataProcessor

专门用于处理 SSE 流式数据的处理器，支持消息累积和去重。

**文件位置**：`utils/sseDataProcessor.uts`

#### 核心功能

```typescript
export class SSEDataProcessor {
  private sseChunks: SSEChunk[] = []
  private chatId: string = ''
  private messageMap = new Map<string, MsgItem>()

  /**
   * 处理单个SSE数据块
   */
  processChunk(chunk: SSEChunk): MsgItem[] {
    this.sseChunks.push(chunk)
    this.processMessage(chunk)
    return this.getAllMessages()
  }

  /**
   * 智能判断是否应该追加文本（去重逻辑）
   */
  private shouldAppendText(existingBody: string, newText: string): boolean {
    // 如果新文本为空，不追加
    if (!newText || newText.trim().length === 0) {
      return false
    }
    
    // 如果现有内容已经包含新文本，不追加
    if (existingBody.includes(newText)) {
      return false
    }
    
    // 避免重复的标点符号和空格
    const lastChar = existingBody.charAt(existingBody.length - 1)
    const firstChar = newText.charAt(0)
    
    if (lastChar === firstChar && '.,!?;:'.includes(lastChar)) {
      return false
    }
    
    if (lastChar === ' ' && firstChar === ' ') {
      return false
    }
    
    return true
  }
}
```

#### 使用示例

```typescript
import { createSSEProcessor } from '@/utils/sseDataProcessor'

const processor = createSSEProcessor('chat-123')

// 处理每个数据块
chunks.forEach(chunk => {
  const messages = processor.processChunk(chunk)
  // 更新 UI
  messageList.value = messages
})

// 获取所有消息
const allMessages = processor.getAllMessages()

// 清除数据
processor.clear()
```

### ChatDataAdapter

数据格式适配器，用于在不同数据格式之间转换。

**文件位置**：`utils/chatDataAdapter.uts`

#### 核心功能

```typescript
export class ChatDataAdapter {
  /**
   * 将SSE数据块转换为MsgItem
   */
  static convertSSEChunkToMsgItem(chunk: SSEChunk, chatId: string): MsgItem {
    return {
      _id: chunk.data.id || this.generateId(),
      from_uid: this.getFromUidFromRole(chunk.data.role),
      body: chunk.data.text || '',
      create_time: this.parseTime(chunk.data.time) || Date.now(),
      state: chunk.data.finished ? 3 : 2,
      chat_id: chatId,
      markdownElList: [],
      rendered: false
    }
  }

  /**
   * 处理SSE流式数据，累积文本内容
   */
  static processSSEChunks(chunks: SSEChunk[], chatId: string): MsgItem[] {
    const messageMap = new Map<string, MsgItem>()
    
    chunks.forEach(chunk => {
      const messageId = chunk.data.id
      
      if (!messageMap.has(messageId)) {
        const msgItem = this.convertSSEChunkToMsgItem(chunk, chatId)
        messageMap.set(messageId, msgItem)
      } else {
        const existingMsg = messageMap.get(messageId)!
        existingMsg.body += chunk.data.text || ''
        
        if (chunk.data.finished) {
          existingMsg.state = 3
        }
      }
    })
    
    return Array.from(messageMap.values())
  }
}
```

## 现有示例

### 示例 1：聊天服务中的使用

**文件位置**：`utils/chatService.uts`

```typescript
import { streamRequest } from '@/utils/streamRequest'
import { StreamRequestConfig, StreamChunk } from '@/types/interfaces/chat'

export class ChatService {
  private currentRequest: StreamRequest | null = null
  private isStreaming: boolean = false

  async sendStreamMessage(
    data: any,
    onChunk: (data: string) => void,
    onError: (error: any) => void,
    onComplete: () => void,
    onTimeout?: () => void,
    isTempChat: boolean = false
  ) {
    this.isStreaming = true

    try {
      const apiUrl = isTempChat ? CHAT_API.TEMP_STREAM : CHAT_API.STREAM
      const token = uni.getStorageSync(ACCESS_TOKEN)
      this.currentRequest = new StreamRequest()

      const header = {
        ...API_HEADERS,
      }

      // #ifdef H5 || WEB
      if(process.env.NODE_ENV === 'development'){
        header['Authorization'] = `Bearer ${token}`
      }
      // #endif

      // #ifdef MP-WEIXIN
      header['Authorization'] = `Bearer ${token}`
      // #endif

      await this.currentRequest.request({
        url: apiUrl,
        method: 'POST',
        headers: header,
        body: {
          ...data,
          stream: true
        },
        onChunk: (chunk: StreamChunk) => {
          if (chunk.type === 'content') {
            onChunk(chunk.data)
          }
        },
        onError: (error: any) => {
          this.isStreaming = false
          onError(error)
        },
        onComplete: () => {
          this.isStreaming = false
          onComplete()
        },
        onTimeout: () => {
          this.isStreaming = false
          if (onTimeout) {
            onTimeout()
          }
        }
      })
    } catch (error) {
      this.isStreaming = false
      onError(error)
    }
  }

  abort(): void {
    if (this.currentRequest) {
      this.currentRequest.abort()
      this.currentRequest = null
    }
    this.isStreaming = false
  }
}
```

### 示例 2：在页面中使用

```typescript
<script setup lang="uts">
import { ref } from 'vue'
import { streamRequest } from '@/utils/streamRequest'
import { StreamRequestConfig } from '@/types/interfaces/chat'
import { SSEDataProcessor } from '@/utils/sseDataProcessor'

const messageList = ref<MsgItem[]>([])
const isStreaming = ref(false)
const processor = ref<SSEDataProcessor | null>(null)

// 发送消息
async function sendMessage(content: string) {
  isStreaming.value = true
  processor.value = createSSEProcessor('chat-123')

  const token = uni.getStorageSync(ACCESS_TOKEN)
  
  try {
    await streamRequest.request({
      url: 'https://api.example.com/chat/stream',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: {
        message: content,
        conversationId: 'conv-123',
        stream: true
      },
      onChunk: (chunk) => {
        try {
          // 解析 SSE 数据
          const sseData = JSON.parse(chunk.data)
          
          // 处理数据块
          const messages = processor.value?.processChunk(sseData) || []
          messageList.value = messages
        } catch (error) {
          console.error('解析数据失败:', error)
        }
      },
      onError: (error) => {
        console.error('请求错误:', error)
        uni.showToast({
          title: '请求失败',
          icon: 'none'
        })
        isStreaming.value = false
      },
      onComplete: () => {
        console.log('请求完成')
        isStreaming.value = false
      },
      onTimeout: () => {
        console.log('请求超时')
        uni.showToast({
          title: '请求超时',
          icon: 'none'
        })
        isStreaming.value = false
      }
    })
  } catch (error) {
    console.error('发送消息失败:', error)
    isStreaming.value = false
  }
}

// 中止请求
function abortRequest() {
  streamRequest.abort()
  isStreaming.value = false
}
</script>
```

## 最佳实践

### 1. 错误处理

**推荐方式**：区分不同类型的错误

```typescript
onError: (error: any) => {
  // 网络错误
  if (error.message?.includes('network')) {
    uni.showToast({
      title: '网络错误，请检查网络连接',
      icon: 'none'
    })
    return
  }
  
  // 服务器错误
  if (error.status >= 500) {
    uni.showToast({
      title: '服务器错误，请稍后重试',
      icon: 'none'
    })
    return
  }
  
  // 其他错误
  console.error('请求错误:', error)
  uni.showToast({
    title: error.message || '请求失败',
    icon: 'none'
  })
}
```

### 2. 超时处理

**推荐方式**：小程序端设置合理的超时回调

```typescript
onTimeout: () => {
  // 显示提示
  uni.showToast({
    title: '请求超时，已自动断开',
    icon: 'none',
    duration: 2000
  })
  
  // 清理状态
  isStreaming.value = false
  
  // 可选：重试机制
  // retryRequest()
}
```

### 3. 数据累积

**推荐方式**：使用 SSEDataProcessor 处理数据累积

```typescript
const processor = createSSEProcessor(chatId)

onChunk: (chunk) => {
  try {
    const sseData = JSON.parse(chunk.data)
    const messages = processor.processChunk(sseData)
    messageList.value = messages
  } catch (error) {
    console.error('处理数据失败:', error)
  }
}
```

### 4. 请求中止

**推荐方式**：在组件卸载时清理请求

```typescript
import { onUnmounted } from 'vue'

onUnmounted(() => {
  // 组件卸载时中止请求
  streamRequest.abort()
})
```

### 5. 内存管理

**推荐方式**：及时清理处理器数据

```typescript
onComplete: () => {
  // 请求完成后清理
  processor.value?.clear()
  processor.value = null
  isStreaming.value = false
}
```

### 6. 状态管理

**推荐方式**：使用响应式状态管理请求状态

```typescript
const isStreaming = ref(false)
const errorMessage = ref<string | null>(null)

// 在请求开始时重置状态
async function startRequest() {
  isStreaming.value = true
  errorMessage.value = null
  
  try {
    await streamRequest.request(config)
  } catch (error) {
    errorMessage.value = error.message
  } finally {
    isStreaming.value = false
  }
}
```

## 常见问题

### Q1: H5 端连接失败怎么办？

**A**: 检查以下几点：

1. **Fragment 参数**：确认服务端支持 `fragment` 请求头
2. **CORS 配置**：确认服务端已配置正确的 CORS 头
3. **Content-Type**：确认请求头包含 `Content-Type: application/json`
4. **网络连接**：检查网络连接是否正常

```typescript
// 检查连接状态
onOpen: (response) => {
  console.log('连接状态:', response.status)
  if (response.status >= 400) {
    console.error('连接失败:', response.statusText)
  }
}
```

### Q2: 小程序端数据乱码怎么办？

**A**: 确保正确使用 UTF-8 解码：

```typescript
// StreamRequest 已自动处理 UTF-8 解码
// 如果仍有问题，检查服务端编码
```

### Q3: 如何实现自动重连？

**A**: H5 端 `fetch-event-source` 已内置自动重连。小程序和 App 端需要手动实现：

```typescript
let retryCount = 0
const MAX_RETRIES = 3

async function requestWithRetry(config: StreamRequestConfig) {
  try {
    await streamRequest.request(config)
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      retryCount++
      console.log(`重试第 ${retryCount} 次...`)
      setTimeout(() => {
        requestWithRetry(config)
      }, 1000 * retryCount) // 指数退避
    } else {
      console.error('重试次数已达上限')
    }
  }
}
```

### Q4: 如何处理大量数据？

**A**: 使用数据处理器进行分批处理：

```typescript
const processor = createSSEProcessor(chatId)
let batchSize = 0

onChunk: (chunk) => {
  const sseData = JSON.parse(chunk.data)
  processor.processChunk(sseData)
  
  batchSize++
  // 每 10 个数据块更新一次 UI
  if (batchSize >= 10) {
    messageList.value = processor.getAllMessages()
    batchSize = 0
  }
}

onComplete: () => {
  // 最后更新一次
  messageList.value = processor.getAllMessages()
}
```

### Q5: 如何调试 SSE 连接？

**A**: 使用以下方法：

```typescript
// 1. 启用详细日志
onOpen: (response) => {
  console.log('[SSE] 连接已建立:', response)
}

onChunk: (chunk) => {
  console.log('[SSE] 收到数据:', chunk)
}

onError: (error) => {
  console.error('[SSE] 错误:', error)
}

onComplete: () => {
  console.log('[SSE] 请求完成')
}

// 2. 检查网络请求（浏览器开发者工具）
// 3. 使用 uni.request 的调试功能
```

### Q6: 小程序端超时时间如何设置？

**A**: 在 `requestWeapp` 方法中设置：

```typescript
this.requestTask = uni.request({
  // ...
  timeout: 1000 * 60 * 60 * 12, // 12 小时
  // ...
})
```

注意：超时监控是独立的，60 秒内无数据流动会触发 `onTimeout` 回调。

### Q7: 如何避免重复数据？

**A**: 使用 SSEDataProcessor 的智能去重功能：

```typescript
const processor = createSSEProcessor(chatId)

// processor 内部已实现去重逻辑
// 会自动检查并跳过重复内容
```

## 总结

通过本指南，你可以：

1. ✅ **理解 SSE 实现原理**：了解 H5、小程序、App 三端的实现差异
2. ✅ **快速上手**：学会如何使用 StreamRequest 发起流式请求
3. ✅ **深入实现**：理解数据处理器和适配器的工作原理
4. ✅ **遵循最佳实践**：编写高质量的流式请求代码
5. ✅ **解决常见问题**：快速定位和修复错误

### 核心要点

- **统一接口**：`StreamRequest` 提供统一的接口，自动适配不同平台
- **错误处理**：完善的错误处理和超时监控机制
- **数据累积**：使用 `SSEDataProcessor` 处理流式数据累积
- **UTF-8 支持**：小程序端正确处理多字节字符
- **类型安全**：完整的 TypeScript 类型定义

### 参考资源

- [uni-app 官方文档](https://uniapp.dcloud.net.cn/)
- [Server-Sent Events 规范](https://developer.mozilla.org/zh-CN/docs/Web/API/Server-sent_events)
- [fetch-event-source 文档](https://github.com/Azure/fetch-event-source)

---

**维护者**：开发团队

如有问题或建议，请联系开发团队或提交 Issue。