# VoIP 正式后端待配合清单

日期：2026-11-17。客户端分支 `feat/nuwa-basic-2026.11-voip-calls`。已按用户指出的 PC Web 会议链路重新核对：**会议 RTC 和在线一对一呼叫已有可复用接口，当前 IPA 已按这套接口接入，可以先做两台手机在线互拨。** 下文另外列手机冷唤醒及完整产品的增强项，不再把新接口名称作为开始联调的前置。生产配置、APNs 证书及部署本轮均不变更。

普通消息继续 UniPush；iOS 来电使用原生 PushKit + APNs VoIP + LiveCommunicationKit，媒体使用 LiveKit。Android 沿用 UniPush 的厂商通道适配与原生来电展示；厂商普通通知送达不能直接等同于后台进程唤起。鸿蒙另有原生 Push/Call Service 接入和待验收项，见[国内通道申请](voip-cn-provider-onboarding.md)。本项目只做一对一电话。

## 1. 当前协议与目标协议分开

当前客户端真实业务适配 `im-voip-v1`：主叫申请 RTC 房间、取得 token、入房后发送 `msgType=voip` 的 IM 邀请；被叫验证消息和参与方，再入房并回报 `/calls/answered`。当前适配不能提供完整的权威电话状态。

### 已就绪、直接复用的能力

2026-11-17 fetch 后 `nuwax-im/feat-video-meeting` 为 `26dd3491826ddbbfdc9cedfe169fa93ba9144c1f`，已重新核对 PC `store/call.ts`、API 封装和服务实现；通过 ego-browser 的现有测试登录态做只读查询：

| 能力 | 现有接口 / 依据 | 结论 |
| --- | --- | --- |
| RTC 建房和签发入房 token | `POST /meetings/rtc/rooms`、`POST /meetings/rtc/rooms/{room}/tokens`；PC 私聊明确 `maxParticipants=2` | 与会议共用底层服务，移动端已经复用，不需要另建媒体服务 |
| 房间服务运行状态 | 测试环境 `GET /meetings/rtc/rooms` → HTTP 200、`code=0000`；实现实际调用 RTC provider 的 listRooms | 会议功能已开启，房间查询链路可用；本次未另建房间或采集媒体 |
| 会议列表 | 测试环境 `GET /meetings` → HTTP 200、`code=0000` | 已可用；会议记录不等同于所有一对一未接记录 |
| RTC token 续签 | 已有 `POST /meetings/rtc/rooms/{room}/tokens/refresh` 和服务实现；本次未执行签发/续签 | 已有实现可对接；下文待确认的是平台登录凭据的原生续期，二者分开 |
| 音视频及 data 授权 | 角色默认权限已包含音视频发布/订阅及 `canPublishData=true`，LiveKit provider 写入授权 | 不将媒体就绪 data 能力列为“后端尚未实现” |
| 在线一对一邀请、接听、拒接及取消 | `/messages` 的 `msgType=voip`、`/calls/answered`、`/calls/declined`、`/calls/ended`、IM 3007；PC 通话管理器已使用 | 已有源码与现有接入，可以按该协议联调，不要求先实现另一套 `/calls` CRUD |

上述 API 完整前缀均为 `/api/instant-message`，实际探测域名为 `https://testagent.xspaceagi.com`。本次没有发消息、建房、接听或挂断他人的通话，未重新执行真实 PC/手机媒体通话。

### 手机未运行时的来电与后续增强

还需核对并接通的是 **APNs VoIP 专用投递及可靠设备路由**：本次测试环境 `GET /calls/devices` 为 404，本轮未提交注册请求；所核对分支未发现同路径注册实现。现有 `/devices` 已有 `voipToken` 写入字段，但所核对发送实现仍通过 UniPush CID 发普通邀请，尚未发现消费 PushKit token 的 APNs sender。若独立服务已经提供这些能力，以实际部署契约接入；可扩展现有设备接口实现相同隔离/撤销语义，不强制新增指定路径，不能无条件回退写入会被普通刷新清空的字段。

