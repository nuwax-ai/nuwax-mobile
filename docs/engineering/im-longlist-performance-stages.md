# IM 长列表性能治理：分阶段实施方案

> 立项：2026-11-13　版本：v1
> 范围：**会话详情页（`pages/message/chat.uvue`）→ 伙伴页会话列表（`conv-list-pane`）→ 智联录（`contact-list-pane`）**
> 原则：**每阶段独立开关、默认关闭、独立可回滚、不改任何接口契约与对外行为**；一个阶段上线观察一版再做下一个

---

## 0. 结论摘要

当前两条主列表（会话详情、会话列表）都是 **`scroll-view` + `v-for` 全量真节点渲染，数据数组只增不减**，在 uni-app x（App 端原生渲染，每个节点 = 一个原生 View）下成本随数据量线性增长，叠加**页面级 tick 触发的整页重渲**，在用户量增长/长会话场景会出现明显卡顿，极端情况闪退。

治理路径不是"一步换虚拟列表"，而是**分 7 个阶段，每阶段都是可独立验收、可单独回滚的最小改动**：

```
Stage 0 观测与开关骨架（不改行为）
Stage 1 详情页 tick 隔离        ← 纯收益，风险最低，先做
Stage 2 详情页消息窗口上限      ← 收益最大，纯数据层
Stage 3 详情页媒体子块组件化    ← 为 Stage 4 提供挂载点
Stage 4 详情页媒体懒解析/懒挂载  ← 媒体链路，分端灰度（鸿蒙最后）
Stage 5 伙伴页会话列表          ← 独立文件，可并行
Stage 6 智联录                  ← 独立文件，可并行
Stage 7 回收列表评估（可选）    ← 仅当 1~4 做完指标仍不达标才启动
```

**每阶段完成的标准动作见第 3 节进度总览表 + 第 12 节变更记录**，后续任何人（或 AI 会话）开工前先读这两处即可判断进度与状态。

---

## 1. 现状与问题定性

### 1.1 会话详情页 `pages/message/chat.uvue`（18871 行）

