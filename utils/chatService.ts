import { ChatMessage, StreamChunk } from '@/types/interfaces/chat'
import { StreamRequest } from '@/utils/streamRequest'
import { CHAT_API, API_HEADERS } from '@/constants/api.constants'
import { ACCESS_TOKEN } from '@/constants/home.constants'

interface AppSSEClient {
  startChat: (config: {
    url: string
    headers?: Record<string, string>
    method?: string
    body?: Record<string, any>
  }) => void
  stopChat: () => void
}

interface StreamCallbacks {
  onChunk: (chunk: string) => void
  onComplete: () => void
  onError: (error: any) => void
}

// 聊天服务类
export class ChatService {
  private currentRequest: any = null
  private isStreaming: boolean = false
  private appSSEClient: AppSSEClient | null = null
  private appStreamCallbacks: StreamCallbacks | null = null

  /**
   * 注册/清理 APP 端 SSE 插件实例。
   * 页面 onMounted 时注册，onUnmounted 时置空，避免悬挂引用。
   */
  setAppSSEClient(client: AppSSEClient | null): void {
    this.appSSEClient = client
  }

  /**
   * 处理 APP 插件的消息事件并转发到统一流式回调。
   * 插件已按 SSE 协议分帧，这里只做最小过滤与分发。
   */
  handleAppSSEMessage(message: { data?: string }): void {
    if (!this.appStreamCallbacks) return
    const chunk = typeof message?.data === 'string' ? message.data : ''
    if (!chunk || chunk === '[DONE]') return
    this.appStreamCallbacks.onChunk(chunk)
  }

  /**
   * 处理 APP 插件错误事件，统一收口到 sendMessage 的 onError。
   */
  handleAppSSEError(error: any): void {
    if (!this.appStreamCallbacks) return
    const { onError } = this.appStreamCallbacks
    this.appStreamCallbacks = null
    this.isStreaming = false
    onError(error)
  }

  /**
   * 处理 APP 插件结束事件，统一收口到 sendMessage 的 onComplete。
   */
  handleAppSSEFinish(): void {
    if (!this.appStreamCallbacks) return
    const { onComplete } = this.appStreamCallbacks
    this.appStreamCallbacks = null
    this.isStreaming = false
    onComplete()
  }

  // 发送消息并获取流式响应
  async sendMessage(
    data: any,
    onChunk: (chunk: string) => void,
    onComplete: () => void,
    onError: (error: any) => void,
    // 是否是临时会话
    isTempChat?: boolean = false,
    // 超时回调（微信小程序专用，60秒内无数据流动时触发）
    onTimeout?: () => void
  ): Promise<void> {
    // if (this.isStreaming) {
    //   onError(new Error('已有请求正在进行中'))
    //   return
    // }

    this.isStreaming = true

    try {
      // 使用配置的API端点
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

      // #ifdef APP
      header['Authorization'] = `Bearer ${token}`
      // #endif

      const requestBody = {
        ...data,
        stream: true
      }

      // #ifdef APP
      // APP 端优先走 gao-ChatSSEClient，规避原生 request 在流式场景的不稳定行为。
      if (this.appSSEClient) {
        this.appStreamCallbacks = {
          onChunk,
          onComplete: () => {
            this.isStreaming = false
            onComplete()
          },
          onError: (error: any) => {
            this.isStreaming = false
            onError(error)
          }
        }
        this.currentRequest = {
          abort: () => {
            this.appSSEClient?.stopChat()
          }
        }
        this.appSSEClient.startChat({
          url: apiUrl,
          method: 'POST',
          headers: header,
          body: requestBody
        })
        return
      }
      // #endif

      // H5/WEB/小程序仍使用原有 StreamRequest 逻辑。
      await this.currentRequest.request({
        url: apiUrl,
        method: 'POST',
        headers: header,
        body: requestBody,
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

  // 中止当前请求
  abort(): void {
    // 先清理 APP 回调引用，防止 stop 后插件异步回调再次写入状态。
    this.appStreamCallbacks = null
    if (this.currentRequest) {
      this.currentRequest.abort()
      this.currentRequest = null
    }
    this.isStreaming = false
  }

  // 创建用户消息
  createUserMessage(content: string): ChatMessage {
    return {
      id: this.generateId(),
      role: 'user',
      content: content,
      timestamp: Date.now(),
      status: 'sent'
    }
  }

  // 创建AI消息
  createAIMessage(content: string = ''): ChatMessage {
    return {
      id: this.generateId(),
      role: 'assistant',
      content: content,
      timestamp: Date.now(),
      status: 'processing'
    }
  }

  // 更新AI消息内容
  updateAIMessage(message: ChatMessage, content: string): void {
    message.content = content
  }

  // 完成AI消息
  completeAIMessage(message: ChatMessage): void {
    message.status = 'sent'
    message.rendered = true
  }

  // 设置消息错误
  setMessageError(message: ChatMessage, error: string): void {
    message.status = 'error'
    message.error = error
  }

  // 生成唯一ID
  private generateId(): string {
    return 'msg_' + Date.now().toString(36) + Math.random().toString(36).substr(2)
  }

  // 检查是否正在流式传输
  get isCurrentlyStreaming(): boolean {
    return this.isStreaming
  }
}

// 创建聊天服务实例
export const chatService = new ChatService()
