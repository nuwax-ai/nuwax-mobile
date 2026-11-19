# 国内一对一 VoIP：最新总方案与厂商申请手册

核对日期：2026-11-17。源码基线 `ff8d49019`，工作树 `mobile-voip`，分支 `feat/nuwa-basic-2026.11-voip-calls`。范围：真实女娲 App 的人与人、用户与智能体一对一网络电话；不新增会议、SIM 拨号、SIP/PSTN 外呼功能。

本文将现有调试、iOS 无进程来电和厂商申请合成同一方案，不再另起一条架构。普通消息继续 UniPush；电话发送优先复用 UniPush／个推的实际平台能力；iOS 最后一段仍是 APNs VoIP → PushKit → LCK，Android 保留原生接收器与 Telecom，媒体统一 LiveKit。厂商专用 Kit 按应用权益和聚合适配情况逐家接入，不表示已经开通。

执行清单见 [统一交付计划](voip-delivery-plan.md)；明天到公司的具体操作见 [iOS 无进程来电操作细则](voip-ios-cold-start-runbook.md)。**当前安卓只有指定机型／场景通过；iOS 无进程来电未通过；不是整套方案已完成生产验收。** 本轮只整理代码对应的方案，没有提交申请、变更控制台、上传基座或部署服务。生产配置及部署必须先提供具体变更供用户确认。

## 1. 一次电话经过哪些系统

```mermaid
sequenceDiagram
    participant A as 主叫 App
    participant B as 呼叫业务后端
    participant P as 系统推送通道
    participant N as 被叫原生通话层
    participant R as LiveKit 媒体
    A->>B: 会议 RTC 建房与签票
    A->>R: 主叫先连接本次房间
    A->>B: 发送单聊 voip 邀请
    B-->>N: 在线邀请（有执行机会时）
    B->>P: 有效来电的专用设备路由
    P->>N: 允许的唤起与来电通知
    N->>N: 系统来电展示、业务去重
    N->>B: 核对消息、账号、单聊和时效
    Note over B,N: iOS 专用投递及正式原子接听／终态补偿仍待补
    N->>B: 用户接听后申请本次媒体授权
    N->>R: 接听后加入、发布与订阅
    R-->>A: 媒体已连接且对端就绪
    R-->>N: 媒体已连接且对端就绪
    N->>B: 入房后 answered 停铃上报
    A->>R: active 挂断并断开媒体
    R-->>N: 远端离开，宽限及重连保护
    N->>N: 释放媒体、通知、音频和后台任务
```

上图把当前实际顺序和待补的电话投递放在一起。当前真实业务适配 `im-voip-v1`：RTC 建房、单聊 `msgType=voip` 邀请、原生独立 IM WS 及 `/calls/answered`、`/calls/declined`、`/calls/ended`；不是已部署完整 `/calls-v1` 状态服务。原子抢接、权威终态查询及断线补偿仍待后端。细节见 [实际业务接入](voip-business-integration.md)、[后端源码核对](voip-im-backend-review.md)。

四类职责必须分开：

| 层 | 负责什么 | 本项目选择 |
| --- | --- | --- |
| 业务信令 | 谁呼叫谁、忙线、超时、接听归属、取消与结束 | 现有 IM 后端及后续电话状态增强 |
| 系统推送 | App 无执行机会时，让操作系统获得来电事件 | 现有 UniPush／个推优先聚合；Android 按厂商获准通道，iOS 真正 APNs VoIP，鸿蒙原生应用内通话推送 |
| 原生通话 | 系统接听/拒接、锁屏交互、音频路由、持续通话 | Android Telecom/CallStyle；iOS LCK；鸿蒙 Call Service |
| 音视频媒体 | 麦克风、摄像头、WebRTC 连接、媒体传输 | LiveKit；不承担设备推送或呼叫裁决 |

普通 UniPush CID 注册、推送任务成功、通知出现、原生回调、系统来电展示、双向媒体，分别记录证据。任何一项都不能替代后面各项。

### 1.1 当前实际接打顺序

