# VoIP 系统来电与推送分工

2026-11-10 用户确认：普通消息继续 UniPush，iOS 电话使用 APNs VoIP；本批仅本地移动端代码、测试和后端交接，生产配置与部署不动。Android 纳入同一方案。交互保持一对一电话，媒体继续 LiveKit。

2026-11-16 起分两条交付线：现有技术方案继续真实 App 调试；厂商申请、苹果及国内完整流程见[国内通道申请手册](voip-cn-provider-onboarding.md)。研究线的新 Kit 不自动变更本页实施方案。最新构建/安装结果以[验收记录](voip-acceptance.md)为准，下文“本批未安装”指 11 月 10 日的本地 APNs 实现批次。

## 通道与边界

| 功能 | iOS | Android | 鸿蒙 |
| --- | --- | --- | --- |
| 普通消息 | 现有 UniPush / 普通 APNs | 现有 UniPush / 厂商推送 | 现有 UniPush / 厂商推送 |
| 在线邀请与控制 | 原生独立 IM WS，业务 REST | 原生独立 IM WS，业务 REST | 现有原生控制适配 |
| 电话后台唤起 | APNs VoIP → PushKit | UniPush 原生接收器 + 厂商允许的电话唤起能力，逐厂商验证 | 原生 VoIP Push 权益及系统接口，待真机 |
| 电话接听与音频管理 | iOS 17.4+ LCK；15–17.3 前台/普通通知 | Core-Telecom、CallStyle、原生接听页与通话 FGS | Call Service、VoIP 后台任务及 ArkWeb 媒体 |
| 接通后的音视频 | LiveKit Swift | LiveKit Kotlin | LiveKit JS / ArkWeb |

UniPush 的普通通知、个推 SDK 的原生能力和电话专用推送分别核对。参数可透传、SDK 受理、通知出现、原生回调、系统来电和双向媒体是不同证据，不能互相替代。本方案没有新建推送服务或重启第二套普通推送 SDK。

## iOS 实施

详见 [APNs VoIP 对接契约](voip-ios-push-handoff.md)。原生插件直接向 `/api/instant-message/calls/devices` 登记独立 APNs 设备命名空间；正式后端需新增此接口。普通 `/devices` 注册与 CID 不参与 APNs token 更新。

后台专用发送由后端同事在现有服务内实现，客户端不保存 APNs 私钥。签名环境由本地 profile 生成并校验。PushKit 收到邀请后先报 LCK，再核对消息、账号和单聊成员；接听前不采集。本批未向 APNs 发送，也未安装新版。

## Android 实施与厂商前置

保留现有功能代码：`uni_modules/nuwax-voip/native/android-unipush` 在普通 SDK 处理前识别邀请，交给 `VoipBridge.receiveUniPush()`；普通消息继续父类处理。Kotlin 通话层查询消息/单聊，启动 Core-Telecom、CallStyle、原生接听页；接听后持有通话服务并进入 LiveKit。源码与接收器生成仍随完整 App 基座重复构建，不依赖测试监听服务。

必须分别验证三层：

1. **厂商收到通知。** UniPush CID 与包名、签名和厂商配置匹配；服务端发出未过期邀请。普通厂商通知可能只在系统通知栏展示，等用户点击才启动应用。
2. **原生执行机会。** 主/推送进程不存在时，实际厂商通道是否能按其权限允许的方式触发本 App 原生回调。需要电话专用权益时按厂商申请；不能把普通 IM 分类、通知送达、自启动或省电无限制当成电话唤起能力。
3. **系统来电展示。** 得到执行机会后验证 Telecom、CallStyle 接听/拒接、锁屏原生页及挂断回收。检查通知渠道/锁屏显示、全屏来电权限和厂商后台界面限制；Android 14+ 的全屏 intent 受系统权限与分发政策限制。不能只凭 manifest 声明报告弹层成功。

