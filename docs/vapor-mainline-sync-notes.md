# vapor 线同步主线：注意事项与回归清单

> 更新时间：2026-08-19 · vapor 线：`feat/nuwa-zhuoda-2026.07-vapor`（HEAD `a57e2e96`）
> 主线：`origin/feat/nuwa-zhuoda-2026.07`（已前进至 `fc5ce807`）

## 一、为什么要继续同步主分支

vapor 线从主线（`36603849` / 合入点 `b327d594`）分叉后已独立演进了大量改动（会话详情 H5 内嵌重构、vapor 规约修复、uts 插件适配）。主线在同期继续迭代，**分叉越久，一次性合并的冲突面和语义冲突越大**。按仓库分支规范（主线定期 merge 进 vapor 线），当前是合适的同步窗口——主线新增量还小（6 个提交），越早合代价越低。

另：**DCloud 官方亦推荐使用 vapor**（蒸汽模式为其主推的 App 端渲染方向），本线投入与平台演进方向一致，值得持续维护而非临时分支。

主线本次新增（`36603849..fc5ce807`）：

| 提交 | 内容 |
|---|---|
| `5d7b8e91` | ai-msg 工具卡 name 属性值内换行清洗 |
| `35b4e416` | voice TTS 连接错误处理与停滞检测 |
| `f9315816` | voice TTS 尾部容错与超长句处理 |
| `fc5ce807` | 构建文件引用更新 + 新增组件 |

## 二、合并时的注意点

**文件级冲突面（已核实，仅 1 个文件双边都改过）：**

- `subpackages/components/ai-msg/ai-msg.uvue` —— vapor 线做过反嵌套/styleIsolation 适配，主线加了工具卡清洗。手工合并时遵守 vapor 样式规约：**后代（`.a .b`）、复合（`.a.b`）、伪类选择器在 styleIsolation 2.0 下运行时整条丢弃**，主线新样式若含此类写法需同步反嵌套。

**语义级注意（无文本冲突但行为耦合，重点看）：**

1. **voice / TTS 模块**（主线两项增强的主战场）：vapor 线 `agent-detail.uvue` 壳层直接桥接了 `voiceStreamSpeaker` / `ttsWebSocketPlayer` / `audioPlayerManager` / `asrWebSocketClient`（内嵌 H5 的原生语音桥）。合并后确认：
   - 桥接处调用签名未变（UTS 回调 arity 必须精确匹配，改签名会 error17）；
   - TTS 新增的错误处理/停滞检测在内嵌页场景下行为正常（桥是"透传"不是"重实现"，主线改动应自动受益，但需回归）。
2. **会话详情双轨架构**：vapor 线 App 端 = web-view 内嵌 H5 同页，H5/小程序端 = 原生组件（`#ifndef APP` 分支）。主线对 `chat-conversation-component` / 聊天逻辑的改动合并后：
   - App 端**不走**原生聊天链路（由内嵌 H5 渲染），改动只影响 H5/小程序端；
   - 若改动涉及「H5 端也会跑的公共逻辑」（services/utils/hooks），内嵌页同样受益，无需额外移植；
   - 若改动只对原生渲染有意义（模板/样式类），注意它不会体现在 App 端——评审时别误判为"丢改动"。
3. **公式渲染**：vapor 线会话渲染走 H5 后，App 端不再依赖公式原生链路；主线对 mathRendererCore/ratex 的改动合并进来不冲突，但 App 端收益仅限非会话场景。
4. **vapor 专属修复单向保留**：合并方向为主线 → vapor。vapor 专属提交（swiper 门控、evalJS 兜底、HX5.24 NSNumber 适配等）**禁止反向流入 basic/main**（仓库流向规则）；合并产生冲突时以 vapor 侧结构为准、主线侧功能为准。
5. **uts 插件（uni_modules）**：ratex iOS 已按 HX5.24 适配（NSNumber 桥参数）。主线若在不同 HX 版本下工作，合并后以 vapor 侧写法为准，勿回退。

## 三、合并后回归关键点

**App · Android（vapor 基座，本次合并的验收主体）**

- [ ] 冷启动日志无 `swiperItem.value.itemId` / `wrapperEl.offsetWidth` NPE（tabBar 预挂载门控有效）
- [ ] 智能体 tab 首次切换：列表正常挂载加载
- [ ] 会话详情（H5 内嵌）：历史/任务消息渲染、发送、流式输出、工具卡显示（`5d7b8e91` 正改此处，**重点**）
- [ ] 内嵌页语音：TTS 播报（连接错误/停滞场景各试一次，`35b4e416` 正改此处，**重点**）、录音 ASR 转写
- [ ] 键盘弹起顶起输入区、返回键正常退出（webViewAlive 先卸载再退栈路径）
- [ ] 长会话来回进出 ≥5 次无异常

**App · iOS**

- [ ] 需先重打自定义基座（ratex Swift 签名已变更，旧基座公式走 proxy 兜底不崩，但新插件不生效）
- [ ] iOS 26 真机：会话页来回进出 ≥5 次不崩（WKWebView 释放竞态缓解有效性）

**H5 / 小程序（原生聊天路径，主线改动的直接落点）**

- [ ] 会话详情消息/工具卡/公式渲染
- [ ] 语音播报基础链路

**基座配套**

- [ ] HX 5.24 生成的 wgt 必须配同版本基座 SDK（版本错配 = 部分模块热推不生效，表现为"代码没更新"）

## 四、遗留清理项（合并时顺手处理）

- `pages/test-webview-crash/`（iOS26 崩溃最小复现页，未注册 pages.json，验证通过后删除）
- `agent-detail` 内 `[AgentDetailWebView]` / webview 页 `[WebViewDiag]` 诊断日志（问题稳定后可降噪）
