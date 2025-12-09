# Chat Markdown 自定义渲染元素（组件）实现指南

## 📋 目录

- [概述](#概述)
- [核心架构](#核心架构)
- [快速开始：生成 Markdown 并插入自定义标签](#快速开始生成-markdown-并插入自定义标签)
- [实现步骤：创建自定义渲染组件](#实现步骤创建自定义渲染组件)
- [现有示例](#现有示例)
- [最佳实践](#最佳实践)
- [常见问题](#常见问题)

## 概述

本项目使用 `mp-html` 组件作为 Markdown 渲染引擎，通过 `markdown-it-container` 插件机制实现自定义元素的渲染。当需要在 Markdown 中渲染自定义组件时（如工具调用、执行过程等），可以通过创建容器块来扩展渲染能力。

### 核心优势

- ✅ **插件化设计**：通过 `markdown-it-container` 插件扩展，不影响核心渲染逻辑
- ✅ **类型安全**：支持 UTS/TypeScript 类型定义
- ✅ **灵活扩展**：可以自定义任意容器标签的渲染
- ✅ **动态数据**：支持通过 `processingList` 传递动态数据，实现实时更新
- ✅ **多端支持**：基于 uni-app-x，支持 H5、小程序、App 多端

## 核心架构

### 技术栈

- **渲染引擎**：`mp-html` 组件（基于 `markdown-it`）
- **插件系统**：`markdown-it-container`
- **容器组件**：`container.vue` 自定义组件
- **数据处理**：`processingList` + `getProcessingDataByPriority`

### 架构图

```
┌─────────────────────────────────────────┐
│         Markdown 文本                    │
│  (包含 :::container 语法)                │
└──────────────┬──────────────────────────┘
               │
               │ markdown-it 解析
               ▼
┌─────────────────────────────────────────┐
│      markdown-it-container 插件          │
│  - 识别 :::container 语法               │
│  - 转换为 <container> 标签              │
└──────────────┬──────────────────────────┘
               │
               │ 生成 HTML 节点
               ▼
┌─────────────────────────────────────────┐
│         mp-html 组件                     │
│  (uni_modules/mp-html)                  │
└──────────────┬──────────────────────────┘
               │
               │ 识别 container 标签
               ▼
┌─────────────────────────────────────────┐
│         node.vue 组件                    │
│  - 识别 <container> 标签                │
│  - 调用 getRenderData()                 │
│  - 合并 processingList 数据             │
└──────────────┬──────────────────────────┘
               │
               │ 传递合并后的数据
               ▼
┌─────────────────────────────────────────┐
│      container.vue 组件                  │
│  - 渲染工具调用状态                      │
│  - 显示执行详情                          │
│  - 处理用户交互                          │
└─────────────────────────────────────────┘
```

### 数据流

```
Markdown 文本
  ↓
:::container executeId="xxx" type="Page" status="EXECUTING"
:::
  ↓
<container data='{"executeId":"xxx","type":"Page","status":"EXECUTING"}'></container>
  ↓
container.vue 组件接收 data 属性
  ↓
getRenderData() 合并 processingList 数据
  ↓
最终渲染的组件数据 = data + processingList[executeId]
```

## 快速开始：生成 Markdown 并插入自定义标签

在实际开发中，我们通常需要在代码中动态生成包含自定义容器标签的 Markdown 字符串。本节介绍如何在前端生成这些标签。

### 方式一：使用工具函数（推荐）

#### 1. 使用现有的工具函数

项目已提供 `containerHelper.uts` 工具函数，位于 `subpackages/utils/containerHelper.uts`。

**核心函数**：

```uts
/**
 * 生成工具调用自定义块
 * @param beforeText 之前的文本内容
 * @param toolCallData 工具调用数据
 * @returns 包含自定义块的完整文本
 */
export function getCustomBlock(
  beforeText: string,
  toolCallData: { 
    type?: string; 
    name?: string; 
    executeId?: string; 
    status?: string 
  }
): string
```

**使用示例**：

```uts
import { getCustomBlock } from '@/subpackages/utils/containerHelper.uts'

// 在消息处理中生成容器块
const toolCallData = {
  type: 'Page',
  name: '页面预览',
  executeId: 'exec-123',
  status: 'EXECUTING'
}

let markdown = '这是一段普通文本。'
markdown = getCustomBlock(markdown, toolCallData)
// 结果: '这是一段普通文本。\n\n:::container executeId="exec-123" type="Page" status="EXECUTING" name="页面预览"\n:::\n\n'
```

#### 2. 底层工具函数

如果需要更灵活的控制，可以使用底层函数：

```uts
import { getBlockWrapper, getBlockName } from '@/subpackages/utils/containerHelper.uts'

/**
 * 生成自定义容器块
 * @param data 属性数据对象
 * @returns 格式化的容器块字符串
 */
function generateContainerBlock(data: Record<string, any>): string {
  const blockName = getBlockName() // 返回 'container'
  return getBlockWrapper(blockName, data)
}

// 使用示例
const block = generateContainerBlock({
  executeId: 'exec-123',
  type: 'Page',
  status: 'EXECUTING',
  name: '页面预览'
})
// 结果: '\n\n:::container executeId="exec-123" type="Page" status="EXECUTING" name="页面预览"\n:::\n\n'
```

### 方式二：直接字符串拼接

如果只是偶尔使用，也可以直接拼接字符串：

```uts
// 准备数据
const executeId = 'exec-123'
const type = 'Page'
const status = 'EXECUTING'
const name = '页面预览'

// 拼接 Markdown
const markdown = `这是一段文本。

:::container executeId="${executeId}" type="${type}" status="${status}" name="${name}"
:::

继续其他内容...`
```

### 方式三：创建专用的生成函数

对于特定的业务场景，可以创建专门的生成函数：

```uts
/**
 * 生成页面预览容器块
 * @param markdownText 现有的 Markdown 文本
 * @param pageData 页面数据
 * @returns 插入容器块后的 Markdown
 */
export function insertPagePreviewBlock(
  markdownText: string,
  pageData: { executeId: string; name: string; status: string }
): string {
  const block = `\n\n:::container executeId="${pageData.executeId}" type="Page" status="${pageData.status}" name="${pageData.name}"\n:::\n\n`
  
  // 检查是否已存在，避免重复插入
  if (markdownText.includes(`executeId="${pageData.executeId}"`)) {
    return markdownText
  }
  
  return `${markdownText}${block}`
}

/**
 * 生成工具调用容器块
 * @param markdownText 现有的 Markdown 文本
 * @param toolCallData 工具调用数据
 * @returns 插入容器块后的 Markdown
 */
export function insertToolCallBlock(
  markdownText: string,
  toolCallData: { executeId: string; type: string; name: string; status: string }
): string {
  const attrs = Object.entries(toolCallData)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ')
  
  const block = `\n\n:::container ${attrs}\n:::\n\n`
  
  // 检查是否已存在
  if (markdownText.includes(`executeId="${toolCallData.executeId}"`)) {
    return markdownText
  }
  
  return `${markdownText}${block}`
}
```

### 数据传递规则

#### 1. 简单属性（字符串、数字）

直接在容器语法中传递：

```markdown
:::container executeId="exec-123" type="Page" status="EXECUTING" name="页面预览"
:::
```

#### 2. 复杂数据（对象、数组）

如果需要传递复杂数据，有两种方式：

**方式一：通过 processingList 传递（推荐）**

```uts
// 在消息对象中设置 processingList
const message = {
  text: markdownWithContainer,
  processingList: [
    {
      executeId: 'exec-123',
      type: AgentComponentTypeEnum.Page,
      name: '页面预览',
      status: ProcessingEnum.EXECUTING,
      result: {
        input: { url: 'https://example.com' },
        data: { html: '<div>...</div>' }
      },
      // ... 其他字段
    }
  ]
}
```

**方式二：在容器语法中传递 JSON 字符串**

```markdown
:::container executeId="exec-123" data='{"key":"value","nested":{"prop":123}}'
:::
```

### 实际使用场景

#### 场景 1：SSE 流式消息处理

```uts
// 在 AgentDetailService.uts 中
import { getCustomBlock } from '@/subpackages/utils/containerHelper.uts'

// 处理 PROCESSING 事件
if (eventType === ConversationEventTypeEnum.PROCESSING) {
  const processingResult = responseData.result || {}
  responseData.executeId = processingResult.executeId

  // 生成包含容器块的 Markdown
  const accumulatedText = getCustomBlock(
    currentMessage.text || '',
    responseData
  )

  // 更新消息
  newMessage = {
    ...currentMessage,
    text: accumulatedText,
    status: MessageStatusEnum.Loading,
    processingList: [
      ...(currentMessage?.processingList || []),
      responseData,
    ] as ProcessingInfo[],
  }
}
```

#### 场景 2：检查标签是否已存在

`getCustomBlock` 函数已经内置了重复检查逻辑：

```uts
// 在 containerHelper.uts 中
export function getCustomBlock(
  beforeText: string,
  toolCallData: { type?: string; name?: string; executeId?: string; status?: string }
): string {
  const { type, executeId } = toolCallData
  
  if (!type || !executeId) {
    return beforeText
  }

  const hasBlock = beforeText.includes(`executeId="${executeId}"`)

  if (hasBlock) {
    // 如果已经存在相同的执行ID，则不重复添加
    return beforeText
  }

  // ... 生成新块
}
```

#### 场景 3：动态更新处理状态

```uts
// 当处理状态更新时，更新 processingList
const updateProcessingStatus = (
  executeId: string,
  newStatus: ProcessingEnum,
  result?: ExecuteResultInfo
) => {
  const currentMessage = getCurrentMessage()
  
  // 更新 processingList 中对应项的状态
  const updatedProcessingList = currentMessage.processingList?.map(item => {
    if (item.executeId === executeId) {
      return {
        ...item,
        status: newStatus,
        result: result || item.result
      }
    }
    return item
  }) || []
  
  // 更新消息
  updateMessage({
    processingList: updatedProcessingList
  })
}
```

### 注意事项

1. **使用换行分隔**：容器块前后需要添加换行，确保 Markdown 解析正确

   ```markdown
   ✅ 正确
   文本内容
   
   :::container executeId="xxx"
   :::
   
   继续内容
   
   ❌ 可能有问题
   文本内容
   :::container executeId="xxx"
   :::
   继续内容
   ```

2. **属性值转义**：属性值中的引号需要转义或使用单引号

   ```markdown
   ✅ 正确
   :::container name="页面\"预览\""
   :::
   
   ✅ 也可以
   :::container name='页面"预览"'
   :::
   ```

3. **避免重复插入**：在流式渲染中，注意检查标签是否已存在，避免重复插入

4. **executeId 唯一性**：确保每个容器块都有唯一的 `executeId`，用于标识和匹配 `processingList` 中的数据

## 实现步骤：创建自定义渲染组件

如果你需要创建新的自定义渲染组件，请按照以下步骤操作。

### 第一步：了解容器组件结构

容器组件位于 `uni_modules/mp-html/components/mp-html/container/container.vue`。

**组件 Props**：

```vue
props: {
  data: {
    type: Object,
    required: true
  }
}
```

**数据合并逻辑**：

在 `node.vue` 中，通过 `getRenderData()` 方法合并数据：

```javascript
getRenderData(data) {
  if(!data) {
    return {}
  }
  
  if(typeof data === 'string') {
    data = JSON.parse(data)
  }
  
  // 从 processingList 中按优先级获取数据并合并
  const result = {
    ...data,
    ...getProcessingDataByPriority(data.executeId, this.processingList)
  }
  
  return result
}
```

### 第二步：修改容器组件（如果需要）

如果需要支持新的渲染类型，可以修改 `container.vue` 组件：

```vue
<template>
  <view class="tool-call-status">
    <!-- 根据 type 渲染不同的内容 -->
    <view v-if="toolCall.type === 'Page'" class="page-preview">
      <!-- 页面预览内容 -->
    </view>
    <view v-else-if="toolCall.type === 'Tool'" class="tool-call">
      <!-- 工具调用内容 -->
    </view>
    <!-- 默认渲染 -->
    <view v-else class="default-container">
      <!-- 默认内容 -->
    </view>
  </view>
</template>

<script>
export default {
  props: {
    data: {
      type: Object,
      required: true
    }
  },
  computed: {
    toolCall() {
      return this.data
    }
  }
}
</script>
```

### 第三步：在 Markdown 中使用

在代码中生成包含容器块的 Markdown：

```uts
import { getCustomBlock } from '@/subpackages/utils/containerHelper.uts'

const markdown = getCustomBlock('', {
  executeId: 'exec-123',
  type: 'Page',
  name: '页面预览',
  status: 'EXECUTING'
})
```

### 第四步：传递 processingList

在消息对象中设置 `processingList`：

```uts
const message = {
  text: markdown,
  processingList: [
    {
      executeId: 'exec-123',
      type: AgentComponentTypeEnum.Page,
      name: '页面预览',
      status: ProcessingEnum.EXECUTING,
      result: {
        input: { /* 输入参数 */ },
        data: { /* 输出数据 */ }
      },
      cardBindConfig: { /* 卡片配置 */ },
      targetId: 123
    }
  ] as ProcessingInfo[]
}
```

### 第五步：在组件中使用

在消息组件中传递 `processingList`：

```vue
<template>
  <mp-html 
    :content="processedText" 
    :processing-list="msg.processingList" 
    :markdown="true" 
    :container-style="`width: 100%;`" 
  />
</template>
```

## 现有示例

### 示例 1：工具调用容器（Tool Call）

**生成 Markdown**：

```uts
import { getCustomBlock } from '@/subpackages/utils/containerHelper.uts'

const markdown = getCustomBlock('', {
  executeId: 'tool-call-123',
  type: 'Tool',
  name: '读取文件',
  status: 'EXECUTING'
})
```

**Markdown 语法**：

```markdown
:::container executeId="tool-call-123" type="Tool" status="EXECUTING" name="读取文件"
:::
```

**渲染效果**：

- 显示工具名称和状态
- 支持展开/收起查看详情
- 显示调用参数和结果
- 支持复制功能

### 示例 2：页面预览容器（Page Preview）

**生成 Markdown**：

```uts
const markdown = getCustomBlock('', {
  executeId: 'page-preview-123',
  type: 'Page',
  name: '页面预览',
  status: 'FINISHED'
})
```

**processingList 数据**：

```uts
{
  executeId: 'page-preview-123',
  type: AgentComponentTypeEnum.Page,
  name: '页面预览',
  status: ProcessingEnum.FINISHED,
  result: {
    input: { url: 'https://example.com' },
    data: { html: '<div>页面内容</div>' }
  }
}
```

**渲染效果**：

- 显示页面名称和状态
- 支持预览页面（点击眼睛图标）
- 显示执行结果

### 示例 3：动态状态更新

**初始状态**：

```uts
// 生成 EXECUTING 状态的容器
let markdown = getCustomBlock('', {
  executeId: 'exec-123',
  type: 'Page',
  status: 'EXECUTING'
})

let processingList = [{
  executeId: 'exec-123',
  status: ProcessingEnum.EXECUTING,
  // ... 其他字段
}]
```

**更新为完成状态**：

```uts
// 更新 processingList
processingList = processingList.map(item => {
  if (item.executeId === 'exec-123') {
    return {
      ...item,
      status: ProcessingEnum.FINISHED,
      result: {
        input: { /* ... */ },
        data: { /* ... */ }
      }
    }
  }
  return item
})

// Markdown 文本不需要修改，组件会自动根据 processingList 更新显示
```

## 最佳实践

### 1. 使用工具函数生成容器块

**推荐**：使用 `getCustomBlock` 函数

```uts
import { getCustomBlock } from '@/subpackages/utils/containerHelper.uts'

const markdown = getCustomBlock(beforeText, toolCallData)
```

**原因**：
- 自动处理重复检查
- 统一的格式和风格
- 易于维护和修改

### 2. executeId 唯一性

**推荐**：确保每个容器块都有唯一的 `executeId`

```uts
const executeId = `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
```

**原因**：
- 用于匹配 `processingList` 中的数据
- 避免重复插入容器块
- 支持动态更新状态

### 3. 数据分离

**推荐**：简单属性放在容器语法中，复杂数据通过 `processingList` 传递

```uts
// ✅ 推荐
// Markdown 中只包含标识信息
:::container executeId="exec-123" type="Page" status="EXECUTING"
:::

// processingList 中包含完整数据
processingList: [{
  executeId: 'exec-123',
  result: { /* 复杂数据 */ }
}]
```

**原因**：
- Markdown 文本保持简洁
- 复杂数据可以动态更新
- 支持流式渲染

### 4. 状态管理

**推荐**：使用 `ProcessingEnum` 枚举管理状态

```uts
import { ProcessingEnum } from '@/types/enums/common.uts'

const status = ProcessingEnum.EXECUTING // 'EXECUTING'
// 或
const status = ProcessingEnum.FINISHED // 'FINISHED'
const status = ProcessingEnum.FAILED    // 'FAILED'
```

**原因**：
- 类型安全
- 避免拼写错误
- 便于维护

### 5. 优先级处理

**推荐**：理解 `getProcessingDataByPriority` 的优先级逻辑

优先级顺序：`FINISHED` > `FAILED` > `EXECUTING`

```uts
// 如果 processingList 中有多个相同 executeId 的项
// 会优先使用 FINISHED 状态的数据
const result = getProcessingDataByPriority(executeId, processingList)
```

**原因**：
- 确保显示最终状态
- 支持状态覆盖
- 处理并发更新

### 6. 错误处理

**推荐**：在生成容器块时进行数据验证

```uts
export function getCustomBlock(
  beforeText: string,
  toolCallData: { type?: string; name?: string; executeId?: string; status?: string }
): string {
  const { type, executeId } = toolCallData
  
  // ✅ 验证必要字段
  if (!type || !executeId) {
    console.warn('getCustomBlock: type 或 executeId 缺失', toolCallData)
    return beforeText
  }

  // ... 其他逻辑
}
```

### 7. 性能优化

**推荐**：避免频繁更新 Markdown 文本

```uts
// ✅ 推荐：只更新 processingList
updateMessage({
  processingList: newProcessingList
})

// ❌ 不推荐：每次都重新生成整个 Markdown
updateMessage({
  text: generateNewMarkdown() // 可能导致性能问题
})
```

**原因**：
- Markdown 解析有性能开销
- `processingList` 更新更高效
- 组件会自动响应数据变化

## 常见问题

### Q1: 容器块不显示怎么办？

**A**: 检查以下几点：

1. **Markdown 语法是否正确**：确保使用 `:::container` 语法，且前后有换行

   ```markdown
   ✅ 正确
   :::container executeId="xxx"
   :::
   
   ❌ 错误
   :::container executeId="xxx":::
   ```

2. **mp-html 组件配置**：确保 `markdown` 属性为 `true`

   ```vue
   <mp-html :markdown="true" :content="text" />
   ```

3. **容器插件是否启用**：检查 `markdown-it/index.js` 中是否配置了 `markdown-it-container`

4. **控制台错误**：检查浏览器控制台是否有错误信息

### Q2: 如何传递复杂数据？

**A**: 使用 `processingList` 传递复杂数据：

```uts
// 在消息对象中设置
const message = {
  text: markdownWithContainer,
  processingList: [{
    executeId: 'exec-123',
    result: {
      input: { /* 复杂对象 */ },
      data: { /* 复杂对象 */ }
    }
  }]
}
```

容器组件会自动从 `processingList` 中获取并合并数据。

### Q3: 如何更新容器状态？

**A**: 更新 `processingList` 中对应项的状态：

```uts
// 更新 processingList
const updatedList = processingList.map(item => {
  if (item.executeId === targetExecuteId) {
    return {
      ...item,
      status: ProcessingEnum.FINISHED,
      result: newResult
    }
  }
  return item
})

// 更新消息
updateMessage({ processingList: updatedList })
```

容器组件会自动响应数据变化并更新显示。

### Q4: 如何支持新的容器类型？

**A**: 修改 `container.vue` 组件，添加新的渲染逻辑：

```vue
<template>
  <view class="custom-container">
    <!-- 根据 type 渲染不同内容 -->
    <view v-if="toolCall.type === 'YourNewType'">
      <!-- 新类型的渲染内容 -->
    </view>
    <!-- 现有类型 -->
    <view v-else>
      <!-- 现有渲染逻辑 -->
    </view>
  </view>
</template>
```

### Q5: 容器组件如何获取数据？

**A**: 数据通过以下流程传递：

1. **Markdown 中的属性**：通过 `:::container executeId="xxx"` 传递
2. **processingList**：通过组件 props 传递
3. **数据合并**：在 `node.vue` 的 `getRenderData()` 中合并
4. **组件接收**：`container.vue` 通过 `data` prop 接收合并后的数据

### Q6: 如何调试容器组件？

**A**: 使用以下方法：

1. **添加 console.log**：在 `container.vue` 中打印接收的数据

   ```vue
   <script>
   export default {
     props: {
       data: Object
     },
     mounted() {
       console.log('Container data:', this.data)
     }
   }
   </script>
   ```

2. **检查 processingList**：确认 `processingList` 中是否有对应 `executeId` 的数据

3. **检查数据合并**：在 `node.vue` 的 `getRenderData()` 中添加日志

4. **Vue DevTools**：使用 Vue DevTools 检查组件 props 和 data

### Q7: 如何处理多个相同 executeId 的容器？

**A**: `getProcessingDataByPriority` 函数会按优先级返回数据：

```uts
// 优先级：FINISHED > FAILED > EXECUTING
const result = getProcessingDataByPriority(executeId, processingList)
// 返回优先级最高的项
```

如果有多个相同 `executeId` 的项，会优先使用 `FINISHED` 状态的数据。

### Q8: 容器组件支持哪些交互？

**A**: 当前 `container.vue` 组件支持：

- **展开/收起**：点击头部切换详情显示
- **复制**：复制参数或结果到剪贴板
- **预览**：对于 Page 类型，支持页面预览（点击眼睛图标）

可以在 `container.vue` 中添加更多交互功能。

### Q9: 如何在流式渲染中避免重复插入？

**A**: `getCustomBlock` 函数已经内置了重复检查：

```uts
const hasBlock = beforeText.includes(`executeId="${executeId}"`)

if (hasBlock) {
  return beforeText // 已存在，不重复添加
}
```

确保每次调用时传入完整的 `beforeText`。

### Q10: 容器组件样式如何自定义？

**A**: 修改 `container.vue` 中的样式：

```vue
<style lang="scss">
.tool-call-status {
  // 自定义样式
  background-color: #f0f0f0;
  border-radius: 8rpx;
  
  // 更多样式...
}
</style>
```

## 总结

通过本指南，你可以：

1. ✅ 理解 Markdown 自定义渲染的架构和原理
2. ✅ **快速上手**：学会如何在代码中生成包含自定义容器标签的 Markdown
3. ✅ **深入实现**：了解如何创建和自定义渲染组件
4. ✅ 遵循最佳实践，编写高质量的代码
5. ✅ 解决常见问题，快速定位和修复错误

## 参考资源

- [mp-html 文档](https://github.com/jin-yufeng/mp-html)
- [markdown-it-container 文档](https://github.com/markdown-it/markdown-it-container)
- [uni-app-x 官方文档](https://uniapp.dcloud.net.cn/uni-app-x/)

---

**维护者**：开发团队

如有问题或建议，请联系开发团队或提交 Issue。
