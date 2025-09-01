# Tool Call Status 组件

## 📖 组件介绍

`tool-call-status` 是一个用于显示工具调用状态的组件，支持多种状态显示和详细信息展示。

## 🚀 功能特性

- **多种状态支持**: 执行中、已完成、执行失败等状态
- **可展开详情**: 点击头部可展开查看详细信息
- **响应式设计**: 支持不同屏幕尺寸
- **状态指示器**: 不同状态有不同的颜色和样式
- **详细信息展示**: 执行ID、参数、结果、错误信息等

## 📱 使用方法

### 基本用法

```vue
<template>
  <tool-call-status :data="toolCallData" />
</template>

<script lang="uts" setup>
import ToolCallStatus from '@/components/tool-call-status/tool-call-status.uvue'

const toolCallData = {
  executeId: 'e1dc543db8314d8bb0ba63a275e3b242',
  type: 'Mcp',
  status: 'EXECUTING',
  name: 'list_news_sources',
  targetId: 12345,
  cardBindConfig: { enabled: true },
  result: null
}
</script>
```

### 组件属性

| 属性名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| data | ToolCall | 是 | 工具调用数据对象 |

### ToolCall 接口定义

```typescript
interface ToolCall {
  cardBindConfig?: any        // 卡片绑定配置
  executeId: string          // 执行ID
  type: string               // 工具类型
  targetId: number           // 目标ID
  name?: string              // 工具名称
  status: 'EXECUTING' | 'FINISHED' | 'FAILED'  // 执行状态
  result?: any               // 执行结果
}
```

## 🧪 测试示例

### 运行测试

1. 在页面中引入测试组件：
```vue
<template>
  <tool-call-status-example />
</template>

<script lang="uts" setup>
import ToolCallStatusExample from '@/components/tool-call-status/tool-call-status-example.uvue'
</script>
```

2. 或者直接访问测试页面（如果已配置路由）

### 测试功能

#### 1. 静态数据测试
- **执行中状态**: 显示蓝色"执行中"指示器
- **已完成状态**: 显示绿色"已完成"指示器  
- **执行失败状态**: 显示红色"执行失败"指示器
- **复杂参数测试**: 测试复杂配置数据的显示
- **空结果测试**: 测试空结果的显示效果

#### 2. 动态状态测试
- 实时切换工具状态
- 观察状态变化对UI的影响
- 测试不同状态下的结果显示

#### 3. 组件交互测试
- 点击展开/收起详细信息
- 测试响应式布局
- 验证不同数据格式的兼容性

## 🎨 样式定制

组件使用 SCSS 编写，支持以下样式定制：

### 状态颜色
- `status-executing`: 执行中（蓝色）
- `status-finished`: 已完成（绿色）
- `status-failed`: 执行失败（红色）

### 响应式断点
- 默认: 桌面端布局
- `max-width: 750rpx`: 移动端布局

## 🔧 开发说明

### 组件结构
```
tool-call-status/
├── tool-call-status.uvue          # 主组件
├── tool-call-status-example.uvue  # 测试示例
├── README.md                      # 说明文档
└── index.uts                      # 导出文件
```

### 主要方法
- `toggleExpanded()`: 切换展开状态
- `getStatusClass()`: 获取状态样式类
- `getStatusText()`: 获取状态文本
- `formatArguments()`: 格式化参数显示

### 事件处理
- `@click="toggleExpanded"`: 头部点击展开/收起

## 📋 测试检查清单

- [ ] 各种状态正确显示
- [ ] 展开/收起功能正常
- [ ] 响应式布局正确
- [ ] 不同数据格式兼容
- [ ] 状态切换动画流畅
- [ ] 错误处理机制完善

## 🐛 常见问题

### Q: 状态不显示或显示错误？
A: 检查 `status` 字段值是否为 `'EXECUTING' | 'FINISHED' | 'FAILED'` 之一

### Q: 组件无法展开？
A: 确保 `data` 属性正确传入，且包含必要的字段

### Q: 样式显示异常？
A: 检查是否正确引入了组件的样式文件

## 📝 更新日志

- **v1.0.0**: 初始版本，支持基本状态显示
- **v1.1.0**: 添加测试示例和详细文档
- **v1.2.0**: 优化状态映射和UI显示

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request 来改进这个组件！

## �� 许可证

MIT License
