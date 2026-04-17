/**
 * 模拟后端API服务
 * 用于语音转文字功能的模拟接口实现
 */

// API响应接口
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
  timestamp: number
}

// 语音转文字请求参数
export interface VoiceToTextRequest {
  audio: any              // 音频文件
  format: string          // 音频格式
  duration: number        // 音频时长(秒)
  language?: string       // 语言类型
  userId?: string         // 用户ID
}

// 语音转文字响应数据
export interface VoiceToTextResponse {
  text: string            // 转换后的文本
  confidence: number      // 识别置信度 (0-1)
  duration: number        // 音频时长
  segments?: Array<{      // 分段结果
    text: string
    start: number
    end: number
    confidence: number
  }>
}

/**
 * 模拟API服务类
 */
export class MockApiService {
  private static instance: MockApiService
  private requestDelay: number = 1500 // 模拟网络延迟
  private successRate: number = 0.95  // 成功率
  
  // 预设的模拟文本库
  private mockTexts = {
    short: [
      "你好",
      "谢谢", 
      "再见",
      "是的",
      "不是",
      "好的",
      "没问题",
      "可以"
    ],
    medium: [
      "这是一段测试语音",
      "语音识别功能正常",
      "请检查录音质量",
      "系统运行正常",
      "欢迎使用语音功能",
      "录音测试成功",
      "语音转文字完成"
    ],
    long: [
      "这是一段较长的语音转文字测试内容，用于验证系统的识别能力",
      "人工智能语音识别技术在近年来取得了重大突破，准确率不断提升",
      "语音交互将成为未来人机交互的重要方式，应用前景非常广阔",
      "通过深度学习和神经网络技术，语音识别系统能够更好地理解人类语言",
      "语音转文字功能在智能客服、会议记录、语音助手等场景中发挥重要作用"
    ]
  }
  
  // 错误类型库
  private errorTypes = [
    {
      code: 'NETWORK_ERROR',
      message: '网络连接异常，请检查网络设置'
    },
    {
      code: 'AUDIO_QUALITY_LOW',
      message: '音频质量较低，识别结果可能不准确'
    },
    {
      code: 'SERVER_BUSY',
      message: '服务器繁忙，请稍后重试'
    },
    {
      code: 'FORMAT_NOT_SUPPORTED',
      message: '音频格式不支持，请使用标准格式'
    },
    {
      code: 'DURATION_TOO_SHORT',
      message: '音频时长过短，无法识别'
    },
    {
      code: 'LANGUAGE_NOT_SUPPORTED',
      message: '不支持的语言类型'
    }
  ]
  
  private constructor() {}
  
  /**
   * 获取单例实例
   */
  static getInstance(): MockApiService {
    if (!MockApiService.instance) {
      MockApiService.instance = new MockApiService()
    }
    return MockApiService.instance
  }
  
  /**
   * 语音转文字接口
   */
  async voiceToText(request: VoiceToTextRequest): Promise<ApiResponse<VoiceToTextResponse>> {
    // 参数验证
    const validationError = this.validateRequest(request)
    if (validationError) {
      return this.createErrorResponse(validationError.code, validationError.message)
    }
    
    // 模拟网络延迟
    await this.delay(this.requestDelay + Math.random() * 1000)
    
    // 模拟请求失败
    if (Math.random() > this.successRate) {
      const randomError = this.errorTypes[Math.floor(Math.random() * this.errorTypes.length)]
      return this.createErrorResponse(randomError.code, randomError.message)
    }
    
    // 生成模拟结果
    const result = this.generateMockResult(request)
    
    return this.createSuccessResponse(result)
  }
  
