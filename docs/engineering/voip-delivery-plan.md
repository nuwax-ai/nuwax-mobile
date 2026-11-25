# VoIP 统一实施与交付清单

日期：2026-11-17。统一工作树 `mobile-voip`，分支 `feat/nuwa-basic-2026.11-voip-calls`。用户要求 PC Web 对齐和 iOS 无进程来电两条工作线合并计划，避免重复修改。普通消息保持 UniPush，媒体复用会议 RTC；本清单不授权生产配置、厂商权益、证书或部署变更。

最新整体方案、各 Android 厂商／Apple／鸿蒙的申请流程及当前设备通过范围统一见 [总方案与申请手册](voip-cn-provider-onboarding.md)；到公司后按 [iOS 操作细则](voip-ios-cold-start-runbook.md)逐项执行。PC 对齐代码批次已作为 `ff8d49019` 同步两端；本批文档不代表后续 iOS 绑定／投递代码已完成或新包已就绪。

## 已合入的共同基线

- PC Web 对照报告为 [对齐清单](voip-pcweb-alignment.md)，实际微应用锁定 `nuwax-im@0fa014fc86712a09bb9e321e24b5aa2dc4fc2ea0`；真实业务继续用现有 rooms／tokens、IM voip 消息和 3007，不另建媒体或历史服务。
- iOS 会话提交 `0936f019a` 已在本分支：PushKit 系统报告与后续 HTTP 验证解耦、后台任务有界取消、Keychain 原位更新及启动 hook 检查。本次在其上补业务稳定性，没有替换 token 注册器、PushKit delegate、Keychain 或后台验证任务。详情见 [iOS 冷启动跟进](voip-ios-cold-start-followup.md)。
- 原生系统来电、App 内通话 UI、推送送达及进程唤起分别验收。华为既有锁屏提醒通过，不覆盖本次新代码、iOS 无进程唤醒或其他手机。

## 当前代码批次：PC 对齐四项

| 项目 | 实现与限制 | 状态 |
| --- | --- | --- |
| 接听上报容错 | 当前 im-voip-v1 入房成功后，answered 只是停铃通知；临时上报失败保留媒体。主叫邀请发送失败仍结束呼叫。401/403 仍清理匹配的 VoIP 会话，旧 token 的失败不清理刷新后的身份 | Android／iOS／鸿蒙已补源码与测试 |
| 重连保护 | 曾经有过远端、当前人数归零时等 3 秒再确认；仍在重连则继续等，远端恢复撤销计时；SDK 最终断开仍收尾。旧呼叫／旧房间的计时器不能结束新呼叫 | Android／iOS／鸿蒙 ArkWeb 已补源码与测试 |
| 响铃计时 | 准备媒体／发送邀请单独限时 30 秒；邀请成功后按响应 sendTime+60 秒确定响铃截止，缺 sendTime 时以确认时间兜底，未来时钟不能延长窗口，过期幂等回执不重新响铃 | 三端已补；取消途中迟到邀请仍补发旧 cancel |
| 挂断语义 | legacy ended 仅用于主叫接通前取消／超时；已 active 的正常挂断释放媒体，不再额外发 cancel；明确被叫拒接仍走 declined | 三端已补源码与测试 |

本批验证：Vitest 15 文件／127 项；Swift Foundation／Security 57 项；Kotlin/JVM 12 项；Swift 桥语法解析、ArkWeb 媒体资源生成及 `git diff --check` 通过。包含现有冷启动修补回归，新增传输失败、鉴权与 token 刷新、准备／响铃两个时钟、真实离房／重连恢复、旧任务隔离及挂断语义案例。

本批未运行 HBuilderX、App 原生平台类型检查／链接、打包、安装或真机通话。源码测试不替代最终安装包和交叉通话验收。RTC 成员显示名（对齐报告 D5）、聊天通话卡片与正式服务端历史仍是后续项。

## iOS 投递：优先扩展既有 UniPush

APNs VoIP 是苹果的电话投递机制，不意味着要另部署一个 APNs 或呼叫服务。发送层优先复用现有 UniPush／个推真正的 VoIP 通道；手机仍是唯一 PushKit registry → LCK 系统来电 → LiveKit。普通消息保持原路由。

该路线的 SDK／发送参数能力有资料与本机头文件依据，但当前 App 的远端绑定、VoIP topic、签名环境、厂商直投权益及真实送达**未通过**。不能把 payload 中的业务 type=voip、SDK BOOL、云函数 errCode=0、设备 registered 或 serverReady 当作 PushKit 已送达。准确 SDK 生命周期及供应商限制以 [冷启动跟进](voip-ios-cold-start-followup.md)和其链接来源为依据。

