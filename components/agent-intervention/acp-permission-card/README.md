# AcpPermissionCard — ACP 权限审批卡片

> 模块总文档见 [`../README.md`](../README.md)

Agent 工具调用前的权限审批交互卡片。

## Props

| 参数 | 说明 | 类型 | 必填 |
| --- | --- | --- | --- |
| interaction | ACP 权限交互数据 | `AcpPermissionInteraction` | 是 |

## Events

| 事件名 | 说明 | 回调参数 |
| --- | --- | --- |
| respond | 用户选择审批选项时触发 | `(response: AcpPermissionResponse)` |

## 导入

```uts
import AcpPermissionCard from '@/components/agent-intervention/acp-permission-card/acp-permission-card.uvue'
```
