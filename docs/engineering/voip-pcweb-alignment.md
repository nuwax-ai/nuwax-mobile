# PC Web 与移动端 VoIP 对齐核查

核查日期：2026-11-17。移动端基线 `ce67237dc08dc42a6553cd9514265236a956143e`，分支 `feat/nuwa-basic-2026.11-voip-calls`。本轮检查真实 PC Web 源码及其锁定的微应用，不重新设计接口，也不修改 PC Web、后端或生产配置。

## PC Web 基线确认

PC Web 主仓库为 `/Users/apple/workspace/nuwax`。本轮只读 fetch 后 GitHub `feat-2026.11` 为 `f5e8b20583106b01d6d9a7b4acf668f7cd7edd67`，GitLab 同分支为 `70873c49ccc71d47cc8293f1bef4c4c988570135`，两端主仓 HEAD 尚不一致；**两端锁定的 `submodules/nuwax-im` 都是 `0fa014fc86712a09bb9e321e24b5aa2dc4fc2ea0`**，与本机独立 IM 仓及后端核查基线相同，因此本轮通话实现的比较基线一致。未替用户同步或切换 PC 工作区。

主仓 `src/utils/microAppRoutes.ts` 将 `/instant-message` 映射至 `nuwax-im-web`，入口为 `/micro-apps/message/index.html`；`src/layouts/MicroAppHost/index.tsx` 通过微应用宿主加载。实际会议和电话逻辑位于锁定子模块的：

- `nuwax-im-web/src/store/call.ts`：同一 store 管理 `mode=call/room`，一对一入口 `startCall/accept/decline/hangup`，会议入口 `enterRoom` 等。
- `nuwax-im-web/src/api/index.ts`：`callApi`、`meetingApi`、`meetingRecordApi`。
- `nuwax-im-web/src/lib/livekitRoom.ts`、`callGuards.ts`：SDK 事件、重连与离房宽限。
- `nuwax-im-web/src/store/chat.ts`：`sendVoipInvite` 沿用消息发送流水线。
- `nuwax-im-web/src/components/VoipCallCard.tsx`：聊天通话卡片及本次浏览器会话中的结果。

以下结论是**当前锁定源码的对照**，不是生产网页资源版本、PC 实际通话或移动端新包的端到端验收。本轮未创建房间、签发 token、发消息、拨号或启动平台编译。

## 主调用链已经对齐

API 均使用 `/api/instant-message` 前缀。平台字段按设备分别为 web／ios／android／harmonyos，不能照抄成 web。

| 环节 | PC Web | 移动端现状 | 判断 |
| --- | --- | --- | --- |
| 主叫建房 | `POST /meetings/rtc/rooms`，maxParticipants=2、emptyTimeoutSeconds=120 | `servers/voipIm.uts:createImVoipCall` 同一路径和参数 | 已对齐；房间名格式不同但都符合服务端约束，不要求字符串前缀相同 |
| 自己签票 | `POST /meetings/rtc/rooms/{room}/tokens`，platform/deviceId/displayName | Android、iOS、鸿蒙各自原生请求同一路径；wsUrl/token 映射到媒体桥 | 路径、时机对齐；displayName 尚有差异，见 D5 |
| 先入房再邀请 | `createRoom → issueToken → joinLiveKit → sendVoipInvite` | UTS 建房，原生 connectMedia，媒体加入后 `mediaJoined` 发邀请 | 已对齐，不是点击按钮立即先向对端发消息 |
| 邀请 | `POST /messages`，msgType=voip，body 含 callId/mediaType/roomName | 同一消息格式，保留 convId、msgId、callId、roomName | 已对齐；clientMsgId 的生成格式不同但各自满足消息幂等用途 |
| 邀请发送期间挂断 | 邀请成功返回后发现旧 callId 已结束，则补 `/calls/ended` cancel | 原生使用捕获的会话及 msgId 做同样补偿 | 已对齐，不能删除这条迟到补偿 |
| 被叫接听 | 签票并加入 LiveKit，之后 `POST /calls/answered` | 三端在媒体加入后调用同一路径，字段同为 convId/msgId/callId/roomName | 路径和顺序对齐；失败处理未对齐，见 D1 |
| 拒接 | `POST /calls/declined` 后本机立即收尾 | 原生明确 rejected 才上报 declined，本地先收尾 | 已对齐；权限失败／忙线不伪装成明确拒接 |
| 主叫响铃期取消／超时 | `POST /calls/ended`，reason=cancel/timeout | 同一端点与字段 | 已对齐；active 挂断的调用范围有差异，见 D4 |
| 在线状态通知 | IM 3007：voip:answered/cancel/timeout/decline | 原生独立 IM WS 消费同样事件 | 协议已对齐，移动后台连接由原生持有 |
| 通话收尾 | 一对一离开 RTC，由对端 SDK 事件感知 | 同样释放媒体、系统通话及通知 | 主线一致，离房判据的健壮性未对齐，见 D2 |

