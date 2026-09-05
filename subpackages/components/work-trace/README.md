# V2 会话工作轨迹（H5 / MP-WEIXIN 链路）

对齐 PC 端 `presentation-v2`（nuwax 仓库 `feat-dong.0930`，见
`docs/conversation/renderer-v2-grouped-trace-summary.md`）的三层会话渲染：
**整轮工作轨迹 → 连续工具调用组 → 单条工具紧凑行**，配套自动折叠/展开状态机。

仅作用于 `ai-msg.uvue` 的 `#ifdef H5 || MP-WEIXIN` 分支（App 生产 web-view 嵌 H5
即走此路径）；原生 uvue 分支（UniAiXMsgRender / tool-call-group）保持旧渲染不变。

## 架构

```
MessageInfo（一轮 = 一条 assistant 消息：think + text 嵌过程标签 + processingList + finalResult）
  │
  ├─ conversationTrace.uts（投影层，纯函数，可单测）
  │    projectTurnTrace(): 解析 :::container / HTML 过程标签 →
  │      traceItems（narration / openui / plan / tool-row / tool-group）
  │      + 最终回答分离（终态 outputText 优先、运行态末段正文为实时回答区）
  │      + 轨迹头指标（工具数 / 耗时 anchor / 失败态）
  │
  └─ ai-msg.uvue H5 分支
       ├─ WorkTraceContainer（哑壳：轨迹头 + v-if 折叠体）
       │    ├─ think-container（现有思考折叠/增量逻辑原样迁入）
       │    ├─ narration / openui → mp-html 实例（段级预清洗，稳定段不重复解析）
       │    ├─ plan → plan-trace-card（任务清单）
       │    ├─ tool-group → tool-trace-group（组头 kind 级动作摘要 + 行列表）
       │    └─ tool-row → tool-trace-row（紧凑行，点击进 tool-details-modal 弹窗）
       └─ answer-container → mp-html（最终回答，始终独立可见）
```

## 分组规则（与 PC traceItems.ts 一致）

- 连续 ≥2 条普通工具成组；组 id = `tool-group:${首个节点 executeId}`（流式追加稳定）
- 单条工具独立成行不套组；Plan / OpenUI / 正文 narration 立即切断分组
- 同 executeId 去重保留最后一次；相邻连续 Plan 只保留最后一个；`type=Event` 默认丢弃
  （OpenUI renderUI 例外，独立段交 mp-html 出 openui-card）
- 组状态：任一 running > 任一 failed > finished；组头摘要按 kind 首次出现顺序去重
  （如「读取了文件 · 运行了命令」），kind 级状态决定动作短语语态（正在/了/失败）
- 分组发生在正文提升之前：运行态末段正文被提升为实时回答区，不切断其前面的组

## 折叠状态机（托管在 ai-msg 组件实例，组件不卸载则状态不丢）

| 层 | 默认 | 自动行为 | 手动行为 |
| --- | --- | --- | --- |
| 整轮轨迹 | 运行展开 / 终态与历史收起 | running→终态自动收起一次 | 手动展开后保持，不被流式增量重置 |
| 工具组 | 活动组（运行轮尾组）展开，其余收起 | 失去活动（新内容/新组出现）自动收起一次 | 手动重开后不再被强制关闭 |
| 单条工具 | 无展开态 | 详情走全屏弹窗（`page_preview_detail`） | file-edit 且 `kind=edit` 行点击跳文件预览 |

实现要点：`groupExpandedMap` 以稳定组 id 为 key + `groupExpandedVersion` ref 驱动
模板重算；`previousActiveGroups` / `autoCollapsedGroups` 两个 Set 实现「收起一次」
语义；轨迹收起仅 `v-if` 卸载内容，宿主实例不卸载。

## 涉及文件

| 文件 | 职责 |
| --- | --- |
| `subpackages/components/ai-msg/conversationTrace.uts` | 投影层纯函数（分组/类型识别/最终回答分离/指标/动作短语 key） |
| `subpackages/components/work-trace/work-trace-container.uvue` | 整轮轨迹壳（状态图标 + 指标头 + 折叠体） |
| `subpackages/components/work-trace/tool-trace-group.uvue` | 工具组（组头摘要 + 行列表） |
| `subpackages/components/work-trace/tool-trace-row.uvue` | 紧凑事件行（图标+动作+目标+状态；详情弹窗/文件预览） |
| `subpackages/components/work-trace/plan-trace-card.uvue` | Plan 任务清单 |
| `subpackages/components/work-trace/traceIcons.uts` | 类型 → iconfont 映射 |
| `subpackages/components/ai-msg/ai-msg.uvue` | 投影 computed + 折叠状态机 + H5 模板分支 |
| `constants/i18n-locales/*.uts` | `Mobile.Chat.WorkTrace.*` 文案（四语言） |
| `pages/test-work-trace/test-work-trace.uvue` | 离线预览页（历史终态 / 纯文本 / 单步流式模拟） |

## 验证

- 编译：H5（`cli publish web`）与 app-android（`pnpm uni:build`）双通过
- 功能：预览页 `#/pages/test-work-trace/test-work-trace` 覆盖
  运行态展开+计时、成组/单行/正文切断、活动组切换自动收起、终态自动收起一次、
  手动保持、失败语态、Plan 卡、纯文本轮无轨迹、最终回答独立渲染
- 性能约束：投影经 computed 缓存（挂 `streamRevision`）；narration 段稳定后
  content 不再变化（mp-html 不重复解析）；SSE 50ms 合并窗与 fingerprint 去重不动

## 已知边界

- 旧 `mpHtmlContent` / mp-html `container` / `container-group` 组件保留未删
  （原生分支 parser 与其他用途仍在），H5 会话 AI 消息不再走它们
- 详情形态保持全屏弹窗（未做内联展开，移动端窄屏取舍）
- 原生 uvue 渲染分支尚未对齐本方案（后续按需同步 `tool-call-group` 一侧）
