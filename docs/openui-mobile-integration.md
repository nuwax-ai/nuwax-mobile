# OpenUI 移动端接入说明（nuwax-mobile）

移动端 OpenUI 统一「**点击 → 全屏 webview**」展示（小程序 `<web-view>` 不能局部内嵌，
故 inline/sidecar 一致处理）。web runtime 已具备移动端布局（横排→竖排），webview 加载即可。

## 文件清单（本次新增/修改）

新增：
- `utils/openUiSchema.uts` — 检测/提取/路径：`isOpenUiRenderToolName`、`extractOpenUiArtifactInfo`、`buildOpenUiFilePath`、`OpenUiArtifactInfo`。
- `subpackages/utils/openUiArtifactAdapter.uts` — SSE chunk → OpenUI 产物：`extractOpenUiArtifactFromChunk(chunk)`。
- `subpackages/components/openui-card/openui-card.uvue` — 可点卡片，点击 → `openOpenUiArtifact`（全屏 webview）。
- `scripts/verify-openui-contract.mjs` — 契约校验：`node scripts/verify-openui-contract.mjs`（mobile 检测 token 与 nuwax-openui-mcp 工具名一致）。

修改：
- `utils/system.uts` — 新增 `openOpenUiArtifact(conversationId, artifactId, title)`（拼 runtime URL + 跳 `/subpackages/pages/webview/webview`）。
- `types/interfaces/ai-msg.uts` — `MsgItem` 加 `openuiArtifactId` / `openuiTitle`。
- `subpackages/components/ai-msg/ai-msg.uvue` — `cloneMsgItem`/`mergeMsgFromProps`/`applyMsgPatch` 透传新字段；`answer-container` 内按字段渲染 `<OpenUiCard>`。
- `subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts` — PROCESSING 分支调 `extractOpenUiArtifactFromChunk`，命中则写入 `nmObj.openuiArtifactId/openuiTitle`。

## 数据流

```
SSE PROCESSING(nuwax_render_openui 结果)
  → AgentDetailService: extractOpenUiArtifactFromChunk(responseData)
  → nmObj.openuiArtifactId / openuiTitle
  → buildMessageInfoFromDraft → MessageInfo → … → ai-msg(MsgItem)
  → answer-container 渲染 <OpenUiCard>
  → 点击 → openOpenUiArtifact → /subpackages/pages/webview/webview?url=<runtime?file_path=...>
```

## ⚠️ HBuilderX 验证时需重点确认的唯一环节

`openuiArtifactId` 要从 AgentDetailService 流到 ai-msg 的 `MsgItem`，依赖中间链路：
`buildMessageInfoFromDraft` + `MessageInfo` 类型 + 父组件 MessageInfo→MsgItem 的映射。

如果卡片不出现，最可能就是这一环没把 `openuiArtifactId/openuiTitle` 带过去。需在
`types/interfaces/conversationInfo.uts` 的 `MessageInfo` 加 `openuiArtifactId?`/`openuiTitle?`，
并确认 `messageInfoClass.uts`（或 `buildMessageInfoFromDraft`）拷贝这两个字段，以及历史回放
`subpackages/utils/historyMessageAdapter.uts` 对 OpenUI 工具结果同样检测（调
`extractOpenUiArtifactFromChunk`）。工具名/result 字段位置也请用真实报文核对一次
（`openUiArtifactAdapter.uts` 已按多候选兼容：`data.name`/`result.name`/`blockSource.name` 等）。

## 校验

- 契约：`node scripts/verify-openui-contract.mjs`（不依赖 HBuilderX，已通过）。
- 编译/运行：HBuilderX（本仓库无 uni CLI）。App/iOS/Android/H5/MP 均走同一 webview 路径。
- 小程序：确认 `constants/config.uts` 的 `ALLOW_EXTERNAL_LINK_DOMAIN` 含 `${API_BASE_URL}`（webview 域名白名单）。
