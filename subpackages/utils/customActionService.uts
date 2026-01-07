/**
 * 统一的自定义操作服务
 * 管理所有自定义元素的交互事件：打开预览、远程桌面、刷新文件树、打开页面等
 * 
 * 设计参考 PC端: src/models/conversationInfo.ts
 * - openPreviewView: 打开预览视图，设置viewMode为'preview'，显示文件树，刷新文件列表
 * - openDesktopView: 打开远程桌面视图，设置viewMode为'desktop'，启动容器，启动保活
 * - handleRefreshFileList: 刷新文件列表，调用apiGetStaticFileList
 * 
 * 详细接入文档请参考: integration_guide.md
 */

import { API_BASE_URL } from '@/constants/config'

/**
 * 事件类型枚举（对应PC端 EVENT_TYPE）
 */
export enum CustomEventType {
  /** 刷新文件列表 */
  REFRESH_FILE_LIST = 'custom_action_refresh_file_list',
  /** 打开预览视图 */
  OPEN_PREVIEW = 'custom_action_open_preview',
  /** 打开远程桌面 */
  OPEN_DESKTOP = 'custom_action_open_desktop',
  /** 打开扩展页面 */
  OPEN_PAGE = 'custom_action_open_page',
  /** 打开外部链接 */
  OPEN_LINK = 'custom_action_open_link',
}

/**
 * 视图模式枚举（对应PC端 viewMode）
 */
export enum ViewModeEnum {
  /** 预览模式 */
  PREVIEW = 'preview',
  /** 远程桌面模式 */
  DESKTOP = 'desktop',
}

/**
 * 操作类型枚举
 */
export enum CustomActionType {
  /** 打开预览视图（文件预览模式） */
  OPEN_PREVIEW = 'OPEN_PREVIEW',
  /** 打开远程桌面视图 */
  OPEN_DESKTOP = 'OPEN_DESKTOP',
  /** 刷新文件树 */
  REFRESH_FILE_LIST = 'REFRESH_FILE_LIST',
  /** 打开扩展页面（iframe/webview） */
  OPEN_PAGE = 'OPEN_PAGE',
  /** 打开外部链接 */
  OPEN_LINK = 'OPEN_LINK',
}

/**
 * 操作参数接口
 */
export interface CustomActionParams {
  type: CustomActionType
  conversationId?: string
  uri?: string
  params?: Record<string, any>
  method?: string
  dataType?: string
  requestId?: string
}

/**
 * 页面预览选项
 */
export interface OpenPageOptions {
  uri: string
  params?: Record<string, any>
  method?: string
  dataType?: string
  requestId?: string
}

/**
 * 打开预览事件数据（对应PC端 openPreviewView 逻辑）
 */
export interface OpenPreviewEventData {
  conversationId: string
  viewMode: ViewModeEnum
}

/**
 * 打开远程桌面事件数据（对应PC端 openDesktopView 逻辑）
 */
export interface OpenDesktopEventData {
  conversationId: string
  viewMode: ViewModeEnum
}

/**
 * 刷新文件列表事件数据（对应PC端 handleRefreshFileList 逻辑）
 */
export interface RefreshFileListEventData {
  conversationId: string
}

/**
 * 打开页面事件数据
 */
export interface OpenPageEventData {
  uri: string
  method: string
  dataType: string
  requestId: string
}

/**
 * 统一的自定义操作服务类
 * 
 * 使用示例：
 * - CustomActionService.openPreviewView(conversationId) // 打开预览视图
 * - CustomActionService.openDesktopView(conversationId) // 打开远程桌面
 * - CustomActionService.refreshFileList(conversationId) // 刷新文件树
 * - CustomActionService.openPage({ uri: '/page/index', params: { id: 1 } }) // 打开扩展页面
 * - CustomActionService.openLink('https://example.com') // 打开外部链接
 * 
 * 事件监听示例：
 * uni.$on(CustomEventType.OPEN_PREVIEW, (data: OpenPreviewEventData) => { ... })
 * uni.$on(CustomEventType.REFRESH_FILE_LIST, (data: RefreshFileListEventData) => { ... })
 */
