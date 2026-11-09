# VoIP 正式后端接入交接

2026-11-09 更新，供后端对接和正式体测使用。客户端按独立功能集成。已核对 `nuwax-im/feat-video-meeting@fb880f2` 的实际接口、IM 事件及 RTC 流程，接入前先阅读[实际接口核对](voip-im-backend-review.md)。下文保留原目标协议的交接项，按实际实现逐项确认和适配。

## 当前基线

- Android、iOS 使用专用 Debug 测试包和本地呼叫服务，媒体连接真实 LiveKit。2026-11-06 18:31 的 iPhone Bob → Redmi Alice 已出现系统接听、拒接通知，随后完成接听、active 和挂断，用户确认已通。
- 该次安卓开启了用户可停止的开发监听前台服务。uni-push CID 已注册到开发服务，开发服务返回 `nativePush=false`。厂商通道审核和正式邀请发送仍待接入。
- 鸿蒙已有 ArkWeb 媒体页、原生控制与系统通话适配及可重复生成的构建模板，编译记录见验收文档，真机覆盖待补齐。
- 正式智能体呼叫、上下文、真实语音能力随后端另行验收。

每次构建和真机结果统一登记到 [验收记录](voip-acceptance.md)，测试包重建步骤见 [真机测试说明](voip-device-testing.md)。

## 客户端结构与修改入口

| 事项 | 归属 | 宿主接点 |
| --- | --- | --- |
| 呼叫状态、权限、账号隔离 | `features/voip/callManager.uts`、`callState.uts` | `App.uvue` 调用 `integration.uts` |
| 单聊呼叫入口 | `features/voip/components/chat-actions.uvue` | 聊天页传入 `convId` |
| 通话和测试界面 | `features/voip/screens` | 两个分包路由页只挂载组件 |
| REST、身份与基地址 | `servers/voip.uts` | 使用已有平台地址、登录凭据、设备 ID |
| 音频占用 | `features/voip/audioFocus.uts` | 录音、TTS、消息音视频检查占用并响应中断 |
| 原生媒体、控制流、系统来电 | `uni_modules/nuwax-voip/utssdk/app-*` | 推送原生回调和应用生命周期 |
| 构建、测试宿主 | `scripts/voip-native` | Android 公共构建脚本调用一次功能配置入口 |
| 开发服务及事件注入 | `scripts/voip-dev` | 显式执行 `pnpm voip:dev` |

`features/voip/integration.uts` 为生命周期和邀请入口，`audioFocus.uts` 为独立轻量音频入口。平台 SDK 类型和业务接口字段在功能内部处理。详细边界见 [模块说明](../../features/voip/README.md)。

## 异步调用边界

拨号在能力检查和权限申请完成后，分别重新确认账号代次与当前呼叫占用。退出、切账号或另一通来电到达后，过期拨号停止；有来电时打开已有通话页面。新建呼叫响应在账号清理后才返回时，继续使用原始请求身份尽力取消该呼叫。

推送 token 获取也绑定发起时的账号与原生会话。Android CID、iOS registry 和鸿蒙异步 getToken 回调均需通过当前会话检查。鸿蒙优先使用 initialize 传入的 pushEnvironment，早期存储记录缺失此字段时按开发身份回退，正式账号测试可显式选择与签名匹配的通道环境。

这些边界使用功能级 mock 回归，正式环境仍须验证签名、真实 token 和送达。

## 首次对接需双方确认

| 议题 | 当前客户端约定 | 交接结果需记录 |
| --- | --- | --- |
| 域名与鉴权 | `getApiBaseUrl()` 加 `/api/instant-message/calls`，Bearer 平台登录凭据，`X-Call-Device-Id` | 测试域名、网关转发、401/403、刷新和失效规则 |
| 业务身份 | 既有 `apiImWhoami()` 返回 userId，`getImDeviceId()` 提供设备 ID | userId 与单聊成员、智能体 ID 的一致性 |
| 能力 | `enabled/audio/video/nativePush/incomingEvents` | 开关维度、智能体语音能力、平台通道就绪口径 |
| SSE | 账号级 `/events` 加单呼叫 `/{callId}/events`，完整快照，Last-Event-ID | 10 秒心跳、网关缓冲/超时、续接保留窗口 |
| 媒体就绪 | 两端 `ready` 后进入 active，正式服务补 LiveKit 事件核验 | 轨道就绪判定、30 秒连接超时、重连回收策略 |
| 设备路由 | uniPush、pushKit、harmonyPush 等按通道、环境、bundleId、vendor 注册与撤销 | 正式包名校验、撤销时机和换账号隔离 |
| LiveKit | 短期本次呼叫凭据，房间最多两人 | WSS/TURN、区域、网络端口、房间销毁与拒绝旧凭据重入 |
| 智能体 | 会话成员推导被叫，能力由后端声明 | 主动来电授权、上下文来源、智能体媒体服务入口 |

