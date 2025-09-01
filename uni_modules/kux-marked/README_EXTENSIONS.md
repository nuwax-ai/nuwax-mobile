# Markdown扩展架构使用指南

本文档介绍如何使用kux-marked库的扩展功能，包括数学公式、Mermaid图表、警告框和容器区块等。

## 快速开始

### 基本使用

```typescript
import { Lexer } from './uni_modules/kux-marked/common/Lexer';

// 创建Lexer实例，扩展功能会自动注册
const lexer = new Lexer();

// 解析包含扩展功能的Markdown文本
const markdown = `
# 标题

数学公式：$E=mc^2$

\`\`\`mermaid
graph TD
    A --> B
\`\`\`

> [!TIP]
> 这是一个提示框
`;

const tokens = lexer.lex(markdown);
console.log(tokens);
```

### 自定义扩展配置

```typescript
import { Lexer } from './uni_modules/kux-marked/common/Lexer';
import { ExtensionRegistry } from './uni_modules/kux-marked/common/ExtensionRegistry';

// 创建自定义配置的Lexer
const lexer = new Lexer();
const registry = lexer.getExtensionRegistry();

// 查看已注册的扩展
console.log('已注册的扩展:', registry.getRegisteredNames());
console.log('扩展统计:', registry.getStats());
```

## 扩展功能详解

### 1. 数学公式扩展

#### 支持的语法

- **行内公式**: `$formula$` 或 `\\(formula\\)`
- **块级公式**: `$$formula$$` 或 `\\[formula\\]`

#### 使用示例

```markdown
<!-- 行内公式 -->
文本中的公式：$E=mc^2$ 和 \\(F=ma\\)

<!-- 块级公式 -->
$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

\\[
\\frac{d}{dx}\\int_a^x f(t)dt = f(x)
\\]
```

#### 解析结果

```typescript
// 行内公式Token
{
  type: 'math',
  raw: '$E=mc^2$',
  text: 'E=mc^2',
  display: false,
  mathType: 'inline',
  tokens: []
}

// 块级公式Token
{
  type: 'math',
  raw: '$$\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}$$',
  text: '\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}',
  display: true,
  mathType: 'block',
  tokens: []
}
```

### 2. Mermaid图表扩展

#### 支持的图表类型

- 流程图 (flowchart/graph)
- 时序图 (sequenceDiagram)
- 类图 (classDiagram)
- 甘特图 (gantt)
- 饼图 (pie)
- Git图 (gitgraph)
- 实体关系图 (erDiagram)
- 用户旅程图 (journey)
- 状态图 (stateDiagram)
- 需求图 (requirementDiagram)
- C4图 (c4Context/c4Container/c4Component)
- 思维导图 (mindmap)
- 时间线 (timeline)

#### 使用示例

```markdown
<!-- 流程图 -->
\`\`\`mermaid
graph TD
    A[开始] --> B{判断条件}
    B -->|是| C[执行操作A]
    B -->|否| D[执行操作B]
    C --> E[结束]
    D --> E
\`\`\`

<!-- 时序图 -->
\`\`\`mermaid
sequenceDiagram
    participant A as 用户
    participant B as 系统
    A->>B: 发送请求
    B-->>A: 响应数据
\`\`\`
```

#### 解析结果

```typescript
{
  type: 'mermaid',
  raw: '```mermaid\\ngraph TD\\n    A --> B\\n```',
  text: 'graph TD\\n    A --> B',
  lang: 'mermaid',
  diagramType: 'flowchart',
  tokens: []
}
```

### 3. 警告/提示框扩展

#### 支持的类型

- `NOTE`: 一般性信息提示
- `TIP`: 有用的建议或技巧
- `IMPORTANT`: 重要信息
- `WARNING`: 警告信息
- `CAUTION`: 需要小心的情况

#### 使用示例

```markdown
> [!NOTE]
> 这是一个注意事项

> [!TIP]
> 这是一个有用的提示

> [!IMPORTANT]
> 这是重要信息

> [!WARNING]
> 这是警告信息

> [!CAUTION]
> 这是需要小心的情况
```

#### 解析结果

```typescript
{
  type: 'alert',
  raw: '> [!NOTE]\\n> 这是一个注意事项',
  text: '这是一个注意事项',
  alertType: 'note',
  tokens: [/* 内容的tokens */]
}
```

