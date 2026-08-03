# Chat Markdown 自定义渲染元素（组件）实现指南

## 概述

移动端聊天 Markdown 自定义节点（工具调用、执行计划、任务结果等）由 `ai-msg` / `uni-ai-x` 解析并分发到原生组件渲染。

### 当前技术栈

- **消息组件**：`subpackages/components/ai-msg/ai-msg.uvue`
- **Markdown 解析**：`aiMsgMarkdownParser.uts`（App 侧另有 `appMarkdownFallback.uts`）
- **渲染入口**：`UniAiXMsg` / `UniAiXMsgRender`（`uni_modules/uni-ai-x`）
- **工具调用卡片**：`subpackages/components/tool-call/`
- **任务结果卡片**：`subpackages/components/task-result/task-result-card.uvue`

### 架构（简图）

```
Markdown / 自定义标签文本
        │
        ▼
 aiMsgMarkdownParser / appMarkdownFallback
        │
        ▼
 UniAiXMsgRender（按节点类型分发）
        │
        ├── 普通 Markdown 文本节点
        ├── markdown-custom-process → tool-call-card / tool-call-group
        ├── task-result → task-result-card
        └── 其他自定义节点（按需扩展）
```

## 现有自定义节点

| 标签 / 类型 | 渲染组件 | 说明 |
|---|---|---|
| `markdown-custom-process` | `tool-call-card` / `tool-call-group` | 工具调用 / Plan |
| `task-result` | `task-result-card` | 任务产物，可触发预览 |

更多用法见：

- [`subpackages/components/tool-call/README.md`](../subpackages/components/tool-call/README.md)
- [`docs/agent_integration_guide.md`](./agent_integration_guide.md)

## 扩展建议

1. 在解析层识别新标签，产出结构化节点（`UniAiMarkdownElItem`）。
2. 在 `UniAiXMsg` / `ai-msg` 中按节点类型挂载对应 uvue 组件。
3. 动态状态优先走 `processingList` 等结构化数据，避免反复重写整段 Markdown 文本。

## 示例页面

- 路由：`/subpackages/pages/chat-conversation-component/chat-conversation-component`
- H5：`/m/#/subpackages/pages/chat-conversation-component/chat-conversation-component`
