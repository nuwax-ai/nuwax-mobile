# 会话 Markdown 渲染能力清单（对齐 PC Web）

> 维度：**已支持 ✅ / 不完善 ⚠️ / 待开发 ❌**，并对照 **PC web（基准）** 与 **main 分支旧版（mp-html，仅 H5/小程序）**。
> 生成日期：2026-08-05　分支：`feat/nuwa-zhuoda-2026.07`
> 同步说明：本清单随 `12397a98`（对齐主线）及后续 `9dd609ad` / `ac6333f5` / `935a7552` 更新；未提交 WIP 见文末。

## 三种渲染方案背景

| 方案 | 原理 | 平台 | 状态 |
|---|---|---|---|
| **main 旧版（mp-html）** | `mp-html` 内嵌 katex → KaTeX 直接渲成 HTML 节点嵌在富文本 | 仅 H5/小程序（依赖 DOM） | 已在 `1a47dc00` 移除 |
| **PC web（基准）** | `ds-markdown`（内包 react-markdown 10.1）+ remark/rehype 生态，原生 HTML 矢量渲染 | Web | 对齐目标 |
| **当前分支（proxy-web）** | 隐藏 web-view KaTeX → html2canvas 截 PNG → `<image>` 回填；H5 另保留 v-html 原生 | App + H5 + 小程序 | 当前主线 |

