# App 会议邀请与音视频通话技术方案

日期：2026-11-18
基线分支：`feat-zq`（会议模块与通话实现所在分支）
参考实现：`nuwax-im` 仓库 `feat-video-meeting` 分支（`lib/voip.ts`、`lib/meetingInvite.ts`、`store/call.ts`、`store/meetingInvite.ts`、`ImCallController`）
状态：方案稿，待评审

> 2026-11-19 对接范围更新。移动端交付单聊语音原生来电字段契约，IM 后端同学负责实现投递。字段、JSON 示例和 iPhone 扩展以[单聊语音来电推送字段（后端对接稿）](../engineering/单聊语音来电字段对照-后端定稿.md)为准。

---

## 0. 结论摘要

1. **不新开消息通道**。会议邀请与语音/视频通话都是**普通 IM 消息**，走既有发送 → 落库 → 扇出 → 未读 → 离线推送链路，只是多两种 `msgType`：
   - `voip`：1v1 语音/视频通话邀请，**60 秒响铃窗口**，过期即「未接来电」。
   - `meeting_invite`：会议邀请，**整场会议有效**，不超时。
2. 瞬时状态（接听/拒绝/挂断/超时/已处理）走 `MSG_CUSTOM_EVENT(3007)`，由 4 个 REST 端点触发，**不落库、不补发**。
3. RTC 统一用 LiveKit：1v1 通话与多人会议是**同一个房间概念**，复用 `nunuax-livekit` 插件与 `utils/meeting/meetingMedia.uts`，区别只在房间的创建者与生命周期。
4. 单聊语音原生来电由 IM 按被叫设备提供 `callRoute`，并在 `payload` 带上完整邀请定位、被叫身份和截止时间。字段见 §5.2.2。
5. App 端缺口集中在：协议解析、通话状态机、来电/邀请界面、铃声与音频会话、推送点击路由、消息卡片渲染。

---

## 1. 范围

### 1.1 本期包含

| 场景 | 入口 | 接收方表现 |
|---|---|---|
| 创建会议时选参会人 | 会议「发起 / 预约」表单选人 | 聊天收到会议邀请卡片 + 来电式邀请浮层（可加入/忽略） |
| 会议进行中添加参会人 | 会中「邀请」面板 | 同上 |
| 单聊发起语音通话 | 聊天页「+」/顶栏 | 全屏来电页，接听进入 1v1 语音房间 |
| 单聊发起视频通话 | 聊天页「+」/顶栏 | 全屏来电页，接听进入 1v1 视频房间 |
| 群聊发起语音/视频通话 | 群聊天页「+」 | 群内一条通话卡片（不响铃）+ 被勾选成员收到单聊邀请（响铃） |

### 1.2 本期不包含

- 系统来电的跨平台扩展先验单聊语音，按 §5.2.2 的字段送达，视频和群通话后续单独确认。
- 通话中录制、通话记录独立页（首期用消息气泡承载记录）。
- 会议邀请的「稍后提醒」等日历能力。

### 1.3 平台范围

Android / iOS / 鸿蒙首批；H5、微信小程序不在本期（无原生推送与后台音频能力）。

---

## 2. 协议总览

### 2.1 消息类型（服务端已实现，值是落库契约，不可改名）

| msgType | 摘要占位 | 生命周期 | body |
|---|---|---|---|
| `voip` | `[通话]` | 60 秒响铃窗口 | `{ callId, mediaType, roomName }` |
| `meeting_invite` | `[会议邀请]` | 整场会议期间有效 | `{ inviteId, roomName, title, mediaType, groupCall?, silent?, passcode? }` |

字段约束（三端逐字一致）：

