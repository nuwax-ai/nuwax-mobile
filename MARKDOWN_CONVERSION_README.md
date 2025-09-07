# Markdown转换功能使用说明

本文档说明如何将第306行的text数据通过markdown解析成MarkdownToken[][]二维数组，以便在uni-ai-x-msg组件中渲染。

## 功能概述

从第365行开始，我们实现了将第306行的text数据转换为MarkdownToken[][]格式的功能，这样可以直接在uni-ai-x-msg组件中使用。

## 核心文件

### 1. 转换器工具 (`utils/markdownConverter.uts`)
```typescript
import { MarkdownConverter } from '@/utils/markdownConverter'

// 将MarkdownElement数组转换为MarkdownToken[][]
const datasList: MarkdownToken[][] = MarkdownConverter.convertToTokenArray(markdownElements)

// 直接从markdown文本转换
const datasList: MarkdownToken[][] = MarkdownConverter.convertFromText(markdownText)
```

### 2. 在chat.uvue中的使用 (第365行附近)
```typescript
// MESSAGE事件处理
if (eventType === ConversationEventTypeEnum.MESSAGE) {
  const { text, type, ext, id, finished } = data;

  // 解析markdown
  const markdownElements: MarkdownElement[] = markdownParser.parse(text);
  
  // 转换为MarkdownToken[][]格式
  const datasList: MarkdownToken[][] = MarkdownConverter.convertToTokenArray(markdownElements)

  const markdownElList: markdownElItem[] = [{
    uniqueId: '1',
    type: 'text',
    datasList,
  }];
  
  // 在消息中使用
  newMessage = {
    ...currentMessage,
    text: `${currentMessage.text}${text}`,
    markdownElList,
    status: finished ? null : MessageStatusEnum.Incomplete,
  };
}
```

## 支持的Markdown语法

转换器支持以下Markdown语法：

### 1. 标题
```markdown
# 一级标题
## 二级标题
### 三级标题
```

### 2. 代码块
```markdown
```javascript
function hello() {
  console.log("Hello World!");
}
```
```

### 3. 列表
```markdown
- 列表项1
- 列表项2
- 列表项3
```

### 4. 引用
```markdown
> 这是一个引用块
```

### 5. 分割线
```markdown
---
```

### 6. 链接
```markdown
[链接文本](https://example.com)
```

### 7. 普通文本
```markdown
这是普通文本内容
```

## 转换流程

### 步骤1: 解析Markdown
```typescript
const markdownElements: MarkdownElement[] = markdownParser.parse(text)
```

### 步骤2: 转换为Token格式
```typescript
const datasList: MarkdownToken[][] = MarkdownConverter.convertToTokenArray(markdownElements)
```

### 步骤3: 创建markdownElItem
```typescript
const markdownElList: markdownElItem[] = [{
  uniqueId: '1',
  type: 'text',
  datasList,
}]
```

### 步骤4: 在消息中使用
```typescript
newMessage = {
  ...currentMessage,
  text: `${currentMessage.text}${text}`,
  markdownElList, // 这里使用转换后的数据
  status: finished ? null : MessageStatusEnum.Incomplete,
}
```

## 数据结构说明

### MarkdownToken结构
```typescript
type MarkdownToken = {
  type?: string | null;        // 元素类型：'text', 'heading', 'code', 'list', 'blockquote', 'hr', 'link', 'image'
  text?: string | null;        // 文本内容
  raw?: string | null;         // 原始markdown文本
  href?: string | null;        // 链接地址（用于link和image类型）
  depth?: number | null;       // 标题级别（用于heading类型）
  lang?: string | null;        // 代码语言（用于code类型）
  tokens?: MarkdownToken[] | null; // 子token（用于复杂结构）
}
```

### markdownElItem结构
```typescript
type markdownElItem = {
  uniqueId: string,           // 唯一标识
  type: string,               // 元素类型
  datasList: MarkdownToken[][] // 二维数组，每个子数组包含一个元素的token
}
```

## 使用示例

### 示例1: 基本使用
```typescript
import { MarkdownConverter } from '@/utils/markdownConverter'

const text = "# 标题\n这是一段文本"
const datasList = MarkdownConverter.convertFromText(text)
```

### 示例2: 在流式响应中使用
```typescript
// 处理流式数据
const handleStreamChunk = (chunk: string) => {
  const datasList = MarkdownConverter.convertFromText(chunk)
  const markdownElList = [{
    uniqueId: Date.now().toString(),
    type: 'text',
    datasList,
  }]
  
  // 更新消息
  currentMessage.markdownElList = markdownElList
}
```

### 示例3: 完整的事件处理
```typescript
const handleMessageEvent = (data: any) => {
  const { text, type, ext, id, finished } = data
  
  // 解析并转换
  const markdownElements = markdownParser.parse(text)
  const datasList = MarkdownConverter.convertToTokenArray(markdownElements)
  
  // 创建markdownElList
  const markdownElList = [{
    uniqueId: id || Date.now().toString(),
    type: 'text',
    datasList,
  }]
  
  // 更新消息
  return {
    text: text,
    markdownElList: markdownElList,
    status: finished ? null : 'incomplete'
  }
}
```

## 注意事项

1. **性能优化**: 对于大量文本，建议分批处理
2. **错误处理**: 确保在未识别到文字时有适当的降级处理
3. **内存管理**: 及时清理不需要的转换结果
4. **类型安全**: 使用TypeScript确保类型正确

## 扩展功能

### 添加新的Markdown语法支持
在`MarkdownConverter.convertFromText`方法中添加新的解析逻辑：

```typescript
// 例如：支持表格
if (line.includes('|')) {
  // 解析表格逻辑
  elements.push({
    type: 'table',
    content: line
  })
}
```

### 自定义Token属性
在转换时可以添加自定义属性：

```typescript
const token: MarkdownToken = {
  type: element.type,
  text: element.content,
  raw: element.content,
  tokens: null,
  // 添加自定义属性
  customProperty: 'customValue'
}
```

## 测试

使用提供的测试函数验证转换功能：

```typescript
import { testMarkdownConversion } from '@/examples/markdown-conversion-example'

// 运行测试
const result = testMarkdownConversion()
console.log('转换结果:', result)
```

这个转换功能现在已经完全集成到您的聊天系统中，可以无缝地在uni-ai-x-msg组件中渲染markdown内容。