  /**
   * 验证请求参数
   */
  private validateRequest(request: VoiceToTextRequest): { code: string, message: string } | null {
    if (!request.audio) {
      return { code: 'MISSING_AUDIO', message: '音频文件不能为空' }
    }
    
    if (request.duration < 0.5) {
      return { code: 'DURATION_TOO_SHORT', message: '音频时长过短，至少需要0.5秒' }
    }
    
    if (request.duration > 600) {
      return { code: 'DURATION_TOO_LONG', message: '音频时长过长，最多支持10分钟' }
    }
    
    const supportedFormats = ['mp3', 'wav', 'aac', 'PCM', 'webm']
    if (!supportedFormats.includes(request.format?.toLowerCase())) {
      return { code: 'FORMAT_NOT_SUPPORTED', message: '不支持的音频格式' }
    }
    
    return null
  }
  
  /**
   * 生成模拟识别结果
   */
  private generateMockResult(request: VoiceToTextRequest): VoiceToTextResponse {
    const duration = request.duration
    let selectedText: string
    
    // 根据音频时长选择合适的文本
    if (duration < 2) {
      selectedText = this.mockTexts.short[Math.floor(Math.random() * this.mockTexts.short.length)]
    } else if (duration < 8) {
      selectedText = this.mockTexts.medium[Math.floor(Math.random() * this.mockTexts.medium.length)]
    } else {
      selectedText = this.mockTexts.long[Math.floor(Math.random() * this.mockTexts.long.length)]
    }
    
    // 根据语言类型调整文本
    if (request.language === 'en-US') {
      selectedText = this.translateToEnglish(selectedText)
    }
    
    // 生成置信度 (时长越长，置信度可能越低)
    let baseConfidence = 0.95
    if (duration > 30) {
      baseConfidence = 0.85
    } else if (duration > 60) {
      baseConfidence = 0.80
    }
    
    const confidence = baseConfidence - Math.random() * 0.15
    
    return {
      text: selectedText,
      confidence: Math.max(0.60, confidence),
      duration: duration,
      segments: this.generateSegments(selectedText, duration)
    }
  }
  
  /**
   * 简单的中英文翻译（模拟）
   */
  private translateToEnglish(chineseText: string): string {
    const translations: Record<string, string> = {
      '你好': 'Hello',
      '谢谢': 'Thank you',
      '再见': 'Goodbye',
      '是的': 'Yes',
      '不是': 'No',
      '好的': 'OK',
      '没问题': 'No problem',
      '可以': 'Sure',
      '这是一段测试语音': 'This is a test voice',
      '语音识别功能正常': 'Voice recognition is working',
      '请检查录音质量': 'Please check recording quality',
      '系统运行正常': 'System is running normally',
      '欢迎使用语音功能': 'Welcome to use voice function',
      '录音测试成功': 'Recording test successful',
      '语音转文字完成': 'Speech to text completed'
    }
    
    return translations[chineseText] || 'This is a voice recognition test'
  }
  
  /**
   * 生成分段结果
   */
  private generateSegments(text: string, duration: number): Array<{
    text: string
    start: number
    end: number
    confidence: number
  }> {
    const segments = []
    const words = text.split('')
    const avgTimePerChar = duration / words.length
    
    let currentTime = 0
    let currentSegment = ''
    const segmentLength = Math.max(1, Math.floor(words.length / Math.max(1, Math.floor(duration / 3))))
    
    for (let i = 0; i < words.length; i++) {
      currentSegment += words[i]
      
      if (currentSegment.length >= segmentLength || i === words.length - 1) {
        const segmentDuration = currentSegment.length * avgTimePerChar
        
        segments.push({
          text: currentSegment,
          start: currentTime,
          end: currentTime + segmentDuration,
          confidence: 0.70 + Math.random() * 0.30
        })
        
        currentTime += segmentDuration
        currentSegment = ''
      }
    }
    
    return segments
  }
  
  /**
   * 创建成功响应
   */
  private createSuccessResponse<T>(data: T): ApiResponse<T> {
    return {
      success: true,
      data,
      timestamp: Date.now()
    }
  }
  
