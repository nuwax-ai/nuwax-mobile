# OpenUI 移动端接入说明（nuwax-mobile）

移动端 OpenUI 统一「**点击 → 全屏 webview**」展示（小程序 `<web-view>` 不能局部内嵌，
故 inline/sidecar 一致处理）。web runtime 已具备移动端布局（横排→竖排），webview 加载即可。

表单提交只读问题见 [openui-h5-submit-form.md](./openui-h5-submit-form.md)。

## 当前产品渲染路径（重要）

App 会话详情通过 `agent-detail` 的 `<web-view>` **内嵌 H5 同页**；H5 / 小程序正文走
`ai-msg` → **mp-html**，不是原生 `uni-ai-x-msg`。

| 端 | 消息正文渲染 | OpenUI 卡片落点 |
|---|---|---|
| H5 / 微信小程序 | `ai-msg` → `mp-html` | `mp-html/node/node.vue` → `mp-html/openui-card` |
| App（当前生产：内嵌 H5） | 同上（走 H5 包） | 同上 |
| App 原生（非内嵌，`#ifndef H5 \|\| MP`） | `uni-ai-x-msg` | `OpenUiCard`（`subpackages/components/openui-card`） |

因此排查「H5 看不到 openui-card」时，优先查 **mp-html node 分支**，而不是
`uni-ai-x-msg` 或 `MsgItem.openuiArtifactId` 字段。

## 文件清单

新增 / 核心：
- `utils/openUiSchema.uts` — 检测/提取/路径：`isOpenUiRenderToolName`、`extractOpenUiArtifactInfo`、`buildOpenUiFilePath`、`OpenUiArtifactInfo`。
- `subpackages/utils/openUiArtifactAdapter.uts` — 对齐 Web `applyOpenUiToolCallSseEvent`，把
  `PROCESSING + subEventType=RENDER_UI` 的 `data.result` 标准化为移动端 `ProcessingInfo`。
- `subpackages/components/openui-card/openui-card.uvue` — App 原生路径可点卡片。
- `subpackages/uni_modules/mp-html/components/mp-html/openui-card/openui-card.vue` — **H5/MP mp-html 专用**纯 Vue 卡片（避免 `.vue` 直接挂 `.uvue`）。
- `scripts/verify-openui-contract.mjs` — 契约校验：`node scripts/verify-openui-contract.mjs`。

修改（渲染与数据）：
- `utils/system.uts` — `openOpenUiArtifact` / `jumpToFilePreviewPage`；App 内嵌时走
  `uni.webView.navigateTo`（注入的 uni.webview.js）开原生预览页。
- `utils/pendingOpenUiAction.uts` — 暂存 + `consumeLatestPendingOpenUiAction`（原生壳回传用）。
- `subpackages/pages/agent-detail/agent-detail.uvue` — onShow 消费 latest → evalJS
  `__nuwaxOnOpenUiResume`。
- `subpackages/pages/chat-conversation-component/...` — 注册 `__nuwaxOnOpenUiResume`。
- `subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts` — PROCESSING 优先
  `normalizeRenderUiProcessingData`，按 `executeId` 合并执行态/完成态；历史回补 OpenUI ref。
- `subpackages/components/ai-msg/ai-msg.uvue` — H5/MP 用 `<mp-html :processing-list :conversation-id>`。
- `subpackages/uni_modules/mp-html/.../node/node.vue` — `container` / `markdown-custom-process` 命中
  OpenUI 工具名时渲染 `<openui-card>`。
- `subpackages/uni_modules/mp-html/.../container/container.vue` — 隐藏 OpenUI 普通工具条（对齐
  `tool-call-card.isVisible`）。
- `subpackages/uni_modules/mp-html/.../container/container-group.vue` — 工具计数排除 OpenUI。
- `utils/markdown.uts` — `groupMarkdownContainers`：**默认跳过 Event，但保留 OpenUI renderUI**，
  否则标签被剥掉，mp-html 无法出卡。
- `uni_modules/uni-ai-x/.../uni-ai-x-msg.uvue` — App 原生路径旁路 `OpenUiCard`。

## 数据流

```
SSE PROCESSING + subEventType=RENDER_UI
  → data.result.executeId/status/data/input
  → AgentDetailService: normalizeRenderUiProcessingData(res, responseData)
     （规范为 type=ToolCall，避免被 groupMarkdownContainers 当 Event 丢掉）
  → processingList（同 executeId：EXECUTING → FINISHED）
  → 正文插入 :::container / 规范化为 <markdown-custom-process name=...renderUI...>
  → ai-msg.resolveRenderableBodyText → groupMarkdownContainers
  → mp-html 解析节点
  → node.vue：isOpenUiProcessNode → <openui-card>
  → 点击 → openOpenUiArtifact → /subpackages/pages/file-preview-page/file-preview-page
```

