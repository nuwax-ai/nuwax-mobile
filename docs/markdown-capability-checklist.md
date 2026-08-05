# 会话 Markdown 渲染能力清单（对齐 PC Web）

> 维度：**已支持 ✅ / 不完善 ⚠️ / 待开发 ❌**，并对照 **PC web（基准）** 与 **main 分支旧版（mp-html，仅 H5/小程序）**。
> 生成日期：2026-08-05　分支：`perf/stream-markdown-render`

## 三种渲染方案背景

| 方案 | 原理 | 平台 | 状态 |
|---|---|---|---|
| **main 旧版（mp-html）** | `mp-html` 内嵌 katex → KaTeX 直接渲成 HTML 节点嵌在富文本 | 仅 H5/小程序（依赖 DOM） | 已在 `1a47dc00` 移除 |
| **PC web（基准）** | `ds-markdown`（内包 react-markdown 10.1）+ remark/rehype 生态，原生 HTML 矢量渲染 | Web | 对齐目标 |
| **当前分支（proxy-web）** | 隐藏 web-view KaTeX → html2canvas 截 PNG → `<image>` 回填；H5 另保留 v-html 原生 | App + H5 + 小程序 | 当前主线 |

**关键机制**：会话 markdown 有两条解析路径（调度 [aiMsgMarkdownParser.uts](subpackages/components/ai-msg/aiMsgMarkdownParser.uts)）——纯文本流式走 **uni-cmark**（cmark-gfm 全语法）；一旦含 ```` ``` ````/`![`/`$$`/`\[`/`\(`/表格/自定义标签，**整段切到自研 fallback**（[appMarkdownFallback.uts](subpackages/components/ai-msg/appMarkdownFallback.uts)）。fallback 的 `parseInline` 只认 `**`/`` ` ``/`$`/`![`/`[`/`<conversation>`，是多数"不完善"项的共同根源。

---

## 一、块级结构

| 能力 | 状态 | PC web | main 旧版(mp-html) | 说明 / 缺口 |
|---|---|---|---|---|
| 标题 H1-H6 | ✅ | ✅ | ✅ | 含行内公式混排 |
| 段落 | ✅ | ✅ | ✅ | |
| 有序/无序列表 | ✅ | ✅ | ✅ | 含行内公式混排 |
| 代码块 + 语法高亮 | ✅ | ✅ | ✅ | App 用 uni-highlight(TextMate)；**H5 不高亮（纯文本，⚠️ 见下）** |
| 行内代码 `` ` `` | ✅ | ✅ | ✅ | |
| 表格 GFM | ✅ | ✅ | ✅ | 横滚 + 复制/下载 markdown + 单元格公式 + 对齐 + 空表头剔除 |
| 引用块 `>` | ⚠️ 不完善 | ✅ | ✅ | 仅 cmark 路径支持；**fallback 不识别**，含结构块消息里失效 |
| 水平线 `---` | ❌ 刻意忽略 | ✅ | ✅ | 双端刻意跳过（避免 `$$` 后误产横线），如需 hr 则无 |
| 任务列表 `- [ ]` | ❌ 待开发 | ✅ | ❌ | fallback 仅当普通列表，无交互 checkbox |
| 嵌套列表 | ⚠️ 不完善 | ✅ | ✅ | fallback 只认单层 `[-+*]`/`\d+`，嵌套层级不解析 |

## 二、数学公式

| 能力 | 状态 | PC web | main 旧版(mp-html) | 说明 / 缺口 |
|---|---|---|---|---|
| inline `$...$` | ✅ | ✅ | ✅ | App 截图 / H5 v-html |
| inline `\(...\)` | ❌ 待开发 | ✅ | ✅ | **fallback 不识别**（cmark 路径支持）；含结构块消息里失效 |
| block `$$...$$` | ✅ | ✅ | ✅ | |
| block `\[...\]` | ⚠️ 不完善 | ✅ | ✅ | 仅整行识别；**跨行块不支持** |
| ```` ```math ```` 代码块 | ✅ | — | ❌ | mobile 特有 |
| 公式闭合才渲染（流式） | ✅ | ✅(隐式) | — | 未闭合不渲、等补全 |
| KaTeX 磁盘缓存 + 并发去重 | ✅ | — | ❌ | App 截图优化 |
| **H5 公式换行/折断** | ⚠️ **bug** | ✅(原生矢量) | ✅ | `d8896b12` 注释掉 `.katex-display white-space:nowrap` → 完整公式因宽度换行、内部折断、多余空行。**已定位根因**；修复含**超长公式横向滚动**（nowrap + overflow-x:auto） |

## 三、图表 / 媒体

| 能力 | 状态 | PC web | main 旧版(mp-html) | 说明 / 缺口 |
|---|---|---|---|---|
| mermaid 出图 | ⚠️ 不完善 | ✅(SVG) | ❌ | web-view 截图 + 双 Tab；**但 App 流式走 fallback 不识别 mermaid → 不出图** |
| mermaid 闭合才渲染 | ❌ 待开发 | ✅ | — | 流式半截 mermaid 反复 render 报错，无防护 |
| mermaid 大图自适应 | ❌ 待开发 | ✅ | — | 容器写死 400px + aspectFit 压小；renderMermaid 不回传宽高 |
| mermaid 失败回退 | ⚠️ 不完善 | ✅(回退源码) | — | 失败后图表 Tab 空白，未自动落代码 Tab |
| mermaid 小程序 | ❌ 不支持 | — | — | 显示提示文案（web-view 限制，不打通） |
| 图片 `![alt](url)` | ✅ | ✅ | ✅ | 原位渲染 + 点击 previewImage + 流式未闭合剥离 |
| 图片错误占位 | ⚠️ 不完善 | ✅(fallback 占位图) | ✅ | 加载失败无占位图 |

## 四、行内样式 / 链接

| 能力 | 状态 | PC web | main 旧版(mp-html) | 说明 / 缺口 |
|---|---|---|---|---|
| 加粗 `**` | ✅ | ✅ | ✅ | |
| 斜体 `*`/`_` | ⚠️ 不完善 | ✅ | ✅ | 仅 cmark 路径；**fallback 不支持**，含结构块消息里失效 |
| 删除线 `~~` | ⚠️ 不完善 | ✅ | ✅ | 仅 cmark 路径；**fallback 不产出**（样式 `.del` 已就绪） |
| 链接 `[t](url)` | ✅ | ✅ | ✅ | 跳内置 webview 页 |
| 裸 URL autolink | ❌ 待开发 | ✅(remark-gfm) | ✅ | fallback 不识别裸 `https://` |
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

## 汇总：待开发 / 不完善清单（本次对齐范围）

### 待开发 ❌（功能缺失）
1. `\(...\)` 行内公式定界符（fallback）
2. 裸 URL autolink（fallback）
3. mermaid 闭合才渲染（流式防护）
4. mermaid 大图自适应（宽高回传 + 容器自适应）
5. 任务列表 `- [ ]` checkbox（可选，低优先）
6. citation 角标（PC 也无，可不做）

### 不完善 ⚠️（已有但有缺陷）
1. **H5 公式换行/折断/多余空行**（根因 `d8896b12` 注释 nowrap，已定位）★最影响观感
2. **斜体 / 删除线 / 引用块** 在含结构块的消息里失效（fallback 不识别）★影响面大
3. `\[...\]` 跨行块公式不完整
4. **mermaid App 流式不出图**（fallback 不识别）★功能缺失感强
5. mermaid 失败回退、图片错误占位
6. H5 代码块不高亮（App 有）
7. 嵌套列表层级

### 本次改动三大块（对应专项设计）
- **A. fallback 解析器补语法** —— `\(...\)` / `\[...\]` 跨行 / 斜体 / 删除线 / 引用块 / 裸 URL
- **B. mermaid 全修** —— fallback 识别 + 闭合才渲染 + 大图自适应 + 失败回退（保持截图链路）
- **C. H5 公式换行修复** —— 恢复 nowrap + **超长公式横向滚动（overflow-x:auto）** + inline-block 容器（H5 保持 v-html 原生矢量，对齐 PC）
