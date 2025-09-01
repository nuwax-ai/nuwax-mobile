# kux-marked Lexer.uts 功能解读文档

## 概述

`Lexer.uts` 是 `kux-marked` 模块的核心组件，负责将 Markdown 文本解析为结构化的 Token 数组。它是整个 Markdown 解析流程的第一步，将原始文本转换为可以被后续 Parser 和 Renderer 处理的中间表示。

## 核心功能

### 1. **词法分析 (Lexical Analysis)**
- **文本预处理**: 处理换行符、制表符等特殊字符
- **Token 生成**: 将 Markdown 文本分解为不同类型的 Token
- **状态管理**: 维护解析过程中的上下文状态

### 2. **双阶段解析**
- **块级解析 (Block Parsing)**: 处理标题、段落、列表、代码块等块级元素
- **行内解析 (Inline Parsing)**: 处理粗体、斜体、链接、图片等行内元素

### 3. **扩展支持**
- **自定义 Tokenizer**: 支持通过扩展添加新的解析规则
- **规则配置**: 支持 pedantic、GFM 等不同的解析模式

## 架构设计

### 类结构图

```
Lexer
├── tokens: TokensList          // Token 存储容器
├── options: MarkedOptions      // 解析配置选项
├── state: I_LexerState        // 解析状态管理
├── tokenizer: I_Tokenizer     // Token 生成器
└── inlineQueue: I_LexerInlineQueue[] // 行内解析队列
```

### 接口定义

```typescript
interface I_Lexer {
  tokens: TokensList;           // Token 列表
  options: MarkedOptions;       // 配置选项
  state: I_LexerState;         // 解析状态
  
  lex(src: string): TokensList;                    // 主解析方法
  blockTokens(...): NodesToken[] | TokensList;     // 块级解析
  inline(src: string, tokens?): NodesToken[];     // 行内解析入口
  inlineTokens(...): NodesToken[];                 // 行内解析实现
}
```

## 核心方法详解

### 1. **主解析方法 `lex()`**

```typescript
lex(srcSource: string): TokensList {
  let src = srcSource;
  // 1. 预处理：统一换行符
  src = src.replace(other.carriageReturn, '\n');
  
  // 2. 块级解析
  this.blockTokens(src, this.tokens, null);
  
  // 3. 行内解析队列处理
  for (let i = 0; i < this.inlineQueue.length; i++) {
    const next = this.inlineQueue[i];
    this.inlineTokens(next.src, next.tokens);
  }
  
  return this.tokens;
}
```

**执行流程**:
1. **文本预处理**: 统一换行符格式
2. **块级解析**: 识别并解析块级元素
3. **行内解析**: 处理所有行内元素
4. **返回结果**: 完整的 Token 列表

### 2. **块级解析 `blockTokens()`**

```typescript
blockTokens(src: string, tokens: NodesToken[], lastParagraphClipped: boolean) {
  while (src.length > 0) {
    let token: NodesToken | null = null;
    
    // 1. 扩展 Tokenizer 优先处理
    if (this.options.extensions?.block?.some((extTokenizer) => {
      token = extTokenizer({ lexer: this }, src, tokens);
      return token != null;
    })) {
      continue;
    }
    
    // 2. 标准 Token 类型识别
    // - newline (换行)
    // - code (代码块)
    // - fences (围栏代码)
    // - heading (标题)
    // - hr (分割线)
    // - blockquote (引用)
    // - list (列表)
    // - html (HTML 标签)
    // - def (定义)
    // - table (表格)
    // - lheading (行内标题)
    // - paragraph (段落)
    // - text (文本)
  }
}
```

**支持的块级元素**:
- **标题**: `# ## ###` 等各级标题
- **代码块**: ``` ```javascript\n代码内容\n``` ```
- **引用**: `> 引用内容`
- **列表**: `- * +` 或 `1. 2. 3.`
- **表格**: GFM 表格语法
- **分割线**: `---` 或 `***`
- **HTML**: 原生 HTML 标签

### 3. **行内解析 `inlineTokens()`**

```typescript
inlineTokens(src: string, tokens: NodesToken[]) {
  while (src.length > 0) {
    let token: NodesToken | null = null;
    
    // 1. 扩展 Tokenizer 优先处理
    if (this.options.extensions?.inline?.some((extTokenizer) => {
      token = extTokenizer({ lexer: this }, src, tokens);
      return token != null;
    })) {
      continue;
    }
    
    // 2. 标准行内 Token 类型识别
    // - escape (转义字符)
    // - tag (HTML 标签)
    // - link (链接)
    // - reflink (引用链接)
    // - emStrong (粗体/斜体)
    // - codespan (行内代码)
    // - br (换行)
    // - del (删除线)
    // - autolink (自动链接)
    // - url (URL)
    // - text (文本)
  }
}
```