**关键机制**：会话 markdown 有两条解析路径（调度 [aiMsgMarkdownParser.uts](subpackages/components/ai-msg/aiMsgMarkdownParser.uts)）——纯文本流式走 **uni-cmark**（cmark-gfm 全语法）；一旦含 ```` ``` ````/`![`/`$$`/`\[`/`\(`/表格/自定义标签，**整段切到自研 fallback**（[appMarkdownFallback.uts](subpackages/components/ai-msg/appMarkdownFallback.uts)）。fallback 的 `parseInline` 在 `12397a98` 已补齐多数行内语法；剩余缺口主要是嵌套列表、任务列表、图片错误占位等。

---

## 一、块级结构

| 能力 | 状态 | PC web | main 旧版(mp-html) | 说明 / 缺口 |
|---|---|---|---|---|
| 标题 H1-H6 | ⚠️ 不完善 | ✅ | ✅ | 含行内公式混排；**App 行内公式为原文降级**（见「App 行内公式混排」） |
| 段落 | ⚠️ 不完善 | ✅ | ✅ | **App 含行内公式段落不走 mixed-box**，走 `uni-ai-text-md` 显示裸 LaTeX |
| 有序/无序列表 | ⚠️ 不完善 | ✅ | ✅ | 含行内公式混排；**App 行内公式为原文降级** |
| 代码块 + 语法高亮 | ✅ | ✅ | ✅ | App+H5 统一 `parseLineCode`（uni-highlight/TextMate）。**关键**：含 ```` ``` ```` 的消息整段走 fallback，故高亮须在 fallback 代码块分支接入（`appMarkdownFallback.uts:highlightCodeBlock`）；SDK `parseMarkdown.uts` 的 `#ifdef WEB` 跳过已移除。曾误标 ✅（App 实走 fallback 未分词→纯文本），现已修复。未提交 WIP：H5 wasm 路径校验、App 高亮全局串行 |
| 行内代码 `` ` `` | ✅ | ✅ | ✅ | |
| 表格 GFM | ✅ | ✅ | ✅ | 横滚 + 复制/下载 markdown + 单元格公式 + 对齐 + 空表头剔除 |
| 引用块 `>` | ✅ | ✅ | ✅ | `12397a98` fallback 已识别连续 `>` 行，引用内支持行内公式/斜体/删除线 |
| 水平线 `---` | ❌ 刻意忽略 | ✅ | ✅ | 双端刻意跳过（避免 `$$` 后误产横线），如需 hr 则无 |
| 任务列表 `- [ ]` | ❌ 待开发 | ✅ | ❌ | fallback 仅当普通列表，无交互 checkbox |
| 嵌套列表 | ⚠️ 不完善 | ✅ | ✅ | fallback 只认单层 `[-+*]`/`\d+`，嵌套层级不解析 |

## 二、数学公式

| 能力 | 状态 | PC web | main 旧版(mp-html) | 说明 / 缺口 |
|---|---|---|---|---|
| inline `$...$` | ⚠️ 不完善 | ✅ | ✅ | **H5** v-html 正常。**App 当前降级为 LaTeX 原文**（`uni-ai-x-msg.uvue`：`hasMathToken` 在 App 恒 false，段落不走 mixed-box；列表/标题 math token 直接 `<text>{{ token.text }}</text>`）。根因：uvue `<text>` 不能嵌 `<image>`，行内公式截图混排会断行/留白；块级公式不受影响 |
| inline `\(...\)` | ⚠️ 不完善 | ✅ | ✅ | 解析已识别（`12397a98` fallback）；**App 展示同 `$...$`，仍为原文降级** |
| block `$$...$$` | ✅ | ✅ | ✅ | |
| block `\[...\]` | ✅ | ✅ | ✅ | `12397a98` 支持跨行闭合；未闭合不渲 |
| ```` ```math ```` 代码块 | ✅ | — | ❌ | mobile 特有 |
| 公式闭合才渲染（流式） | ✅ | ✅(隐式) | — | 未闭合不渲、等补全 |
| KaTeX 磁盘缓存 + 并发去重 | ✅ | — | ❌ | App 截图优化 |
| **H5 公式换行/折断** | ✅ | ✅(原生矢量) | ✅ | 已治本：`displayMode` 区分 + `::v-deep` 穿透 scoped（`ac6333f5`）+ nowrap + 超长横滚（`935a7552`）。未提交 WIP：放得下居中无滚动条、宽扁才套最小高度 |
| **App 行内公式混排** | ⚠️ **待优化** | ✅(原生矢量) | ✅ | **当前 App 段落/列表/标题行内公式显示 LaTeX 原文**，非 KaTeX 图。待优化方向：行内截图尺寸/基线对齐、flex 混排不断行、或原生矢量方案；表格单元格仍走 `katex-el`（待一并验证） |

## 三、图表 / 媒体

| 能力 | 状态 | PC web | main 旧版(mp-html) | 说明 / 缺口 |
|---|---|---|---|---|
| mermaid 出图 | ✅ | ✅(SVG) | ❌ | `12397a98` fallback 识别 ```` ```mermaid ````；`9dd609ad` 修多图串台（唯一 id + 串行截图） |
| mermaid 闭合才渲染 | ✅ | ✅ | — | fence 未闭合不走进出图，等补全 |
| mermaid 大图自适应 | ✅ | ✅ | — | `renderMermaid` 回传真实宽高，容器按宽高比自适应（去 400px 写死） |
| mermaid 失败回退 | ✅ | ✅(回退源码) | — | href 空时图表 Tab 提示失败，可手动切代码 Tab 看源码 |
| mermaid 小程序 | ❌ 不支持 | — | — | 显示提示文案（web-view 限制，不打通） |
| 图片 `![alt](url)` | ✅ | ✅ | ✅ | 原位渲染 + 点击 previewImage + 流式未闭合剥离 |
| 图片错误占位 | ⚠️ 不完善 | ✅(fallback 占位图) | ✅ | 加载失败无占位图 |

## 四、行内样式 / 链接

| 能力 | 状态 | PC web | main 旧版(mp-html) | 说明 / 缺口 |
|---|---|---|---|---|
| 加粗 `**` | ✅ | ✅ | ✅ | |
| 斜体 `*` | ✅ | ✅ | ✅ | `12397a98` fallback 支持 `*text*`（跳过 `**`）；**下划线 `_text_` 仍不支持** |
| 删除线 `~~` | ✅ | ✅ | ✅ | `12397a98` fallback 产出 `.del` |
| 链接 `[t](url)` | ✅ | ✅ | ✅ | 跳内置 webview 页 |
| 裸 URL autolink | ✅ | ✅(remark-gfm) | ✅ | `12397a98` fallback 识别 `http(s)://`，跳过已在 markdown 链接内的 URL |
| `conversation://` 内部链接 | ✅ | ✅ | ✅ | 跳会话详情 |
| citation 角标溯源 `[1]` | ❌ 待开发 | ❌(PC 也无) | ❌ | 双端均未做 |

## 五、自定义标签（Agent 体系）

| 能力 | 状态 | PC web | main 旧版(mp-html) | 说明 |
|---|---|---|---|---|
| `<markdown-custom-process>` 工具卡 | ✅ | ✅ | ✅ | 工具体系完整 |
| `<markdown-custom-process-group>` 工具组 | ✅ | ✅ | ✅ | 可折叠 |
| `:::container` 历史语法 | ✅ | — | ✅ | 兼容适配 |
| `<task-result>` 任务产物卡 | ✅ | ✅ | ✅ | |
| `<conversation>` 会话链接 | ✅ | ✅ | ✅ | |
| `<agent-info>` 智能体标识 | ✅ | ✅ | ✅ | 消息级原生 `<image>` 渲染 name+icon（非 fallback 内联） |
| 思考过程 think | ✅ | ✅ | ✅ | 独立字段通道，折叠展示 |

---

## 汇总：待开发 / 不完善 / 已完成

### 待开发 ❌（功能缺失）
1. 任务列表 `- [ ]` checkbox（可选，低优先）
2. citation 角标（PC 也无，可不做）

### 不完善 ⚠️（已有但有缺陷）
1. **App 行内公式显示原文**（段落/列表/标题）★观感问题，待优化混排方案
2. 嵌套列表层级（fallback 仍单层）
3. 图片错误占位（加载失败无占位图）
4. 斜体 `_text_`（仅 `*`，下划线形式未做）

### 已完成 ✅（原对齐范围 A/B/C + 跟进 fix）
1. ~~`\(...\)` 行内公式定界符（fallback）~~ → `12397a98`
2. ~~裸 URL autolink（fallback）~~ → `12397a98`
3. ~~mermaid 闭合才渲染 / 大图自适应 / App 出图 / 失败回退~~ → `12397a98`；多图串台 → `9dd609ad`
4. ~~斜体 `*` / 删除线 `~~` / 引用块 `>`~~ → `12397a98`
5. ~~`\[...\]` 跨行块公式~~ → `12397a98`
6. ~~H5 公式换行/折断/多余空行~~ → `12397a98` + scoped 穿透 `ac6333f5` + 横滚看全 `935a7552`
7. ~~H5 代码块不高亮~~ → App+H5 统一 `parseLineCode`

### 已完成三大块（原专项设计）
- **A. fallback 解析器补语法** —— `\(...\)` / `\[...\]` 跨行 / 斜体 `*` / 删除线 / 引用块 / 裸 URL ✅
- **B. mermaid 全修** —— fallback 识别 + 闭合才渲染 + 大图自适应 + 失败回退 + 多图串台修复 ✅
- **C. H5 公式换行修复** —— `displayMode` + `::v-deep` nowrap + 超长横滚 + 左对齐 ✅

### 未提交 WIP（工作区，尚未入库）
- **块级公式布局**：展示宽 < 屏宽 85% → 居中 view（无滚动条）；超宽才 `scroll-view` 横滚
- **宽扁公式最小高度**：仅 `aspect≥6` 且矮时套 `BLOCK_MIN_DISPLAY_HEIGHT=44`，避免窄/高公式被过度放大
- **代码高亮稳定性**：App `highlightCodeBlock` 全局串行（防 `ConcurrentModificationException`）；H5 `_onig.wasm` 改走 `static/uni-highlight/` + `\0asm` 魔数校验；`parseCode` 初始化/tokenize 失败返回 error 不再挂起回调
- **调试页**：`pages/test-katex-app` 同步 fits/scroll 行为；`pages.json` tab 入口暂清空（本地调试用）

### 待优化 backlog（已知问题，未开工）
- **App 行内公式混排**：恢复 KaTeX 展示（替代 LaTeX 原文），需解决 uvue 行内 `<image>` 断行/留白；涉及 `uni-ai-x-msg.uvue`（`hasMathToken`、列表/标题 math 分支）及 `katex-el` 行内尺寸
