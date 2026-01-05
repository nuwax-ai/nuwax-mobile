# 主包大小优化说明

## 问题描述
主包大小：3378KB，超过微信小程序 2MB（2048KB）限制。

## 优化措施

### 1. 删除未使用的 uni-ai-x 静态资源

#### 已删除的资源：
- **ai-provider 图片**（672K）：所有 AI 服务商 logo 图片
  - azure.png, baidu.png, bailian.png, deepseek.png
  - doubao.png, ifly.png, minimax.png, openai.png
  - qwen.png, siliconflow.png
  - 说明：项目中只使用了 bailian，其他图片未使用

- **uni-chat-logo.png**（188K）
  - 说明：代码中已被注释掉，未使用

- **default-avatar.png**（4K）
  - 说明：未使用

#### 已删除的字体：
- **uni-ai-x/static/font/FiraCode-Regular.ttf**（284K）
  - 说明：代码块字体，项目中未直接使用

### 2. 删除 mp-html 中的字体资源

#### 已删除的字体：
- **mp-html/static/font/FiraCode-Regular.ttf**（283K）
  - 说明：代码高亮字体，已修复引用

### 3. 优化 KaTeX 数学公式字体

#### 已删除的不常用字体：
- **KaTeX_Typewriter-Regular.ttf**（27K）
- **KaTeX_Size3-Regular.ttf**（7.4K）
- **KaTeX_Size4-Regular.ttf**（10K）

#### 保留的必要字体：
- KaTeX_AMS-Regular.ttf（62K）
- KaTeX_Main-Regular.ttf（52K）
- KaTeX_Main-Bold.ttf（50K）
- KaTeX_Main-Italic.ttf（33K）
- KaTeX_Main-BoldItalic.ttf（32K）
- KaTeX_Math-Italic.ttf（31K）
- KaTeX_Math-BoldItalic.ttf（30K）
- KaTeX_SansSerif-Regular.ttf（19K）
- KaTeX_SansSerif-Bold.ttf（24K）
- KaTeX_SansSerif-Italic.ttf（22K）
- KaTeX_Size1-Regular.ttf（12K）
- KaTeX_Size2-Regular.ttf（11K）

## 优化效果统计

### 已删除的资源总大小：
- ai-provider 图片：672K
- uni-chat-logo.png：188K
- FiraCode 字体（uni-ai-x）：284K
- FiraCode 字体（mp-html）：283K
- KaTeX Typewriter 字体：27K
- KaTeX Size3 字体：7.4K
- KaTeX Size4 字体：10K
- **总计：约 1.48MB**

### 预期优化后主包大小：
- 优化前：3378KB（约 3.3MB）
- 优化后：预计 < 1900KB（约 1.9MB）
- **减小：约 1.48MB**

## 修改的文件

1. **uni_modules/mp-html/components/mp-html/styles/highlight.scss**
   - 注释掉 FiraCode 字体引用

2. **uni_modules/mp-html/components/mp-html/styles/katex-fonts.scss**
   - 注释掉 Typewriter、Size3、Size4 字体定义

3. **删除的文件**
   - `uni_modules/uni-ai-x/static/ai-provider/*.png`
   - `uni_modules/uni-ai-x/static/uni-chat-logo.png`
   - `uni_modules/uni-ai-x/static/default-avatar.png`
   - `uni_modules/uni-ai-x/static/font/FiraCode-Regular.ttf`
   - `uni_modules/mp-html/static/font/FiraCode-Regular.ttf`
   - `static/fonts/KaTeX_Typewriter-Regular.ttf`
   - `static/fonts/KaTeX_Size3-Regular.ttf`
   - `static/fonts/KaTeX_Size4-Regular.ttf`

## 注意事项

1. **FiraCode 字体**：如果未来需要代码高亮字体，需要重新添加并修改引用

2. **KaTeX 特殊字体**：
   - Typewriter 字体已删除，某些等宽文本可能显示异常
   - Size3、Size4 字体已删除，特大字号可能显示异常

3. **AI Provider 图片**：如果未来需要添加新的 AI 服务商，需要在 `uni_modules/uni-ai-x/static/ai-provider/` 目录下添加对应的 logo 图片

4. **验证方法**：
   - 重新构建项目
   - 检查主包大小是否 < 2MB
   - 测试数学公式渲染是否正常
   - 测试代码块显示是否正常

## 后续优化建议

如果主包仍然超过 2MB，可以考虑：
1. 启用分包策略（subPackages）
2. 进一步压缩图片资源
3. 移除更多未使用的组件和模块
4. 使用 CDN 加载静态资源

