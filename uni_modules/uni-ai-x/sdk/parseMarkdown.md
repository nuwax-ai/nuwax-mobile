# ParseMarkdown.uts 技术文档

## 概述

`ParseMarkdown.uts` 是 uni-ai-x 模块中用于实时流式 Markdown 解析和代码高亮的核心类。该类专门设计用于处理 SSE（Server-Sent Events）流式数据，实现边接收边解析的高效 Markdown 渲染。

## 核心功能

### 1. 流式 Markdown 解析
- **实时解析**: 支持对正在接收的 Markdown 文本进行实时解析
- **增量处理**: 只解析新增的内容部分，避免重复解析
- **异步处理**: 使用任务调度机制，避免阻塞主线程

### 2. 代码块高亮
- **逐行解析**: 对代码块进行逐行高亮处理，提升响应速度
- **多语言支持**: 支持多种编程语言的语法高亮
- **渐进式渲染**: 优先显示未高亮的代码，再逐步应用高亮

### 3. 智能闭合检测
- **动态闭合**: 根据 Markdown 元素类型判断是否完整
- **状态管理**: 维护每个元素的闭合状态

## 类结构

### 构造函数
```typescript
constructor(updateCallBack: UpdateCallBack)
```

**参数:**
- `updateCallBack`: 当解析结果更新时的回调函数

### 主要属性

| 属性名 | 类型 | 描述 |
|--------|------|------|
| `updateCallBack` | UpdateCallBack | 解析结果更新回调函数 |
| `parseLock` | boolean | 解析锁，防止并发解析 |
| `readyParseMdIndex` | number | 准备解析的 Markdown 文本索引 |
| `parseMdIndex` | number | 当前解析位置索引 |
| `markdownTokenList` | MarkdownToken[] | 解析后的 Markdown token 列表 |
| `lastParseLineCodeText` | string | 上次解析的代码行文本 |
| `nextTaskTimer` | number | 延迟任务定时器 |
| `oldMsgBodyLength` | number | 旧消息体长度 |

## 核心方法详解

### runTask(msgBody: string, isDelay: boolean = false)

**功能**: 主要的任务运行方法，负责协调整个解析流程

**流程**:
1. 验证输入文本长度
2. 清除之前的延迟任务
3. 检查解析锁状态
4. 提取新增的 Markdown 文本
5. 调用代码解析任务
6. 调用 Markdown 解析任务
7. 设置下一轮解析任务

**关键逻辑**:
```typescript
// 新增的 markdown 文本
const newMd = msgBody.slice(this.readyParseMdIndex)
// 更新准备解析的索引
this.readyParseMdIndex += (newMd.includes('\n') ? newMd.split('\n')[0] + '\n' : newMd).length
```

### parseCodeTask(markdownText: string): Promise<string>

**功能**: 处理代码块的语法高亮

**特点**:
- 查找未闭合的代码块
- 逐行解析代码内容
- 支持多种编程语言
- 异步处理，不阻塞主线程

**解析策略**:
1. 检测代码块开始标记 (```)
2. 提取语言类型
3. 逐行进行语法高亮
4. 生成唯一标识符
5. 更新代码块状态

### parseMarkdownTask(markdownText: string)

**功能**: 解析标准 Markdown 语法

**支持的语法**:
- 标题 (# ## ###)
- 列表 (- 或数字)
- 代码块 (```)
- 引用 (>)
- 分割线 (---)
- 链接和图片

**处理流程**:
1. 调用 `markedLexer` 解析 Markdown
2. 判断元素闭合状态
3. 更新或新增 token
4. 处理元素合并
5. 触发更新回调

### isClose(type: string, markdownText: string): boolean

**功能**: 判断 Markdown 元素是否完整闭合

**闭合规则**:
- **双换行闭合**: `list`, `table`, `code`, `blockquote`
- **单换行闭合**: `paragraph`, `heading`, `hr`, `def`, `space`
- **无需换行**: `text`, `strong`, `em`, `del`, `link`, `image`, `codespan`

## 性能优化策略