- `callId` / `inviteId`：`^[A-Za-z0-9._-]{1,128}$`，前端生成，原样透传，仅用于去重。
- `roomName`：`^[A-Za-z0-9._-]{1,128}$`，LiveKit 房间名；会议号即房间名。
- `mediaType`：`audio` | `video`（大小写不敏感，解析时归一；认不出返回 `null`，**不猜默认值**）。
- `title`：会议标题，截断 60 字符；**不进摘要的 roomName**（通知栏/锁屏可见，且开放游客的会议号即入会凭据）。
- `passcode`：4~6 位数字，可选；形状不合格直接丢弃，不写入消息体。
- `silent`：群通话卡片专用；`true` 时收到**不弹邀请浮层**，只作为聊天卡片。
- `groupCall`：`true` 时卡片文案用「语音/视频通话」口径，但仍走会议入会流程。

### 2.2 瞬时事件（3007 即时消息事件）

| eventType | 触发 | 目标 | 客户端动作 |
|---|---|---|---|
| `voip:answered` | 被叫接听并入房成功后 | **接听者自己的其余设备** | 停止响铃 |
| `voip:decline` | 被叫拒绝 | 会话内广播 | 主叫停止等待；被叫其它端停铃 |
| `voip:cancel` | 主叫挂断 | 会话内广播 | 所有端退出通话界面 |
| `voip:timeout` | 主叫端 60 秒到点 | 会话内广播 | 所有端退出，显示未接听 |
| `meeting:invite-handled` | 加入/忽略会议邀请后 | **处理者自己的其余设备** | 摘掉该邀请并停铃 |

事件 payload 至少含 `callId`（通话类）或 `inviteId` + `msgId`（会议类）；客户端按 id 匹配是否是自己正在展示的那一通，不匹配直接忽略。

### 2.3 REST 端点（nuwax-im 已实现）

| 方法 | 路径 | 调用者 | 请求体 |
|---|---|---|---|
| POST | `/api/instant-message/calls/answered` | 被叫 | `{ convId, msgId }` |
| POST | `/api/instant-message/calls/ended` | **仅主叫** | `{ convId, msgId, reason: "cancel"\|"timeout" }` |
| POST | `/api/instant-message/calls/declined` | **仅被叫** | `{ convId, msgId }` |
| POST | `/api/instant-message/calls/meeting-invite-handled` | 处理者 | `{ convId, msgId, inviteId, roomName }` |

服务端校验：会话活跃成员、消息必须是 `voip` / `meeting_invite`、`ended` 必须是发送者、`declined` 必须非发送者。全部「失败不影响本地入会/停铃」——客户端 fire-and-forget。

### 2.4 离线推送

服务端现有信封（`UniPushChannel`）：

```json
{
  "push_clientid": ["..."],
  "title": "…",
  "content": "…",
  "payload": { "convId": "雪花字符串", "convType": 2, "type": "voip|meeting_invite|message", "msgId": "雪花字符串" },
  "category": { "harmony": "IM", "huawei": "IM" },
  "force_notification": true,
  "request_id": "..."
}
```

单聊语音原生来电在此信封上增加 `callRoute`，并补齐 `payload` 字段。普通离线通知可按原会话定位和点击处理。见 §5.2.2。

---

## 3. 端上状态机

### 3.1 通话（`voip`）

```text
idle ──(发起/收到邀请)──> outgoing / incoming
incoming ──接听──> connecting ──入房成功──> active ──挂断──> ended
incoming ──拒绝──> ended(declined)
outgoing ──收到 answered──> connecting
outgoing ──收到 decline──> ended(declined)
outgoing ──60s 到点──> 调 /ended(timeout) ──> ended(missed)
incoming ──65s 兜底──> ended(missed)
outgoing/incoming ──单方取消──> ended(canceled)
```

约束：

- **全局同一时刻只允许一通通话**；`incoming/outgoing/connecting/active` 时再来邀请 → 记一条「忙线未接」，不弹界面。
- **去重键 `callId`**：重连补投、多端同步的同一 `callId` 只响一次。判断「我正在进行中的这一通」也用 `callId`，**不能用 `senderId === 自己`**（同账号多端常态，会误杀自己另一端的来电）。
- **60 秒是主叫驱动的**：主叫到点主动调 `/ended?reason=timeout`；被叫本地 65 秒兜底（主叫可能已离线）。
- 收到邀请时校验 `sendTime` 是否在响铃窗口内，断线补投的旧帧直接丢弃。

