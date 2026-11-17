# VoIP 正式后端待配合清单

日期：2026-11-17。客户端分支 `feat/nuwa-basic-2026.11-voip-calls`。本文只列后端责任及联调判据，不表示接口已经部署。生产配置、APNs 证书及部署本轮均不变更。

普通消息继续 UniPush；iOS 来电使用原生 PushKit + APNs VoIP + LiveCommunicationKit，媒体使用 LiveKit。Android 沿用 UniPush 的厂商通道适配与原生来电展示；厂商普通通知送达不能直接等同于后台进程唤起。鸿蒙另有原生 Push/Call Service 接入和待验收项，见[国内通道申请](voip-cn-provider-onboarding.md)。本项目只做一对一电话。

## 1. 当前协议与目标协议分开

当前客户端真实业务适配 `im-voip-v1`：主叫申请 RTC 房间、取得 token、入房后发送 `msgType=voip` 的 IM 邀请；被叫验证消息和参与方，再入房并回报 `/calls/answered`。当前适配不能提供完整的权威电话状态。

只读检查 `nuwax-im/feat-video-meeting` 的结果记录于[后端审查](voip-im-backend-review.md)。以下“目标接口”是待后端确认的契约，客户端不会在正式业务中假定它们已存在，也不会用开发模拟服务代替正式后端。接口就绪后在 `servers/voip*.uts` 与原生控制适配层切换，不改聊天页和通话界面的规则。

| 优先级 | 目标接口 / 逻辑 | 后端必须保证 | 联调判据 |
| --- | --- | --- | --- |
| P0 | `GET /calls/capabilities?convId=…` | 实际功能开关、双方身份/媒体能力、设备可达性、系统版本降级、电话接收偏好 | 未注册电话设备、未登录、旧 iOS、对方禁用电话时不返回“可系统来电” |
| P0 | `POST /calls` | `clientRequestId` 幂等；生成业务 callId；绑定 convId、主被叫、发起设备和截止时间；原子忙线裁决 | 双向同时拨号只产生确定结果，重试不建第二个房间或重复响铃 |
| P0 | `GET /calls/{callId}` | 权威快照含递增 version、参与方、接听设备、媒体、响铃/连接截止时间、终态原因；查询需鉴权 | 取消先到、迟到邀请、旧推送、多设备接听均查询到同一个最终结果 |
| P0 | `POST /calls/{callId}/actions` | actionId 幂等；accept/reject/cancel/end 原子裁决；仅第一台合法设备接听；终态不可逆 | 其他设备立即停铃，accept 与 cancel 并发不会留下有效采集或孤立 RTC 房间 |
| P0 | `POST /calls/{callId}/credentials` | 短期 RTC 授权限定本次房间、预期参与方、获胜设备和媒体/数据能力 | 无关租户成员不能加入；失去接听权的设备不能取得有效 token；结束后清理房间与授权 |
| P0 | `GET /calls/{callId}/events` 或等价原生 WS | 鉴权、版本/游标、断线续接、终态补偿；控制不依赖 `App.onHide` 会断开的聊天 WS | 挂起恢复、短暂断网后不漏 cancel/end；重复事件不改变终态 |
| P0 | `GET/POST /calls/devices` | 独立电话设备命名空间及条件登记/撤销，详见下节 | 账号切换、token 刷新、旧撤销迟到均不能串号或删新路由 |
| P0 | APNs VoIP sender | 对有效来电直接投递专用电话 token；不以 IM 在线或普通 CID 存在为发送条件 | 拨号前被叫无进程时仍有 APNs 请求、PushKit 回调、系统来电和接听媒体的同次关联证据 |
| P0 | 原生冷启动凭据交换/续期 | 与登录团队确认可用协议；撤销、过期及设备归属由服务端校验，提供短期通话权限 | accessToken 过期时不要求先手动打开页面才能接电话；账号退出/撤销后绝不接通旧来电 |
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

先提供测试环境部署版本、接口 OpenAPI/示例、系统推送开关和错误码；确认当前协议适配如何迁移。APNs 配置或服务部署涉及生产时另行取得用户确认，本轮不执行。

每次联调按 callId 关联：创建/忙线裁决 → 电话设备路由 → APNs 请求 → PushKit 接收 → LCK 系统报告结果 → 用户动作/获胜设备 → RTC 鉴权/双方就绪 → 挂断终态 → 房间、采集与系统通话释放。不得记录登录 token、RTC JWT、APNs token 或私钥。

验收至少包括前台、桌面、锁屏、挂起、系统回收无进程、用户强退、重启首次解锁前后；再覆盖拒接、超时、取消抢先、重复/迟到推送、并发抢接、账号切换、权限拒绝、专注过滤、断网恢复。系统回收与“强行停止/强退”分开留证；先两台 iPhone 完成，再补 Android、鸿蒙跨端矩阵。具体见 [iOS 产品流程检查](voip-ios-product-readiness.md) 与[验收记录](voip-acceptance.md)。