### 1. 任务调度机制
```typescript
// 延迟执行避免频繁解析
this.nextTaskTimer = setTimeout(() => {
    this.runTask(msgBody)
}, 300)
```

### 2. 解析锁机制
```typescript
if (this.parseLock) {
    // 防止并发解析
    this.nextTaskTimer = setTimeout(() => {
        this.runTask(msgBody)
    }, 300)
    return
}
```

### 3. 增量解析
```typescript
// 只解析新增部分
const newMd = msgBody.slice(this.readyParseMdIndex)
```

### 4. 深拷贝优化
```typescript
// 避免引用问题
const copyMarkdownTokenList = JSON.parse<MarkdownToken[]>(JSON.stringify(this.markdownTokenList))
```

## 平台兼容性

### Harmony 平台特殊处理
```typescript
// #ifdef APP-HARMONY
// 解决鸿蒙平台解析错误的临时方案
if (newTokenList[0]!.type == 'paragraph' && /```[a-zA-Z]+\n/.test(newTokenList[0]!.raw!)) {
    newTokenList[0]!.type = 'code'
    fntIsClose = false
    newTokenList[0]!.isClose = fntIsClose
}
// #endif
```

### 异步处理差异
```typescript
// #ifdef APP-HARMONY
nextTick(() => {
    resolve(markdownText)
})
// #endif
// #ifndef APP-HARMONY
resolve(markdownText)
// #endif
```

## 使用示例

### 基本用法
```typescript
// 创建解析器实例
const parser = new ParseMarkdown((tokens: MarkdownToken[]) => {
    // 处理解析结果
    console.log('解析完成:', tokens)
})

// 开始解析
parser.runTask(markdownText)
```

### 流式处理
```typescript
// 模拟 SSE 流式数据
let content = ''
sseStream.onMessage((chunk) => {
    content += chunk
    parser.runTask(content)
})
```

## 依赖关系

### 外部依赖
- `@/uni_modules/kux-marked`: Markdown 解析引擎
- `@/uni_modules/uni-ai-x/sdk/parseCode.uts`: 代码高亮解析器

### 数据结构
```typescript
interface MarkdownToken {
    type: string
    text?: string
    raw?: string
    lang?: string
    isClose?: boolean
    uniqueId?: string
    codeTokens?: IToken[][]
}
```

## 错误处理

### 代码高亮错误
```typescript
if (parseCodeRes.error != null) {
    console.warn(`暂不支持${lang}语言的代码高亮解析，源代码：`, codeText)
    parseComplete = true
}
```

### 异常捕获
```typescript
}).catch((error) => {
    console.warn('代码高亮解析器返回的错误信息：', error)
    resolve(markdownText)
})
```

## 最佳实践

### 1. 性能优化
- 合理设置延迟时间 (300ms)
- 避免频繁的完整重解析
- 使用解析锁防止竞态条件

### 2. 内存管理
- 及时清理定时器
- 使用深拷贝避免引用问题
- 控制 token 数组大小

### 3. 错误处理
- 优雅处理不支持的语言
- 提供详细的错误日志
- 实现降级方案

## 调试建议

### 1. 开启调试日志
```typescript
console.log('parseMarkdown.runTask Thread.currentThread().name', Thread.currentThread().name)
console.log('parseMarkdown.runTask msgBody', msgBody, isDelay)
```

### 2. 监控解析状态
```typescript
console.log('parseLock', msgBody)
console.log('未满', msgBody, this.nextTaskTimer)
```

### 3. 检查代码块状态
```typescript
console.log('codeToken.codeTokens.length', codeToken.codeTokens?.length)
```

## 扩展点

### 1. 自定义语法支持
可以通过扩展 `isClose` 方法支持更多 Markdown 语法

### 2. 性能调优
可以调整延迟时间和解析策略以适应不同场景

### 3. 错误恢复
可以增加更强大的错误恢复机制

## 总结

`ParseMarkdown.uts` 是一个功能完整、性能优化的流式 Markdown 解析器，特别适用于实时聊天和文档协作场景。其设计充分考虑了移动端性能限制和跨平台兼容性，提供了稳定可靠的 Markdown 渲染能力。