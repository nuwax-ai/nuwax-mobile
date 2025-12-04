import { ChatMessage, StreamChunk } from '@/types/interfaces/chat'
import { StreamRequest } from '@/utils/streamRequest'
import { CHAT_API, API_HEADERS } from '@/constants/api.constants'
import { ACCESS_TOKEN } from '@/constants/home.constants'

// 聊天服务类
export class ChatService {
  private currentRequest: any = null
  private isStreaming: boolean = false

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

      await this.currentRequest.request({
        url: apiUrl,
        method: 'POST',
        headers: header,
        body: {
          ...data,
          // conversationId: 1442734, //TODO 调试 先写死 后面一定删除
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

  // 中止当前请求
  abort(): void {
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
