# 移动端 Agent 组件接入指南

本文档说明移动端文件树刷新与相关 UI 接入现状。

## 1. 当前实现

- **中枢层** (`subpackages/utils/customActionService.uts`): 仅保留 `CustomActionService.refreshFileList`。
- **消息层** (`AgentDetailService`): 流式 `PROCESSING` 且类型为 `ToolCall` 时调用 `refreshFileList`。
- **UI 层** (`chat-conversation-component`): `uni.$on('refreshFileList')`，在任务型智能体 + 有会话 id + 文件树弹窗可见时调用 `fetchFileList`。

```typescript
import { CustomActionService } from '@/subpackages/utils/customActionService'

// 流式 ToolCall 场景（业务内已接）
CustomActionService.refreshFileList(`${conversationId}`)
```

页面监听：

```typescript
uni.$on('refreshFileList', onRefreshFileList)
// onUnload / onUnmounted
uni.$off('refreshFileList', onRefreshFileList)
```

## 2. UI 组件接入要求

### 2.1 文件树组件 (File Tree)
- **触发时机**: 用户打开工作台文件树，或文件树已打开时收到 `refreshFileList`。
- **功能要求**: 根据 `conversationId` 调用 `/api/computer/static/file-list` 获取文件列表。

### 2.2 远程桌面 / 预览
- 原 `openPreviewView` / `openDesktopView` / `openPage` / `openLink` / `dispatch` 已从代码中移除（无业务引用）。
- 如需恢复，需重新实现并在页面侧补齐事件监听。

## 3. 常见问题

- **Q: `task-result` 点击无反应？**
  - A: 检查是否传入了 `conversationId`。如果没有 `conversationId`，`task-result` 会降级发出 `task_result_click` 事件，你需要手动处理该事件。

- **Q: 样式不符合预期？**
  - A: `task-result` 与 Plan/工具调用样式分别在 `subpackages/components/task-result/`、`subpackages/components/tool-call/` 中，按需调整对应组件样式即可。