| 顺序 | 在现有体系内的最小增量 | 完成条件 |
| --- | --- | --- |
| 1 | 现有 PushKit token 回调接入已初始化的个推 SDK 绑定；处理 token／CID 轮换，保留唯一 registry 与普通消息 delegate | 版本与账号代次隔离、绑定参数接受仅作诊断；不假造远端确认，不用空 token／全局销毁代替撤销 |
| 2 | 扩展现有 IM 设备记录或等价电话登记接口，关联账号、设备、CID、bundle、签名环境、电话能力、登记版本及条件撤销 | 普通消息刷新不覆盖电话字段；退出、切账号、旧撤销和迟到请求不能复活旧路线 |
| 3 | 现有 push-send 增加经过鉴权的 iOS 电话分支：真正的 options.ios.type=voip、最小邀请载荷、短有效期与去重 | 不混发 Android／iOS CID、不无条件透传 options；按本应用实际权益确认厂商直投及 development／production 环境 |
| 4 | IM 有效单聊邀请触发电话路由；不机械跳过 WS 在线设备，不重复叠加普通电话通知 | 有测试部署版本、合法电话设备选择和同一 callId 的投递记录 |
| 5 | 统一切换注册适配器与状态，条件撤销旧路线，保留一个 voipPushRegistration 入口 | 不并行显示两套“绿色就绪”，不一边依赖缺失接口一边宣称个推已闭环 |

发送环境和 topic 不按 API 域名或 CID 猜测，不编造 SDK／云函数参数。厂商直投策略若需开通或现有生产证书配置需修改，必须先提供具体变更供用户确认；本批不执行。若现有应用无法支持这条路线，再启用已有的直连 APNs 适配器方案，按设备明确选一条，不能默认双投。

用户已反馈没有已知独立 APNs 测试部署；本计划不要求新起服务。IM 与云函数的测试部署仍需交付实际版本才能进入投递联调，生产部署不在授权范围内。

## Android 无进程来电与正式构建同列 P0

2026-11-18 用户明确要求：已走通的 Android 场景也必须补齐无进程自动唤起，不能停在测试类型、后台存活或用户点击通知。iOS 和 Android 均须完成这项交付，现有局部通过记录保留原范围。

### 当前几种 test 条件的区别

| 条件 | 源码／既有包的实际含义 | 不能替代的验收 |
| --- | --- | --- |
| 完整业务 QA 包／testagent | 真实女娲 App，使用 im-voip-v1 及现有会议 RTC；固定测试 API，qaAccepted 放行测试通话。包校验排除 HX DebugServe、deviceTest 标记和 VoipDevControlService 声明 | 不能据此宣称正式构建能力闸门已完成，也不证明无进程时厂商会回调 |
| 旧专用 deviceTest 包 | 可使用独立开发身份／服务及受保护的开发前台监听；仅供早期媒体和原生交互测试 | 不能以开发监听保活、局域网服务或 adb 定向注入代替真实业务推送唤起 |
| 厂商 test_mode／testMessage | 与业务测试 API、QA 包和原生 Debug 是不同概念；本次所查 push-send 发送源码未设置这些字段 | 实际已部署函数和厂商资格须回读；测试投递资格不能自动当作正式资格 |
| 华为／荣耀既有成功记录 | 华为最新锁屏成功轮次由在线邀请先到；荣耀有用户清理后台后来电的反馈，但未取得当时全进程快照 | 来电、响铃、亮屏、接听通过分别保留，尚不足以证明拨号前全部 App 进程不存在后的自动来电 |

### 统一实现边界

