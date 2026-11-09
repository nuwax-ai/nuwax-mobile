# nuwax-im VoIP 实际接口核对

核对日期为 2026-11-09。后端来源为 `nuwax-im` 的 `feat-video-meeting`，fetch 后提交为 `fb880f21b02714d46d8d28591296878b98f09611`。本次依据控制器、DTO、应用服务、推送实现及 Web 端调用流程核对，部署环境的接口与真实推送仍需联调。

移动端继续使用 `feat/nuwa-basic-2026.11-voip-calls`，先通过 `d68143d9a` 合入 `feat-2026.11@caf93effb`，随后同步两端一致的最新基线 `a8d6cc7db`，增量为 H5 构建产物。VoIP 按下一版本在独立分支推进。

## 已实现的调用链

一对一电话已具备邀请、接听后停铃、主叫取消/超时、被叫拒接及 LiveKit 入房接口。电话入口复用 RTC 房间服务，移动端界面继续采用一对一电话式交互。

| 步骤 | 实际接口或事件 | 关键字段与时机 |
| --- | --- | --- |
| 主叫建房 | `POST /api/instant-message/meetings/rtc/rooms` | `name/platform/deviceId/maxParticipants/emptyTimeoutSeconds`。Web 电话设置人数上限 2 |
| 获取媒体凭据 | `POST /api/instant-message/meetings/rtc/rooms/{room}/tokens` | 双方分别请求自己的 `platform/deviceId/displayName`，可传 `ttlSeconds` |
| 发起邀请 | `POST /api/instant-message/messages` | `msgType="voip"`，body 含 `callId/mediaType/roomName`，另含 `convId/clientMsgId/deviceId`。现有 Web 流程为主叫建房、入房后再发邀请 |
| 接听上报 | `POST /api/instant-message/calls/answered` | `convId/msgId` 必填，`callId/roomName` 可选。成功入房后上报，向接听账号的在线设备发送 `voip:answered` |
| 主叫取消/超时 | `POST /api/instant-message/calls/ended` | `convId/msgId/reason`，reason 为 `cancel` 或 `timeout`，校验消息发送者身份 |
| 被叫拒接 | `POST /api/instant-message/calls/declined` | `convId/msgId`，`callId/roomName` 可选，向会话广播 `voip:decline` |
| 在线控制事件 | IM opcode `3007` | `eventType` 为 `voip:answered/voip:cancel/voip:timeout/voip:decline`，payload 以 `callId` 关联通话 |
| 设备注册 | `POST /api/instant-message/devices` | 复用 IM 设备注册，包含 `deviceId/platform/pushToken/voipToken`。移动端 pushToken 当前用于 uni-push CID |
| 离线邀请 | uni-push payload | `{type:"voip",convId,msgId}`，收到后需查询消息正文取得 callId 和 roomName |

RTC token 响应字段为 `wsUrl/token/expiresAt/identity/room`，其中 expiresAt 为时间字符串。响应信封仍使用 `code="0000"`。后端响铃常量为 60 秒，Web 被叫另有 65 秒本地兜底。通话中的挂断由离开 LiveKit 及对端离房事件处理。