### 3.2 会议邀请（`meeting_invite`）

```text
收到邀请 ──> pending 队列（队首展示）
队首 ──加入──> 上报 invite-handled ──> 入会
队首 ──忽略──> 上报 invite-handled ──> 出队
收到 meeting:invite-handled（自己其它端）──> 按 inviteId/msgId 出队
```

- **不超时**，不进入通话忙碌判定；会议邀请与进行中的通话可以并存（用户在通话中可以选择忽略邀请）。
- 同一 `inviteId` 只响一次；同一个人**再次被邀请**（新 `inviteId`）要再次提示。
- `silent=true` 的群通话卡片：只渲染卡片，入队动作跳过。
- 入会=会议入会流程（`create=false`，绝不凭空建房）。

---

## 4. 场景流程

### 4.1 创建会议时邀请参会人

```text
主持人 App                  IM 服务端                     被邀请人 App
   │  createRoom(origin=1)      │                              │
   │───────────────────────────>│                              │
   │  为每个被邀请人：           │                              │
   │  createP2p(userId)         │                              │
   │───────────────────────────>│                              │
   │  sendMessage(meeting_invite)                              │
   │───────────────────────────>│──落库/扇出/离线推送──────────>│
   │                            │                              │ 卡片 + 邀请浮层
   │                            │   (离线: 3007 不补发)         │ 加入/忽略
   │                            │<── meeting-invite-handled ───│
   │                            │──3007 给自己其它端────────────>│
```

要点：

- **逐人单聊发送**，不依赖群：收件人错过浮层也能在会话里找到卡片。
- 失败只累计不中断，返回「成功 n / 失败名单」，会议本身不判失败。
- 邀请内容随卡片带 `passcode` 明文，避免对方点进去撞密码框。
- 会议「预约」复用同一条链路；「会中加人」同样复用，只是入口在会中面板。

### 4.2 会中加人

与 4.1 完全一致（同一发送函数），额外差异：

- 当前会议 `roomName` 已存在，`title`/`mediaType` 取会中状态。
- 已入会的人不再发送（按会议成员列表过滤）。
- 发送成功后不阻塞会议。

### 4.3 单聊语音/视频通话

```text
主叫                                服务端                          被叫
 │ 建 LiveKit 房间（可选预建）         │                              │
 │ sendMessage(voip, callId, room)    │                              │
 │───────────────────────────────────>│──落库/扇出/推送(type=voip)──>│
 │ 显示「正在呼叫 00:xx」              │                              │ 全屏来电页 + 铃声
 │                                    │                              │ 接听
 │                                    │<── /calls/answered ──────────│
 │                                    │──3007 voip:answered ────────>│ 自己其它端停铃
 │ 入房（拿 token）/ 等待              │                              │ 入房（拿 token）
 │<────────── LiveKit 音视频 ───────────────────────────────────────>│
 │ 挂断 → /calls/ended(cancel)        │──3007 voip:cancel ──────────>│ 退出
```

要点：

- 主叫发起后**立即展示呼出界面**，房间可预建也可接听后建；两端都以 `roomName` + token 入房。
- 被叫必须**入房成功后**才上报 `answered`（不是点按钮瞬间）。
- 主叫取消/超时都要调 `/ended`，否则被叫会一直响到本地兜底。
- 未接通时消息气泡显示「已取消 / 未接听 / 已拒绝」，接通后显示时长。

### 4.4 群聊通话

```text
发起人                        群会话                       被勾选成员
 │ 1) 发一条 groupCall+silent 卡片到群（全员可见、不响铃）
 │──────────────────────────────>│
 │ 2) 对被勾选成员逐人：createP2p + meeting_invite（响铃）
 │──────────────────────────────────────────────────────────>│
```

- **不能把群卡片做成响铃源**：一条群消息会扇出给全群，不带 `silent` 等于骚扰全群。
- 未勾选的群成员随时点群卡片加入（`create=false`）。
- 群通话的房间是**会议房间**（不是 1v1 voip 房间），因此复用会议入会与成员治理。