权威终态/断线补偿、多设备原子抢接、按电话参与方收紧授权等仍是完整产品的增强与生产验收要求，**不阻挡当前两台 iPhone 先按现有协议做在线接打测试**。

只读检查和当前证据见[后端审查](voip-im-backend-review.md)。以下“目标接口”只是待后端确认的协议表达；可由现有接口扩展或提供等价能力，不要求因为路径不同重做会议链路。当前 IPA 不依赖这些新路径实现在线通话。

| 优先级 | 目标接口 / 逻辑 | 后端必须保证 | 联调判据 |
| --- | --- | --- | --- |
| 产品增强 | 能力声明（可扩展现有查询） | 实际功能开关、双方身份/媒体能力、设备可达性、系统版本降级、电话接收偏好 | 未注册电话设备、未登录、旧 iOS、对方禁用电话时不返回“可系统来电” |
| 产品增强 | 创建与忙线（当前已用 RTC 建房 + IM 邀请） | 保留当前幂等链路，补账号忙线和并发裁决；不要求单独 `POST /calls` | 双向同时拨号产生确定结果，重试不重复邀请 |
| 生产验收增强 | 权威状态查询（目标 `GET /calls/{callId}` 或等价接口） | 递增 version、参与方、接听设备、截止时间和不可逆终态 | 取消先到、迟到邀请、断线后查询到同一个最终结果 |
| 生产验收增强 | 动作裁决（可扩展现有 answered/ended/declined） | actionId 幂等、原子接听、统一主被叫结束；不强制新 actions 路径 | 只有一个设备获胜，其他设备停铃；并发动作安全 |
| 生产验收增强 | 媒体授权收紧（已有 RTC tokens 接口） | 限定本次电话的预期参与方、获胜设备及媒体权限 | 无关成员或失去接听权的设备不能取得有效 token |
| 生产验收增强 | 原生控制恢复（已有 IM WS/3007） | 断线续接、终态补偿；不强制另起 SSE 服务 | 恢复后不漏 cancel/end，重复事件不改变终态 |
| 冷唤醒前置 | PushKit 登记路由（扩展现有 `/devices` 或新增 `/calls/devices`） | 分通道/环境/账号保存及条件登记/撤销，详见下节 | 账号切换、普通刷新、旧撤销均不串号或删新路由 |
| 冷唤醒前置 | APNs VoIP sender | 对有效来电投递专用电话 token；不以 IM 在线为不投递依据 | 无进程时有 APNs → PushKit → 系统来电 → 接听媒体证据 |
| 登录过期场景前置 | 平台登录凭据的原生交换/续期（不等于 RTC token refresh） | 与登录团队确认协议；撤销、过期及设备归属由服务端校验 | accessToken 过期时不要求先打开页面才能接听；账号撤销后不接旧来电 |
| P1 | 权威通话记录、未接补偿与消息卡片 | 可提议 `GET /calls/history`（待确认）；按 callId 幂等保存结果和时长，多端同步 | 无进程时未接、系统过滤、另一设备接听有正确最终记录；同一呼叫只有一条未接提醒 |
| P1 | 全局电话偏好、联系人限制、拉黑、频控 | 创建呼叫和推送前统一执行；不依靠前端隐藏入口 | 关闭来电后不再被电话推送唤起；拉黑/滥拨不能绕过服务端 |

接口路径完整前缀为 `/api/instant-message`；详细字段见[客户端契约](voip-client-contract.md)。原生登录续期和 history 尚未有确认接口，客户端没有凭空请求这些路径。

## 2. iOS 专用推送设备与发送

登记身份至少包含 `provider=apns`、`channel=pushKit`、deviceId、bundleId、environment、token、registrationId、previousRegistrationId。环境由签名宿主的 `aps-environment` 决定，不根据 API 域名或 JS 的开发/发行模式猜测。本地测试 IPA 使用统一签名目录已更新的 development 描述文件，覆盖 LLD16 与 zhengqiang，对应 APNs sandbox；生产环境仍需单独确认和批准。

