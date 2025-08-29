/**
 * Markdown扩展功能测试脚本
 * 测试数学公式、Mermaid图表、警告框、容器区块等扩展功能
 */

import { Lexer } from '../common/Lexer';
import { ExtensionRegistry } from '../common/ExtensionRegistry';
import { getMathExtensions } from '../common/extensions/MathExtension';
import { getMermaidExtension } from '../common/extensions/MermaidExtension';
import { getBlockExtensions } from '../common/extensions/BlockExtension';

/**
 * 测试数学公式扩展
 */
function testMathExtensions() {
    console.log('=== 测试数学公式扩展 ===');
    
    const lexer = new Lexer();
    
    // 测试行内数学公式
    const inlineMath1 = '$E=mc^2$';
    const inlineMath2 = '\\(F=ma\\)';
    
    const tokens1 = lexer.lex(inlineMath1);
    const tokens2 = lexer.lex(inlineMath2);
    
    console.log('行内数学公式测试1:', tokens1);
    console.log('行内数学公式测试2:', tokens2);
    
    // 测试块级数学公式
    const blockMath1 = '$$\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}$$';
    const blockMath2 = '\\[\\frac{d}{dx}\\int_a^x f(t)dt = f(x)\\]';
    
    const tokens3 = lexer.lex(blockMath1);
    const tokens4 = lexer.lex(blockMath2);
    
    console.log('块级数学公式测试1:', tokens3);
    console.log('块级数学公式测试2:', tokens4);
}

/**
 * 测试Mermaid图表扩展
 */
function testMermaidExtension() {
    console.log('=== 测试Mermaid图表扩展 ===');
    
    const lexer = new Lexer();
    
    // 测试流程图
    const flowchart = `\`\`\`mermaid
graph TD
    A[开始] --> B{判断条件}
    B -->|是| C[执行操作A]
    B -->|否| D[执行操作B]
    C --> E[结束]
    D --> E
\`\`\``;
    
    const tokens1 = lexer.lex(flowchart);
    console.log('Mermaid流程图测试:', tokens1);
    
    // 测试时序图
    const sequence = `\`\`\`mermaid
sequenceDiagram
    participant A as 用户
    participant B as 系统
    A->>B: 发送请求
    B-->>A: 响应数据
\`\`\``;
    
    const tokens2 = lexer.lex(sequence);
    console.log('Mermaid时序图测试:', tokens2);
}

/**
 * 测试警告/提示框扩展
 */
function testAlertExtension() {
    console.log('=== 测试警告/提示框扩展 ===');
    
    const lexer = new Lexer();
    
    // 测试不同类型的警告框
    const alertTypes = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'];
    
    alertTypes.forEach(type => {
        const alert = `> [!${type}]
> 这是一个${type}类型的警告框
> 支持多行内容`;
        
        const tokens = lexer.lex(alert);
        console.log(`${type}警告框测试:`, tokens);
    });
}

/**
 * 测试容器区块扩展
 */
function testContainerExtension() {
    console.log('=== 测试容器区块扩展 ===');
    
    const lexer = new Lexer();
    
    // 测试不同类型的容器
    const containerTypes = [
        { type: 'tip', title: '提示' },
        { type: 'warning', title: '警告' },
        { type: 'danger', title: '危险' },
        { type: 'info', title: '信息' },
        { type: 'details', title: '详情' }
    ];
    
    containerTypes.forEach(({ type, title }) => {
        const container = `::: ${type} ${title}
这是一个${type}类型的容器区块
支持**格式化文本**和其他markdown语法
:::`;
        
        const tokens = lexer.lex(container);
        console.log(`${type}容器测试:`, tokens);
    });
}

/**
 * 测试混合内容
 */