### 4.5 离线 / 后台

| 状态 | 送达方式 | 端上表现 |
|---|---|---|
| App 前台（WS 在线） | 3007 + 消息帧 | 来电页/邀请浮层，无系统通知 |
| App 后台但进程存活 | 厂商通道 + 在线透传 | Android 系统通知；iOS 由端上补本地通知 |
| App 无进程 | 普通通知或单聊语音原生来电通道 | 普通通知按点击路由处理。原生来电按 §5.2.2 的 `callRoute` 和 `payload.expiresAt` 验证系统来电 |
| 鸿蒙退后台 | Push Kit | 系统通知；进程被冻结，点击后才恢复 |

**必须做去重**：同一条消息可能同时经 WS 与推送到达，按 `msgId`（通话再叠 `callId`）只处理一次。

### 4.6 多设备

- 邀请扇出到用户所有设备（服务端按 `sourceDeviceId` 排除发起端）。
- 任一端接听 → `/answered` → 其余端停铃。
- 任一端拒绝 → `/declined` → 其余端停铃。
- 会议邀请同理，任一端加入/忽略 → `meeting-invite-handled`。

---

## 5. 前后端衔接

### 5.1 发送侧（App → 服务端）

#### convId 的语义（先澄清）

`convId` 是**这条邀请消息落到哪个 IM 会话**，不是会议标识，也不是"会议号"：

- **会议本身没有 `convId`**，会议标识是 `roomName`（会议号 = LiveKit 房间名）。
- 1v1 通话：`convId` = 与对方的单聊会话。
- 创建会议 / 会中加人：**每个被邀请人各建一条单聊**，每人一个 `convId`（`apiImCreateP2pConversation`，服务端幂等）。
- 群通话：群会话 `convId` 只用于发一条 `silent=true` 的群卡片；响铃邀请仍逐人走单聊。

所以「创建会议时选人」不能拿会议去套一个 `convId`，正确调用链是：

```text
for each 被邀请人:
  convId = createP2p(userId)       // 幂等，已存在直接复用
  sendMeetingInvite(convId, body)  // roomName / title / mediaType 在 body 里
```

#### 分层封装

| 层 | 函数 | 职责 |
|---|---|---|
| 底层 | `apiImSendMeetingInvite(convId, inviteId, roomName, title, mediaType, groupCall, silent, clientMsgId, passcode?)` | 发一条 `meeting_invite`；**已存在**于 `servers/imCall.uts`，待补 `passcode` |
| 高层 | `inviteContactsToMeeting({ roomName, title, mediaType, passcode, contacts })` | 逐人建单聊 + 发送 + 汇总失败；创建页 / 预约页 / 会中加人共用 |
| 群卡片 | `sendGroupCallCard(groupConvId, body)` | 群会话发一条 `silent=true` 卡片，**不响铃** |
| 通话 | `apiImSendVoipInvite(convId, callId, mediaType, roomName, clientMsgId)` | 1v1 通话邀请；**已存在**于 `servers/imCall.uts` |

`clientMsgId` 每条唯一（幂等键）；`deviceId` 必带（服务端据此排除来源端）。

### 5.2 推送侧（服务端 → 云函数 → App）

#### 5.2.1 分类与渠道

由后端根据已登记的被叫设备选择来电能力。单聊语音原生来电使用 `callRoute`；`category` 与 `channelId` 属于具体通知配置，原生来电字段见下一节。

#### 5.2.2 payload 字段（完整清单）

**单聊 VoIP 原生来电。** IM → 云函数新增一个顶层对象 `callRoute`。在现有 `payload` 里补 `callId`、`mediaType`、`calleeId`、`expiresAt`，`displayName` 为展示字段。服务端按消息发送时间计算截止时间；端上用 `convId + msgId` 回查原邀请，接听时读取其中的 RTC 房间名。完整 JSON、字段类型和 iPhone 登记字段见[后端对接稿](../engineering/单聊语音来电字段对照-后端定稿.md)。

**meeting_invite**