| # | 机制 | 代码位置 | 后果 |
|---|---|---|---|
| A | `scroll-view` + `v-for` 全量渲染，无回收 | [chat.uvue:100](../../pages/message/chat.uvue#L100)、[chat.uvue:173](../../pages/message/chat.uvue#L173) | 每条消息的每个节点都是真实原生 View |
| B | 单条消息模板 ~750 行，内含 6 层嵌套 `v-for`（mergeItems / lines / segs / imageAtts / linkAtts / reactionChips） | [chat.uvue:173-920](../../pages/message/chat.uvue#L173-L920) | 单行 15–40 个节点，1000 条 ≈ 2–4 万原生视图 |
| C | 上翻只 `unshift` 不裁剪 | [chat.uvue:8818](../../pages/message/chat.uvue#L8818) | 数组无上限，翻到哪涨到哪 |
| D | WS 推送只 `push` 不裁剪 | 多处 `messages.value.push(...)` | 长驻群会话消息数持续增长 |
| E | **页面级 tick 被模板直接读取** → 每次变化整页重渲 | 录音波形 150ms（[chat.uvue:1871](../../pages/message/chat.uvue#L1871)、[chat.uvue:11888](../../pages/message/chat.uvue#L11888)）；智能体转钟 1.6s（[chat.uvue:313](../../pages/message/chat.uvue#L313)、[chat.uvue:376](../../pages/message/chat.uvue#L376)）；已读 tick（[chat.uvue:347-372](../../pages/message/chat.uvue#L347-L372)）；头像 tick（[chat.uvue:246](../../pages/message/chat.uvue#L246)）；鸿蒙头像放行 tick（[chat.uvue:7798](../../pages/message/chat.uvue#L7798)） | 录音时每秒 6 次 O(N) 全页重渲；N 大时直接冻住 |
| F | 媒体回填走整表重赋值 | `scheduleChatMediaRefresh` [chat.uvue:5426](../../pages/message/chat.uvue#L5426) | 每批媒体回填 = 一次全表 diff |
| G | 每条消息插入即解析全部媒体（图片下载/解码、头像、视频） | `resolveRowMedia` [chat.uvue:8589](../../pages/message/chat.uvue#L8589)，调用点 [chat.uvue:8741](../../pages/message/chat.uvue#L8741)、[chat.uvue:8821](../../pages/message/chat.uvue#L8821) | 离屏消息也全量下载解码，内存/带宽双爆 |
| H | 视频全量顺序预载 | `preloadChatVideos` [chat.uvue:8215](../../pages/message/chat.uvue#L8215) | 从最新往回遍历**全部**消息，每条完成触发一次整表重建 → 近似 O(N²) |

**拐点估算**（依据：鸿蒙真机实测首帧布局与行数线性，20 行 584ms / 60 行 1254ms，见历史记录）：

| 消息条数 | 预期表现 |
|---|---|
| ≤ 100 | 正常 |
| 200–400 | 上翻/录音/智能体处理期间明显掉帧 |
| 500–800 | 进页 4–8s，滚动卡顿，低端机可能 ANR |
| ≥ 1000（含图/视频） | Android OOM / iOS 主线程超时 jetsam 被杀 → 闪退 |

### 1.2 伙伴页会话列表 `pages/message/components/conv-list-pane.uvue`

| # | 机制 | 代码位置 | 后果 |
|---|---|---|---|
| A | `scroll-view` + `v-for`，无回收（行已组件化 `conv-row-item`） | [conv-list-pane.uvue:21](../../pages/message/components/conv-list-pane.uvue#L21)、[conv-list-pane.uvue:61](../../pages/message/components/conv-list-pane.uvue#L61) | 行数 = 节点数，但单行比消息行轻 |
| B | 每页 50，翻页后**整表** `copyRows + reorderConvRows + resolveConvRowsIcons + assignConvFallbacks` | [message-content.uvue:1547-1585](../../pages/message/message-content.uvue#L1547-L1585) | 每翻一页 O(N) 重算 + 整列重渲 |
| C | 刷新/WS 走整表替换 | [message-content.uvue:1506-1517](../../pages/message/message-content.uvue#L1506-L1517) | 用户越多刷新越凶 |

**拐点**：数千会话内是"翻页变慢"，万级才到闪退风险。优先级低于详情页。

### 1.3 智联录 `pages/message/components/contact-list-pane.uvue`

- 数据一次性拉全量（[message-content.uvue:1604](../../pages/message/message-content.uvue#L1604) `apiImContacts()`），服务端有 `truncated` 截断兜底，无分页。
- 行内联在 pane 模板里（`pendingIn / pendingOut / spaces / groups / contacts` 五个 `v-for`），未组件化。
- 风险水平：**低**（有服务端截断），但在千级联系人时滚动会抖。排在最后。

---

## 2. 总体策略与铁律

### 2.1 三条铁律（每阶段都必须满足）

1. **默认关闭**：阶段代码随版本进包，开关默认 `false`；内部灰度验证 ≥ 1 个版本后再改默认值。开关翻转能在不重新发版的条件下生效（读 storage 覆盖）。
2. **不改对外行为**：不改接口契约、不改消息语义、不改 UI 视觉（除非该阶段明确是 UI 变更）。所有阶段都是"同样结果，更少成本"。
3. **可独立回滚**：每阶段是独立 PR/提交集合，回滚 = 把默认值改回 `false` 即可恢复到旧路径；旧代码路径在本阶段内**不删除**（只加分支），确认稳定后的清理单独提交。

### 2.2 开关机制（Stage 0 落地）

新增 `utils/perfFlags.uts`：

```uts
// 读 storage 覆盖（键 perf_flags，JSON），页面 onLoad 时读一次并缓存
export function perfFlag(name: string, def: boolean): boolean
```

- 默认值集中在 `PERF_FLAG_DEFAULTS` 常量表，随版本改。
- 页面 **只在 onLoad/setup 读一次**，运行中不翻转（避免状态不一致导致的诡异现象）。
- 关闭开关时走原有代码路径，保证回滚是零成本的。

### 2.3 代码内标记（方便后续接力）

每阶段的代码必须带统一前缀注释，便于 `grep` 定位：

```
// [IMPERF-S1] tick 隔离：录音波形改为组件自持定时器
// [IMPERF-S2] 消息窗口上限
// [IMPERF-S4] 媒体懒解析（开关：perf.chat.mediaLazy）
```

### 2.4 分支与提交

- 按项目规范：`feat/nuwa-<line>-<YYYY.MM>-<slug>`，当前跨端线为 `feat-2026.11`。
- 一阶段一 PR；PR 描述必须粘贴本文件对应阶段的验收数据。
- 合入后推两个远端（GitHub + 内网 GitLab）。

---

## 3. 阶段路线图与进度总览

> **接力方式**：开工前先看本表「状态 / 默认值 / 所属版本」三列；完成一个阶段后必须更新本表 + 第 12 节变更记录。

| 阶段 | 内容 | 开关名 | 默认 | 所属版本 | 状态 | 验收数据 | 提交 |
|---|---|---|---|---|---|---|---|
| S0 | 观测埋点 + 开关骨架 | `perf.enabled` | on（仅埋点） | 待定 | ⬜ 未开始 | — | — |
| S1 | 详情页 tick 隔离（波形 / 转钟） | `perf.chat.tickIsolation` | off | 待定 | ⬜ 未开始 | — | — |
| S2 | 详情页消息窗口上限 | `perf.chat.windowCap` | off | 待定 | ⬜ 未开始 | — | — |
| S3 | 详情页媒体子块组件化 | `perf.chat.mediaComponent` | off | 待定 | ⬜ 未开始 | — | — |
| S4 | 详情页媒体懒解析/懒挂载 | `perf.chat.mediaLazy` | off | 待定 | ⬜ 未开始 | — | — |
| S5 | 伙伴页会话列表治理 | `perf.convList` | off | 待定 | ⬜ 未开始 | — | — |
| S6 | 智联录治理 | `perf.contactList` | off | 待定 | ⬜ 未开始 | — | — |
| S7 | 回收列表评估（可选） | — | — | 待定 | ⬜ 未评估 | — | — |

状态图例：⬜ 未开始 / 🟡 开发中 / 🔵 灰度中 / ✅ 已全量 / ⛔ 已回滚（附原因）

---

## 4. Stage 0：观测与开关骨架

**目标**：在没有 APM 的前提下，能得到"改前 / 改后"可比的客观数据；建立开关骨架。

### 4.1 实施步骤

1. 新增 `utils/perfFlags.uts`（见 2.2）。
2. 新增 `utils/im/chatPerf.uts`：
   - `perfMark(name)` / `perfSpan(name, fromTs)`：开发版（`#ifdef DEBUG` 或 flag 开）用 **`console.error`** 打出时间戳（★鸿蒙真机看不到 `console.log`/`warn`，必须用 `error`）。
   - `perfCountRows()`：`uni.createSelectorQuery().selectAll(".chat-msg").count()` 近似行数。
3. 在详情页打三个点：
   - `initHistory` 入口（t0）→ `listSettled = true`（t1）：**进页耗时**
   - `handleChatScroll`（[chat.uvue:7833](../../pages/message/chat.uvue#L7833)）：统计 1s 窗口内帧间隔 P95
   - `messages.value.length` 变化时打一次条数
4. 同款打点给伙伴页（`convLoaded` 翻转）与智联录（`contactLoaded` 翻转）。

### 4.2 分端注意

- Android：`console.error` 可用 `pnpm hx:android:log` 抓；也可用内置 adb logcat。
- 鸿蒙：必须 `console.error`；日志量大时按 1% 采样。
- iOS：真机日志用 devicectl 抓沙盒 log（见项目既有方法）。
- H5 / 小程序：`console.error` 直接可用，主要验证不报错。

### 4.3 验收

- 三端各跑一次，能拿到「进页耗时 / 行数 / 帧间隔 P95」三项，且开关关闭时**行为与当前完全一致**（对比 `git diff` 只应有新增打点）。

### 4.4 回滚

埋点本身无行为影响；出问题直接删打点（或 `perf.enabled=false`）。

---

## 5. Stage 1：会话详情页 tick 隔离

**目标**：把**周期性**驱动整页重渲的 tick 移出页面渲染函数，改为组件自持。

> 为什么排第一：纯收益、不碰数据流、不碰接口，回滚成本最低，且能立刻消掉"录音/智能体处理期间整页冻结"。

### 5.1 范围（只做周期性 tick）

| 对象 | 频率 | 处理 |
|---|---|---|
| 录音波形 `waveformBars` | **150ms** | 抽组件，自持定时器（S1a） |
| 智能体转钟 `agentClockDeg` | 1.6s | 抽组件，自持定时器（S1b） |
| 已读 `readInfoTick` / 头像 `avatarResolveTick` / 转写 `asrTick` / 鸿蒙 `harmonyAvaSettleTick` | 事件驱动 | **本阶段不动**（S1c 可选，见 5.5） |

### 5.2 S1a 录音波形

- 现状：`waveformBars` 是页面 ref，`updateWaveform()` 每 150ms 整表替换（[chat.uvue:11888](../../pages/message/chat.uvue#L11888)），模板 [chat.uvue:1871](../../pages/message/chat.uvue#L1871) 直接 `v-for`。
- 做法：抽 `components/chat-voice-wave.uvue`，**组件内部**持有 bars 数组与 `setInterval`；父只传 `active: boolean`。参考已有 `components/voice-wave-bars.uvue` 的写法。
- 要点：父模板**不得**读取任何波形相关 ref（否则依赖仍建在页面上）。

### 5.3 S1b 智能体转钟

- 现状：页面 `agentClockDeg` ref + `agentClockStyle(deg)`，在行内两处消费（[chat.uvue:313](../../pages/message/chat.uvue#L313)、[chat.uvue:376](../../pages/message/chat.uvue#L376)）。
- 做法：抽 `components/chat-agent-clock.uvue`，组件内部自持 interval；**相位由 `Date.now()` 推导**（`deg = floor(now / 6400) * 1440 % 360`），保证多实例天然同步、不需要共享状态、也不会有漂移。
- 保留原有"步进 + transition"降桥频策略（每条 tick 转 4 圈，`transition-duration: 6400ms`），视觉与现在一致。
- 组件只在 `agentStatus == 2` / `agentP2pMark == 1` 时挂载，数量天然少；`onUnmounted` 必须清 timer。

### 5.4 分端注意

- **Android**：组件内 ref 更新只重渲组件自身，符合预期；不要在 `@load/@error` 之类原生事件回调里读响应式（历史 NPE，须 `setTimeout(0)`）。
- **鸿蒙**：组件内的纯 `view` + `:style` 变换不需要新节点创建语义，安全；但如果组件首帧依赖 `onReady`，注意鸿蒙首帧绘制时机。
- **iOS**：这条改动正是历史"动画 tick 打断中文输入"的解药（先例 `voice-wave-bars`），改完应回归 iOS 中文输入。
- **H5 / 小程序**：确认 `setInterval` 在页面隐藏时不会继续跑（`onHide` 停表）。

### 5.5 S1c（可选，按实测决定）

若 Stage 0 数据显示 `readInfoTick` 的 bump 频率仍然造成明显全页重渲（群聊大量已读回执），再做：
- 把 `readInfos` + `readInfoTick` 提到**模块级**（`utils/im/chatReadStore.uts`），已读环抽成组件自行订阅。
- ⚠️ 前置验证：`uts` 模块导出 `ref` 在三端编译目标下是否可用（30 分钟小样验证，含 H5 与小程序）。
- 若不通过，则推迟到 Stage 7 行组件化时随行内组件一起解决。

### 5.6 开关与灰度

- `perf.chat.tickIsolation`：关闭时保留原页面级 ref 与内联模板（旧路径完整保留），打开时渲染新组件。
- 建议灰度：内部 QA 全开 1 版 → 30% → 100%。

### 5.7 验收标准

| 项 | 标准 |
|---|---|
| 功能 | 录音波形动效、智能体转钟/蓝勾、p2p 思考钟**视觉与现在一致**（录屏对比） |
| 性能 | 500 条消息会话，录音 60s 期间滚动帧间隔 P95 不劣于空闲时 +10ms |
| 性能 | 智能体"处理中"期间，JS 侧无每秒级全页重渲（用 S0 打点确认 render 次数下降） |
| 回归 | iOS 中文输入框可正常输入拼音（历史踩坑项） |
| 回归 | 录音结束/取消、页面隐藏、切后台后无残留 timer（内存不涨） |

### 5.8 回滚

开关置 `false`；组件文件保留不影响编译。

---

## 6. Stage 2：会话详情页消息窗口上限

**目标**：给 `messages` 加硬上限，保证内存与节点数有界。

### 6.1 策略（关键设计）

- **上限** `CHAT_MAX_ROWS = 600`（可调常量），**裁剪粒度** `CHAT_TRIM_CHUNK = 100`（避免每来一条就裁）。
- **只裁不可见的一端**：
  - 用户在上翻 → 超限时从**尾部**裁（尾部在视口外，裁掉不跳动）。但**跳过**：
    - 本地未确认/失败行（`local == true` 或 `status != 1`，发件箱要保留）
    - 未读分隔行（`msgId == unreadDividerMsgId`，最多 1 行）
    - 正在多选/转发的行（若存在选中态）
  - 用户在贴底（`isNearBottom()`）→ 超限时从**头部**裁。
- **头部裁剪的正确性**：翻页游标来自 `messages.value[0].seq`（[chat.uvue:8906](../../pages/message/chat.uvue#L8906)），裁头后游标自然前移，后续上翻继续按"当前表头之前"取页，语义正确、不跳段；被裁掉的旧行若再次翻到会重新拉取（按 `msgId` 去重）。
  - **但必须**：裁头后把 `hasMore` 复位为 `true`（原本可能是 `false`），否则用户再也翻不上去。
- **不许在用户处于列表中段时裁头**（会整体跳动）：只有 `isNearBottom()` 且 `listSettled == true` 才允许裁头；不满足时挂起，等回到贴底或下一次贴底时补裁。

### 6.2 实施步骤

1. `utils/im/chatWindow.uts`：纯函数 `trimRows(rows, opts) -> {removed, keepHead, keepTail}`，便于单测与复用。
2. `prependHistoryRecords` 末尾、各处 `push` 之后调用 `maybeTrim()`。
3. `maybeTrim()` 内维护 `windowTrimmed` 标志 → 影响 `hasMore` 复位。
4. 媒体缓存**本阶段不主动释放**（避免误释放仍被可见行引用的 blob/临时文件）；行对象被丢弃即释放主体内存，释放策略留给 Stage 4。

### 6.3 与既有机制的交互（必须逐项回归）

| 机制 | 风险 | 处理 |
|---|---|---|
| 上翻锚定 `preserveImPrependAnchor` / `firstVisibleRowKey` | 裁尾不影响可视区；裁头需贴底守卫 | 按 6.1 |
| 「回到底部」浮钮 | 裁尾后 `scrollHeight` 变小，浮钮判据可能误亮 | 回归 `scheduleJumpLatestCheck` |
| 搜索/引用定位 `jumpToMsg` | 定位会换页并插入目标行，可能立刻被裁 | 定位期间（`jumpLocating`）**禁用裁剪** |
| 未读定位 `unreadLocating` | 同上 | 定位期间禁用裁剪 |
| 合并转发详情页 | 详情页已深拷贝（历史修复） | 回归二次进入图不裂 |
| 进页缓存 `imChatCache` | 缓存条数可能超过上限 | 水合后立即裁一次 |

### 6.4 分端注意

- 纯数据层，无平台分支；但**鸿蒙**的 `scroll-into-view` 兜底定位在裁剪后必须仍能找到 `msg-{id}`（裁掉的 id 不能还在锚点上）→ `scrollAnchor` 清空逻辑要覆盖裁剪路径。
- **Android**：裁剪后 `messages.value = rows` 是整表重赋值，会触发一次全表 diff（可接受，次数少）；注意不要在原生事件回调里直接调用。

### 6.5 开关与灰度

`perf.chat.windowCap`，默认 off；关闭时 `maybeTrim()` 直接 return。

### 6.6 验收标准

| 项 | 标准 |
|---|---|
| 内存 | 1000+ 条会话连续上翻 30 页：Android `adb shell dumpsys meminfo` 稳定在阈值内、不再随页数线性增长 |
| 正确性 | 上翻不跳段、不重复、不丢消息（与线上旧包同会话对照） |
| 正确性 | 连续上翻到裁头 → 再往回翻，能正常重新加载更早消息（`hasMore` 复位生效） |
| 回归 | 发文本/图/视频/语音、失败重试、撤回、引用、@提及、多选转发全部正常 |
| 回归 | 搜索定位、引用定位、未读定位到 1000 条之前的消息仍能直达 |
| 回归 | 群聊未读分隔线在裁剪后行为符合预期（不可见即消失，不算 bug） |

### 6.7 回滚

开关 off；上限常量置为极大值等价于不裁。

---

## 7. Stage 3：会话详情页媒体子块组件化

**目标**：把图片组 / 视频 / 语音三块从 750 行的行内模板中抽成独立组件，为 Stage 4 提供"可挂载/可不挂载"的边界。

> 为什么不是整行组件化：整行需要 ~30 个回调和大量 props，回归面巨大；媒体子块边界清晰、收益直接。整行组件化只在 Stage 7 启动回收列表时才必需。

### 7.1 步骤

1. 抽 `components/chat-msg-media/chat-image-grid.uvue`（主图 + `imageAtts`，含预览点击）。
2. 抽 `chat-video-block.uvue`（占位卡 ↔ 播放器切换，注意 `videoPlayUrl` 回填语义，[chat.uvue:2384](../../pages/message/chat.uvue#L2384)）。
3. 抽 `chat-audio-block.uvue`（语音条 + 转文字三点，注意 `asrTick`）。
4. 行内模板替换为组件标签，**props 只传该块需要的字段**，事件回传 `msgId` 而非整行对象。

### 7.2 分端注意（重点，历史踩坑密集区）

- **Android**：`@load/@error` 回调内**不得**读响应式（会 NPE），必须 `setTimeout(0)` 挪出事件栈。
- **鸿蒙**：
  - 组件内新建 `<image>` 节点在滚动帧中不补绘 → 必须复用"停手后再挂载"闸门（[chat.uvue:7833](../../pages/message/chat.uvue#L7833) 的 `chatScrolling` + 160ms 空闲）。
  - 弹层/隐藏容器里诞生的节点永不显示（`lazyMount` 先例），媒体组件不能放在 `v-if` 隐藏容器里预热。
  - `bg-image url()` 鸿蒙静默丢弃，图标一律走 iconfont 字形。
- **iOS**：`<video>` 禁止子节点、禁止 `autoplay`（历史约束）——抽组件时保持。
- **H5**：blob 地址的 `revokeObjectURL` 生命周期仍由页面统一登记（`releaseChatImages`），组件不自行 revoke。

### 7.3 验收标准

| 项 | 标准 |
|---|---|
| 功能 | 单图 / 多图（1–9 张）/ 图文混排 / 视频 / 语音 全部与改动前一致 |
| 功能 | 图片全屏预览、长图预览、视频全屏与退出、语音播放与转文字 |
| 性能 | 开关开/关对比，单行节点数下降（用 S0 的 `perfCountRows` 近似 + DevTools 节点树抽查） |
| 回归 | 鸿蒙头像/图片不出现"永久空白"（历史问题） |

### 7.4 开关与回滚

`perf.chat.mediaComponent`：off 时走原内联模板，on 时走组件。旧模板保留到 S4 验收通过后再删（删除单独提交）。

---

## 8. Stage 4：会话详情页媒体懒解析 / 懒挂载

**目标**：不在视口内的消息**不下载、不解码、不挂节点**。

### 8.1 核心设计：单向门

> **只懒挂载，不反向卸载** —— 一旦某行进入过可见区并挂载，就一直挂着（直到被 Stage 2 裁掉）。

理由：反向卸载会立刻踩中历史三连坑——鸿蒙"卸载后新节点不补绘"、头像刷新环、iOS 节点重建闪烁。单向门把风险压到最低，收益仍有 ~90%（长会话里大部分行从未进入视口）。

### 8.2 步骤

1. 可见范围：扩写 [chat.uvue:8752](../../pages/message/chat.uvue#L8752) `firstVisibleRowKey` 为 `visibleRange(overscan)`（上下各多取 N 行，`N ≈ 6`）。
   - 复用已有 `uni.getElementById` + `getBoundingClientRect` 方式，**不新增页面级 ref**。
2. 在 `handleChatScroll` 的 160ms 空闲回调（已有 `chatScrollIdleTimer`）里算一次范围：
   - 把新进入范围的行写入**非响应式** `Set<string> mediaWanted`。
   - 对新增行调用 `resolveRowMedia(row)`（该函数已是幂等的入口）。
3. 在 `resolveRowMedia` 开头加守卫（[chat.uvue:8589](../../pages/message/chat.uvue#L8589)）：
   ```uts
   if (lazyOn && !mediaWanted.has(row.msgId)) { row.mediaDeferred = true; return; }
   ```
   并把 `prependHistoryRecords` / `mergeSyncedMessages` 里的"每行都解析"改为只解析可见范围。
4. 模板侧：媒体块（Stage 3 组件）以 `wanted` prop 决定是否渲染 `<image>`/`<video>`；`wanted` 由 `mediaWanted` 通过**行字段**（`mediaDeferred` 取反）驱动，配合已有的 `scheduleChatMediaRefresh` 落地（这是既有机制，不改）。
   - Android 注意：行字段变更必须走 `messages.value = messages.value.slice()` 那套（[chat.uvue:5426](../../pages/message/chat.uvue#L5426)），原地赋值不重渲。
5. `preloadChatVideos`（[chat.uvue:8215](../../pages/message/chat.uvue#L8215)）改为只扫**可见范围 ± overscan**，不再从表头扫到尾。

### 8.3 分端灰度顺序（重要）

| 顺序 | 平台 | 理由 |
|---|---|---|
| 1 | Android | 图片下载/解码是最大成本，收益最直接；坑已知（NPE、方法绑定） |
| 2 | iOS | 相对安全，重点看节点重建闪烁 |
| 3 | H5 / 小程序 | blob 生命周期、无原生桥，问题最轻 |
| 4 | **鸿蒙最后** | 节点不补绘、弹层不显、@load 假回调三类坑都在这里；必须先在三端验证机制后再开 |

鸿蒙开启前必须单独过一遍：
- 滚动中不创建 image 节点（走 `chatScrolling` 空闲闸门）
- 起始 src 优先用已预取到本地的远端 temp（避免"先灰后图"）
- 失败行要连展示地址一起清并重解析（历史做法）
- 探针一律 `console.error`

### 8.4 验收标准

| 项 | 标准 |
|---|---|
| 网络 | 含 50 张图的会话进页：实际图片请求数从 ~50 降到屏内条数级 |
| 内存 | 同上会话，Android 峰值内存下降 ≥ 30% |
| 功能 | 滚动到任意位置，图片/视频在 1 帧内出现（无"永久灰块/空白"） |
| 功能 | 长图预览、视频首帧、语音播放不回归 |
| 边界 | 快速滑动（惯性）期间不出现空白持续到停手之后（停手后 ≤ 300ms 补齐） |
| 边界 | 被 Stage 2 裁掉再回拉的行，媒体能重新解析 |

### 8.5 回滚

`perf.chat.mediaLazy` 关闭 → `resolveRowMedia` 恢复全量解析（旧路径）。

---

## 9. Stage 5：伙伴页会话列表

**目标**：会话数上万时不卡。

### 9.1 步骤

1. **加载上限**：已加载页数上限 `CONV_MAX_PAGES = 5`（250 条），超出后底部提示"仅显示最近 250 个会话，请用搜索"。
   - 这是**唯一**涉及用户可见行为的改动 → 开关控制，默认关闭。
2. **翻页不再整表重排**：`loadMoreConversations` 改为"新页行追加 + 仅对受影响分区局部重排"，不再 `copyRows` 全表 + `reorderConvRows(全表)`。
   - 注意保持分区不变式（置顶 / 草稿 / 普通），参考 [message-content.uvue:1547-1585](../../pages/message/message-content.uvue#L1547-L1585) 现有注释。
3. **刷新走合并**：`loadConversations` 整表替换改为按 `convId` diff 合并（复用行对象，只更新变化字段），减少整列重渲。
   - 注意：`resolveConvRowsIcons` 已跳过已回填行，可直接传整表。
4. **行级组件已就绪**：`conv-row-item` 已组件化，无需再拆。

### 9.2 分端注意

- 列表有原生下拉刷新插槽（Harmony/Android/iOS 三套补丁）与 `scrollViewKey` 重建逻辑 —— **本条改动完全不碰这些**，只动数据层。
- 顶部/底部切换 tab 时 pane 的重建与 `activeTab` 写入保持原样（历史卡顿修复，勿回退）。

### 9.3 验收标准

| 项 | 标准 |
|---|---|
| 性能 | 500 会话翻 10 页，单次翻页主线程耗时 < 100ms（S0 打点） |
| 性能 | 相比开关关闭，整表重渲次数下降 ≥ 80% |
| 回归 | 下拉刷新、侧滑、长按、置顶分组、草稿、未读角标、搜索四态全部正常 |
| 回归 | WS 新消息到达时列表实时排序与角标正确 |

---

## 10. Stage 6：智联录

**目标**：千级联系人滚动不抖。

### 10.1 步骤

1. **分区懒渲染**：`contacts` / `groups` / `spaces` 三个长列表各先渲染前 `CONTACT_CHUNK = 50` 行，滚动到底再追加。
   - 视觉上等价于"一次性都在"（用户滚动即加载），不引入"展开更多"按钮，避免 UI 变更。
2. **行的组件化 + 头像懒挂载**：头像沿用详情页的头像解析链，离屏不解析。
3. 保持 `truncated` / `degraded` 提示逻辑不变。

### 10.2 分端注意

- 同 Stage 4 的图片/头像约束（鸿蒙节点创建时机、Android NPE）。
- 该 pane 在下拉刷新插槽内，追加渲染必须发生在滚动空闲（避免与原生 refresher 抢帧）。

### 10.3 验收标准

- 1000 联系人：首屏渲染耗时、滚动帧率达标；搜索、备注修改、申请同意/拒绝、跳转会话全部正常。

---

## 11. Stage 7：回收列表评估（可选，不是必做）

**启动条件**：S1–S4 全部上线并观察一版后，目标机型上 1000 条消息会话仍达不到 50fps。

### 11.1 评估清单（逐项确认可行才开工）

| 项 | 需要确认 |
|---|---|
| 三端支持度 | `list-view` 在 Android / iOS / 鸿蒙 / H5 / 小程序的支持矩阵（按当前 HBuilderX 5.15 核实） |
| 任意消息定位 | 能否滚动到指定 `msgId`（搜索/引用/未读定位依赖） |
| 下拉刷新 | 原生 refresher 插槽是否支持（三端现有补丁可能要重做） |
| 手势 | 长按面板、滑动手势、多选、按压态能否保持 |
| 输入坞让位 | `bodyShiftPx` 与容器高度联动是否仍成立 |
| 锚定 | 上翻锚定机制能否在回收容器上重建 |
| 前置 | 消息行必须先整行组件化（Stage 3 的延伸） |

### 11.2 结论分支

- 可行 → 立项独立方案，迁移前先做"整行组件化"子阶段。
- 不可行（尤其鸿蒙） → 明确记录结论与原因，保持 `scroll-view + 窗口上限` 路线，本方案即终结。

---

## 12. 变更记录（每阶段完成后追加一行）

| 日期 | 阶段 | 版本/分支 | 提交 | 验收数据摘要 | 验收人 | 备注 |
|---|---|---|---|---|---|---|
| 2026-11-13 | 立项 | feat-2026.11 | — | — | — | 本文档创建 |

---

## 13. 每阶段通用回归清单（三端都要过）

**消息能力**：文本 / 图片（单图、多图、图文混排）/ 视频 / 语音 / 文件 / 互动卡片 / 合并转发 / 引用 / @提及 / 表情回应

**交互**：上翻加载更早 / 下拉刷新 / 回到底部浮钮 / 长按面板（回复、复制、转发、撤回、删除、转文字）/ 多选 / 滑动 / 输入框（键盘让位、面板切换、中文输入）/ 搜索定位 / 引用定位 / 未读定位

**状态**：发送中 / 失败重试 / 撤回 / 已编辑 / 已读回执 / 智能体处理中与完成

**入口**：伙伴页 → 会话详情（会话列表行、搜索结果、@提及、分享卡片、系统通知）全部能进且卸载无残留

> 每个阶段 PR 必须附上本清单的勾选结果（分端：Android / iOS / 鸿蒙；H5 可选）。

---

## 14. 排期与资源建议

| 阶段 | 预估工作量 | 依赖 | 建议节奏 |
|---|---|---|---|
| S0 | 0.5 人日 | — | 与 S1 同批 |
| S1 | 2–3 人日 | S0 | 第一个版本 |
| S2 | 3–5 人日 | S0 | 第二个版本 |
| S3 | 5–8 人日 | — | 第三个版本 |
| S4 | 5–10 人日 | S3 | 第三/四个版本（分端灰度，鸿蒙压最后） |
| S5 | 2–3 人日 | — | 可与 S3/S4 并行 |
| S6 | 2–3 人日 | S5 经验 | 与 S5 同批 |
| S7 | 评估 1–2 人日 | S1–S4 | 按指标决定是否立项 |

**建议分批上线**：S0+S1 → S2 → S3 → S4（Android→iOS→H5→鸿蒙）→ S5+S6。

---

## 15. 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| 鸿蒙节点不补绘/弹层不显 | 图片永久空白 | 单向门 + 滚动空闲挂载 + 鸿蒙最后开 + 保留"哑节点扫描重挂"兜底 |
| Android 原生事件内读响应式 NPE | 崩溃 | 全部 `setTimeout(0)` 挪出；自建代码评审检查项 |
| 裁剪与锚定冲突 | 视口跳动 | 只裁不可见端 + 贴底守卫 + 定位期间禁用裁剪 |
| 整表重赋值触发全页 diff | 卡顿短时尖峰 | 合并调度（现有 50ms 去抖）+ 只在空闲期触发 |
| 开关状态不一致 | 诡异现象 | 页面 onLoad 读一次并缓存，运行中不翻转 |
| 历史修复被无意回退 | 老问题复现 | 本文件第 15 节 + 通用回归清单；PR 必须对照 |

---

## 16. 关键坑位索引（历史沉淀，改前必读）

- **Android**：原生事件回调内读响应式 → NPE；模板方法调用不收集依赖 → 需 tick 尾参；`v-if` 方法调用式创建后不重估 → 显隐走 `:style`。
- **鸿蒙**：`console.log/warn` 看不到，探针用 `console.error`；滚动帧内新建 `<image>` 不补绘；隐藏容器内节点永不显示且 `@load` 照常回调；`bg-image url()` 静默丢弃；`scroll-into-view` 驱动不可靠需兜底；`height:0 + overflow:hidden` 藏不住，要 `v-if`。
- **iOS**：`<video>` 禁子节点/禁 autoplay；高频页面级 tick 会打断中文拼音输入；节点重建易闪烁。
- **通用**：`scroll-view` 内容 flex 行会被压成视口宽；`chat.uvue` 模板有 255 参数硬限（新增顶层引用极易触发 R8 桩异常整页加载失败）。
