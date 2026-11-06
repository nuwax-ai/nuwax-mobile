# 移动端一对一通话契约（待正式后端实现）

本分支实现电话式单呼。会议、屏幕共享、录制、SIM、SIP/PSTN 不在范围内。LiveKit 只负责媒体；它的 room 不能代替业务呼叫、忙线、抢接和权限裁决。本文接口是**拟新增契约**，不是现网接口清单。没有修改 `agent-platform` 或独立 IM 服务。

正式对接顺序、客户端修改入口与待确认项见 [交接说明](voip-backend-integration.md)。开发专属 `/dev/login`、`/health`、`/diagnostics` 和 `/dev/inject` 仅供测试工具使用。

## 传输与身份

正式环境 HTTPS/WSS。REST 与 SSE 使用 `Authorization: Bearer <平台登录凭据>` 和 `X-Call-Device-Id: <设备标识>`；凭据不进入推送、页面 URL、日志。所有 ID（用户、会话、设备、呼叫）按字符串处理。REST 业务成功和业务错误均以 HTTP 200 返回信封，鉴权失效使用 HTTP 401/403。响应沿用 `{code:"0000",data:{...},message:""}`；失败 `data:null`，`code` 是稳定错误码。客户端展示 i18n 文案，不直接展示后端错误正文。

客户端只能基于有权限的单聊会话创建呼叫。服务端从会话成员计算对端，不能相信客户端指定的 callee、房间名或 LiveKit identity。智能体也作为明确的会话参与方，由智能体接入服务加入；视频传输能力不表示模型能理解视频。

## 权威快照

```json
{
  "callId": "6e45353c-3038-4afb-a489-d22957d51e77",
  "convId": "9007199254740993123",
  "version": 1,
  "state": "ringing",
  "callerId": "alice",
  "calleeId": "bob",
  "callerDeviceId": "device-a",
  "acceptedDeviceId": "",
  "callerDisplayName": "Alice",
  "calleeDisplayName": "Bob",
  "displayName": "Alice",
  "peerKind": "user",
  "mediaType": "video",
  "createdAt": 1793930000000,
  "expiresAt": 1793930045000,
  "connectExpiresAt": 0,
  "connectedAt": 0,
  "endedAt": 0,
  "reason": ""
}
```

时间均为 UTC 毫秒。`displayName` 供来电系统界面使用（被叫看到主叫名称）；页面按 caller/callee 的显示名选对端。不能让陌生客户端通过 callId 探查别人的呼叫。

状态单向 `ringing → connecting → active → ended`。`version` 为服务端单呼叫递增正整数。任何状态可结束；终态永不回退。响铃默认 45 秒，接听后媒体连接窗口默认 30 秒。终态原因至少支持 `rejected/cancelled/timeout/busy/hangup/connectionTimeout/failed`。客户端的 `answeredElsewhere/sessionChanged/mediaFailed/disconnected` 是本机结束原因，不替代后端审计记录。

`accept` 必须在持久化事务/原子脚本里裁决，同时占用主被叫账号的通话槽。只有发起设备与抢接成功设备能拿到凭据；同账号其他设备收到获胜设备 ID 后结束本机响铃，不能把整个业务呼叫挂掉。

## REST

公共前缀 `/api/instant-message/calls`。

| 方法 / 路径 | 请求 | 返回 data / 服务端要求 |
| --- | --- | --- |
| GET `/capabilities?convId=…` | 已登录设备 | `{enabled,audio,video,nativePush,incomingEvents}`；结合租户开关、会话成员、智能体媒体能力、平台与推送就绪状态 |
| POST 空路径 | `{convId,mediaType:"audio"或"video",requestId}` | 快照；`userId+deviceId+requestId` 幂等，相同键不同参数报冲突；自己或对端已有占用则 `CALL_BUSY` |
| GET `/{callId}` | 无 | 最新权威快照；同时处理服务端超时 |
| POST `/{callId}/actions` | `{action,actionId,answerMediaType?}` | 最新快照；动作幂等、原子裁决，见下表 |
| POST `/{callId}/credentials` | `{}` | `{serverUrl,participantToken,expiresAt}`；接受后签发，服务端异步操作结束时再次检查状态和设备所有权 |
| POST `/devices` | 见下文 | `{registered,nativePush}`；通话设备凭据独立于 IM 设备注册 |

| action | 发起方 / 条件 |
| --- | --- |
| `accept` | 被叫设备；状态必须 ringing；`answerMediaType` 可将 video 降为 audio，不能将 audio 升为 video |
| `reject` | 任一被叫设备，且仍 ringing |
| `cancel` | 原始主叫设备，且仍 ringing |
| `end` | 原始主叫设备或被叫获胜设备；结束幂等 |
| `ready` | 上述两个媒体拥有设备各自上报；本机媒体连接和对端音轨已订阅后发送 |

`ready` 是本次客户端联调增加的确认动作。正式后端还须用 LiveKit 参与者/轨道事件核验入房与发布情况，不能因收到一个客户端 ready 就进入 active。两端 ready 且服务端媒体检查通过才设置 `connectedAt`。界面还会检查本机连接与对端媒体就绪，再展示通话中并计时。重连是附加媒体状态，不回退业务版本；超时或最终断开后关闭采集。