| 字段 | 用途 | 必要性 |
|---|---|---|
| `convId` / `convType` / `msgId` | 已有 | 已有 |
| `type` | 已有：值为 `meeting_invite` | 已有 |
| `inviteId` | 去重（同一条邀请重复投递只响一次） | **必须** |
| `roomName` | 点「加入」直接入会（`create=false`） | **必须** |
| `title` | 浮层/卡片标题；不带就得先拉消息 | **必须** |
| `mediaType` | 入会默认开不开摄像头 | **必须** |
| `silent` | 群通话卡片不响铃；缺了会「勾选 2 人、全群弹窗」 | **必须** |
| `passcode` | 4~6 位数字；有密码的会议冷启动点通知必须能直接入会，不撞密码框 | **必须**（有密码时） |
| `senderName` | 浮层显示「张三邀请你加入」；不能等拉会话 | **必须** |
| `groupCall` | 区分「群通话」与「会议邀请」的卡片文案与浮层标题 | **必须** |

```json
{
  "convId": "1879...", "convType": 2, "msgId": "1879...",
  "type": "meeting_invite",
  "inviteId": "mi-lx2k3-ab12",
  "roomName": "123456789",
  "title": "周会",
  "mediaType": "video",
  "silent": false,
  "groupCall": false,
  "passcode": "1234",
  "senderName": "张三"
}
```

> `silent` 漏了会直接出事故：群通话是往群里发一条 `silent=true` 的 `meeting_invite`，会推送给全群成员。离线端若在 payload 里拿不到 `silent`，只能先拉消息才知道，弱网下会按「响铃邀请」处理。
>
> `passcode` 放 payload 是安全的：payload 不渲染到通知栏/锁屏（展示的只有 `title`/`content`），且与 PC「邀请卡片随身带密码」的约定一致。

**不要放进 payload**：

| 字段 | 原因 |
|---|---|
| `senderAvatar` | URL 长、受保护需鉴权、可能过期；端上按 `convId` 拉会话，先显示首字头像 |
| `senderId` | 多端去重靠 `callId`/`inviteId`，服务端已按 `sourceDeviceId` 排除发起端 |
| `convName` | 1v1 用 `senderName`；群卡片不弹浮层，不需要即时展示 |
| `sendTime`（会议邀请） | 会议邀请整场有效，没有过期语义 |
| RTC `token` / `roomUrl` | 接听后由 token 接口返回 |

来电关键字段在云函数传递中须保留；会议邀请字段继续按本节约定。

#### 5.2.2.1 信封层语义（端上必须理解）

**`type` 可能是 `message`，不能只判 `voip`。** 服务端 `render()` 会在三种情况下把 `type` 置空（通道按 `"message"` 输出）：

1. 消息被撤回或查不到；
2. **同一会话还有其他未读**（`others > 0`）——通知文案已不是单纯那一条，不能弹来电界面；
3. **voip 已超过 60 秒响铃窗口**——补推候选可存活 7 天，昨天的未接电话今天不能再来电。

以上描述普通通知的聚合逻辑。原生来电需要 `type=voip` 和 §5.2.2 约定的有效字段。会议邀请不受 60 秒限制。

**`badge` 的未读口径待产品确认。** payload 里的 `badge` 是未读总数，`voip` / `meeting_invite` 当前按普通消息计入未读：

- 未接来电是否计入（一般计入）；
- 会议邀请是否计入（一般计入）；
- 若不计，服务端未读计数要排除，否则角标虚高，iOS 本地补角标也会跟着错。

普通通知沿用现有的 `request_id`。原生来电由候选云函数按路由、目标设备和 `callId` 生成 `request_id`，同一次通话的重试仍使用原业务 `callId`。取消和超时沿用 §5.3 的通话状态上报。

#### 5.2.3 云函数连带改动

`push-send` 的原生来电请求按 `callRoute` 选厂商通道，保留 §5.2.2 的关键字段。回执用于按同一 `callId` 跟踪送达。

### 5.3 状态上报（App → 服务端）