1. 主叫从真实单聊点语音／视频，检查登录、隐私、对端能力、权限和忙线；同一时间只持有一个呼叫。
2. 复用会议 RTC 建房和签票，主叫连接媒体后才发送 IM `msgType=voip` 邀请；媒体准备／发送限时 30 秒，发送成功后按 `sendTime+60 秒` 计算响铃窗口。
3. 被叫通过原生 IM 连接或系统推送获知邀请。两条路并发按 callId 去重；不能只因 WS 在线就假定手机有执行机会而跳过电话投递。
4. Android 进入 Telecom／CallStyle；iOS PushKit 回调先完成原生系统来电报告，业务网络校验独立继续；鸿蒙按原生通话推送及 Call Service 流程。接听前被叫不启动采集。
5. 被叫接听后进媒体房，当前 `/answered` 是停铃上报，临时失败不拆掉媒体；401/403 仍按匹配身份失效处理。正式原子接听裁决是后端增强项，不能用这个容错绕过授权。
6. 本地媒体已连接且对端就绪才进入 active 和计时。短暂重连不当作挂断；曾经有远端后，远端归零等待 3 秒，重连中继续等待，恢复即撤销离房计时。
7. 主叫接通前取消／超时走 legacy ended，被叫明确拒接走 declined；active 正常挂断释放媒体，不追加 legacy cancel，远端通过媒体离开及控制收尾。正式权威终态与恢复查询仍待后端补全。

App 级 CallManager 和 `features/voip` 持有业务，原生插件持有系统通话／媒体；页面只展示和发送操作。普通业务仅保留入口、账号和生命周期接点。权限引导、音频互斥与记录复用分别见 [通话准备](voip-call-readiness.md)、[会议关系](voip-meeting-relationship.md)，不把通话实现散落到聊天页。

媒体依赖沿用当前锁定的 Android LiveKit Kotlin 2.30.0、iOS Swift 2.19.0、鸿蒙 ArkWeb 内 LiveKit JS 2.23.0。这是本项目版本锁定，不声称它们是各项目当日最新版本。华为 Android 运行 APK，与鸿蒙原生应用／ArkWeb 路线分别构建和验收。

### 1.2 权限与产品体验

按 [通话准备方案](voip-call-readiness.md)逐层实施：隐私／登录后展示通话能力与缺失项；通知和系统来电相关权限说明用途后申请；麦克风／相机在用户拨打、接听相关功能时申请，不在启动时堆叠全部弹窗。Android 创建独立“音视频通话邀请通知”分类和合理铃声默认值，保留用户显式静音及关闭选择；按系统检查全屏来电、通知、后台等能力，提供到本 App 设置的引导，不把复杂全局设置作为正常使用前置。

显示名、权限引导 UI、正式聊天通话卡片／后端历史和真实智能体仍是独立待办。会议的房间、参与者和记录模型优先复用，但不能因 RTC 可通就宣称通话结果已在后端持久化，也不能把传视频当作模型已具备视频理解。

## 2. “App 没启动”需要区分的情况

| 手机状态 | 能否承诺来电 |
| --- | --- |
| 从未安装，或安装后从未同意隐私/登录/登记设备 | 没有可用的用户设备路由，不能来电 |
| 曾完成登记，当前在桌面或锁屏，进程存活 | 可验在线控制；仍需检验冻结、网络及系统限制 |
| 曾完成登记，进程被系统回收 | 必须依靠获准的系统推送与原生冷启动，不能依赖页面 JS 或原生长连接 |
| 用户主动强停/强退、撤销权限或关闭来电开关 | 单列操作系统限制，不保证与系统自然回收等价 |
| 断网、设备关机、登录已过期 | 不承诺实时来电；过期邀请不得恢复成新响铃 |

因此，首次启动是建立身份和设备路由的前置，之后不应要求用户一直开着 App。Android“自启动”“无限制省电”只是特定设备测试条件，不能替代厂商通道和 VoIP 权益。HBuilderX 调试服务可能自动重启进程，冷启动验收时必须排除该干扰。

iPhone 的“用户从多任务界面上滑退出”是本次重点，必须单独实测，不能把系统回收的结果直接套用，也不能仅凭普通通知强退规则断言真正 PushKit 必然成功或必然失败。先接通真实投递，再记录退出方式、拨号前进程、系统是否重新启动及接听结果。

## 3. 申请前统一准备的材料

由应用负责人准备一份受控材料包，每个平台按实际要求补充：

1. 企业开发者主体、应用名称、真实业务介绍、应用备案/上架资料；涉及特定资质时按对应平台当前规则办理。
2. Android 包名 `com.nuwax.app`、实际发行与调试签名的 SHA-256 指纹；iOS Bundle ID、Team ID、App ID；鸿蒙独立应用和签名信息。不能因包名相同就认为签名或权益相同。
3. 商店详情页或可供审核的下载入口、独立审核测试账号、两账号互拨步骤。
4. 单聊语音/视频入口、来电页、接听/拒接、通话设置开关、通知授权说明的截图及录屏。
5. 明确描述两种场景：人与人通话、智能体主动来电。智能体来电必须是真实可接听的双向通话，不能把普通 AI 提醒包装成电话绕过消息限制。申请类别须由厂商确认。
6. 服务结束后释放后台任务与音视频资源的说明，以及用户关闭来电、拒接、拉黑/限制联系人的产品规则。