所以当前真实 App 的在线一对一不需要等待规划中的另一套 `/calls` 创建／credentials／SSE API。`calls-v1` 是开发工具／目标契约，真实业务选择 `im-voip-v1`；现有会议 API 继续作为首选。

## 需要优先对齐的行为

### D1：接听上报失败会错误回滚媒体（高优先）

PC `store/call.ts:accept` 在成功入房后，对 `/calls/answered` 使用独立异步上报，失败不回滚已加入的通话；`api/index.ts:callApi.answered` 也明确这个约定。

移动端 Android 的 `mediaJoined()` 将被叫 answered 的异常抛回 `connectMedia()`，外层会 `finish("mediaFailed")`。iOS 的 `mediaJoined()` 也会抛出，调用任务捕获后结束媒体；鸿蒙接收到首次 connected 后对同一异常执行 finish。因而一次上报超时／临时 5xx，可能表现为“已经接通又立即结束”。

建议按当前 `im-voip-v1` 把两种失败分开：主叫发邀请失败仍结束本次呼叫；被叫已入房后的可重试通知失败只记录／有限补报，不拆掉已工作的媒体。认证失效仍执行会话失效清理。不能把该容错照搬到将来需要原子授权裁决的接听接口。

源码定位：Android `VoipBridge.kt:mediaJoined/connectMedia`；iOS `NuwaxVoipBridge.swift:mediaJoined/connectMedia`；鸿蒙 `VoipBridge.ets:mediaJoined/mediaEvent`。

### D2：移动端缺 PC 已有的重连离房保护（高优先）

PC `callGuards.ts` 将远端离开条件收敛为：曾经有过远端、当前人数归零、当前未重连；状态机再等待 3000ms 宽限，复核仍无人且未重连才结束。远端恢复时撤销计时器，SDK 最终 disconnected 另行收尾。

当前 Android 在 `RoomEvent.ParticipantDisconnected` 直接结束业务通话；iOS 的 `participantDidDisconnect` 同样直接 finish。鸿蒙使用的 JS 媒体页也将 ParticipantDisconnected 直接通知为 disconnected。它们没有 PC 这一层保护，存在网络切换／重连时提前结束的风险；本轮没有制造网络故障验证触发率。

建议复用 PC 的判据和宽限语义，并用各端当前 SDK 状态与真实远端集合实现；保留移动端已有重连上限和终态隔离，不把页面延时当作媒体重连保护。

### D3：主叫响铃倒计时起点更早（中高优先）

PC 在邀请发送成功且拿到 msgId 后调用 `scheduleOutgoingTimeout()`。移动端在 `createImVoipCall()` 建房返回时就设置 expiresAt=now+60000，原生 adopt 后开始计时；`mediaJoined()` 发邀请成功后只更新 msgId，不刷新这个截止时间。建房之后签票、连媒体、音频准备及发消息所花时间都会消耗主叫的响铃窗口。

建议分开“媒体准备／邀请发送超时”和“邀请已发出的响铃超时”；邀请成功后根据服务端 sendTime 确定 60 秒有效期，避免主叫较早取消而被叫仍在有效窗口。被叫保持按消息 sendTime 校验，不能因为 PC 有额外本地兜底就延长过期邀请的可接听范围。

### D4：已接通的挂断仍额外上报 cancel（中优先）

PC `hangup()` 只有主叫且仍在 outgoing/connecting/incoming 阶段才向 `/calls/ended` 上报；active 时主要通过离房结束对端。当前移动端三端 `notifyBusinessEnd()` 对主叫未限制为接通前，通常把非 timeout 原因转换成 cancel，因此正常已接通的挂断也可能额外发出 cancel。