```ts
apiImCallAnswered({ convId, msgId })
apiImCallEnded({ convId, msgId, reason })
apiImCallDeclined({ convId, msgId })
apiImMeetingInviteHandled({ convId, msgId, inviteId, roomName })
```

全部 fire-and-forget，失败只记日志，**绝不影响本地入会/停铃**。

### 5.4 事件接收（服务端 → App）

App 端 `utils/im/imWsEventBridge.uts` 已有 `IM_EVENT.CustomEvent` 透传，新增：

- `utils/im/imCall.uts`：解析 `voip:*`，转给通话状态机。
- `utils/meeting/meetingInviteState.uts`：解析 `meeting:invite-handled`。

### 5.5 RTC

```ts
apiImMeetingCreateRoom(body)          // 主叫/主持人建房，origin=1 才落会议记录
apiImMeetingIssueToken(room, name)    // 入会令牌（identity=tenant:user:platform）
nuwax-livekit.connect(serverUrl, token, room, displayName, micOn, cameraOn)
```

1v1 通话与会议共用；`create=false` 加入者**绝不建房**。

---

## 6. App 端工作清单

### 6.1 协议与状态

| 文件 | 工作 |
|---|---|
| `utils/im/imCallProtocol.uts`（新） | `parseVoipInvite` / `parseVoipEvent` / `parseMeetingInvite` / `makeCallId` / `makeRoomName` / TTL 常量，逐条对齐 PC `lib/voip.ts`、`lib/meetingInvite.ts` |
| `utils/im/imCallState.uts`（新） | 通话状态机：忙碌判定、去重、超时、事件应用；模块级单例 |
| `utils/meeting/meetingInviteState.uts`（新） | 邀请队列、`inviteId` 去重、`handled` 集合（上限 200）、与事件对账 |
| `servers/imCall.uts` | **已有** `apiImSendVoipInvite` / `apiImSendMeetingInvite` / `answered` / `ended` / `declined`；只需给 `apiImSendMeetingInvite` 补 `passcode` |
| `utils/meeting/meetingInviteSend.uts`（新） | 高层 `inviteContactsToMeeting`：逐人 `createP2p` + 发送 + 失败汇总；创建页 / 预约页 / 会中加人共用 |

### 6.2 界面

| 文件 | 工作 |
|---|---|
| `components/im-call/call-incoming.uvue`（新） | 全屏来电页：头像、姓名、语音/视频标识、接听/拒绝、60s 倒计时 |
| `components/im-call/call-outgoing.uvue`（新） | 呼出页：正在呼叫、取消 |
| `components/im-call/call-active.uvue`（新） | 通话中：计时、静音、扬声器、挂断、视频画面/切换摄像头 |
| `components/im-call/meeting-invite-overlay.uvue`（新） | 会议邀请浮层：标题、邀请人、加入/忽略；不超时 |
| `pages/message/chat.uvue` | 单聊/群聊「+」面板增加语音/视频入口；来电页挂载 |
| `pages/message/message-content.uvue` | 渲染 `voip` 通话卡片与 `meeting_invite` 邀请卡片（含加入按钮、状态文案） |
| `subpackages/pages/im-meeting/im-meeting-create.uvue` | 创建会议时选人 → 逐人发送邀请，展示部分失败名单 |
| `subpackages/pages/im-meeting/im-meeting-room.uvue` | 会中「邀请」面板复用同一发送函数 |
| 群通话：群聊天「+」 | 选人弹窗 → 发 `silent` 群卡片 + 逐人单聊邀请 |

### 6.3 系统能力

| 项 | 工作 |
|---|---|
| 铃声/震动 | 来电铃声（可循环）、震动；停止时机与音频会话协调 |
| 音频会话 | 统一 `meetingMedia` 的音频占用：会议/通话/语音消息/ASR 互斥，入会前抢占、退出后释放 |
| 推送路由 | 原生通话入口按 `expiresAt` 判断有效期。普通通知的点击分支仍按 `type` 路由，旧来电从原消息 `sendTime` 判 60 秒窗口，过期显示「未接来电」 |
| 原生来电展示 | Android 原生来电使用端上已有的电话通知渠道。iPhone 按 PushKit 回调上报系统来电。普通通知按现有规则展示 |
| 权限 | 麦克风/摄像头申请时机：发起或接听时；拒绝后给「仅收听」降级路径 |
| 前后台 | `App.onHide` 不主动断 RTC（会议模块已约定）；来电页在后台时由通知承载 |