AppID、channelId 和申请结果可进入交接清单；AppSecret、MasterSecret、P8、测试账号密码只通过受控路径交付，不进仓库、聊天或截图。本文列出官方申请邮箱供负责人操作，本轮未发送邮件或提交任何申请。

提交前为每个平台建立台账：`负责人 / 主体 / 包名与签名 / AppID / 普通 Push 状态 / 通话权益状态 / 支持系统和机型 / 测试与生产环境 / 批准工单 / 客户端版本 / 真机证据`。状态用“未申请、审核中、已批准、已接入、已验收”分开填写。

## 4. 国内 Android 厂商逐个怎么申请

先申请普通推送，再核对电话能力。UniPush 可继续聚合已有厂商普通推送；电话专用接口能否由聚合服务转发，必须得到 DCloud/个推对**具体应用、通道、SDK 版本与参数**的确认，不能由 `payload.type=voip` 推导。

| 厂商/系统 | 普通推送入口与步骤 | 电话能力与申请路径 | 核对重点 |
| --- | --- | --- | --- |
| 小米/Redmi | [小米开放平台](https://dev.mi.com/console/)创建移动应用、开通 MiPush、登记包名及对应信息，获取本应用凭据 | 单独申请 VoIP Service Kit：发至 `mipush-permission@xiaomi.com`；提供主体、应用/包名、AppID、channel 信息、场景、通话与设置截图。适用场景与内部应用证明按[申请规则](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=1656)办理 | 普通推送开通不等于 VoIP；[新版 Kit](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=2244)使用 MiPush RegId 和专用消息类型，须检测设备能力 |
| 荣耀 | [荣耀开发者平台](https://developer.honor.com/cn/)创建应用，开通并接入荣耀推送新通道，登记签名指纹 | 单独申请 VoIP 权益：`honorpush@honor.com`；提交应用/包名、AppID、场景、通话及开关截图/录屏；内部应用附主体证明，其他场景先咨询。[官方规范](https://developer.honor.com/cn/docs/11002/guides/notification-voip-standards) | [Kit 入门](https://developer.honor.com/cn/docs/voip/guides/dev-overview)要求 MagicOS 10.0+ 测试设备；仍须运行时判断与支持列表核对 |
| vivo/iQOO | [vivo 开发者平台](https://dev.vivo.com.cn/)创建并审核应用，在推送运营平台开通 Push、取得 AppID/AppKey/AppSecret；见[服务申请](https://dev.vivo.com.cn/documentCenter/doc/281) | 官方已有 [VoIP Service Kit](https://developers.vivo.com/product/d/voip)，覆盖系统通话 UI、音频路由和后台通话管理；通过该产品的在线提单或 `push@vivo.com` 获取当前接入/权益要求 | 本轮公开资料未核实到完整的申请资质、最低版本及冷唤起保证，必须取得厂商书面范围；Kit 的后台通话能力不能直接当作离线推送能力 |
| OPPO/一加/realme | [OPush](https://push.oppo.com/)创建应用、登记包名与信息、申请推送，按控制台配置本应用所需凭据 | 向平台工单核对真实音视频来电的消息分类、离线执行与系统来电权限；尚无本轮已核实、可直接引用的统一 VoIP Kit 申请规则 | 测试推送与正式推送的上架条件不同；不把可发普通通知写成可冷唤起系统电话 |
| 华为 Android/HMS | [AppGallery Connect](https://developer.huawei.com/consumer/cn/service/josp/agc/index.html)创建 Android 应用、登记签名指纹、开通 Push Kit，取得对应客户端/服务端配置 | 核对该 Android 应用实际拥有的来电相关权益与投递方式 | 与下节 HarmonyOS 原生权益分开，不能共用一份开通结论 |
| 魅族/Flyme | [魅族开发者平台](https://open.flyme.cn/)创建应用，在[推送平台](https://push.meizu.com/)登记包名并获取应用凭据 | 通过厂商支持确认通话类消息、进程执行机会和通知交互范围 | 本轮仅核实普通推送申请路径，未核实独立 VoIP Kit 权益，不做自动系统来电承诺 |
| 三星及其他未覆盖 Android | 先记录销售地区、ROM、GMS 是否可用及实际网络；有条件的海外设备可评估 UniPush FCM 辅助通道 | 当前项目未核实可直接申请的第三方三星专用 VoIP 通道；向 DCloud／个推确认具体设备的离线交付和原生回调能力 | FCM 需要 GMS 及 Google 推送网络可达，不能作为国内三星默认保证；无获准唤醒能力时明确降级，单列支持范围 |

普通多厂商开通和 UniPush 所依赖的个推配置可对照[个推官方厂商开通指引](https://docs.getui.com/getui/mobile/vendor/vendor_open/)。各平台需要的字段不同，以当前控制台为准，不批量替换现有生产凭据。

### 4.1 每一家都按这六步落地

1. **先查已有配置**：应用负责人逐家登记现有 AppID、包名、签名、普通 Push 和通话权益状态。已接入的华为／荣耀普通通道继续复用，不能因为这次补离线打包依赖就重建应用或重新申请普通 Push。
2. **补未开通的普通 Push**：按上表进入该厂商平台，完成开发者认证、应用创建和推送开通。核对将要安装的 APK 的签名，不能拿另一套调试签名冒充发行签名。小米目前缺失的普通通道优先补台账和申请条件。
3. **申请真实通话能力**：小米、荣耀按官方邮件模板提交；vivo 用产品页提单或官方支持邮箱确认条件；OPPO、华为 Android、魅族等先取得本应用允许的消息分类、离线执行和通话界面的书面范围。不把普通 IM 通道申请自动当作 VoIP 审批。
4. **问清能否沿用 UniPush**：将批准能力、目标 SDK 和系统版本交给 DCloud／个推，确认是否能转发该专用消息、是否要求厂商 RegId、是否会在无进程时触发原生层。若确需厂商专用适配器，仍接入现有 VoIP 插件与同一后端电话调度，不重建一套业务呼叫服务。
5. **先形成具体配置变更，再确认**：按 [DCloud 厂商配置](https://doc.dcloud.net.cn/uni-app-x/uni-push/vendor_config.html)将应用参数、配置文件、回执和客户端依赖逐项对应。现有生产应用、密钥、channel、回执地址的保存或替换均先请用户确认；本地测试副本／服务版本与生产明确隔离。
6. **构建并逐家验收**：依赖／配置进入真实 App 后重新构建；核对 SDK、签名、CID/必要 RegId 和厂商回执。按前台→桌面→锁屏→进程回收验证响铃、亮屏、接听、双向媒体和挂断；不能把“已批准”直接填成“已验收”。

**安卓共用的是业务、媒体和系统通话架构，权益、消息协议、SDK、ROM 支持与验收不完全相同。三星不是唯一需要分支处理的品牌。** FCM 的使用前置和 UniPush 接入方式见 [DCloud FCM 指南](https://doc.dcloud.net.cn/uni-app-x/uni-push/google-fcm.html)。

### 4.2 各家提交时的具体差别

| 厂商 | 负责人要实际完成的动作 | 取回的结果 |
| --- | --- | --- |
| 小米 | 在小米平台补普通 Push／当前消息分类与 channel；向官方邮箱发送 `【Voip Service Kit 功能申请】- 女娲Nuwax - 日期`，按真实业务提供企业、应用、AppID、channel、开关／通话截图及审核入口 | 审批工单、允许场景、SDK／机型范围、是否需 MiPush RegId；再核实聚合支持 |
| 荣耀 | 保留既有普通通道；向官方邮箱提交 `【VoIP权益】- 女娲Nuwax - 日期`，附 IM／办公场景、来电开关和通话录屏，企业内部证明仅在确属该范围时提供 | 权益批准、SDK 指引与支持版本；现有荣耀普通链路测试不能代替专用 Kit 开通 |
| vivo | 在开发者／推送平台开通符合上架要求的普通 Push；向 `push@vivo.com` 或产品页提单，询问本应用 VoIP Service Kit 权益、SDK、系统及无进程回调要求 | 厂商书面接入清单和测试范围，尚未确认的材料不预填为已完成 |
| OPPO／一加／realme | OPush 建应用并完成相应测试／正式资格；工单说明真实双向来电、后台和锁屏诉求；逐个确认对应 ROM／机型覆盖 | AppID 及平台要求的凭据、批准分类、原生唤起方式和机型列表，不按品牌集团名称直接推定全覆盖 |
| 华为 Android/HMS | AGC 选择 Android 应用，核对 SHA-256、Push Kit、实际 APK 配置文件和既有 UniPush 参数；就来电分类／执行范围向平台核实 | Android 应用的配置及批准范围，不拿 HarmonyOS 原生权益作凭证 |
| 魅族 | 推送平台创建／核对应用和包名，按平台要求配置 AppID／客户端参数与服务端凭据；支持工单确认离线来电能力 | 普通 Push 开通、允许的通话行为与实测范围 |
| 三星／其他 | 先测地区、系统、GMS 和网络，再向聚合服务确认可用路线；海外 FCM 只在符合前置的设备验证 | 明确支持、降级或暂不支持的设备范围，不能用在线长连接测试填冷唤醒通过 |

### 上架条件与审核时间

- 个推当前[厂商条件说明](https://docs.getui.com/getui/scene/pushCondition/)区分：华为、荣耀、魅族及 OPPO 测试环境可不要求商店上架；小米、vivo 和 OPPO 正式环境需要上架。这是普通厂商离线推送条件，不能代替电话权益审批。
- 小米、荣耀的 VoIP 规则均写明约 15 个工作日内回复申请结果；回复并非必然批准。内部应用与面向公众应用必须按真实服务范围申报。
- 2026 年小米消息分类/模板已有调整，新申请须按[当前分类规则](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=2321)创建 channel；真人私信、AI 交互与来电不可自行混为同一类别。
- 商店已上架、厂商 Push 已开通、通话权益已批准、客户端 SDK 已接入、真机已通过，分别留存记录。

申请邮件草稿可复用以下字段，提交时再按该厂商当前模板调整，不包含任何密钥：

```text
申请能力：应用内一对一音视频来电
企业主体：<营业执照主体>
应用：女娲Nuwax；包名 com.nuwax.app；AppID <本厂商应用 ID>
推送 channel：<本厂商要求的分类与通道>
业务：真人单聊互拨；另请确认智能体主动发起真实双向语音的适用类别
目标：桌面后台、锁屏及系统回收后收到邀请，显示系统接听/拒接
用户控制：来电开关、拒接与结束；结束后释放音频/后台资源
附件：上架或下载入口、通话与设置录屏、所需主体/场景证明
联调：审核账号通过受控渠道提供；请明确允许的 SDK、系统/机型与投递方式
```

### 小米新版专用能力对现有方案的影响

官方新版接入使用原生 MiPush RegId、对应 AppID/AppSecret 与 VoIP 消息类型，并要求查询 `FLAG_SUPPORT_CALLKIT`。UniPush CID 不能直接替代 RegId，普通云函数 payload 的 `type:"voip"` 也不等于厂商 VoIP 类型。[小米接入流程](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=2247)

研究线先收集申请、支持机型和聚合服务适配结论；调试线保留当前接收器。若需要新增厂商 SDK/后端适配器，再形成有版本与回退范围的变更，不能为验证冷启动额外拉起第二套无关推送服务。

## 5. HarmonyOS 原生怎么申请

1. 为原生鸿蒙应用建立独立的应用身份、签名与 Push Token 注册，开通 Push Kit。
2. 在华为应用的“开放能力管理”中申请“推送应用内通话消息”权益，按页面模板提交场景与附件。当前官方资料有 AGC“项目设置 → 选择应用”及新“应用管理 → 基础信息”入口，以所属应用控制台为准。
3. 认真核对[当前权益材料](https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/push-apply-right)：内部企业/政府、智能安防、智能穿戴等场景按规定提供盖章证明；其他应用页面列出 B22 国内多方通信服务资质要求。这是该平台该权益的审核材料要求，女娲适用类别须由业务负责人向平台确认，不能将公共产品按内部应用申报，也不据此推导所有平台的一对一通话都需同一资质。
4. 权益通过后对接原生 VoIP 推送、原生 callId、Call Service 和后台任务；业务 callId 与原生 callId 分别保存映射。
5. 先验 ArkWeb 双向音频、系统接听、锁屏持续通话及进程回收后邀请，再开放入口。原生配置与媒体页由源码构建脚本重复生成。

华为[应用内通话规则](https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/push-voip)明确：锁屏只能语音接听；视频接听进入应用内界面。不能按 Android 普通通知或网页前台通话替代鸿蒙验收。

## 6. 苹果：APNs VoIP → PushKit → 原生通话 → LiveKit

苹果链路由 Apple Developer 身份、签名、APNs 鉴权与原生框架组成；不走 Android 厂商申请邮箱。**发送层优先留在 UniPush／个推，使用真正的 VoIP 类型，最后由 APNs VoIP 投递到 PushKit；普通通知不会自动转成电话。** SDK 和发送参数能力已核实，本应用实际绑定、topic／环境与投递仍未验收。

### 6.1 开发者与签名准备

1. 使用团队 Apple Developer 账号，核对显式 App ID/Bundle ID `com.nuwax.app`，启用 Push Notifications，配置通话所需后台模式与隐私声明。
2. 由授权管理员核对已有 APNs Authentication Key（P8）、Key ID、Team ID 及其 topic／环境授权。沿 UniPush 路线时先请 DCloud／个推确认本应用正确的 VoIP 凭据配置入口和环境选择；若走备用直连 APNs 才交后端密钥管理。也可使用匹配 VoIP topic 的证书认证。不能仅因已有普通 APNs 配置就认定电话发送已配置；不为排查重新创建、撤销或覆盖已有 key。
3. 准备匹配该 App ID 和设备的开发签名/profile。本地包从 profile 读取 `aps-environment`，与签名后 entitlement 回读比对；不按 API 域名、DEBUG 或用户输入猜环境。
4. 使用 development profile 签名的包走 sandbox，TestFlight/App Store 包走 production；Ad Hoc 等包也以签名中的 `aps-environment` 为准，不能按 Debug/Release 构建名猜测。分别登记 PushKit token。开发真机联调不以 App Store 正式上架为前提，但仍须正确账号、签名、设备及推送权限。

P8 可用于开发和生产环境，但具体 key 授权与目标 token 环境仍须匹配。私钥仅保存在受控服务端或供应商凭据配置，不进入客户端；详情见 [Apple APNs token 认证](https://developer.apple.com/help/account/capabilities/communicate-with-apns-using-authentication-tokens/)。

2026-11-17 已通过用户登录的 Apple Developer 页面核对：本 App 的 Push Notifications 已启用，现有 APNs Key 为 All topics / Sandbox & Production；已重新生成失效的开发 profile 并确认覆盖两台联调手机。P8 原文件的后端保管与实际发送尚待确认，生产发行 profile 未改。具体变更和本地签名选择见 [Apple 配置核对记录](voip-ios-push-handoff.md#2026-11-17-apple-developer-配置核对与开发签名更新)。

### 6.2 客户端与后端各自做什么

| 责任方 | 操作 |
| --- | --- |
| iOS 原生 | 保留唯一 PKPushRegistry；将 PushKit token 绑定给已初始化的个推 SDK，处理 CID／token 轮换与登录代次；保留现有原生恢复和系统来电。SDK 返回 BOOL 仅作本地参数受理诊断 |
| 业务后端 | 扩展现有设备接口或等价电话登记，关联账号／设备／CID／包名／环境／版本和可接电话能力；普通设备刷新不清空电话字段，退出／换账号可靠撤销旧路由。`/calls/devices` 是现有备用契约，不是唯一必须新建的路径 |
| UniPush 发送 | 只给已登记的 iOS 电话设备发送 `options.ios.type=voip` 及经过校验的最小邀请载荷，短有效期和去重；核实本应用厂商直投能力、VoIP topic 及 development／production 选择。业务 payload 的 `type=voip` 不替代此参数 |
| 备用直连 APNs | 仅当现有聚合路线不满足要求时启用已有适配器契约：HTTP/2、`apns-push-type=voip`、`apns-topic=com.nuwax.app.voip`、匹配环境及短 expiration。按设备选一路，不默认双投 |
| iOS 收到邀请 | 在原生 PushKit 回调及时报告系统来电，业务网络核对并行进行；不等页面启动、IM WebSocket 或消息详情返回后才上报 |
| 用户接听 | 核对有效呼叫/接听归属与权限，再接入 LiveKit；媒体连接和对端就绪后开始计时；拒接不启动采集 |
| 结束或失效 | 控制连接与权威终态结束系统通话，释放媒体/音频会话/后台任务；取消和挂断不用追加 VoIP push 传递 |

APNs 建议 expiration 为 0 或仅数秒，避免过时来电；业务响铃时限独立计算。APNs 200 只表示受理，不能当作已响铃。完整载荷、幂等、重试与注册撤销契约见 [iOS 后端交接](voip-ios-push-handoff.md)。[Apple PushKit 来电规则](https://developer.apple.com/documentation/pushkit/responding-to-voip-notifications-from-pushkit)

已核实依据：[DCloud options 映射](https://doc.dcloud.net.cn/uniCloud/uni-cloud-push/options.html)、[个推 iOS VoIP 类型](https://docs.getui.com/getui/server/rest_v2/common_args/)、[原生 token 绑定](https://docs.getui.com/getui/mobile/ios/xcode/)。`settings.strategy.ios=2` 是厂商直投策略，DCloud [明确标注需申请开通](https://doc.dcloud.net.cn/uniCloud/uni-cloud-push/api.html#settings)，不能直接当作本应用已拥有的权益；发送环境参数也不能猜测。详细步骤和给供应商的核对问题见 [明日操作细则](voip-ios-cold-start-runbook.md)。

### 6.3 系统版本与国内发行边界

- 当前代码保留 iOS 15 安装范围，17.4+ 走 LiveCommunicationKit；15–17.3 仅前台通话/普通通知，不注册 PushKit。LCK 的[来电上报 API](https://developer.apple.com/documentation/livecommunicationkit/conversationmanager/reportnewincomingconversation(uuid:update:))标注 17.4+，这不等于所有旧系统/地区签名组合已验收。
- 原生回调按实际系统和 SDK 支持实现，不能把新版 API 直接用于旧系统，也不再建立第二个 registry。真实 PushKit 必须及时向系统通话框架报告，不能复制供应商旧示例绕过当前 Apple 要求。
- 国内商店可用性须由团队针对本 App 向 Apple Developer Support/App Review 核对，并以相同发行签名实测；本次公开资料与开发包验收不能替代发行审核结论，不承诺仅更换系统框架就解决地区审核要求。
- 本产品无需申请默认电话/默认拨号器，不走蜂窝拨号兜底。Apple 的[默认拨号器指南](https://developer.apple.com/documentation/livecommunicationkit/preparing-your-app-to-be-the-default-dialer-app)属于另一类能力，不能将其 EU 条件套到本次普通 App 内网络通话。

## 7. 后端与基础设施交接顺序

### 呼叫业务

- 一个业务 callId 贯穿邀请、在线事件、推送、系统映射、媒体房间与日志；消息定位 ID 保持字符串。
- 后端持久化 ringing/connecting/active/ended、递增版本、超时、忙线与原子接听归属。客户端忽略旧版本和终态后的迟到邀请。当前 IM 协议本地投影序号不能充当后端权威版本。
- 当前 IM 适配按邀请发送时间加 60 秒校验；原计划默认 45 秒。正式服务需统一下发 expiresAt，再统一客户端和推送 TTL，不能各端自行混用。
- 电话推送单独调度，避免沿用普通消息“IM 连接在线便不推送”的判断；后台冻结时在线记录可能仍在。在线与推送并发到达按业务呼叫去重。
- 取消、拒接、接听获胜者和挂断走可恢复控制连接，并提供权威查询补偿。App 重启后仅查消息详情不足以判定是否仍在响铃。

### 设备与平台适配

- 普通 UniPush CID、PushKit token、Harmony 原生 token、必要的厂商 RegId 分命名空间存储。按用户、物理设备、包名、环境、provider/channel、注册版本隔离。
- 登出/换账号撤销旧路由，轮换与失效采用条件更新；旧撤销不能清空新账号或新 token。
- 电话路由按已批准权益、系统版本和实测能力选择；未支持设备明确降级到普通通知/点击进入，不伪称自动系统来电。
- 推送只带最小呼叫定位与显示信息，不带平台登录 token、RTC JWT、任意 URL。APNs 私钥、厂商密钥及服务端 LiveKit secret 不进客户端。

### 媒体与国内网络

- `livekit-test.nuwao.com` 页面可打开只证明该入口可访问，不能证明手机媒体 UDP/TURN、后台推送或电话控制全部可用。
- 使用可从目标国内运营商访问、证书链有效的 WSS/HTTPS 媒体与业务域名；核实 LiveKit 的媒体端口、ICE 公网地址及 TURN/TLS 兜底。按实际部署版本的[官方端口与防火墙指引](https://docs.livekit.io/transport/self-hosting/ports-firewall/)配置，不能只放通控制台 HTTPS。
- 分别用 Wi-Fi 和国内蜂窝网络验证双向音频/视频、网络切换与弱网重连。RTC token 只授权本次房间和身份，不按同租户任意房间泛授权。
- 智能体必须真实加入媒体、接收用户语音并连续回复；真人或合成媒体替身仅验证媒体链路，不能替代正式智能体上下文和双向语音验收。

## 8. 谁负责、交付什么、怎样验收

| 负责人 | 交付 |
| --- | --- |
| 产品/应用负责人 | 场景与材料包、用户来电开关、申请范围、商店与主体材料、逐厂商批准记录 |
| 开发者账号管理员 | 受控 App ID/签名/profile/APNs key 授权；厂商控制台配置清单。生产变更先确认 |
| 移动端 | 功能集中在 `features/voip`、原生插件与 API 层；普通业务只保留入口/生命周期接点；真机系统展示、接听媒体及释放记录 |
| 后端同事 | 电话设备注册、专用平台路由/发送、权威状态/原子接听/补偿、媒体授权、脱敏发送回执 |
| 测试/联调 | 每个平台、机型、系统版本、签名渠道的证据矩阵；不能由浏览器或前台 Demo 替代 |

每条链路按顺序验收：

1. 设备登记回执正确，确认账号、包名、环境与通道。
2. 后端有效邀请 → 专用平台发送回执 → 原生到达，关联同一 callId。
3. 前台、桌面后台、锁屏、系统自然回收分别出现系统接听/拒接。受控回收与主动强停另列，不互相替代。
4. 接听后确认两端真实双向声音，视频另验；只看到计时不算听感通过。
5. 拒接/超时/取消/忙线/重复迟到推送/多设备抢接；网络切换、权限拒绝、蓝牙与蜂窝电话打断。
6. 锁屏双向音频持续 30 分钟；挂断后媒体采集、通知、音频焦点和后台任务全部释放。
7. 用真实发行签名再验一次，关闭 HBuilderX 干扰；随后才评审按平台/厂商开放生产能力。

### 2026-11-17 最新交付与验收状态

| 项目 | 当前结论 | 下一步 |
| --- | --- | --- |
| 公共接打代码 | `ff8d49019` 已同步 GitHub／GitLab；三端补齐 PC 接听上报容错、重连保护、准备／响铃计时和挂断差异；保留 `0936f019a` 的 iOS 冷启动可靠性修补 | 新变更还未进入重新编译的安装包，需平台构建与真实回归 |
| 源码测试 | 127 项 Vitest、57 项 Swift、12 项 Kotlin 策略通过，Swift 语法与 ArkWeb 资源生成通过 | 不当作原生平台链接或真机验收 |
| 华为 Android | ABR-AL80／Android 12 新包锁屏铃声、亮屏及原生来电界面已由用户确认；该通在线邀请先到、进程存在 | 无进程独立唤醒、长通话和新代码回归仍待测 |
| 荣耀 | 用户确认退桌面／锁屏接听挂断、清理后台后可来电；没有进程快照，后续明确锁屏无铃声 | 用修补版复测铃声，记录设备／系统及进程回收证据；不标完整验收通过 |
| 小米／Redmi | 进程存在时部分后台／锁屏来电通过；普通小米通道尚缺配置，无进程测试未通过 | 核对普通 Push 开通与专用权益，不能以自启动测试代替 |
| iOS | 前台／在线接打有既有通过记录；用户上滑退出后未收到邀请；当前还缺个推绑定、真实 VoIP 发送和实际测试部署 | 按 [明日细则](voip-ios-cold-start-runbook.md)补齐、出新包后再验 |
| 鸿蒙原生及其余 Android 厂商 | 具备源码组织／规划，未取得本项目完整电话矩阵验收 | 按各自应用身份申请权益并逐设备验证 |
| 生产 | 本批没有生产配置、密钥、权益或部署变更 | 每次具体变更先确认，完整验收后再评审开放 |

### 交付顺序

1. 明天先核对 iOS 现有应用的真实 VoIP 凭据／环境与厂商直投能力，同时完成客户端绑定和后端／云函数增量，不要求重新搭建媒体服务。
2. 本地代码和测试通过后，提交测试环境的具体部署清单供确认；确认后由负责同学部署既有测试服务，交付版本与脱敏投递记录。
3. 使用统一签名目录，HBuilderX 5.34 导出当前完整资源，构建真实 App 的独立测试环境包，不上传基座。
4. 先验单次 PushKit 到达和系统来电，再验前台／后台／锁屏／系统回收／用户上滑退出，最后补完整接打与资源释放矩阵。
5. 其余厂商材料和申请可提前准备，审批／配置／SDK 接入／验收各自留状态。审核时间不纳入“明天必须全部完成”的承诺。

## 9. 本文维护与操作入口

本页维护最新整体架构、各厂商申请和当前能力范围；[交付计划](voip-delivery-plan.md)维护任务顺序；[iOS 操作细则](voip-ios-cold-start-runbook.md)维护逐项操作及排障；[验收记录](voip-acceptance.md)保存实际设备证据。历史契约／旧包说明只作对应批次记录，不能覆盖本页最新状态。