`Core-Telecom` 和 `CallStyle` 负责通话与通知接入，不提供厂商推送送达或进程冷唤醒。普通 UniPush 不能自动等同于厂商专用 VoIP。若所选厂商无法自动唤起，只能将其记录为“普通通知可达/点击进入”，不能验收为“锁屏、进程回收后自动系统来电”。生产能力须保持对应平台/厂商关闭或降级声明。

### Android 后端发送契约

- 单聊业务邀请仍通过正式接口创建，UniPush payload 至少为 `{type:"voip",convId:"…",msgId:"…"}`，ID 保持字符串。原生拉取消息获得 callId/roomName，推送不传登录 token、RTC JWT 或任意 URL。
- 电话邀请短 TTL，最长不超过 60 秒及业务剩余时效；已取消/过期不发。当前仓库云函数已有本地 VoIP 通知白名单和 TTL 修补，未部署。它是普通 UniPush 邀请通知分支，不是 iOS APNs 发送器。
- 后端增加**电话专用调度/平台路由**，与普通消息的批量聚合、角标和离线判定区分。当前 OfflinePushConsumer 会跳过在线设备；不能以 IM WS 在线代替 App 原生层能够响应。电话唤起策略需单独明确，避免后台冻结时漏发邀请。
- 不向所有厂商强行下发未经授权的策略或分类。只有取得通道权限后，才按测试环境和特定厂商验证；不修改普通消息全局策略。
- 多设备接听、拒接、取消和终态走业务裁决/控制连接，在线与推送按 callId 去重。推送任务成功不是用户已响铃，不作为原子接听依据。

### 已有证据与复测顺序

Redmi 在用户批准“无限制＋自启动”后，主进程存活的后台/锁屏真实来电、接听、计时和挂断释放已有记录；在线信令先到，不能证明独立推送唤起。受控回收进程后未唤起仍是未通过项，详见 [验收记录](voip-acceptance.md)。不把该结果扩大为所有 Android 厂商均通过或均不支持。

用户后续提供已配置通道的非小米真机，先核对签名/CID/厂商及允许能力，再由 iPhone 呼入：前台 → 后台 → 锁屏 → 系统回收。每轮分别关联服务端任务、厂商结果、原生到达日志、系统界面、接听媒体及挂断释放。主动强行停止单列系统限制。当前 Xiaomi AppID/AppKey 未配置，不能据此推断其他厂商配置缺失。

## 两端联调与验收

先完成后端测试环境的 APNs 注册和发送，再安装真实 App（另行确认）。Android 作为前台主叫可以先验证 iPhone 被叫，不要求其厂商离线通道就绪；随后 iPhone → 已配置厂商通道的非小米 Android 验后台被叫。两方向均需要两个不同账号。

除前后台/锁屏/系统回收，还需覆盖：立即接听/拒接、重复/迟到邀请、主叫取消、多设备抢接、账号切换、权限拒绝、蓝牙与蜂窝电话打断、网络切换、锁屏双向音频 30 分钟及完整资源释放。无厂商执行机会、无正式 APNs 凭据或无权威终态时如实留待验，不用常驻开发服务替代。

## 本批交付与待办

本地实现 iOS APNs 注册、条件撤销、签名元数据及可测试 mock；普通 UniPush 消息与 Android 原生接收逻辑保持既有分工。Android 本批补齐实施/后端/验收方案，不宣称新增厂商通道已开通。鸿蒙原生 VoIP 权益与真机矩阵继续单独补齐。不修改 agent-platform 或 nuwax-im，不提交、部署或上传基座。

官方依据：[Apple APNs VoIP](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns)、[Android Core-Telecom](https://developer.android.com/develop/connectivity/telecom/voip-app/telecom)、[CallStyle](https://developer.android.com/develop/ui/views/notifications/call-style)、[Android 14 全屏通知限制](https://developer.android.com/about/versions/14/behavior-changes-14#secure-fsi)、[UniPush 推送介绍](https://doc.dcloud.net.cn/uni-app-x/uni-push/intro.html)。