- 按已鉴权账号、bundle、环境、设备及 channel 保存；uni-push CID 的刷新不能清空电话 token。
- 旧登记撤销需匹配 registrationId，token 更换需原子替换并阻止已撤销登记重放。账号退出、服务端踢出、失效 token 都须移除对应电话路由。
- 私钥 `.p8`、Team ID、Key ID 由服务端受控配置；不放 App、推送载荷或页面 URL。topic 使用实际 `com.nuwax.app.voip`，`apns-push-type=voip`；短有效期，只用于仍有效的来电。
- 载荷只包含不敏感的业务定位和时效信息；不携带平台登录 token、RTC JWT。客户端先及时尝试系统来电报告，再鉴权核对业务消息/状态，未确认前不采集。
- cancel、end、状态变化走已建立的原生控制连接；不能用 VoIP 推送发送取消、静默刷新或普通通知。
- 记录 APNs 请求 ID、状态码、拒绝原因与 callId；处理 `BadDeviceToken`、`Unregistered`、topic/environment 不匹配等失败，不用“HTTP 已受理”代替送达/展示证明。

RTC 参与方授权应允许本次呼叫的可靠 data 消息（当前就绪 topic 为 `nuwax.voip.media-ready.v1`），用于静音对端的媒体就绪握手；这不能放宽房间参与方鉴权。完整实际接口前缀为 `/api/instant-message`。截至 2026-11-16 的只读核对中 `/calls/devices` 仍未部署，后端交付时须重新确认当前测试环境版本。

客户端完整登记协议和载荷示例见 [APNs 后端交接](voip-ios-push-handoff.md)。后端普通 UniPush APNs token 不能直接当作 PushKit token。

## 3. 当前协议仍需后端修正的风险

1. `/calls/answered` 通知若没有获胜 deviceId，客户端只能避免本机重复操作，无法实现服务端多设备原子抢接。
2. 现有 `/calls/ended` 仅主叫 cancel/timeout，`/calls/declined` 只代表被叫明确拒接；被叫超时、权限拒绝、系统过滤、媒体失败不能被伪造成用户拒接。应统一权威终态，并允许任一合法参与方结束。
3. 当前 RTC 参与者标识与租户级建房授权不足以限定本次一对一电话；必须由后端约束预期参与方，不能只靠客户端接受第一个远端媒体来完成鉴权。
4. 客户端本机终态缓存、30 秒连接/重连截止和 Keychain 记录只用于安全收尾，不能修复服务端丢失的终态、跨端未接补偿或后端孤立房间。
5. 原生收到 401 会失败并释放当前呼叫；客户端尚无正式原生登录续期协议。已有页面登录刷新不能覆盖进程不存在时的接听。
6. 本机通话记录只包含已经验证/观察到的呼叫，不能声称覆盖未送达推送或所有其他设备结果。持久化电话消息及跨设备记录属于后端交付。

## 4. 后端联调交付要求

在线通话直接沿用现有 `nuwax-im` 的 docs/14、docs/15 及当前接口，不要求重写整套协议文档。移动端专用推送和状态增强部分补充差异契约、错误码及测试部署版本；若独立服务已提供，按其实际契约适配。APNs 配置或服务部署涉及生产时另行取得用户确认，本轮不执行。

每次联调按 callId 关联：创建/忙线裁决 → 电话设备路由 → APNs 请求 → PushKit 接收 → LCK 系统报告结果 → 用户动作/获胜设备 → RTC 鉴权/双方就绪 → 挂断终态 → 房间、采集与系统通话释放。不得记录登录 token、RTC JWT、APNs token 或私钥。

验收至少包括前台、桌面、锁屏、挂起、系统回收无进程、用户强退、重启首次解锁前后；再覆盖拒接、超时、取消抢先、重复/迟到推送、并发抢接、账号切换、权限拒绝、专注过滤、断网恢复。系统回收与“强行停止/强退”分开留证；先两台 iPhone 完成，再补 Android、鸿蒙跨端矩阵。具体见 [iOS 产品流程检查](voip-ios-product-readiness.md) 与[验收记录](voip-acceptance.md)。