export class CustomActionService {
  /**
   * 打开预览视图
   * 对应PC端 openPreviewView 方法
   * 切换到文件预览模式并刷新文件列表
   * @param conversationId 会话ID
   */
  static openPreviewView(conversationId: string): void {
    if (!conversationId) {
      console.warn('[CustomActionService] openPreviewView: conversationId is required')
      return
    }
    
    // 移除 chat- 前缀
    const idStr = String(conversationId)
    const cid = idStr.startsWith('chat-') ? idStr.replace('chat-', '') : idStr
    
    console.log('[CustomActionService] openPreviewView:', cid)
    
    // 发送打开预览视图事件（对应PC端 setViewMode('preview') + setIsFileTreeVisible(true)）
    const eventData: OpenPreviewEventData = {
      conversationId: cid,
      viewMode: ViewModeEnum.PREVIEW
    }
    console.log('[CustomActionService] Action: OPEN_PREVIEW, Params:', { conversationId })
    uni.$emit(CustomEventType.OPEN_PREVIEW, eventData)
    
    // 触发文件列表刷新（对应PC端 eventBus.emit(EVENT_TYPE.RefreshFileList, cId)）
    this.refreshFileList(conversationId)
  }
  
  /**
   * 打开远程桌面视图
   * 对应PC端 openDesktopView 方法
   * 切换到远程桌面模式并启动VNC连接
   * @param conversationId 会话ID
   */
  static openDesktopView(conversationId: string): void {
    if (!conversationId) {
      console.warn('[CustomActionService] openDesktopView: conversationId is required')
      return
    }
    
    // 移除 chat- 前缀
    const idStr = String(conversationId)
    const cid = idStr.startsWith('chat-') ? idStr.replace('chat-', '') : idStr
    
    console.log('[CustomActionService] openDesktopView:', cid)
    
    // 发送打开远程桌面事件（对应PC端 setViewMode('desktop') + setIsFileTreeVisible(true) + apiEnsurePod）
    const eventData: OpenDesktopEventData = {
      conversationId: cid,
      viewMode: ViewModeEnum.DESKTOP
    }
    console.log('[CustomActionService] Action: OPEN_DESKTOP, Params:', { conversationId })
    uni.$emit(CustomEventType.OPEN_DESKTOP, eventData)
  }
  
  /**
   * 刷新文件树
   * 对应PC端 handleRefreshFileList 方法
   * 重新获取会话相关的文件列表
   * @param conversationId 会话ID
   */
  static refreshFileList(conversationId: string): void {
    if (!conversationId) {
      console.warn('[CustomActionService] refreshFileList: conversationId is required')
      return
    }
    
    // 移除 chat- 前缀
    const idStr = String(conversationId)
    const cid = idStr.startsWith('chat-') ? idStr.replace('chat-', '') : idStr
    
    console.log('[CustomActionService] refreshFileList:', cid)
    
    // 发送刷新文件列表事件（对应PC端 runGetStaticFileList(targetId)）
    const eventData: RefreshFileListEventData = {
      conversationId: cid
    }
    console.log('[CustomActionService] Emitting REFRESH_FILE_LIST event:', eventData)
    // uni.$emit(CustomEventType.REFRESH_FILE_LIST, eventData)
    uni.$emit('refreshFileList', cid)
  }
  