契约变更先修改 [字段与状态约定](voip-client-contract.md)，随后同步开发服务、UTS 和三端原生解析。完整示例快照、错误码和动作条件均在该文档维护。

## 接口交付顺序

| 批次 | 后端提供 | 客户端联调及通过条件 |
| --- | --- | --- |
| 1 | capabilities、create、snapshot、actions | 两个真实账号在有权限的单聊创建呼叫，幂等、忙线、超时、取消和抢接结果一致 |
| 2 | 账号/单呼叫 SSE、credentials、LiveKit 事件 | 两端接听后连接媒体，双方就绪进入 active，挂断与断线后释放房间和占用 |
| 3 | devices、各平台邀请发送 | 在匹配包名、签名和环境下完成前台、后台、锁屏及回收后系统来电 |
| 4 | 正式智能体媒体与业务接入 | 用户呼叫智能体、智能体主动来电、上下文及双向语音逐项通过 |

后端基础能力先完成前两批，两端前台可尽早联调。系统来电必须结合第三批的实际通道验证。多设备抢接及账号撤销由服务端持久化原子裁决。

## 正式环境切换检查

1. 提供两个平台测试账号、同一有权限的单聊和受控测试域名，账号和密钥走团队受控配置。
2. 通过普通登录获取平台身份。清理旧开发会话，确认 native initialize 的 `development=false`，API 地址来自平台配置。Alice/Bob 开发凭据仅用于开发服务。
3. 在受控内部构建中按已验证平台放行 `isVoipPlatformAccepted()`，后端 capabilities 同时控制会话能力。当前实现固定 false，放行改动需随对接批次提交并记录覆盖平台。
4. 对照三端桥的请求前缀、headers、SSE 事件名、快照字段和错误码，特别确认账号级来电流及 `ready` 动作。
5. 校验设备注册包含通道、环境、bundleId 和对应 vendor，空 token 只撤销同一记录，登出由服务端清除对应账号路由。Android 正式基座的厂商回调需要补完并留证。鸿蒙已按系统 bundleId 和显式推送环境注册 token，并丢弃退出或切账号后的迟到结果；实际 token 轮换、撤销和送达仍需正式环境联调。iOS 已补齐注册/撤销字段与旧 registry 回调隔离，仍须用真实 APNs 环境验证送达和撤销。
6. 系统来电体测使用正式通道，关闭 Android 开发监听并确认专用 `VoipDevControlService` 未进入正式 manifest。删除测试宿主的 LAN ATS 例外、开发身份和测试服务地址配置。
7. 每轮记录前后端提交、包版本、签名环境、设备和系统版本、网络、callId、权威版本及结果。证据中去除登录 token、RTC JWT、推送 token 和个人通知。

## 三端差异及待补齐项

| 平台 | 功能实现 | 对接前需要继续完成 |
| --- | --- | --- |
| Android | Kotlin LiveKit、Core-Telecom、CallStyle、原生接听页、通话 FGS | 分发基座原生厂商/FCM 接收器接 `VoipBridge.incoming`，正式 uni-push 路由及后台/冷启动送达 |
| iOS | Swift LiveKit、17.4+ PushKit/LCK，15–17.3 前台与普通通知 | 正式证书和 APNs 环境、真实 VoIP token 路由、旧系统安装与系统回收后处理 |
| Harmony | ArkWeb LiveKit、原生 SSE、Push Kit、Call Service、VoIP 持续任务，token 按包名/环境/账号代次注册 | token 轮换/撤销联调、通道权益/签名、系统接听与锁屏持续双向音频真机验证 |

## 正式体测准入与记录

前端测试通过、HBuilderX 三端编译、正式后端接口和各平台通道可用后进入完整矩阵。每个组合分别测试两个呼叫方向及语音/视频，设备包含 Android、iOS、Harmony。

- 场景覆盖前台、后台、锁屏、系统回收，主动强停单独记录系统行为。
- 异常覆盖拒接、忙线、45 秒超时、取消、抢接、重复/迟到事件、权限拒绝、蓝牙/扬声器、蜂窝电话打断、网络切换和恢复。
- 长测覆盖锁屏双向音频 30 分钟，结束后检查媒体采集、系统通知、通话前台服务和后台任务释放。
- 账号覆盖退出、切换、凭据刷新、旧请求和旧推送隔离，现有录音/TTS/消息音视频回归。

每条结果填写下表，失败条目关联日志及修复提交后复测。

| 日期与用例 | 前端/后端提交及包 | 主叫/被叫设备与环境 | callId 与版本时间线 | 展示/应答/媒体/释放 | 结果与证据 |
| --- | --- | --- | --- | --- | --- |
| 待本轮体测填写 | 待填写 | 待填写 | 待填写 | 待逐项确认 | 待填写 |

生产放行依据为完成的验收矩阵和通道条件。合并与部署继续按团队发布流程处理。