当前后端事件不持久化，但后续统一记录时不能把正常完成写成取消。建议按现有 PC 协议限制这个旧端点的用途；将来后端新增权威终态时再统一完整挂断动作，而不是沿用 cancel 代表所有结束。

### D5：RTC 成员显示名使用 userId（中优先）

PC 签票传 `myDisplayName()`。移动端三端原生 `businessCredentials` 当前传配置中的 userId。接口能够工作，但会议成员／后续共用记录的名字可能成为 ID。应在原生会话配置中保存当前账号的真实展示名并随登录刷新；不要额外发明客户端名称接口，也不要使用对端的姓名冒充本机成员名。

## 记录、会议功能和刻意保留的移动差异

| 项目 | PC Web 实际情况 | 移动端判断 |
| --- | --- | --- |
| 一对一聊天卡片 | `VoipCallCard` 从 `useCallStore.records[msgId]` 读取本次浏览器内存结果；刷新后未知结果只显示回拨，不编造未接 | 移动端当前主要有本机历史页，尚未对齐完整聊天卡片；不能误认为 PC 已有全部服务端通话历史 |
| 会议列表／详情 | PC 已调用 `GET /meetings`、`GET /meetings/{meetingId}` 等现有服务 | 这些不是缺后端接口。移动端若扩展会议记录入口应直接接现有服务，而非另造列表 API |
| 未录制的一对一记录 | 当前后端 `origin=2` 仍只在录制路径落会议记录 | 属两端共同的业务增强，按 [会议复用关系](voip-meeting-relationship.md)交接，不应算成 PC 已完整实现、移动端只差调用 |
| 群通话／普通会议 | PC `mode=room` 已处理建房 origin=1、加入会议、邀请处理、主持人／参与者、等待态等；群邀请走 meeting_invite | 当前移动端 feature 仅开放真人单聊；这是范围差异，不是把 maxParticipants 改大即可完成 |
| RTC 票据续签 | 后端已有 `/rooms/{room}/tokens/refresh`；所查 PC 电话调用链中未发现实际自动续签调用 | 不把“服务端有端点”误报成“PC 已实现自动续签”；与平台登录凭据续期分别处理 |
| 同账号自呼 | PC 有同账号多端自测处理 | 移动端按此前约定使用不同测试账号，并禁止自呼；保留产品决定，不直接照搬 |
| 通话中／计时 | PC 某些路径入房即 active，暂无远端时设 10 秒独处兜底 | 移动端按已定要求等待媒体连接和对端媒体就绪再开始计时；保留这项更严格的展示条件 |
| 权限与音频 | PC 使用浏览器授权、Web 音频播放恢复；媒体 store 共用会议／电话 | 移动端需要系统音频会话、Telecom／LCK、锁屏权限与音频焦点，不照搬浏览器生命周期 |
| 进程不存在时来电 | PC store／WebSocket 的存在不能证明 iOS 冷唤醒能力 | iOS APNs VoIP／PushKit 由独立任务跟进；Android 继续 UniPush 原生路由 |

移动端还会重复查询会话、联系人及 whoami 来确认真人主体和禁止自呼，PC 主要从已选会话／聊天 store 取上下文。可在保留账号代次和主体校验的前提下优化重复查询；这不是后端要求新增 capabilities API 的依据。

## 后续修改边界与验收

优先级：D1 接听上报容错、D2 重连离房保护、D3 响铃起点，其次 D4 挂断语义和 D5 显示名；再对齐聊天卡片与服务端记录。原生跨端策略保持一致，新增规则集中在 feature／插件策略中，不扩大聊天页渲染参数。

本轮仅完成核查，未把上述差异描述为已修复。后续代码补齐至少验证：

- answered 超时／5xx 时媒体继续，401/403 按会话失效处理，邀请发送失败仍收尾。
- 重连过程中远端归零后恢复不挂断；真正离开在宽限后结束，旧呼叫回调不影响新呼叫。
- 慢速媒体准备不缩短被叫正常响铃窗口；过期邀请和发送途中取消均仍被正确处理。
- 主叫 active 挂断不再被记为接通前 cancel；拒接、取消、超时仍及时停铃。
- 显示名及账号切换正确；PC↔iOS、PC↔Android 的拨号、接听、拒接、挂断与重连实际互通。

前台／后台／锁屏／无进程及系统通知的验收仍分别记录。这里的代码对照不能替代任何一项真机送达或媒体听感验收。
