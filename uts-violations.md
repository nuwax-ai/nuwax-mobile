# UTS 违规项扫描报告

生成时间：2026/4/17 14:03:11

## 概览

- **总违规数**: 4
- **涉及文件**: 2

## 按类型统计

- **UTS110111101**: 4 处

## 按文件统计

- `/Users/apple/workspace/nuwax-mobile/types/interfaces/conversationInfo.uts`: 3 处
- `/Users/apple/workspace/nuwax-mobile/types/interfaces/sandbox.uts`: 1 处

## 详细违规列表


### /Users/apple/workspace/nuwax-mobile/types/interfaces/conversationInfo.uts:127

**类型**: UTS110111101
**位置**: 第 127 行，第 20 列

```
variableParams?: { [key: string]: string | number };
```

**说明**: Inline index signature type
**修复建议**: Extract to: type MyMap = { [key: string]: ... };
---


### /Users/apple/workspace/nuwax-mobile/types/interfaces/conversationInfo.uts:145

**类型**: UTS110111101
**位置**: 第 145 行，第 20 列

```
variableParams?: { [key: string]: string | number };
```

**说明**: Inline index signature type
**修复建议**: Extract to: type MyMap = { [key: string]: ... };
---


### /Users/apple/workspace/nuwax-mobile/types/interfaces/conversationInfo.uts:168

**类型**: UTS110111101
**位置**: 第 168 行，第 20 列

```
variableParams?: { [key: string]: string | number };
```

**说明**: Inline index signature type
**修复建议**: Extract to: type MyMap = { [key: string]: ... };
---


### /Users/apple/workspace/nuwax-mobile/types/interfaces/sandbox.uts:9

**类型**: UTS110111101
**位置**: 第 9 行，第 18 列

```
agentSelected: { [key: string]: string }; // agentId: sandboxId
```

**说明**: Inline index signature type
**修复建议**: Extract to: type MyMap = { [key: string]: ... };
---


---

## 修复优先级

1. **高优先级** (UTS110111120): 导致编译错误，必须修复
2. **中优先级** (UTS110111101): 类型定义问题，建议修复
3. **低优先级** (UTS110111163): interface 使用问题，可逐步优化
