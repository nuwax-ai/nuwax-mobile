# 移动端 Agent 组件接入指南

本文档说明如何在移动端接入文件树、远程桌面和文件预览组件，以配合 `CustomActionService` 和 `AgentDetailService` 完成 Agent 完整能力的落地。

## 1. 架构概述

移动端采用了与 PC 端一致的事件驱动架构：
- **消息层** (`AgentDetailService`): 解析后端流式消息，自动触发 `OPEN_DESKTOP` (事件) 和 `REFRESH_FILE_LIST` (工具调用)。
- **交互层** (`task-result`): 用户点击任务结果时，触发 `OPEN_PREVIEW`。
- **中枢层** (`CustomActionService`): 统一分发事件。
- **UI 层** (待接入): 监听事件并做出响应（如弹出抽屉、跳转页面）。

## 2. 核心事件监听

在你的聊天页面（如 `chat-conversation-component.uvue`）或全局布局中，监听以下事件：

```typescript
import { CustomEventType, OpenPreviewEventData, OpenDesktopEventData, RefreshFileListEventData } from '@/utils/customActionService.uts'

export default {
  onLoad() {
    // 1. 监听打开文件预览/文件树
    uni.$on(CustomEventType.OPEN_PREVIEW, (data: OpenPreviewEventData) => {
      console.log('收到打开预览请求:', data.conversationId)
      // TODO: 打开文件树抽屉/侧边栏
      // this.showFileTreeDrawer = true
      // this.currentViewMode = 'preview'
      // this.fetchFileList(data.conversationId)
    })

    // 2. 监听打开远程桌面
    uni.$on(CustomEventType.OPEN_DESKTOP, (data: OpenDesktopEventData) => {
      console.log('收到打开远程桌面请求:', data.conversationId)
      // TODO: 显示远程桌面组件/跳转远程桌面页面
      // this.showDesktopView = true
      // this.currentViewMode = 'desktop'
      // this.connectVNC(data.conversationId)
    })

    // 3. 监听刷新文件列表
    uni.$on(CustomEventType.REFRESH_FILE_LIST, (data: RefreshFileListEventData) => {
      console.log('收到刷新文件列表请求:', data.conversationId)
      // TODO: 如果当前文件树是打开的，重新获取文件列表
      // if (this.showFileTreeDrawer) {
      //   this.fetchFileList(data.conversationId)
      // }
    })
  },
  
  onUnload() {
    // 记得移除监听
    uni.$off(CustomEventType.OPEN_PREVIEW)
    uni.$off(CustomEventType.OPEN_DESKTOP)
    uni.$off(CustomEventType.REFRESH_FILE_LIST)
  }
}
```

## 3. UI 组件接入要求

### 3.1 文件树组件 (File Tree)
- **触发时机**: 收到 `OPEN_PREVIEW` 或用户主动点击文件图标。
- **功能要求**:
  - 根据 `conversationId` 调用后端 API 获取文件列表。
  - 收到 `REFRESH_FILE_LIST` 事件时自动刷新。
  - 点击文件项时，调用 `CustomActionService.openPage` 或内部逻辑进行预览。

### 3.2 远程桌面组件 (Remote Desktop)
- **触发时机**: 收到 `OPEN_DESKTOP` 或用户主动切换。
- **功能要求**:
  - 建立 VNC 连接（这通常需要特定的 VNC 客户端组件或 WebView 方案）。
  - 处理容器保活（Keep-alive）。
  - 支持键盘输入和触摸手势映射。

### 3.3 文件预览组件 (Preview)
- **触发时机**: 用户在文件树中点击文件。
- **功能要求**:
  - 根据文件类型（图片、Markdown、代码、HTML）渲染不同内容。
  - 对于 HTML/Web 应用，建议使用 `webview` 并通过 `CustomActionService.openPage` 打开。

## 4. 调试方法

你可以手动调用 `CustomActionService` 来模拟触发，测试 UI 响应：

```typescript
import { CustomActionService } from '@/utils/customActionService.uts'

// 模拟打开预览
CustomActionService.openPreviewView(123)

// 模拟打开远程桌面
CustomActionService.openDesktopView(123)
```

## 5. 常见问题

- **Q: `task-result` 点击无反应？**
  - A: 检查是否传入了 `conversationId`。如果没有 `conversationId`，`task-result` 会降级发出 `task_result_click` 事件，你需要手动处理该事件。
  
- **Q: 样式不符合预期？**
  - A: `task-result` 和 `Plan` 的样式已内置在组件中，如需全局调整，请修改 `uni_modules/mp-html` 下的相关文件。
