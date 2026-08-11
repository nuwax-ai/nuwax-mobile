# nuwax-katex

基于 **KaTeX** 的 uni-app x 数学公式**实时渲染**组件（类似 lime-katex），支持 H5 / Android / iOS / 微信小程序。App 端用 `<web-view>` 直接承载 KaTeX 渲染（**非 html2canvas 截图**），流式输出时公式逐字实时更新。

## 特性

- ✅ 实时动态渲染：`tex` 变化即重渲染（AI 流式输出友好），不做任何图片化
- ✅ 跨平台：H5（v-html 真实 DOM）/ 微信小程序（rich-text）/ Android、iOS（web-view 承载 KaTeX）
- ✅ **标准基座即可运行**（App 端无需自定义基座，对比 lime-katex 的原生引擎方案更轻）
- ✅ 自包含：内置 KaTeX 0.16.22（含字体），无需 `npm install katex`
- ✅ 行内 / 块级（displayMode）、字号、颜色可配
- ✅ 配套 `splitMathSegments()`：把 `$...$` / `$$...$$` 正文切分为片段，便于聊天消息混排

## 安装

把 `uni_modules/nuwax-katex/` 目录拷入项目 `uni_modules/` 即可（easycom 自动扫描，或在页面显式 import）。

## 使用

```html
<template>
  <!-- 行内公式 -->
  <text>勾股定理：</text>
  <nuwax-katex :tex="'a^2 + b^2 = c^2'" />

  <!-- 块级公式 -->
  <nuwax-katex
    :tex="'\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}'"
    :display-mode="true"
  />

  <!-- 自定义字号/颜色（流式更新：tex 变化自动重渲染） -->
  <nuwax-katex :tex="streamTex" :font-size="18" color="#2563eb" />
</template>
```

### Props

| 属性 | 类型 | 说明 |
|---|---|---|
| `tex` | string | 原始 LaTeX（不含 `$` 定界符），必填 |
| `displayMode` | boolean | `true`=块级居中，`false`/缺省=行内 |
| `fontSize` | number | 字号 px；缺省行内 16、块级 13（与聊天正文一致） |
| `color` | string | 公式颜色；缺省跟随主题 |

### Events

- `@load`：渲染完成，`detail = { width, height }`（App 端为 web-view 内容尺寸）
- `@error`：渲染失败，`detail = { errMsg }`

### 正文混排（聊天页集成）

```ts
import { splitMathSegments } from '@/uni_modules/nuwax-katex'

const segs = splitMathSegments('设 $x>0$，则 $$\\int_0^1 x dx = \\frac{1}{2}$$ 成立')
// → [{type:'text',content:'设 '}, {type:'inline',content:'x>0'} ... {type:'block',content:'\\int_0^1 x dx = \\frac{1}{2}'} ...]
```

把片段渲染成 `<text>` 与 `<nuwax-katex>` 交替即可（见 `example/pages/nuwax-katex/index.uvue`）。

## 各平台实现

| 平台 | 渲染方式 | 实时更新 |
|---|---|---|
| H5 | `v-html` 注入 KaTeX HTML（真实 DOM） | tex 变化重算 HTML |
| 微信小程序 | KaTeX → HTML → **关键 CSS 内联** → `rich-text` | 同上 |
| Android / iOS | `web-view` 本地 `static/index.html` 承载 KaTeX | `evalJS("window.nkRender(...)")` 增量渲染，不重载页面；尺寸经 postMessage / `@contentheightchange` 自适应 |

## 注意事项

- **反斜杠转义**：uvue 模板属性里 `\` 会被转义（如 `\f` → 换页符），务必用 `:tex` 动态绑定并写双反斜杠：`:tex="'\\frac{a}{b}'"`。
- **小程序限制**（与 lime-katex 小程序同级别）：小程序无 KaTeX 字体，`\mathcal`/`\mathbb` 等回退系统字体；超大定界符走 SVG（rich-text 不支持 `svg` 标签）会缺失；复杂矩阵/多行环境建议先真机验证。
- **App 端 web-view**：每个公式一个轻量 web-view（虚拟列表下只渲染可视项，实例数有界）；公式内容超宽时由外层 `scroll-view` 横向滚动。
- **H5 easycom**：自动扫描不可靠时显式 import：`import NuwaxKatex from "@/uni_modules/nuwax-katex/components/nuwax-katex/nuwax-katex.uvue"`。

## 结构

```
components/nuwax-katex/nuwax-katex.uvue  组件（三端条件编译）
utssdk/                                  平台实现（interface + web/mp-weixin/app 占位）
js_sdk/tex-splitter.uts                  正文切分（$...$/$$...$$）
static/                                   App web-view 页面 + KaTeX 资源 + 字体
example/pages/nuwax-katex/index.uvue     Demo
```

## Changelog

- 0.0.1 初始版本：三端实时渲染、正文切分、Demo 页