### 6.4 关键约束（踩坑预防）

- **不要用 `v-if` 在隐藏容器里创建来电页**（鸿蒙/弹层头像问题已有先例），统一用常驻 + `opacity` 或 lazyMount。
- 高频计时器（来电倒计时、通话计时）**抽子组件**，禁止页面级 reactive tick 导致整页重渲染（iOS 拼音组字/列表卡顿先例）。
- 列表行内新增渲染分支时注意 Android 模板参数上限，优先抽组件。
- 推送回调里不要直接读响应式数组（Android 原生事件栈 NPE 先例），用 `setTimeout(0)` 挪出。

---

## 7. 后端工作清单

| 项 | 现状 | 待办 |
|---|---|---|
| `voip` / `meeting_invite` 消息类型 | ✅ 已有 | 无需改动 |
| 4 个 calls REST 端点 | ✅ 已有 | 确认 App 鉴权头/平台参数一致 |
| 3007 事件下发 | ✅ 已有 | 无需改动 |
| 推送 `payload.type` | ✅ 已有（wire 值） | 无需改动 |
| 单聊语音原生来电 | 普通推送已有 `convId/convType/type/msgId` | IM 后端按 §5.2.2 提供 `callRoute`，并补四个必传业务字段 |
| 云函数原生来电分支 | 移动端仓已有候选字段校验 | 以实际联调部署验证厂商路由与下行字段 |
| 推送文案 | 通用会话摘要 | `voip`：「张三邀请你语音通话」；会议：「会议邀请：周会」 |
| 60 秒 TTL | ✅ 服务端常量 `CALL_RING_TTL_SEC` | 确认离线推送时的过期处理（过期推送到端后不应再响） |
| 群通话扇出 | PC 前端拼装 | 保持前端拼装即可，服务端无需新增 |
| 会议邀请的推送 | ✅ 走通用消息推送 | 确认 `type=meeting_invite` 且不带 VOIP 分类 |
| 未接来电记录 | 由 `voip` 消息本身承载 | 若要独立通话记录页，另立接口 |

---

## 8. 平台差异与风险

| 风险 | 影响 | 应对 |
|---|---|---|
| iOS PushKit 尚待联调闭环 | App 无进程时的系统来电取决于有效的设备登记与专用投递 | 用同一 `callId` 核对 iOS VoIP 回执、PushKit 回调与系统来电 |
| 鸿蒙后台进程冻结 | 退后台后 WS 不实时，只能靠 Push Kit 通知 | 依赖离线推送 + 点击恢复；不要承诺「后台秒响铃」 |
| 华为 VOIP 分类审核 | 滥用会被收回权益 | 仅实时通话用 `VOIP`；会议邀请用 `IM` |
| Android 电话通知渠道 | 系统允许用户设置铃声和展示行为 | 联调记录渠道和系统设置，按真机响铃及来电页验收 |
| 在线与离线双通道重复 | 同一邀请弹两次 | 按 `msgId`/`callId` 去重 |
| 音频会话冲突 | 会议中接通话/语音消息抢占麦克风 | 统一音频占用协调层，入会前释放 |
| 端上时钟偏差 | 60s 判断提前/延后 | 以服务端 `sendTime` 与本地单调时钟结合，留 5s 兜底 |
| 推送 payload 超 800 | 关键字段被裁 | 服务端 white-list 保留通话字段；客户端容忍缺字段并回落拉消息 |
| 取消/超时不撤回已送达的通知 | 离线被叫的通知栏仍显示来电，点开才发现已过期 | 端上按 `sendTime` 判过期并展示「未接来电」；真正撤回需直调华为 revoke，本期不做 |

