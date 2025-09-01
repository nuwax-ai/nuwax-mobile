# Math Renderer 数学公式渲染器演示页面

## 概述

这是一个用于测试 `uni-ai-math-renderer` 组件的演示页面，展示了各种数学公式的渲染效果和组件的功能特性。

## 功能特性

### 1. 内联数学公式测试
- **简单公式**: `x + y = z`
- **分数公式**: `\frac{a}{b} + \frac{c}{d}`
- **指数公式**: `x^2 + y^3 = z^n`
- **根式公式**: `\sqrt{x} + \sqrt[3]{y}`

### 2. 块级数学公式测试
- **二次方程**: `ax^2 + bx + c = 0`
- **求和公式**: `\sum_{i=1}^{n} x_i = x_1 + x_2 + \cdots + x_n`
- **积分公式**: `\int_{a}^{b} f(x) dx = F(b) - F(a)`
- **矩阵公式**: `\begin{pmatrix} a & b \\ c & d \end{pmatrix}`

### 3. 复杂数学公式测试
- **泰勒级数**: `f(x) = f(a) + f'(a)(x-a) + \frac{f''(a)}{2!}(x-a)^2 + \cdots`
- **傅里叶变换**: `F(\omega) = \int_{-\infty}^{\infty} f(t) e^{-i\omega t} dt`
- **概率公式**: `P(A|B) = \frac{P(B|A)P(A)}{P(B)}`

### 4. 希腊字母和特殊符号测试
- **希腊字母**: `\alpha, \beta, \gamma, \delta, \epsilon, \theta, \lambda, \mu, \pi, \sigma, \phi, \psi, \omega`
- **数学符号**: `\infty, \partial, \nabla, \forall, \exists, \in, \subset, \cup, \cap, \oplus, \otimes`

### 5. GPT 风格数学公式测试
- **GPT 行内公式**: `(\frac{a}{b} + \frac{c}{d})` → 自动转换为 `\(\frac{a}{b} + \frac{c}{d}\)`
- **GPT 块级公式**: `([\sum_{i=1}^{n} x_i])` → 自动转换为 `\[\sum_{i=1}^{n} x_i\]`
- **混合格式**: 支持在同一文本中混合使用多种格式

### 6. 自定义输入测试
- 支持用户输入自定义数学公式
- 实时预览渲染效果
- 可切换内联/块级显示模式
- 快速测试按钮：GPT 行内、GPT 块级、标准 LaTeX

### 7. 显示模式切换
- 支持内联显示 (Inline Mode)
- 支持块级显示 (Block Mode)
- 动态切换显示模式

## 使用方法

### 1. 访问演示页面
在项目中导航到 `examples/math-renderer-demo.uvue` 页面。

### 2. 测试预设公式
页面会自动显示各种预设的数学公式，包括：
- 基础数学运算
- 高等数学公式
- 特殊符号和希腊字母

### 3. 测试自定义公式
1. 在"自定义输入测试"区域输入数学公式
2. 点击"测试公式"按钮
3. 查看渲染效果
4. 使用"切换模式"按钮改变显示方式

### 4. 观察渲染效果
- 内联模式：公式与文本在同一行显示
- 块级模式：公式独占一行，居中显示

## 组件属性

### `text` (string)
- **描述**: 要渲染的数学公式文本
- **必填**: 是
- **示例**: `"x^2 + y^2 = r^2"`

### `displayMode` (boolean)
- **描述**: 显示模式
- **默认值**: `false`
- **说明**: 
  - `false`: 内联显示模式
  - `true`: 块级显示模式

## 样式定制

演示页面包含了完整的样式定义，包括：

### 基础样式
- 响应式布局设计
- 卡片式界面风格
- 清晰的视觉层次

### 数学公式样式
- 等宽字体显示
- 背景色和边框
- 内联/块级模式区分

### 交互元素样式
- 按钮悬停效果
- 输入框焦点状态
- 切换按钮状态指示

## 注意事项

1. **LaTeX 语法**: 数学公式使用 LaTeX 语法，需要正确转义反斜杠
2. **平台兼容性**: 在不支持 KaTeX 的平台上，公式会以原始文本形式显示
3. **性能考虑**: 复杂公式可能影响渲染性能
4. **样式覆盖**: 使用 `:deep()` 选择器来覆盖组件内部样式

## 扩展功能

### 添加新的测试用例
在相应的 `demo-section` 中添加新的 `demo-item`：

```vue
<view class="demo-item">
    <text class="item-label">新公式类型：</text>
    <uni-ai-math-renderer 
        :text="'新的数学公式'" 
        :displayMode="false" 
    />
</view>
```

### 自定义样式
修改 `<style>` 部分来调整外观：

```scss
:deep(.math-renderer) {
    // 自定义样式
    background-color: #your-color;
    font-size: 16rpx;
}
```

## 故障排除

### 常见问题

1. **公式不显示**
   - 检查 LaTeX 语法是否正确
   - 确认组件是否正确导入

2. **样式不生效**
   - 使用 `:deep()` 选择器
   - 检查 CSS 优先级

3. **性能问题**
   - 避免同时渲染过多复杂公式
   - 考虑使用懒加载

## 相关文件

- **组件文件**: `uni_modules/uni-ai-x/components/uni-ai-math-renderer/uni-ai-math-renderer.uvue`
- **演示页面**: `examples/math-renderer-demo.uvue`
- **说明文档**: `examples/MATH_RENDERER_DEMO_README.md`
- **工具函数**: `utils/gptMathConverter.uts`
- **测试文件**: `examples/gpt-math-converter-test.uts`

## 更新日志

- **v1.0.0**: 初始版本，包含基础数学公式测试
- 支持内联和块级显示模式
- 包含自定义输入测试功能
- 完整的样式和交互设计

- **v1.1.0**: 新增 GPT 风格数学公式支持
- 支持 GPT 生成的行内公式 `(\( ... \))`
- 支持 GPT 生成的块级公式 `(\[ ... \])`
- 自动转换为标准 LaTeX 格式
- 新增快速测试按钮和调试信息
- 创建独立的工具函数库和测试套件