**支持的行内元素**:
- **文本样式**: `**粗体**` `*斜体*` `~~删除线~~`
- **行内代码**: `` `代码` ``
- **链接**: `[链接文本](URL)`
- **图片**: `![alt](图片URL)`
- **转义**: `\*` `\[` `\(`

## 扩展机制

### 1. **扩展 Tokenizer 接口**

```typescript
interface TokenizerExtension {
  name: string;           // 扩展名称
  level: 'block' | 'inline'; // 扩展级别
  tokenizer: (this: TokenizerThis, src: string, tokens: NodesToken[]) => NodesToken | null;
}
```

### 2. **扩展处理流程**

```typescript
// 块级扩展
if (this.options.extensions?.block?.some((extTokenizer) => {
  token = extTokenizer({ lexer: this }, src, tokens);
  if (token != null) {
    src = src.substring(token.raw.length);
    this._pushTokens(tokens, token);
    return true;
  }
  return false;
})) {
  continue;
}

// 行内扩展
if (this.options.extensions?.inline?.some((extTokenizer) => {
  token = extTokenizer({ lexer: this }, src, tokens);
  if (token != null) {
    src = src.substring(token.raw.length);
    this._pushTokens(tokens, token);
    return true;
  }
  return false;
})) {
  continue;
}
```

### 3. **扩展优先级**
- **扩展优先**: 自定义扩展在标准规则之前执行
- **顺序执行**: 按扩展数组顺序依次尝试
- **短路返回**: 一旦扩展成功匹配，立即处理

## 状态管理

### 1. **解析状态**

```typescript
interface I_LexerState {
  inLink: boolean;        // 是否在链接内
  inRawBlock: boolean;    // 是否在原始块内
  top: boolean;           // 是否在顶层
}
```

### 2. **状态维护**

```typescript
// 链接状态管理
if (tagToken.inLink) {
  this.state.inLink = true;
}

// 原始块状态管理
if (htmlToken.block) {
  this.state.inRawBlock = true;
}

// 顶层状态管理
this.state.top = true;
```

## 性能优化特性

### 1. **增量解析**
- **流式处理**: 逐字符处理，避免一次性加载大文本
- **状态缓存**: 维护解析状态，避免重复计算
- **队列优化**: 行内解析队列，批量处理提高效率

### 2. **内存管理**
- **Token 复用**: 相同类型的 Token 共享结构
- **字符串截取**: 使用 `substring` 避免字符串复制
- **引用传递**: 通过引用传递 Token 列表

### 3. **错误处理**
- **无限循环检测**: 防止解析器陷入死循环
- **静默模式**: 支持静默错误处理
- **异常抛出**: 提供详细的错误信息

## 使用示例

### 1. **基础用法**

```typescript
import { Lexer } from './common/Lexer';
import { MarkedOptions } from './utssdk/MarkedOptions.interface';

// 创建配置
const options = new MarkedOptions();
options.gfm = true;  // 启用 GFM 模式

// 创建解析器
const lexer = new Lexer(options);

// 解析 Markdown
const tokens = lexer.lex('# Hello World\n\nThis is **bold** text.');
```

### 2. **扩展支持**

```typescript
// 自定义数学公式 Tokenizer
const mathExtension = {
  name: 'math',
  level: 'inline',
  tokenizer: (this: TokenizerThis, src: string, tokens: NodesToken[]) => {
    const match = src.match(/^\$([^$\n]+?)\$/);
    if (match) {
      return {
        type: 'math',
        raw: match[0],
        text: match[1],
        mathType: 'inline',
        tokens: []
      } as NodesToken;
    }
    return null;
  }
};

// 添加到扩展
options.extensions = {
  inline: [mathExtension]
};
```

## 技术特点

### 1. **跨平台兼容**
- **UTS 语言**: 使用 UTS 语言编写，支持多平台
- **条件编译**: 针对不同平台使用不同的正则表达式实现
- **统一接口**: 提供一致的 API 接口

### 2. **高度可扩展**
- **插件架构**: 支持自定义 Tokenizer 扩展
- **规则配置**: 支持多种解析模式
- **钩子机制**: 提供解析过程中的钩子点

### 3. **性能优化**
- **流式解析**: 支持大文本的流式处理
- **内存优化**: 最小化内存分配和复制
- **缓存机制**: 智能缓存提高重复解析效率

## 总结

`Lexer.uts` 是 `kux-marked` 模块的核心组件，它通过双阶段解析（块级 + 行内）将 Markdown 文本转换为结构化的 Token 数组。其设计具有以下优势：

1. **模块化设计**: 清晰的职责分离和接口定义
2. **高度可扩展**: 支持自定义 Tokenizer 和解析规则
3. **性能优化**: 流式解析和内存优化
4. **跨平台兼容**: 基于 UTS 语言的多平台支持
5. **错误处理**: 完善的错误检测和处理机制

这个 Lexer 为整个 Markdown 解析流程提供了坚实的基础，使得后续的 Parser 和 Renderer 能够高效地处理各种 Markdown 元素。
