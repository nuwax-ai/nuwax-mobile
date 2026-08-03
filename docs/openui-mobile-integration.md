# OpenUI 移动端接入说明（nuwax-mobile）

移动端 OpenUI 统一「**点击 → 全屏 webview**」展示（小程序 `<web-view>` 不能局部内嵌，
故 inline/sidecar 一致处理）。web runtime 已具备移动端布局（横排→竖排），webview 加载即可。

## 文件清单（本次新增/修改）

新增：
- `utils/openUiSchema.uts` — 检测/提取/路径：`isOpenUiRenderToolName`、`extractOpenUiArtifactInfo`、`buildOpenUiFilePath`、`OpenUiArtifactInfo`。
- `subpackages/utils/openUiArtifactAdapter.uts` — 对齐 Web `applyOpenUiToolCallSseEvent`，把
  `PROCESSING + subEventType=RENDER_UI` 的 `data.result` 标准化为移动端 `ProcessingInfo`。
- `subpackages/components/openui-card/openui-card.uvue` — 可点卡片，点击 → `openOpenUiArtifact`（全屏 webview）。
- `scripts/verify-openui-contract.mjs` — 契约校验：`node scripts/verify-openui-contract.mjs`（mobile 检测 token 与 nuwax-openui-mcp 工具名一致）。

修改：
- `utils/system.uts` — 新增 `openOpenUiArtifact(conversationId, artifactId, title)`（拼 runtime URL + 跳 `/subpackages/pages/webview/webview`）。
- `types/interfaces/ai-msg.uts` — `MsgItem` 加 `openuiArtifactId` / `openuiTitle`。
- `subpackages/components/ai-msg/ai-msg.uvue` — `cloneMsgItem`/`mergeMsgFromProps`/`applyMsgPatch` 透传新字段；`answer-container` 内按字段渲染 `<OpenUiCard>`。
- `subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts` — PROCESSING 分支优先调
  `normalizeRenderUiProcessingData`，再按 `executeId` 合并执行态/完成态。

## 数据流

```
SSE PROCESSING + subEventType=RENDER_UI
  → data.result.executeId/status/data/input
  → AgentDetailService: normalizeRenderUiProcessingData(res, responseData)
  → processingList（同 executeId：EXECUTING → FINISHED）
  → result.data / result.data.output 提取 nuwax.openui-ref
  → answer-container 渲染 <OpenUiCard>
  → 点击 → openOpenUiArtifact → /subpackages/pages/file-preview-page/file-preview-page
```

`EXECUTING` 阶段没有 artifactId 时，卡片显示“界面生成中”且不可点击；收到带
`nuwax.openui-ref` 的完成帧后才切换为“点击查看界面”。连续 PROCESSING 帧只允许在
`executeId` 相同时合并，避免不同工具调用互相覆盖。

表单型 OpenUI 在 webview 发出 `OPENUI_ACTION` 后，预览页会校验
`nuwax.openui-action/v1`、构建与 PC/ask-question 一致的可读续作消息、同步暂存并返回
会话页。会话页 `onShow` 一次性消费暂存内容，通过既有 `handleSendMessage` 自动发送。
同一预览页只接受第一次有效提交，避免 webview 重复派发造成重复消息。
App/小程序仍统一打开网关 `/static/file-preview.html`；该页面识别 `.openui.json` 后，
所有 OpenUI 预览统一进入 `/static/file-preview.html`，由该页面按需加载 OpenUI Runtime 资源并向原生 webview 转发提交事件。

## ⚠️ HBuilderX 验证时需重点确认的环节

实时链路应同时收到同一 `executeId` 的执行态与完成态；完成态的 openui-ref 位于
`result.data`，真实报文也可能放在 `result.data.output` JSON 字符串中。历史回放则由
`subpackages/utils/historyMessageAdapter.uts` 把 `componentExecutedList` 转成相同的
`processingList` 结构。

## 校验

- 契约：`node scripts/verify-openui-contract.mjs`（不依赖 HBuilderX，已通过）。
- 编译/运行：HBuilderX（本仓库无 uni CLI）。App/iOS/Android/H5/MP 均走同一 webview 路径。
- 小程序：确认 `constants/config.uts` 的 `ALLOW_EXTERNAL_LINK_DOMAIN` 含 `${API_BASE_URL}`（webview 域名白名单）。
