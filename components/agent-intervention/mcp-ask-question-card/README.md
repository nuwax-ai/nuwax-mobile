# McpAskQuestionCard — MCP Ask 结构化提问卡片

> 模块总文档见 [`../README.md`](../README.md)

MCP Ask 协议的结构化表单卡片。组件运行时 `name` 仍为 `McpAskCard`。

## Props

| 参数 | 说明 | 类型 | 必填 |
| --- | --- | --- | --- |
| interaction | MCP Ask 交互数据 | `McpAskInteraction` | 是 |

## Events

| 事件名 | 说明 | 回调参数 |
| --- | --- | --- |
| respond | 用户提交 / 取消 / 跳过时触发 | `(payload: McpAskRespondPayload)` |

## 导入

```uts
import McpAskQuestionCard from '@/components/agent-intervention/mcp-ask-question-card/mcp-ask-question-card.uvue'
```