调用链依据 [Web 通话管理器](https://git.yichamao.com/agent-platform/nuwax-im/-/blob/fb880f21b02714d46d8d28591296878b98f09611/nuwax-im-web/src/store/call.ts)、[调用封装](https://git.yichamao.com/agent-platform/nuwax-im/-/blob/fb880f21b02714d46d8d28591296878b98f09611/nuwax-im-web/src/api/index.ts)和[电话控制器](https://git.yichamao.com/agent-platform/nuwax-im/-/blob/fb880f21b02714d46d8d28591296878b98f09611/nuwax-im-modules/nuwax-im-core/nuwax-im-core-web/src/main/java/com/nuwax/im/core/web/controller/ImCallController.java)。

## 与移动端目标协议的差异

| 事项 | 当前移动端开发链路 | 后端当前实现与接入工作 |
| --- | --- | --- |
| 发起与标识 | 服务端创建 callId，返回权威快照 | 客户端生成 callId/roomName，消息发送后得到 msgId。适配层需保存三者及 convId |
| 状态与动作 | ringing/connecting/active/ended，递增 version，统一 actions | 三个上报接口及 IM 事件。权威状态、busy、抢接与终态裁决需后端补齐或确认新的约定 |
| 查询与补偿 | 按 callId 查询快照，SSE 游标续接 | 消息详情可查询邀请正文；3007 为在线尽力广播，持久化通话状态与断线补偿需补齐 |
| 媒体凭据 | `serverUrl/participantToken`，接听裁决后取得 | 复用 RTC tokens，字段需映射。需收紧到本次电话的参与账号、获胜设备和媒体权限 |
| 来电控制 | 三端原生独立 SSE，覆盖 UTS 后台挂起 | 后端使用 IM WS。原生后台控制需按实际 WS 协议接入，或由后端提供独立可恢复事件流 |
| 来电推送 | `kind="voip.invite"` 加 callId/version/expiresAt | 当前 `type="voip"` 加 convId/msgId，需先查询消息并校验邀请时效 |
| 设备凭据 | `/calls/devices` 按通道/环境/包名保存 | 当前 `/devices` 统一注册，需明确多通道保存、刷新与撤销语义 |
| 响铃超时 | 45 秒 | 当前后端和 Web 为 60 秒，正式适配需统一并验证迟到邀请 |

截至核对提交，`/calls` 控制器提供 answered、ended、declined，以及会议邀请处理端点。原[客户端目标契约](voip-client-contract.md)中的 capabilities、创建/查询快照、统一 actions、credentials、SSE 和 calls/devices 均需继续对齐。移动端生产开关仍按验收条件管理。

## 正式接入前需要确认的后端行为

1. **接听归属与终态。** `reportAnswered` 校验消息与成员后广播，返回发送统计，当前调用链在入房后上报。原子占用、获胜 deviceId、忙线、取消与接听并发、过期裁决需有服务端协议。`maxParticipants=2` 与按平台席位互踢需要和电话抢接规则分别验证。[接听服务](https://git.yichamao.com/agent-platform/nuwax-im/-/blob/fb880f21b02714d46d8d28591296878b98f09611/nuwax-im-modules/nuwax-im-core/nuwax-im-core-application/src/main/java/com/nuwax/im/core/application/service/ImCallApplicationServiceImpl.java)
2. **控制恢复。** `CustomEventBroadcaster` 明确使用在线尽力广播，事件无落库和补发。后台、锁屏、重连后需要能查询到已取消、已拒绝、已接听和已结束的结果。移动端现有 IM WS 会在 onHide 关闭，原生控制必须独立维护。[事件广播实现](https://git.yichamao.com/agent-platform/nuwax-im/-/blob/fb880f21b02714d46d8d28591296878b98f09611/nuwax-im-modules/nuwax-im-core/nuwax-im-core-application/src/main/java/com/nuwax/im/core/application/fanout/CustomEventBroadcaster.java)
3. **电话房间授权。** RTC 服务按租户列房，同租户用户取得房间名后可给自己签 token，identity 为 tenantId:userId:platform，deviceId 放属性中。电话房间需要绑定具体主被叫及获胜设备，限制允许发布的音视频源、数据权限，并规定挂断后的房间回收及旧凭据处理。[RTC 应用服务](https://git.yichamao.com/agent-platform/nuwax-im/-/blob/fb880f21b02714d46d8d28591296878b98f09611/nuwax-im-modules/nuwax-im-meeting/nuwax-im-meeting-application/src/main/java/com/nuwax/im/meeting/application/MeetingRtcApplicationService.java)
4. **系统电话推送。** 当前 UniPushChannel 发送 type/convId/msgId，类别为 IM 通知。voipToken 已可写入设备表，当前推送发送代码使用 uni-push CID。iOS PushKit、鸿蒙 VoIP 专用发送、厂商权益和原生接收器仍需实际接通，分别验证后台和系统回收后的来电。[uni-push 发送实现](https://git.yichamao.com/agent-platform/nuwax-im/-/blob/fb880f21b02714d46d8d28591296878b98f09611/nuwax-im-modules/nuwax-im-core/nuwax-im-core-application/src/main/java/com/nuwax/im/core/application/push/UniPushChannel.java)
5. **设备刷新保留通话 token。** `refreshOnConnect` 对普通 push_token 使用空值保留，对 voip_token 则直接赋本次参数。现有移动端普通设备注册省略 voipToken，后端需明确保留旧值及单独撤销语义，再接原生通话 token 注册。[设备更新 SQL](https://git.yichamao.com/agent-platform/nuwax-im/-/blob/fb880f21b02714d46d8d28591296878b98f09611/nuwax-im-modules/nuwax-im-core/nuwax-im-core-infra/src/main/java/com/nuwax/im/core/infra/dao/mapper/ImUserDeviceMapper.java)

## 移动端接入归属与联调顺序

- 在 `features/voip` 内实现后端协议适配，映射邀请、msgId、动作和媒体凭据，页面继续调用应用级通话管理器。
- HTTP 封装归 `servers/voip.uts`。现有 `servers/im.uts` 的登录、设备 ID 和消息能力可复用，3007 分发使用已有 ImCustomEvent 接点。
- 三端后台控制、系统来电与媒体继续由 `uni_modules/nuwax-voip` 持有。接入前确定 WS 与可恢复状态方案，再修改原生控制层。
- 先联调两个真实账号的一对一建房、邀请、接听、拒接、主叫取消、媒体及挂断，再接后台推送、多设备抢接、冷启动和三端交叉矩阵。
- 智能体通话需另行提供媒体参与者、上下文与主动呼叫授权。当前源码核对覆盖人与人电话链路。

正式环境联调还需要该分支的部署地址、RTC 功能开关状态、两个受控测试账号及推送环境。此次记录为源码对照，真实接口可达性与系统来电验收继续按[验收记录](voip-acceptance.md)逐项留证。