  /**
   * 创建错误响应
   */
  private createErrorResponse(code: string, message: string): ApiResponse {
    return {
      success: false,
      error: {
        code,
        message
      },
      timestamp: Date.now()
    }
  }
  
  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
  
  /**
   * 设置请求延迟
   */
  setRequestDelay(delay: number): void {
    this.requestDelay = Math.max(0, delay)
  }
  
  /**
   * 设置成功率
   */
  setSuccessRate(rate: number): void {
    this.successRate = Math.max(0, Math.min(1, rate))
  }
  
  /**
   * 添加自定义文本
   */
  addMockText(category: 'short' | 'medium' | 'long', text: string): void {
    this.mockTexts[category].push(text)
  }
  
  /**
   * 添加自定义错误类型
   */
  addErrorType(code: string, message: string): void {
    this.errorTypes.push({ code, message })
  }
}

/**
 * API客户端类
 * 用于统一管理API调用
 */
export class ApiClient {
  private baseUrl: string = ''
  private timeout: number = 30000
  private mockService: MockApiService
  
  constructor(baseUrl: string = '', useMock: boolean = true) {
    this.baseUrl = baseUrl
    this.mockService = MockApiService.getInstance()
    
    // 如果没有提供baseUrl或者明确使用模拟服务，则使用模拟服务
    if (!baseUrl || useMock) {
      console.log('使用模拟API服务')
    }
  }
  
  /**
   * 语音转文字接口调用
   */
  async voiceToText(audioFile: any, options: {
    format: string
    duration: number
    language?: string
    userId?: string
  }): Promise<ApiResponse<VoiceToTextResponse>> {
    
    // 如果没有配置真实API地址，使用模拟服务
    if (!this.baseUrl) {
      return this.mockService.voiceToText({
        audio: audioFile,
        format: options.format,
        duration: options.duration,
        language: options.language || 'zh-CN',
        userId: options.userId
      })
    }
    
    // 真实API调用实现
    return this.realApiCall(audioFile, options)
  }
  
  /**
   * 真实API调用
   */
  private async realApiCall(audioFile: any, options: any): Promise<ApiResponse<VoiceToTextResponse>> {
    try {
      const response = await uni.request({
        url: `${this.baseUrl}/api/voice-to-text`,
        method: 'POST',
        data: {
          audio: audioFile,
          format: options.format,
          duration: options.duration,
          language: options.language || 'zh-CN',
          userId: options.userId
        },
        timeout: this.timeout,
        header: {
          'Content-Type': 'application/json'
        }
      })
      
      if (response.statusCode === 200) {
        return response.data as ApiResponse<VoiceToTextResponse>
      } else {
        throw new Error(`API调用失败，状态码: ${response.statusCode}`)
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'API_ERROR',
          message: error.message || 'API调用失败'
        },
        timestamp: Date.now()
      }
    }
  }
  
  /**
   * 设置超时时间
   */
  setTimeout(timeout: number): void {
    this.timeout = timeout
  }
  
  /**
   * 获取模拟服务实例
   */
  getMockService(): MockApiService {
    return this.mockService
  }
}

/**
 * 创建API客户端实例
 */
export function createApiClient(baseUrl?: string, useMock: boolean = true): ApiClient {
  return new ApiClient(baseUrl, useMock)
}

/**
 * 默认API客户端实例
 */
export const defaultApiClient = createApiClient()

/**
 * 便捷的语音转文字函数
 */
export async function convertVoiceToText(
  audioFile: any,
  options: {
    format: string
    duration: number
    language?: string
    userId?: string
  }
): Promise<string> {
  try {
    const response = await defaultApiClient.voiceToText(audioFile, options)
    
    if (response.success && response.data) {
      return response.data.text
    } else {
      throw new Error(response.error?.message || '语音转换失败')
    }
  } catch (error: any) {
    console.error('语音转文字失败:', error)
    throw error
  }
}

// 导出模拟服务实例
export const mockApiService = MockApiService.getInstance()