### 4. 容器区块扩展

#### 支持的类型

- `tip`: 提示容器
- `warning`: 警告容器
- `danger`: 危险容器
- `info`: 信息容器
- `details`: 详情容器
- `quote`: 引用容器
- `code`: 代码容器
- `example`: 示例容器

#### 使用示例

```markdown
::: tip 提示标题
这是一个提示容器
支持**markdown格式**
:::

::: warning
这是一个警告容器（无标题）
:::

::: details 点击查看详情
这是一个可折叠的详情容器
可以包含大量内容
:::
```

#### 解析结果

```typescript
{
  type: 'container',
  raw: '::: tip 提示标题\\n这是一个提示容器\\n:::',
  text: '这是一个提示容器',
  containerType: 'tip',
  title: '提示标题',
  tokens: [/* 内容的tokens */]
}
```

## 高级用法

### 自定义扩展

如果需要创建自定义扩展，可以实现`TokenizerExtension`接口：

```typescript
import { TokenizerExtension } from './uni_modules/kux-marked/utssdk/ExtensionTokens.interface';

const customExtension: TokenizerExtension = {
  name: 'custom',
  level: 'block',
  priority: 50,
  tokenizer: (lexer, src, tokens) => {
    // 自定义解析逻辑
    const match = /^@custom\\{([^}]+)\\}/.exec(src);
    if (match) {
      return {
        type: 'custom',
        raw: match[0],
        text: match[1],
        tokens: []
      };
    }
    return null;
  }
};

// 注册自定义扩展
const lexer = new Lexer();
const registry = lexer.getExtensionRegistry();
registry.register(customExtension);
```

### 扩展管理

```typescript
const registry = lexer.getExtensionRegistry();

// 查看扩展信息
console.log('已注册扩展:', registry.getRegisteredNames());
console.log('扩展统计:', registry.getStats());

// 检查特定扩展
if (registry.hasExtension('mathInline')) {
  console.log('数学行内扩展已启用');
}

// 获取特定扩展
const mathExtension = registry.getExtension('mathInline');

// 取消注册扩展
registry.unregister('mathInline');

// 批量注册扩展
const extensions = [/* 扩展数组 */];
registry.registerMultiple(extensions);

// 清空所有扩展
registry.clear();
```

### 流式解析支持

扩展支持流式解析场景，可以在SSE等实时数据流中使用：

```typescript
// 扩展会在流式解析过程中实时处理新内容
const streamingContent = '这是一个包含 $E=mc^2$ 的流式内容...';
const tokens = lexer.lex(streamingContent);
```

## 性能优化

### 扩展优先级

扩展按优先级排序执行，数值越大优先级越高：

- 数学行内扩展: 100
- 数学块级扩展: 90
- Mermaid扩展: 80
- 警告框扩展: 70
- 容器扩展: 60

### 最佳实践

1. **合理使用扩展**: 只注册需要的扩展以提高性能
2. **正确的语法**: 确保使用正确的语法格式
3. **测试兼容性**: 在不同环境中测试扩展功能
4. **缓存结果**: 对于重复的内容，可以缓存解析结果

## 故障排除

### 常见问题

1. **数学公式不显示**
   - 检查语法是否正确
   - 确保没有多余的空格或换行

2. **Mermaid图表解析失败**
   - 验证图表语法是否正确
   - 检查是否使用了支持的图表类型

3. **警告框不生效**
   - 确保使用正确的语法格式
   - 检查类型是否在支持列表中

4. **容器区块显示异常**
   - 验证开始和结束标记是否匹配
   - 检查容器类型是否正确

### 调试方法

```typescript
// 启用调试模式
const lexer = new Lexer({ debug: true });

// 查看解析结果
const tokens = lexer.lex(markdown);
console.log('解析结果:', JSON.stringify(tokens, null, 2));

// 检查扩展状态
const registry = lexer.getExtensionRegistry();
console.log('扩展统计:', registry.getStats());
```

## 示例项目

完整的示例项目可以参考：

- [测试文档](./test/extension-test.md)
- [测试脚本](./test/extension-test.js)

这些文件包含了所有扩展功能的详细测试用例和使用示例。