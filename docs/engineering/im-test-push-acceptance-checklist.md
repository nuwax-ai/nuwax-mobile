# 独立测试空间推送验收清单

测试路径为 `testagent.xspaceagi.com` → 测试 IM → `nuwax-push-test`（`env-00jy72x2l4nj`）→ `push-send-test` → UniPush → vivo。发送目标由测试 IM 从本环境的设备记录选取。首轮验普通离线通知、实际路由和目标范围。

## 可复用的历史结果

- **华为普通离线通知（10 月 30 日）。** ABR-AL80 上已对齐 IM 调用、厂商回执和通知栏。用相同的证据标准复测独立测试空间。
- **华为原生语音来电（11 月 19、20 日）。** 先用单设备 HMS 灰度验证锁屏无进程唤醒，20 日 19:42 再用测试 Web 经测试 IM 和独立测试空间实拨，确认动态路由、自动亮屏、原生接听页及主叫挂断后收尾。该次实拨的被叫接听、响铃听感和双向音频待验。[华为实拨证据](voip-acceptance.md#1942-第二轮真实链路通过无进程锁屏自动路由)
- **荣耀（11 月 17 日）。** 用户确认退桌面和锁屏可接听、挂断。锁屏铃声与确认全部进程已回收后的厂商唤醒仍需验证。
- **iOS（11 月 17 日）。** 用户确认清理后台后未收到来电。PushKit 登记、投递和无进程唤醒单列。
- **旧版动态登记。** 旧版网关的登记、撤销及未登记目标拒发曾通过。结果随旧版归档。现行流程核对测试 IM 设备记录、出站目标与空间路由。

[历史实机证据](voip-acceptance.md) · [IM 离线推送对接与华为历史证据 §6.3](im-offline-push.md)

## 准备与当前回读

- [x] vivo V2219A 已通过 USB 连接并联网。从 QA 1.3.8（138）同签名升级到 1.4.0（140），厂商注册回调为 0，UniPush 已出现厂商 Token。
- [x] vivo 已取得 CID，现有登录态能访问测试 IM。使用该设备会话验证 `POST /api/instant-message/devices`，HTTP 200、业务码 `0000`，返回现行 IM 设备回执。
- [x] 测试函数收到带测试发送签名的空请求后返回业务码 `400 push_clientid required`。该探针未发送通知。
- [x] 使用两个不同测试账号，Web 或另一端发起，vivo 接收。真实单聊的服务端回执为单 CID 离线，vivo 全部 App 进程已回收。
- [x] 锁屏实测系统通知，核对 App 推送开关的停发和恢复。最终复测前手机熄屏、推送开启、应用未强停。
- [ ] 拿到测试 IM 的部署版本和配置回读。确认测试域名的 HTTPS、WebSocket 都进测试实例，推送和补推使用测试空间 URL、测试签名和测试队列。
- [x] 从 `1d10393b3` 发布测试函数，重新下载的入口、路由模块及函数配置逐字节一致。消息 ID、测试空间调用与系统通知时间见[同版本复测](voip-acceptance.md#合入后同版本复测)。

## 开始实拨后的顺序

- [x] **单设备直发。** 从测试空间向已核对的 vivo CID 发送带唯一标记的通知；修补版本的测试回执与锁屏厂商通知均已对齐。
- [ ] **测试 IM 自测。** 用接收账号对自己的 vivo 调用 `POST /api/instant-message/devices/push-test?deviceId=<vivo 设备 ID>`。对齐 IM 出站 URL、目标 CID 指纹、测试 Space ID、函数调用和实机通知。
- [x] **真实离线单聊。** 锁屏无进程时，已对齐真实消息 ID、测试函数请求、UniPush 回执及厂商通知。18:00 的通知点击冷启动进入对应会话，18:14 在发布后的函数上复验了厂商到达。锁屏进程在线的真实单聊仍可单列复测。
- [x] **验证停发与恢复。** 关停后 IM 对本设备返回 `push_disabled`，关闭期间的真实单聊无对应通知。重新开启后，下一条真实单聊送达。
- [ ] **检查环境隔离。** 确认测试消息在测试 IM 与独立测试空间的日志中关联成功，目标仅为测试设备。由 IM 后端核对环境映射与补推队列，生产侧调用记录可用于只读对照。

首轮通过须同时满足**测试 IM 命中独立测试空间、vivo 收到真实单聊通知、关闭推送的设备不再被测试 IM 选中**。函数返回成功只记为云端受理，手机到达单独记录。

## 首轮通过后

- [ ] 回归角标、会议普通通知、补推和同账号多设备。补测设备重新登录或 CID 变化后的目标取值。
- [x] vivo 普通通知在锁屏、全部 App 进程已回收且应用未强停时送达，系统渠道为 `VPushChannel_2`。同条件一对一语音实拨也收到普通厂商通知，未出现原生接听页。
- [ ] 分设备验原生来电。先核对 IM 上送的当前 CID、单设备 `callRoute` 与测试空间的厂商能力，再走各机型实测。云函数按信封解析并校验目标。华为复验历史已通过场景，荣耀补铃声与进程状态，vivo 和 iOS 按各自原生路径验收。
- [ ] 需要复测同一安装包切换业务域名时，换用支持切域的包。当前 vivo QA 包固定使用测试域名。

## vivo 单聊来电与会议响铃验收

沿用上文的测试 IM 和独立测试空间。使用两个测试账号，从测试 Web 拨给 vivo 上的测试账号。现有 Y77（V2219A、OriginOS Ocean、Android 12）已验证熄屏锁屏、无进程时收到单聊和普通来电通知。本轮从语音通知回退继续往下验证。23:11 的部署仅支持华为 Android 和 iOS 原生发送。vivo 后续 UniPush 选路与实拨记录见下文。[vivo 真机证据](voip-acceptance.md#合入后同版本复测)

### 11 月 20 日真机和适配器复核

- Y77 当前的 1.4.0（140）测试包与受控 Client JSON 的 vivo 参数一致。21:06:32 在熄屏锁屏、主进程与推送进程均退出且应用未强停时实拨，21:06:37 收到 `VPushChannel_2` 普通语音邀请。设备无进程启动或屏幕唤醒事件。21:11:44 主进程和推送进程均存在时复拨，仍只观察到同一厂商通知渠道，屏幕未亮。该轮确认了进程状态，未确认 IM 长连接在线。两次均由 Web 主叫取消。
- 现装包的个推 vivo 辅助 SDK 为 `3.1.2`。二进制里有旧版 `onTransmissionMessage` 空实现，缺少 `onCallMessage`。个推发布的 `3.3.0` AAR 已包含两种回调和 `UnvarnishedMessage.isCallMessage()`，但个推注册的 `VivoPushMessageReceiver` 只覆写 `onReceiveRegId`，来电回调仍未转入女娲。升级依赖后还需接收器转发，并通过现有业务校验进入主进程来电逻辑。[个推厂商 SDK 记录](https://docs.getui.com/getui/mobile/vendor/record/) · [vivo 接入文档](https://dev.vivo.com.cn/documentCenter/doc/967)
- 本地 QA 可先用真实有效的测试邀请验证接收器到女娲接听页，保留同包的普通通知对照。厂商离线唤醒需另取得一条 vivo 专用消息及回调证据。当时 vivo 后台只确认普通推送权限。

### 11 月 20 日新版 vivo 接收器真机结果

- 仅在独立测试环境 QA 包中使用 `com.assist-v3:vivo:3.3.0`。沿用个推 RegId 回调。在 `:pushservice` 收到 vivo SDK 标为来电的旧系统 `onTransmissionMessage` 后，用应用内部广播交给主进程，再沿用女娲业务会话、被叫、时效和 IM 消息校验。签名 QA 1.4.0（140）已覆盖安装到 Y77。新包在熄屏锁屏、主进程和推送进程均退出且应用未强停时，仍收到来自测试 Web 的单聊普通通知，渠道为 `VPushChannel_2`。
- 用同签名的 Android instrumentation 在女娲进程内调用 SDK 回调，传入真实测试 Web 来电。22:01:01 Telecom 登记成功并建立 `9090` 来电通知，静默渠道重要度为 2，屏幕仍熄灭。按用户要求开启女娲悬浮窗权限，并将该来电渠道从「静默通知」改为「优先显示」。22:07:54 复测再次登记 Telecom，渠道重要度为 3，原生通知含「接听」和「拒接」。现有锁屏 Activity 路径要求重要度至少为 4，本次未观察到该 Activity。
- QA 包的 `VIVO_CALL_PAYLOAD` 是应用内部 Intent 参数。vivo SDK 回调先在 `:pushservice` 收到，再经应用内部显式广播交给主进程处理。正式接入应统一复用 Android 的 VoIP 分发、校验和接听流程。仅在厂商回调尚未由个推转发时保留必要的适配。

### 11 月 20 日真实拨号与 vivo 专用发送结果

- 23:11:54 在 Y77 锁屏熄屏、主进程和推送进程均退出且应用未强停时，从测试 Web 实拨。`push-send-test` 收到 `type=voip, scene=call`，识别出 `brand=vv` 和已注册厂商 token，得到 `transport=null`，走 `category.vivo=IM` 的普通通知回退。Y77 收到 `VPushChannel_2` 通知。进程未启动，屏幕未亮，原生接听页未出现。
- 23:32 使用当前应用的凭据通过 vivo OAuth 认证，随后按官方 `message-type=3` 和 `testMessage=true` 向 Y77 的单个 token 发送测试探针。接口返回 HTTP 400，详情为 `message-type : set value is not authorized to use`。当前 AppID 未获准通过该接口发送 VoIP，锁屏冷启动验收未通过。[vivo 鉴权](https://dev.vivo.com.cn/documentCenter/doc/975) · [vivo 专用发送接口](https://dev.vivo.com.cn/documentCenter/doc/979#s-4j9cl213) · [vivo 能力申请指南](https://dev.vivo.com.cn/documentCenter/doc/983)
- 23:51 测试 Web 实拨 `call-mwp5pqsa-bvpmkq`。独立测试函数查到 `brand=vv` 和厂商 token，命中 `android-vivo`，仅按 CID 调用 UniPush。实验使用 `settings.strategy.vv=2` 与 `options.android.VV`。个推返回 `successed_offline`，任务号 `RASS_1120_f7c2fc10b2fbadd837916e9187aa0c48`。Y77 全程锁屏熄屏且应用未被强停，观察期内无女娲进程、来电界面或新增来电通知。UniPush 单推实时报表返回 `30017`（无查询权限），专用来电到达尚未得到验证。
- 23:58 测试 Web 再拨 `call-mwp5yvqq-uncczg`。仅为 Y77 的 CID 开启 UniPush `must_report`，任务号 `RASL_1120_f7d890fd1d57448499dd2ac0cb7ec346`。两次查普通报表都显示可下发 1、实际下发 0、接收 0。实时明细受限（`30017`）。手机持续熄屏且女娲进程未启动。实验只证明统一接口受理该参数组合，仍缺个推到 vivo 专用消息的投递证据。
- 11 月 21 日 00:01，独立测试函数撤下实验字段，保留 `vv → android-vivo` 识别。实拨 `call-mwp628i8-oxtvcl` 仍收到 `type=voip, scene=call`，按 `category.vivo=IM` 调用 UniPush，00:01:26 Y77 在 `VPushChannel_2` 展示普通通知。三轮实拨始终使用同一台 Y77、同一测试包和相同锁屏、无进程、未强停条件。
- 按当前测试 IM 分支的请求形状回放。单聊和实时会议均进入 `type=voip` 业务入口。会议缺少逐被叫的 `calleeId` 与响铃时限 `sendTime` 或 `expiresAt` 时，云函数回退为普通会议卡片。补齐后可走已支持的华为原生路线。vivo 的 UniPush 线下实拨结果见下文。静默会议邀请继续使用普通通知。

### 11 月 21 日数据核对与实拨记录

两次实拨均由测试 Web 经测试 IM 进入 `nuwax-push-test`，运行函数版本为 `aa9bc0f0`。云函数按目标 CID 和个推厂商档案自动选中 `android-vivo`，两次均只发给 Y77。以下时间为北京时间。

| 场景 | 云函数收到请求 | `callId` | 个推任务号 |
|---|---|---|---|
| 单聊语音 | 10:13:17 | `call-mwprx3bg-lu62n5` | `RASS_1121_973138c76e4806ffdff7d54e17554435` |
| 会议响铃 | 10:07:17 | `mi-mwprpebm-215078-0` | `RASS_1121_cf3c927da4d33ff4248642769ca8ae27` |

- **业务数据已核对。** 云端日志确认 `callId`、被叫、会话和消息 ID、媒体类型及有效期齐全，会议响铃校验通过。用回下载的云函数和本机 UniPush 扩展库 `1.2.0` 离线回放，三端的业务邀请关键字段一致。vivo 生成了 `settings.strategy.vv=2`、`message-type=3`、与业务邀请一致的 `extraData` 和 5 秒 TTL。回放验证到 UniPush 请求生成，个推发给 vivo 的报文和实际下发结果待核对。
- **锁屏唤醒未通过。** 两次拨号前 Y77 均熄屏锁屏、主进程和推送进程已退出、应用未被强停。个推均返回 `successed_offline`，Y77 未亮屏、未启动女娲进程，也未出现接听页。两个任务的单推实时统计均返回 `30017`，逐设备消息轨迹均返回 `10004`，当前账号缺少查询权限。[UniPush 返回码说明](https://doc.dcloud.net.cn/uniCloud/uni-cloud-push/api.html)
- **设备展示条件。** Y77 的悬浮窗已允许、勿扰已关闭，来电通知渠道重要度为 3。单聊主动打开锁屏接听页要求重要度至少为 4。恢复验收时，在确认厂商回调到达后单独核对全屏展示。[Android 开页条件](../../uni_modules/nuwax-voip/utssdk/app-android/src/com/nuwax/voip/VoipBridge.kt#L657)

本机证据目录为 `out/voip-android-qa-20261121/vivo-standard-redial.I6EPoI4Z`，内有云端字段回读、离线回放和两个任务的查询回执。

### vivo 暂停与恢复条件

暂停 Y77 的锁屏唤醒实拨，以下两项确认后恢复。来电投递继续统一走 UniPush，华为 Android 与 iOS 沿用各自已通过的链路。

- [ ] **确认 vivo VoIP 发送权益。** 在 vivo 开放平台核对 AppID `106129284`、包名 `com.nuwax.app` 对应的 `message-type=3` 权益。11 月 21 日 10:28 后台显示普通推送为「正式／已通过」，当前账号历史工单无 VoIP 审批记录。11 月 20 日的厂商探针返回未授权。[vivo 申请指南](https://dev.vivo.com.cn/documentCenter/doc/983)
- [ ] **确认个推实际下发。** 请个推按上表两个任务号回查 `VV` 通道的 VoIP 下发结果，记录 vivo 消息 ID、厂商回执或拒因。权益或通道配置确认后，按需要用新任务核对实际下发，再恢复 Y77 锁屏唤醒验收。

### 恢复验收步骤

- [ ] **确认设备与测试包。** 回读机型、OriginOS/Android 版本、APK 版本和签名、测试域名、包内 vivo 推送 SDK 版本。登录测试账号后核对厂商注册、CID 和测试 IM 设备回执。登记来电和通知开关、锁屏通知、铃声／勿扰、麦克风及系统允许的后台与全屏来电设置。Y77 用于旧系统兼容；新机如为 OriginOS 6+，另确认 VoIP Service Kit 在本机可用。官方接入要求 vivo 推送 SDK 至少为 4.1.3.0。[vivo 接入文档](https://dev.vivo.com.cn/documentCenter/doc/967)
- [ ] **跑业务与推送对照。** 前台、退桌面及锁屏进程存活时各实拨一通，确认接听、双向音频和挂断。再让主进程及推送进程均退出，确认应用未被强行停止，熄屏锁屏后分别发起单聊语音和响铃会议。记录通知是否到达、点击定位，以及是否走普通通知回退。一条真实消息对齐测试 IM 出站目标、测试空间请求和手机通知，顺手复验消息通知关闭和恢复。

1. **先验 UniPush 单设备投递。** 通过测试云函数向当前登记的 QA 设备 CID 投递一通有效的一对一语音邀请。对齐厂商回执、vpush 消息 ID、客户端回调和业务 `callId`。Y77 等旧系统按 `onTransmissionMessage` 验收，业务校验后复用女娲 Android 接听页和通话能力。支持 Kit 的 OriginOS 6+ 设备按 `onCallMessage` 验收，校验邀请后携带 vpush 消息 ID 调用 `reportIncomingCall`，验证系统来电界面。[vivo 接入文档](https://dev.vivo.com.cn/documentCenter/doc/967)
2. **再验完整业务链路。** 从测试 Web 实拨，测试 IM 从设备登记选目标，`push-send-test` 按当前设备能力动态选 vivo 专用通道，厂商回调进入现有来电业务。用换设备或重新登记后的目标复测选路。验收请求覆盖正常 IM 入口，云函数和云数据库无需预填测试账号、CID 或机型。能力不可用的设备继续走普通通知回退。
3. **最后验锁屏冷启动和通话收尾。** 分别跑前台、退桌面、锁屏且进程存活、熄屏锁屏且主进程和推送进程均退出且应用未被强停。冷启动一轮先保持无人触屏，确认来电自动展示、亮屏、实际听到铃声，再从锁屏接听并核对双向音频及挂断。另验拒接、超时、主叫取消和重复邀请。通话结束后停止响铃并清理来电页、通知和通话服务。

逐通记录北京时间、机型与 APK、拨入前的锁屏和进程状态、`callId`、测试空间调用 ID、目标 CID 指纹、厂商消息 ID、回调及手机表现。云端受理、厂商回调、原生界面、双向媒体各有通过证据。若只收到普通通知，登记为回退成功，继续检查厂商权益、发送方式和原生接收器。

## 失败时定位

- `401` 时核对测试函数和 IM 的密钥来源。
- 云函数未见对应调用时核对 IM 在线判定、设备选择、推送 URL、队列和补推状态。
- 云函数受理但手机未到时，沿同一请求查 UniPush／厂商回执、系统通知及进程状态。
- 如果目标或 Space ID 对不上，暂停发送和关联补推，由测试 IM 侧核对路由后再恢复。

每条证据记录北京时间、场景、IM 部署版本、请求号或消息 ID、Space ID、函数调用 ID、CID 指纹、UniPush 任务或结果、手机到达时间和结论。

[发给 IM 后端的现行配置](im-test-push-handoff.md)