短期 RTC JWT 默认 60 秒，仅能加入本次 `voip-{callId}`、指定设备 identity，最多两个参与者；只授予 microphone/camera（语音呼叫只 microphone），禁用 data、屏幕共享、管理及录制权限。正式服务保存 SDK 密钥，客户端永远不保存密钥。结束时删除房间/移除参与者，使仍未过期的旧 JWT 不能继续使用；后端需为 room 关闭设置额外的拒绝重入策略，不能仅依赖 JWT TTL。

## 原生控制流与续接

`GET /{callId}/events` 返回本次通话的 SSE。客户端同时使用 **GET `/events`** 作为账号级来电/状态入口，避免前台来电依赖推送；这是在原计划单呼叫 SSE 上增加的订阅入口，正式后端需一并支持。两者都校验登录用户、设备和账号边界。

```text
id: opaque-account-cursor-42
event: call
data: {"callId":"…","version":3,"state":"active",…完整快照…}

: heartbeat

```

SSE 鉴权失败返回 HTTP 401/403，原生层立即释放通话及旧会话。游标是账号/设备范围的 opaque 字符串，不等于单呼叫 version。`Last-Event-ID` 续接；保留窗口过期、游标无效时重新发送当前账号的有效呼叫与近期终态快照，再接实时流。帧顺序与重发可能不可靠，客户端仍按业务 callId/version/终态去重。建议心跳 10 秒；连接断开须重试和补拉，不把重连当成新的来电。

UTS 页面的 onHide 可以断开现有 IM WebSocket；**通话控制流由原生层持有，不能跟着断开**。正式后端要有媒体失联、控制失联和账号注销的服务端兜底回收，避免只有一端挂断时永久忙线。

## 设备、推送与系统映射

```json
{
  "channel": "pushKit",
  "token": "<native token>",
  "environment": "development",
  "bundleId": "com.example.debug"
}
```

通道枚举 `uniPush/pushKit/harmonyPush/fcm/vendor`，vendor 需额外注明厂商。存储主键至少含 `userId+deviceId+channel+environment+bundleId`；每次只更新对应通道，空 token 表示撤销该通道。登录刷新与切账号分别处理，禁止用 uni-push cid 覆盖 PushKit/鸿蒙 token。登出后立即撤销通话路由和设备授权。

uni-push/普通通知用 `kind:"voip.invite"` 标明邀请；原生 PushKit/鸿蒙 VoIP 通道由系统识别。邀请推送只含 `callId/version/expiresAt/callerId/calleeId/displayName/mediaType` 等最小显示信息；不含平台 token、RTC JWT 或可执行 URL。收到推送后启动/恢复控制连接并核对权威状态。取消、拒接、挂断、抢接结果都从已建立的原生控制连接送达，不能再用 VoIP 推送承载取消。

- Android：厂商和 FCM 的接收回调通过 `VoipBridge.incoming(context,payload)` 接入；高优先级消息使用各平台允许的系统来电路径。CallStyle 通知、Core-Telecom 和 foreground service 持有通话。需要由实际分发基座的推送接收器调用此 hook；仅有 UTS `onPushMessage` 不能证明进程被回收后可来电。
- iOS 17.4+：PushKit 委托中先 await LCK 来电上报，再做网络校验；系统 UUID 与业务 ID 独立映射。启动 hook 只恢复已同意隐私、已初始化过的加密会话；重装后的 Keychain 残留不能自动恢复。iOS 15–17.3 不注册 PushKit VoIP，前台呼叫加普通来电通知，不承诺相同的锁屏接听能力。
- Harmony：EntryAbility.onCreate 同步注册 `receiveMessage('VoIP',…)`，且只有这个 Ability 拥有 `action.ohos.push.listener`。用原生推送回调的 `VoIPInfo.callId` 上报 Call Service，业务 callId 另存；禁止用业务 ID 冒充。原生系统应答先报 ANSWERED，媒体就绪后报 ACTIVE。锁屏语音接听，视频进入应用；VoIP 持续任务在媒体 Ability 上申请和释放。

厂商权益、PushKit/APNs 环境、鸿蒙 push-type 10 权益与签名须由正式环境提供。开发服务返回 `nativePush:false`，不模拟供应商送达成功。

## 错误码

至少支持 `CALL_UNAUTHENTICATED/CALL_FORBIDDEN/CALL_NOT_FOUND/CALL_INVALID_DEVICE/CALL_INVALID_ARGUMENT/CALL_BUSY/CALL_IDEMPOTENCY_CONFLICT/CALL_MEDIA_UNSUPPORTED/CALL_NOT_ACCEPTED/CALL_ANSWERED_ELSEWHERE/CALL_ENDED/CALL_CONFLICT/CALL_SERVICE_UNAVAILABLE`。状态冲突后查询权威快照；不能用迟到响应恢复已结束的通话。

## 资料

- [LiveKit Android 2.30.0](https://github.com/livekit/client-sdk-android/releases/tag/v2.30.0)、[Swift 2.19.0](https://github.com/livekit/client-sdk-swift/releases/tag/2.19.0)、[JS 2.23.0](https://github.com/livekit/client-sdk-js/releases/tag/v2.23.0)
- [Android Core-Telecom VoIP](https://developer.android.com/develop/connectivity/telecom/voip-app/telecom)
- [LiveCommunicationKit](https://developer.apple.com/documentation/livecommunicationkit)、[PushKit](https://developer.apple.com/documentation/pushkit)
- [华为 VoIP 推送及锁屏规则](https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/push-voip)、[ArkWeb WebRTC](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/web/web-rtc.md)
