# AgentIntervention

AI Agent 运行时干预模块，支持两种暂停-恢复流程：**ACP 权限审批** 和 **MCP Ask 结构化提问**。

对齐 Web 版 `nuwax-intervention-ui/src/components/business-component/AgentIntervention` 的模块组织方式。

## 示例页面

| 环境 | 地址 |
| --- | --- |
| 路由 path | `/pages/test-intervention/test-intervention` |
| H5 访问 | `{域名}/m/#/pages/test-intervention/test-intervention` |
| 代码跳转 | `uni.navigateTo({ url: '/pages/test-intervention/test-intervention' })` |

示例页源码：`pages/test-intervention/test-intervention.uvue`  
Mock 数据：`utils/mockInterventionData.uts`

## 模块结构

```
components/agent-intervention/
├── README.md
├── intervention-card/          # 按 kind 分发到子卡片
├── acp-permission-card/        # ACP 权限审批卡片
└── mcp-ask-question-card/      # MCP Ask 表单卡片
```

## 子组件

| 组件 | 说明 |
| --- | --- |
| `intervention-card` | 调度器，根据 `kind` 渲染 ACP 或 MCP Ask 卡片 |
| `acp-permission-card` | ACP 工具权限审批 |
| `mcp-ask-question-card` | MCP Ask 结构化表单提问 |

## Mobile 内联接入

在消息循环中挂载子卡片（聊天页当前方式）：

```vue
<acp-permission-card
  v-for="acpItem in item.acpPermissionInteractions"
  :key="acpItem.id"
  :interaction="acpItem"
  @respond="(resp) => handleAcpPermissionRespond(acpItem, resp)"
/>
<mcp-ask-question-card
  v-for="mcpItem in item.mcpAskInteractions"
  :key="`${mcpItem.requestId}:${mcpItem.revision || 1}`"
  :interaction="mcpItem"
  @respond="(payload) => handleMcpAskRespond(item, mcpItem, payload)"
/>
```

或使用调度器（测试页推荐）：

```vue
<intervention-card
  v-for="item in mockItems"
  :key="item.key"
  :kind="item.kind"
  :acp-interaction="item.acpInteraction"
  :mcp-interaction="item.mcpInteraction"
  @respond-acp="onAcpRespond"
  @respond-mcp="onMcpRespond"
/>
```

## 与 Web 版差异

| 能力 | Web | Mobile（当前） |
| --- | --- | --- |
| Dock 面板 + 活跃队列 | 有 | 无（消息流内联渲染） |
| SSE 解析 / respond | model + hooks | `utils/interventionAdapter.uts`、`AgentDetailService.uts` |
| MCP resume 消息 | `mcpAskResumeMessage` | `utils/mcpAskResumeMessage.uts` |
| MCP 3.3.2+ structuredContent | `extractMcpAskStructuredInputFromResult` | `utils/mcpAskSchema.uts`（优先于 `result.input`） |

Phase 2 可按需补 `agent-intervention-chat-layer` + `activeInterventionQueue.uts`。

## 相关工具

- `types/intervention.uts` — 类型定义（含 `MCP_ASK_TOOL_NAME`）
- `utils/interventionAdapter.uts` — SSE 事件识别与提取
- `utils/mcpAskSchema.uts` — JSON Schema 表单解析
- `utils/mcpAskResumeMessage.uts` — MCP Ask 回复消息构建
- `servers/intervention.uts` — ACP 权限审批 API

## MCP Ask 工具契约

对齐 `nuwax-ask-question-mcp` 最新版，**仅支持单一工具入口**：

| 常量 | 值 |
| --- | --- |
| `MCP_ASK_TOOL_NAME` | `nuwax_ask_question` |
| `MCP_ASK_SCHEMA_VERSION` | `nuwax.mcp_ask.v1` |
| `INTERACTION_UI_SCHEMA_VERSION` | `nuwax.interaction.v1` |

已移除 legacy 工具 `nuwaclaw_ask_user` / `nuwax_ask_user`，Mobile 不做兼容分支。