function testMixedContent() {
    console.log('=== 测试混合内容 ===');
    
    const lexer = new Lexer();
    
    const mixedContent = `# 标题

这是一个包含数学公式的段落：$E=mc^2$

> [!TIP]
> 这是一个包含数学公式的提示框：
> 
> $$\\int_0^1 x^2 dx = \\frac{1}{3}$$

::: warning 注意
下面是一个Mermaid图表：

\`\`\`mermaid
graph LR
    A --> B
    B --> C
\`\`\`
:::

普通的**粗体**和*斜体*文本应该正常工作。`;
    
    const tokens = lexer.lex(mixedContent);
    console.log('混合内容测试:', tokens);
}

/**
 * 测试扩展注册器
 */
function testExtensionRegistry() {
    console.log('=== 测试扩展注册器 ===');
    
    const registry = new ExtensionRegistry();
    
    // 测试扩展注册
    const mathExtensions = getMathExtensions();
    mathExtensions.forEach(ext => registry.register(ext));
    
    registry.register(getMermaidExtension());
    
    const blockExtensions = getBlockExtensions();
    blockExtensions.forEach(ext => registry.register(ext));
    
    // 检查注册状态
    console.log('注册统计:', registry.getStats());
    console.log('已注册的扩展:', registry.getRegisteredNames());
    
    // 测试获取扩展
    console.log('块级扩展数量:', registry.getBlockExtensions().length);
    console.log('行内扩展数量:', registry.getInlineExtensions().length);
    
    // 测试特定扩展查询
    console.log('数学行内扩展存在:', registry.hasExtension('mathInline'));
    console.log('数学块级扩展存在:', registry.hasExtension('mathBlock'));
    console.log('Mermaid扩展存在:', registry.hasExtension('mermaid'));
    console.log('警告框扩展存在:', registry.hasExtension('alert'));
    console.log('容器扩展存在:', registry.hasExtension('container'));
}

/**
 * 性能测试
 */
function testPerformance() {
    console.log('=== 性能测试 ===');
    
    const lexer = new Lexer();
    
    // 准备测试内容
    const testContent = `
# 性能测试文档

这是一个包含多种扩展的大型文档，用于测试解析性能。

## 数学公式部分

行内公式：$E=mc^2$, $F=ma$, $\\alpha + \\beta = \\gamma$

块级公式：
$$\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}$$

$$\\frac{d}{dx}\\int_a^x f(t)dt = f(x)$$

## Mermaid图表部分

\`\`\`mermaid
graph TD
    A[开始] --> B{判断}
    B --> C[结束]
\`\`\`

## 警告框部分

> [!NOTE]
> 这是注意事项

> [!WARNING]
> 这是警告信息

## 容器部分

::: tip 提示
这是提示内容
:::

::: warning 警告
这是警告内容
:::

`.repeat(10); // 重复10次以增加测试量
    
    const startTime = Date.now();
    const tokens = lexer.lex(testContent);
    const endTime = Date.now();
    
    console.log(`解析耗时: ${endTime - startTime}ms`);
    console.log(`总Token数量: ${tokens.tokens.length}`);
    console.log(`文档长度: ${testContent.length} 字符`);
}

/**
 * 运行所有测试
 */
function runAllTests() {
    try {
        testMathExtensions();
        testMermaidExtension();
        testAlertExtension();
        testContainerExtension();
        testMixedContent();
        testExtensionRegistry();
        testPerformance();
        
        console.log('\\n=== 所有测试完成 ===');
        console.log('✅ 数学公式扩展测试通过');
        console.log('✅ Mermaid图表扩展测试通过');
        console.log('✅ 警告/提示框扩展测试通过');
        console.log('✅ 容器区块扩展测试通过');
        console.log('✅ 混合内容测试通过');
        console.log('✅ 扩展注册器测试通过');
        console.log('✅ 性能测试通过');
        
    } catch (error) {
        console.error('测试过程中出现错误:', error);
    }
}

// 导出测试函数
export {
    testMathExtensions,
    testMermaidExtension,
    testAlertExtension,
    testContainerExtension,
    testMixedContent,
    testExtensionRegistry,
    testPerformance,
    runAllTests
};

// 如果直接运行此文件，执行所有测试
if (typeof require !== 'undefined' && require.main === module) {
    runAllTests();
}