`EXECUTING` 阶段没有 artifactId 时，卡片显示「界面生成中」且不可点击；收到带
`nuwax.openui-ref` 的完成帧后才切换为「点击查看界面」。连续 PROCESSING 帧只允许在
`executeId` 相同时合并，避免不同工具调用互相覆盖。

表单型 OpenUI 在预览网关发出 `OPENUI_ACTION` 后，预览页会校验
`nuwax.openui-action/v1`、构建与 PC/ask-question 一致的可读续作消息、同步暂存并返回
会话页。会话页 `onShow` / `triggerResume` 一次性消费暂存内容，通过既有 `handleSendMessage`
自动发送。同一预览页只接受第一次有效提交，避免重复派发造成重复消息。

### 内嵌 H5（App web-view → `/m/`）表单回写会话

```
H5 chat（agent-detail 内嵌 chat-conversation-component）
  → 点击 openui-card
  → jumpToFilePreviewPage：检测到 App 内嵌 → uni.webView.navigateTo（注入的 uni.webview.js）
  → 原生新开 file-preview-page（与 H5 SPA 栈分离）
  → web-view 加载 /static/file-preview.html?...&_ticket=... 或 ?sk=...&mode=preview
  → 用户提交表单
  → file-preview-openui.js：isChat → notifyParent({ type:'OPENUI_ACTION', event })
  → 原生 file-preview-page：@message → parseOpenUiActionData → savePendingOpenUiAction(cid)
     （同时写 pendingOpenUiAction:{cid} 与 pendingOpenUiAction:latest）
  → uni.navigateBack
  → 原生 agent-detail.onShow
     → consumeLatestPendingOpenUiAction()
     → evalJS(window.__nuwaxOnOpenUiResume(message))
  → 内嵌 H5：__nuwaxOnOpenUiResume → handleSendMessage(续作文本)
```

要点：
- **打开**走注入 JSSDK `uni.webView.navigateTo`，预览是原生页（有导航栏/返回），不是 web-view 内 H5 SPA 跳转。
- **续作**跨原生/H5 storage：原生暂存 → onShow evalJS 注入；不依赖 URL 上 conversationId 是否仍准确（用 `latest` key）。
- 纯浏览器 H5 / 小程序：仍 `uni.navigateTo` + 同 storage `consumePending`，行为不变。
- 网关 `isChat = !!(_ticket || mode===preview)`：ticket 失败回退 `sk+mode=preview` 仍可提交。
- 纯分享链接（仅顶层 `sk`、无 `mode=preview`）只读，不会 `notifyParent` OPENUI_ACTION。

- **App / 小程序原生 web-view 预览**：`<web-view @message>` 接收网关 `notifyParent` / `uni.webView.postMessage`
- **H5 iframe 预览**：`window.message` 接收 `parent.postMessage`（与网关 `notifyParent` 同源路径）
- 会话内预览须带 `_ticket` 或 `mode=preview` 才允许提交；真分享链接 `?sk=` 见
  [openui-h5-submit-form.md](./openui-h5-submit-form.md)

App/小程序/H5 均打开网关 `/static/file-preview.html`；该页面识别 `.openui.json` 后，
在同源 iframe 中加载 `/static/openui-runtime/index.html` 并转发提交事件。

## HBuilderX / H5 验证时需重点确认的环节

1. 实时链路应同时收到同一 `executeId` 的执行态与完成态；完成态的 openui-ref 位于
   `result.data`（或 `result.data.output` JSON 字符串）。
2. 历史回放由 `subpackages/utils/historyMessageAdapter.uts` 把 `componentExecutedList`
   转成相同的 `processingList` + 正文过程标签。
3. H5 控制台应出现 `[OpenUI][mp-html] name=... match=1 ...`（node 命中日志），DOM 有
   `.openui-card`；且同工具不应再出现普通工具条。
4. `ai-msg` 传入的 `conversation-id` 非空（`mpHtmlConversationId`），否则点击会 toast
   「无法打开 OpenUI」。
5. App 内嵌：点击卡片应新开**原生**预览页；表单提交返回后会话应自动发出续作消息。

## 校验

- 契约：`node scripts/verify-openui-contract.mjs`（不依赖 HBuilderX）。
- 编译/运行：HBuilderX（本仓库无 uni CLI）。App/iOS/Android/H5/MP 均走同一 webview 预览路径。
- 小程序：确认 `constants/config.uts` 的 `ALLOW_EXTERNAL_LINK_DOMAIN` 含 `${API_BASE_URL}`。