---

## 9. 分期计划

| 阶段 | 内容 | 验收 |
|---|---|---|
| P0 | 单聊 voip：消息发送/解析、来电页、接听/拒绝/挂断、3007、LiveKit 入房 | 双端在线互通，语音/视频可通话 |
| P1 | 单聊语音原生来电字段与云函数选路，普通通知点击恢复 | 原生来电从真实拨号验到系统来电页；普通通知点开后按平台处理 |
| P2 | 会议邀请：创建/会中加人、邀请浮层、卡片、handled 同步 | 收到邀请可加入会议，多端同步停铃 |
| P3 | 群通话：群卡片 + 单聊邀请、选人弹窗 | 群内只叫勾选的人，其余人可点卡片加入 |
| P4 | 体验完善：铃声/震动、音频路由、弱网重连、多设备兜底 | 待定 |

---

## 10. 验收用例

1. A 打给 B（均前台）→ B 响铃 → 接听 → 双向音视频；A 挂断 → B 立即退出。
2. A 打给 B，B 拒绝 → A 立即显示「对方已拒绝」，不等 60 秒。
3. A 打给 B，无人接 → 60 秒后 A 显示「未接听」，B 停止响铃。
4. A 打给 B，A 在第 5 秒取消 → B 立即停铃（不残留 55 秒）。
5. B 已有一通通话时 A 再打 → B 不弹窗，消息显示「忙线未接」。
6. B 无进程且设备完成原生来电登记 → A 发起单聊语音 → B 收到系统来电 → 接听后确认双向语音。普通通知的点击恢复另按实际平台验证。
7. 同账号 B 两台设备 → 一台接听，另一台立即停铃。
8. 会议创建时邀请 3 人 → 3 人各收到卡片 + 浮层；1 人加入后其另一台设备停止响铃。
9. 会中邀请新成员 → 新成员可加入同一房间。
10. 群通话选 2 人 → 群内出现卡片但不响铃；被选的 2 人响铃；未选成员点卡片可加入。
11. 会议邀请浮层放置 10 分钟 → 仍可加入（不超时）。
12. 弱网/断线重连 → 重复投递的同一邀请不重复响铃。
13. 推送延迟 3 分钟送达 → 点击后不弹来电页，显示「未接来电」。
14. 群通话卡片推送到未勾选成员 → 只出卡片，不弹邀请浮层。
15. 会议邀请携带密码 → 冷启动点通知直接入会，不出现「要密码但不知道密码」。

---

## 11. 现有实现核对（feat-zq）

| 能力 | 现状 | 位置 |
|---|---|---|
| 发送 `voip` / `meeting_invite` | ✅ 已有 | `servers/imCall.uts` |
| 接收与卡片渲染 | ✅ 已有 | `pages/message/components/chat-view.uvue`（解析 + 点击入会） |
| 实时弹窗 + 加入/忽略 | ✅ 已有（App 启动全局监听） | `utils/im/imCallSession.uts` |
| 通话页面与状态 | ✅ 已有 | `subpackages/pages/im-call/im-call*`、`utils/im/imCallSession.uts` |
| 创建会议选人 | ⚠️ 选人已实现，但发的是**纯文本** | `im-meeting-create.uvue:sendInvitesToContacts` |
| 预约会议邀请 | ⚠️ 同样发纯文本 | `im-meeting-schedule.uvue` |
| 会中「添加成员」 | ❌ 无入口 | `im-meeting-room.uvue` members 面板 |
| 邀请携带密码 | ❌ 发送接口无 `passcode` 参数 | `servers/imCall.uts` |
| 接收端弹窗文案 | ⚠️ 写死「群视频/群语音通话」，且 `silent` 按字符串判断 | `utils/im/imCallSession.uts` |
| Android 原生通话渠道 | VoIP 专项分支已有原生渠道定义 | `nuwax-voip` Android 原生插件 |
| 群通话入口 | ❌ 未见 | — |
| 离线推送 payload/category | ❌ 后端未补 | nuwax-im `UniPushChannel` |