1. **正式业务入口和构建闸门**：当前 Android 原生 initialize／receiveUniPush 接受 qaAccepted，或 Debug 且 businessEnabled；当前通话放行仍受测试范围限制。后续须完成真实发行构建的能力授权和环境配置，测试与正式使用相同业务协议和推送接收实现，不依靠 QA 标志或开发监听维持功能。先完成本地实现及测试，生产开关仍在具体变更确认后开启，本次不自动放开。
2. **有效邀请的投递**：复用现有 IM 与 UniPush 电话路由，按真实账号／设备／登记版本选择目标，不机械跳过在线 WS。对已无执行进程的设备，必须证明厂商投递会使原生接收层执行；仅出现普通通知、只有点击回调或重新打开 App 后补收均不满足。
3. **原生冷启动**：沿用 NuwaxUniPushIntentService → VoipBridge.receiveUniPush／incoming → 业务校验 → Telecom／CallStyle → 用户接听后的 LiveKit。验证加密身份恢复、退出撤销、凭据失效、去重／终态、后台执行时限、铃声和系统来电展示；不能以提前存在的自身前台服务规避无进程条件。
4. **逐厂商能力**：普通厂商透传无法保证拉起被杀进程。先对已部署聚合路线实证；不能满足的厂商核对获准的通话／VoIP 能力、SDK 与对应回调，仍接入现有插件及同一后端调度。支持范围按厂商／ROM／版本记录，不因为华为或荣耀一台通过就推定所有 Android 可用。[个推官方限制](https://docs.getui.com/getui/mobile/vendor/androidstudio/)

### 必须取得的 Android 证据

- 使用包含当次代码的真实完整业务 App，先完成隐私同意、登录与有效设备登记；记录包摘要、业务 API、IM／云函数版本及厂商发送资格。正式发行前还需用发行构建复测，不能只沿用 Debug QA 结果。
- 拨号前没有进行中的通话、开发监听或调试器自动拉起；保存主进程及所有本包子进程均不存在的快照，记录当前用户 stopped 状态及锁屏状态。若推送进程仍在或自动重启，不登记为全部进程不存在。
- 从另一真实账号的单聊发起邀请，不点击被叫通知或 App 图标、不用 adb 注入邀请；按同一 callId 关联 IM 选路、供应商受理／到达、原生回调、新进程启动、系统来电、铃声／展示、接听双向媒体和挂断释放。
- 后台进程存活、受控缓存进程回收、自然系统回收、用户划掉最近任务、系统设置强行停止、重启首次解锁前后分别记录。am kill 不等于 force-stop，划掉最近任务也不能单凭操作名称认定全进程消失；强停结果不与正常回收结果混写。
- 开发监听、在线 WS、普通通知展示、供应商 HTTP／任务成功均不能单独作为本项通过。供应商／服务版本及完整包未就绪时先补前置，不让用户反复清理和拨号。

当前结论：Android 全部本 App 进程不存在后的自动来电仍待上述证据；iOS 对应项同样未通过。现有回收及快照工具见 [Android 测试包说明](voip-android-qa-package.md)。本次只更新统一计划，未编译、安装、操作设备或变更配置／部署。

## 统一文件分工与顺序

### 2026-11-18 客户端和云函数提交范围

- iOS 在签名宿主选择 `NUWAX_IOS_VOIP_PUSH_PROVIDER=unipush` 时，调用 App 已有的 `GeTuiSdk` 绑定 PushKit token。原生在 token、CID 到达和回前台时同步登记。SDK 接受参数后仍须等待 IM 确认当前版本。原始 token 只交给厂商 SDK 并保存在本机加密会话，IM 只收到 CID 与电话路由字段。当前构建默认 provider 仍为 `apns`，需要测试包显式选择 UniPush。
- Android 用既有原生接收器接收厂商回调。专用邀请在访问 IM 前校验被叫账号和截止时间，再比对鉴权接口返回的消息、会话、callId 和媒体类型。核对当前会话后才报告 Telecom，普通通知点击入口不会处理这类专用邀请。对后续发行构建提供 `NUWAX_ANDROID_VOIP_RELEASE_ORIGIN` HTTPS 精确匹配入口，缺省关闭。测试包和发行构建走同一个原生接收器。
- `push-send` 仍复用原 HTTP 鉴权。服务端通过 `callRoute` 指定一个设备，函数只构造固定字段、最长 5 秒的投递 TTL 和稳定防重请求号。iOS 使用 `options.ios.type=voip`，Android 华为、荣耀使用 UniPush 的厂商路由策略；本地测试验证请求参数与回调后的校验链路。Android 策略本身无法确认厂商会在无进程时调用原生接收器。

| 负责人 | 测试联调前要交付 |
| --- | --- |
| IM 后端 | 在现有 `POST /api/instant-message/calls/devices` 接受 `provider=unipush, channel=pushKit, platform=ios, deviceId, bundleId, environment, cid, registrationId, previousRegistrationId, action=register/revoke`。鉴权确定账号，核对设备与 CID 的归属。成功 data 回显 provider、channel、deviceId、bundleId、environment、cid、registrationId、registered，以及可选 nativePush。依登记版本比较更新与撤销，旧请求不得复活；允许以已撤销版本为条件前驱创建后继。退出或换账号须由后端撤销旧账号路由。若请求响应丢失、连续轮换与条件更新冲突，返回可识别结果，待与客户端统一安全重对账，禁止无条件覆盖。 |
| IM 业务发送 | 在有效单聊邀请落库后，按账号、设备及当前路由选择单个目标。POST 原有 `push-send` 时 `push_clientid` 为同一个 CID 字符串，`callRoute` 含 `cid, platform, transport`，iOS 还须带 `environment, registrationId`。transport 为 `ios-voip`、`android-huawei` 或 `android-honor`。`payload` 必须含 `type=voip, convType=1, convId, msgId, callId, calleeId, mediaType, expiresAt`，ID 使用字符串，截止时间为毫秒。保留现有的投递资格与可靠去重，在发送前复核路由及有效性。启用专用路由后避免普通通知叠加。取消、抢接和终态补偿通过业务信令继续补齐。 |
| UniPush／个推 | 确认本 App 的 VoIP topic `com.nuwax.app.voip`、CID → PushKit token 绑定情况、实际 sandbox／production 选择方式、`strategy.ios=2` 和短 TTL 至 APNs expiration 的映射。提供受理或失败原因、任务标识。SDK BOOL、CID 和任务受理只分别证明对应环节。 |
| Android 厂商／聚合方 | 分别确认现有华为、荣耀 SDK 及已批准权益能否让拟支持的系统版本在无进程时触发原生回调，以及 UniPush 是否支持对应电话类型。当前分支已提供 Android 专用载荷及 `hw/ho` 厂商策略，尚缺生产直投能力与实机凭证。若只能展示普通通知或要求点击，厂商方需提供获准的专用投递、回调契约及适用机型，随后按其契约补适配。 |
| 测试环境负责人 | 在隔离的现有测试部署中确认专用路由与供应商配置后，设置云函数的 `NUWAX_VOIP_IOS_APNS_ENVIRONMENT=development`（以签名包为准）和已获准的 `NUWAX_VOIP_ANDROID_TRANSPORTS`（逗号分隔）。两个开关缺省关闭，环境不匹配时发送返回 503。提供 IM 与云函数部署版本并留存同一 callId 的发送、厂商状态、原生回调、系统来电及媒体证据。 |

本轮本地通过 153 项 Vitest、60 项 Swift、20 项 Kotlin/JVM 测试，以及 Swift 语法和云函数 JS 语法检查。HBuilderX 平台编译、安装和真机无进程来电仍待执行。安卓如遇供应商仅支持普通通知的场景，暂按该机型不可验收。iOS 如遇供应商无法路由匹配签名环境的 VoIP token，先取得厂商结论，再评估现有直连 APNs 备选。详见 [DCloud 扩展参数](https://doc.dcloud.net.cn/uniCloud/uni-cloud-push/options.html)、[个推 Android 集成指引](https://docs.getui.com/getui/mobile/vendor/androidstudio/)。

当前会话负责 PC 行为对齐及公共回归；[iOS 专项会话](codex://threads/01a1e940-e635-7110-8bdd-0388dfbee39f)负责 PushKit／供应商路线核查与无进程验收。共享同一分支和已提交基线，不重复 cherry-pick 同一补丁。

`NuwaxVoipBridge.swift` 为共享文件：PC 批次修改 mediaJoined／connectMedia／adopt／挂断及 Room 事件；iOS 专项的 PushKit、后台验证及持久化区域保持已有提交。本批修改期间专项仅补只读清单；后续需要改共享区域先同步范围，顺序提交，不能两边各自重打包或覆盖真机。

交付顺序：完成本批测试并同步双远程 → 对齐供应商／设备契约 → 本地绑定及云函数代码／测试 → 用户确认涉及配置／部署的具体动作 → 取得测试服务版本 → 统一打真实 App 测试包 → 分层真机验收。沿用统一签名目录和 L4／既有证书，不重新申请，不上传基座。

## 真机验收与其余产品项

新包先验证 iPhone↔Android、PC↔iPhone／Android 的邀请、接听、拒接、取消、超时、慢媒体准备与网络恢复。再验证 iOS 后台进程存活、系统回收无进程、用户上滑退出、重启首次解锁前后，每种状态在拨号前记录进程与包版本。

无进程来电必须按同一 callId 串起：有效设备路由 → 供应商受理 → PushKit 回调 → 系统来电 → 用户接听 → 双向媒体 → 挂断和资源释放。未取得发送前置时不让用户反复拨号或改手机权限；未通过的场景继续明确列为未通过。

权限引导仍按 [通话准备方案](voip-call-readiness.md)分层实施，服务缺口不转嫁给用户设置。正式通话记录按 [会议复用关系](voip-meeting-relationship.md)扩展现有模型，保存不依赖录制；这些工作不通过本批四项修补自动完成，也不扩大会议、群通话、录制等当前交付范围。