  /**
   * 打开扩展页面
   * 在iframe或webview中打开指定页面
   * @param options 页面选项
   */
  static openPage(options: OpenPageOptions): void {
    if (!options.uri) {
      console.warn('[CustomActionService] openPage: uri is required')
      return
    }
    
    console.log('[CustomActionService] openPage:', options)
    
    // 构建完整的URL
    let fullUri = options.uri
    if (options.params && Object.keys(options.params).length > 0) {
      const queryString = Object.entries(options.params)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&')
      fullUri = `${fullUri}${fullUri.includes('?') ? '&' : '?'}${queryString}`
    }
    
    // 发送打开页面事件
    const eventData: OpenPageEventData = {
      uri: fullUri,
      method: options.method || 'browser_open_page',
      dataType: options.dataType || 'html',
      requestId: options.requestId || ''
    }
    console.log('[CustomActionService] Action: OPEN_PAGE, Params:', { uri: fullUri, method: eventData.method })
    uni.$emit(CustomEventType.OPEN_PAGE, eventData)
  }
  
  /**
   * 打开外部链接
   * 在新窗口或跳转页面打开链接
   * @param uri 链接地址
   * @param params 查询参数
   */
  static openLink(uri: string, params?: Record<string, any>): void {
    if (!uri) {
      console.warn('[CustomActionService] openLink: uri is required')
      return
    }
    
    console.log('[CustomActionService] openLink:', uri, params)
    
    // 构建完整的URL
    let fullUri = uri
    if (params && Object.keys(params).length > 0) {
      const queryString = Object.entries(params)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&')
      fullUri = `${fullUri}${fullUri.includes('?') ? '&' : '?'}${queryString}`
    }
    
    // #ifdef H5 || WEB
    window.open(fullUri, '_blank')
    // #endif
    
    // #ifdef MP-WEIXIN
    // 小程序环境下使用webview打开
    uni.navigateTo({
      url: `/subpackages/pages/common/webview/webview?url=${encodeURIComponent(fullUri)}`
    })
    // #endif
    
    // 同时发送事件，允许页面自定义处理
    console.log('[CustomActionService] Action: OPEN_LINK, Params:', { uri: fullUri })
    uni.$emit(CustomEventType.OPEN_LINK, { uri: fullUri })
  }
  
  /**
   * 统一的动作分发器
   * 根据动作类型调用相应的处理方法
   * @param action 动作参数
   */
  static dispatch(action: CustomActionParams): void {
    if (!action || !action.type) {
      console.warn('[CustomActionService] dispatch: action type is required')
      return
    }
    
    console.log('[CustomActionService] dispatch:', action.type, action)
    
    switch (action.type) {
      case CustomActionType.OPEN_PREVIEW:
        if (action.conversationId) {
          this.openPreviewView(action.conversationId)
        }
        break
        
      case CustomActionType.OPEN_DESKTOP:
        if (action.conversationId) {
          this.openDesktopView(action.conversationId)
        }
        break
        
      case CustomActionType.REFRESH_FILE_LIST:
        if (action.conversationId) {
          this.refreshFileList(action.conversationId)
        }
        break
        
      case CustomActionType.OPEN_PAGE:
        if (action.uri) {
          this.openPage({
            uri: action.uri,
            params: action.params,
            method: action.method,
            dataType: action.dataType,
            requestId: action.requestId
          })
        }
        break
        
      case CustomActionType.OPEN_LINK:
        if (action.uri) {
          this.openLink(action.uri, action.params)
        }
        break
        
      default:
        console.warn('[CustomActionService] dispatch: unknown action type:', action.type)
    }
  }
}

// 导出事件类型，方便外部监听
export { CustomEventType as EVENT_TYPE }

// 导出默认实例方法，方便使用
export const openPreviewView = CustomActionService.openPreviewView.bind(CustomActionService)
export const openDesktopView = CustomActionService.openDesktopView.bind(CustomActionService)
export const refreshFileList = CustomActionService.refreshFileList.bind(CustomActionService)
export const openPage = CustomActionService.openPage.bind(CustomActionService)
export const openLink = CustomActionService.openLink.bind(CustomActionService)
export const dispatchAction = CustomActionService.dispatch.bind(CustomActionService)
