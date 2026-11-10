# App 实时会议方案（对齐 PC，待评审）

日期：2026-11-09。状态：方案稿，尚未开发。

参考代码：`nuwax-im` 的 `feat-video-meeting` 分支，提交 `fb880f2`（2026-11-09 09:23，会议语音通话 web 端完成）。本次已 fetch 并切到该分支；远程 `main` 仍为 `57c2757`，会议功能尚未合入 `main`。

移动端基线：`feat-2026.11`。本方案讨论 Android / iOS / 鸿蒙 App；H5、微信小程序不纳入本轮实现与验收。以 Android / iOS 为首批落地平台，鸿蒙必须先通过兼容性验证再确定实现与排期，不能因后端接受平台参数就认定音视频可用。

## 1. 建议与目标

复用 PC 的会议后端、自建 LiveKit、IM 邀请协议和会后记录，在 uni-app x 中实现适合手机的原生会议体验。产品形态参考飞书：会前浅色、会中深色，操作集中在底栏，次要功能通过底部面板展开，会议可以收起后继续聊天。

最终功能范围包含：会议中心、立即开会、加入、预约、会议邀请与分享、游客入会、会中音视频、屏幕共享、成员管理、举手、聊天/弹幕、云端录制、会后回放/转写及记录管理。分阶段交付不改变最终对齐范围；未通过的能力不能以“按钮隐藏”视为完成。

**明确不纳入本方案**：聊天页单聊语音/视频通话、群聊通话入口及其呼叫状态机、来电页、接听/拒绝/取消/超时、系统级来电和 VoIP 推送。这部分由另一位同事独立开发。会议模块不修改其产品范围，只约定双方共享 RTC 基础设施时不能同时占用麦克风、摄像头或音频会话。

建议采用 **UTS 原生插件桥接 LiveKit Android / Swift SDK + `.uvue` 业务界面**。先完成双端互通与后台音频验证，再开发完整页面。

## 2. 已核实的现状

### 2.1 PC 实际能力与移动端对应方案

以下以调用路径和后端 Controller 为依据。PC 的部分文件头注释仍描述旧版“预约仅本机”，但 `MeetingPane.doSchedule()` 已调用服务端预约接口，不能照旧注释另做本地预约。

| 能力 | PC 当前实现 | App 方案 / 完成条件 |
|---|---|---|
| 会议中心 | 发起、加入、预约；预约/进行中/历史列表 | 伙伴页增加“会议”页签，三项快捷入口，列表按状态分区 |
| 立即开会 | 生成会议号与分享 slug；主题、联系人、游客开关 | 全屏表单；默认语音入会、摄像头关闭，游客开关显式传 false |
| 加入会议 | 按会议号或邀请链接加入已有房间 | 支持粘贴会议号/完整邀请文案/链接；解析后显示入会确认，不自动建房 |
| 预约 | 服务端保存、跨端列表可见、取消、按原会议号开始；给联系人发送邀请文字 | 服务端为唯一数据源；原号、slug、游客设置沿用；邀请发送失败显示部分成功 |
| 会议邀请 | `meeting_invite` 消息；加入/忽略；本人多设备同步 | 会议邀请面板，去重、忙线处理，忽略后聊天卡片仍可打开；不复用单聊/群聊通话的来电页 |
| 分享 | 复制主题/会议号/链接，分享至会话 | 原格式互通；增加系统分享面板；分享不能自动开放游客 |
| 游客 | 公共房间状态查询、昵称换令牌、受限权限 | App 已安装时可走游客入会承接；未安装继续使用现有 Web 游客页 |
| 会中音视频 | 麦克风、摄像头、切摄像头、音量、连接状态 | 增加前后摄像头切换、听筒/扬声器/耳机路由、系统中断处理 |
| 布局 | 动态、宫格、顶部缩略图、侧边缩略图、演讲者；固定参会人 | 保留五种模式与固定能力；竖屏优先动态/宫格/演讲者，缩略图布局适配屏宽，横屏完整展开 |
| 屏幕共享 | 发布/观看共享轨道 | PC → App 观看、App → PC/App 发布都在最终范围；Android MediaProjection，iOS ReplayKit 扩展先验证 |
| 成员与主持 | 人员状态、静音、全员静音、全员禁言、单独放行/收回发言权限、移出 | 全屏成员面板；管理操作只对主持人显示并由服务端判权；游客也可管理 |
| 举手 | participant attributes 的 `handRaised` | 举手/放下；主持人、成员、视频缩略图展示统一状态 |
| 会中消息 | LiveKit DataChannel：聊天与弹幕 | 底部聊天面板 + 新消息角标；弹幕可由主持人关闭，关闭后仍可普通聊天 |
| 云端录制 | 主持人启动/停止；音频或合成视频；异步生成文件 | 沿用 Egress；全员可见录制状态；端上不自行混流上传 |
| 会后记录 | 基本信息、参会人、录制文件播放/下载、分说话人转写、复制全文 | 原生详情页与播放器；录制、文件、转写分别展示处理中/完成/失败 |
| 删除记录 | 主持人删除会议对所有人不可见；参会人仅移除自己关系；进行中不可删 | 两套确认文案；成功后刷新所有入口，失败保留记录 |
| 离开/散会 | 主持人可“仅退出”或“结束会议”；时长限制由服务端决定 | 主持人退出确认；普通成员离开不散会；倒计时按服务端开始时间计算 |
| 收起会议 | 页内最小化、独立窗口 | App 内可恢复的小窗/会议条；手机系统画中画另作增强项，不能与应用内小窗混同 |

### 2.2 不应误算为 PC 已具备的能力

本次代码检查未见可直接复用的完整会议密码/等候室、联席主持人/转交主持人、日历重复预约与编辑、实时字幕、AI 总结/待办服务。这些不作为“对齐 PC”的默认任务。新增时另立范围与接口。

会后转写已存在，但它不是实时字幕，也不等于 AI 纪要。移动端 `terminal-meeting-detail.uvue` 的 Vox 设备纪要属于另一套后端，不能直接作为 IM 实时会议详情接入。

### 2.3 Mobile 可复用与缺口

| 现有基础 | 复用方式 / 缺口 |
|---|---|
| `servers/im.uts` | 复用鉴权、设备 ID 和平台值；新增独立会议请求模块，避免继续扩张大文件 |
| `utils/im/imWsClient.uts`、`imWsEventBridge.uts` | 已有消息接收和 3007 自定义事件透传；新增会议订阅，不再另建业务信令 WS |
| 伙伴页消息/智联录、联系人与群成员 | 增加会议页签；复用选人数据和导航，群发起使用群成员而非仅联系人 |
| 现有 IM 消息与同步 | 补齐 `meeting_invite`、会议结束记录入口的渲染与处理；`voip` 由通话模块负责 |
| uni-push 与设备注册 | 复用通知通道，扩展会议邀请点击载荷；系统级来电属于通话模块 |
| UTS 原生模块、自定义基座脚本 | 延续现有插件组织、Android/iOS 桥接与基座分发方式 |
| `App.onHide` 断开 IM WS | 保留普通消息的推送策略；会议媒体连接独立管理，退后台不能顺手断掉 RTC |
| ASR/TTS、聊天语音、录音/播放模块 | 加统一音频占用协调，避免入会后仍抢麦、切换 AudioSession 或重复播放 |

## 3. 页面与导航

### 3.1 信息结构

不增加底部一级 Tab。在“伙伴”页头现有“消息 / 智联录”后增加“会议”。会议页签点击才加载列表，不与消息列表滚动、分页状态耦合；现有双页 swiper 的索引映射需要同步调整。

```text
伙伴
├─ 消息：会议邀请卡片、会后记录卡片（不增加单聊/群聊通话入口）
├─ 智联录：联系人/群成员选择复用
└─ 会议
   ├─ 发起会议 → 会前设置 → 会中
   ├─ 加入会议 → 会议号/链接 → 会前设置 → 会中
   ├─ 预约会议 → 主题/时间/成员 → 预约详情 → 开始/取消/分享
   ├─ 进行中 → 会前设置 → 会中
   └─ 历史记录 → 会议详情 → 回放/下载/转写

全局入口：会议邀请、外部会议链接、通知点击、应用内会议小窗
```

### 3.2 核心页面与交互

| 页面 | 布局与交互 |
|---|---|
| 会议首页 | 浅色背景、三个快捷操作；当前会议条置顶；预约和进行中卡片；历史按日期分组；下拉刷新与游标加载更多 |
| 发起 / 预约 | 原生全屏表单，主题、会议号、受邀人、游客开关；预约增加开始时间；不暴露用户不能配置的时长 |
| 加入 | 数字键盘输入、粘贴；会议号按 3-3-3 展示且保留前导零；错误就地提示 |
| 会前设置 | 主题与身份、摄像头预览、麦克风/摄像头/输出设备；默认不开摄像头，开麦受权限和主持设置限制；拒绝麦克风权限可仅收听 |
| 会议邀请 | 显示主题、邀请人、会议时间/状态及加入/忽略；不使用通话模块的来电交互 |
| 会中 | 顶部会议信息/计时/网络/收起；中间舞台或宫格；底栏固定；手势缩放共享内容，点击恢复控件 |
| 成员 | 竖屏用近全屏底部面板，横屏用侧面板；搜索、主持人标识、举手、音视频状态、邀请；主持操作放行内菜单 |
| 聊天 | 底部面板，不离开会场；新消息角标、自动滚动规则；弹幕遮挡控制与输入长度与 PC 保持一致 |
| 会议详情 | 会议元数据、参会人、录制文件、转写；文件卡片直接播放/下载；转写按说话人与时间组织、支持复制全文 |
| 收起状态 | 返回会话后保留小窗/会议条、时长、麦克风状态；点击恢复会场；导航返回不会等于挂断 |

发起人未填主题时沿用 PC 的默认命名。首次入会增加会前检查；之后可记住本机偏好，但不能覆盖主持人权限、系统授权或自动打开摄像头。预约链接打开后要区分“未开始 / 已结束 / 已取消 / 不存在”，不把所有失败都提示为网络错误。

链接兼容 PC 的 `?meeting=<shareSlug或旧会议号>`。新增会议意图解析与承接，不将 slug 当成群号塞入现有 `imInviteEntry`；冷启动、通知和登录回跳共用一个待处理意图，并在消费后去重清理。未登录先查询公开房间状态：开放游客则可填写昵称，否则登录后返回同一场会议的会前页。

### 3.3 会中线框

```text
┌────────────────────────────┐
│ 收起   产品周会 ▾    网络/布局 │
│       00:18:32  剩余 12:00   │
│ ● 正在录制                  │
│                            │
│        主画面 / 共享内容      │
│   正在说话高亮；共享优先显示   │
│                            │
│ [成员1] [成员2] [成员3]  …    │
│                            │
│ 静音  视频  成员(8)  更多     │
│                   [离开]    │
└────────────────────────────┘
更多：共享屏幕、邀请、聊天、举手、录制、布局、音频输出。
主持人另见：全员静音、全员禁言、弹幕设置、结束会议。
```

底栏控制在 4～5 个高频入口，避免将 PC 的整排按钮压缩塞进手机。“更多”可随角色、横竖屏调整，但当前正在共享/录制等状态必须始终可见、可停止。

### 3.4 视觉与细节

- 会前沿用 App 的主色、字体和组件；会中采用深灰画布、高对比文字、低干扰状态色，红色用于离开/结束。
- 常用触控区域至少约 44pt/48dp；兼容安全区、横屏、长昵称、大字号和国际化。
- 关闭摄像头显示头像，不保留最后一帧；麦克风、举手、主持人、共享与网络状态有文字/图标反馈。
- 动态布局只在人数/共享等结构变化时重排，发言切换加短暂稳定窗口，避免画面频繁跳动。
- 竖屏宫格建议每页最多 4 个可见视频；更大屏幕/横屏可增加至 6～9 个，最终取值由真机温升与解码验证决定。分页不改变全体成员可管理性。
- 屏幕共享使用 contain 保留完整内容，支持横屏与放大查看；弹幕不覆盖关键操作区。

## 4. 关键业务规则

### 4.1 开会、入会与预约

1. 发起时先生成会议号与不可猜测的分享 slug；创建房间、签本人令牌、连接成功后再发送即时邀请。
2. 常规会议建房传 `origin=1`，否则可能不产生预期的会议记录；从会话分享或发起会议时可携带真实 `convId` 关联来源。
3. 加入已有会议仅签令牌/连房，绝不因查不到会议而创建同号空房。
4. 预约持久化到服务端。开始预约使用同一 `roomName`、`shareSlug`、`allowGuest`，不生成第二场会议。
5. 预约邀请沿用 PC 的文字邀请路径；不对未核实的日历提醒、到点自动开会作承诺。
6. 表单提交期间防重复；网络超时后先查询确认是否已创建，再决定重试，避免重复房间/预约。
7. 会议模块一次只管理一场会议。已有会议时，加入新会议须明确提示并由用户决定，不自动结束当前会议；与独立通话模块的媒体互斥通过共享协调层处理。

### 4.2 主持人、成员与退出

- 主持人身份来自服务端令牌/房间元数据，不能只看“是不是本机发起”；重入后仍应有主持权限。
- “全员静音”只静音当前轨道，成员可自行开麦；“全员禁言”撤销麦克风发布权限，只有主持人放行后才能开麦。界面必须区分。
- 放行权限只表示允许发言，App 显示“主持人已允许发言”，由用户主动开麦；不能把权限恢复等同于已在采集。
- 相同用户的 PC/手机席位按人聚合；底层仍以 identity 管理媒体，游客按完整 identity 管理；过滤 Egress 隐藏录制席位。
- 普通成员离开只断开自身；主持人点离开弹“仅退出 / 结束会议”。“仅退出”不主动删房，保留条件遵从服务端超时/回收策略。
- “结束会议”调用服务端删房，所有端退出并进入会后状态；最后一人退出的自动收尾遵从后端权限和回收逻辑，不根据本地人数快照随意散会。
- 被移出、会议结束、同平台席位被替换是终止原因，不自动重连；普通网络中断才进入重连流程。
- 删除使用服务端判权。主持人删除会议影响全体；普通参会人删除仅自己不可见；会议进行中不允许删除。不能直接套用 Vox 设备录音的删除提示。

### 4.3 会议邀请

- `meeting_invite` 是普通 IM 消息类型，沿用既有落库、同步、未读和通知链路；不在本模块处理 `voip`。
- 会议邀请没有单聊通话的响铃生命周期；是否可加入以房间状态为准。邀请面板关闭不等于取消会议，聊天卡片仍可再次进入。
- 以 `msgId`、`inviteId` 去重；本人其它端已处理时及时收起本机会议邀请面板。
- 加入/忽略会议邀请调用现有 `/calls/meeting-invite-handled`。该路径虽然位于 `calls` 前缀下，但语义仅为会议邀请的本人多端同步；不因此把通话模块纳入本方案。
- 同一用户不同平台可同时参会；当前 identity 是 `tenant:user:platform`，同平台第二台设备可能替换第一台。暂不宣称“无缝转移会议”；第二端入会要提示回声风险，默认采用避免双端同时开麦的策略。

## 5. 技术设计

### 5.1 路线选择

| 路线 | 适用性 | 建议 |
|---|---|---|
| WebView 包裹 PC/Web 会议 | 可验证基础接入，但后台音频、设备路由、原生视频与屏幕共享需要大量平台处理 | 不作为正式 App 的主路线；不承诺挂页即可具备原生会议体验 |
| LiveKit 原生 SDK + UTS 桥接 | 延续现有后端，原生控制采集、渲染、路由和后台生命周期 | 推荐；先验证 uni-app x/HBuilderX 的构建与渲染组合 |
| 更换 RTC 服务商 | 需要改 PC 与后端令牌/媒体协议 | 本轮无必要；仅在平台兼容性验证失败后重新讨论 |

Android 接 LiveKit Android SDK，iOS 接 LiveKit Swift SDK。具体 SDK 版本、最低系统版本、依赖冲突与离线打包方式在阶段 0 锁定，不先写未经验证的版本号。

鸿蒙以可与当前自建 LiveKit 互通的 SDK/协议实现为验证对象。不能拿 Android AAR 当作原生鸿蒙可用，也不把 WebView 降级当作后台会议已完成。若无可维护的兼容路径，应单独给出鸿蒙接入成本与替代方案，暂停该平台音视频发布；已验证的 REST 列表/预约/记录仍可独立开放并如实标明能力。

### 5.2 分层与目录（拟新增）

```text
servers/imMeeting.uts                  房间、令牌、预约、记录、管理 API
types/interfaces/imMeeting.uts        请求、响应、成员、轨道与状态类型
utils/meeting/meetingSession.uts      全局会话状态、互斥、生命周期
utils/meeting/meetingSignal.uts       IM 消息、3007 事件、通知意图接入
utils/meeting/meetingMedia.uts        RTC 桥接适配层
utils/meeting/meetingEntry.uts        会议号/分享链接/登录回跳解析
utils/meeting/meetingAudioFocus.uts   ASR/TTS/语音播放与 RTC 音频协调
components/im-meeting/               小窗、邀请层、成员/聊天面板、视频格子
subpackages/pages/im-meeting/         首页表单、会前、会中、详情页面
uni_modules/nuwax-livekit/            UTS 接口、Android/iOS 桥接、原生视频视图
```

会议首页内容作为轻量 pane 接入伙伴页；较重的会中/详情放分包。UI 与媒体连接分离：页面销毁/横竖屏重建/收起不应销毁正在进行的 Room。视频使用原生可绑定轨道的视图组件，原生视图嵌入方式和层叠顺序需在阶段 0 验证；不经 JS/UTS 传每帧图像。

插件统一暴露连接/离开、麦克风/摄像头、切摄像头、音频路由、共享开始/停止、轨道订阅/渲染绑定、DataChannel、attributes、连接/权限/元数据事件和能力查询。业务界面不直接持有平台 SDK 对象。

网络请求全部走 `servers/` 和既有 request 封装。设备平台复用 `imDevicePlatform()`，用户/会议/消息/文件雪花 ID 全程使用字符串。

### 5.3 三类状态来源

| 数据 | 权威来源 | 本地职责 |
|---|---|---|
| 房间、预约、角色、记录权限、云录制与文件 | nuwax-im REST / 服务端状态 | 发起命令、展示结果与有限刷新 |
| 在线轨道、说话状态、连接、权限变化、举手、会中消息 | LiveKit 事件、metadata、attributes、DataChannel | 合并为 UI 状态；重连后重建快照 |
| 会议邀请、本人跨端已处理状态 | 现有 IM 消息与 3007 事件 | 去重、相关 ID 校验、路由与 UI 收起 |

不以额外轮询代替媒体事件，不用 IM WS 承载音视频。会后详情在页面可见且任务处理中时有限轮询/退避刷新，离页即停止。

### 5.4 会话状态机

```text
idle
 └─ 发起/加入会议 → preparing → connecting → active

active ↔ reconnecting
active → leaving → ended → idle
preparing/connecting → 失败/取消 → 释放资源 → ended
```

收起/全屏、横竖屏是 UI 状态，不另建 RTC 会话。连接任务带 session generation，异步回包和原生事件必须与当前会话匹配；退会/换账号后到达的旧事件不得重新打开摄像头或重进会议。

### 5.5 与 PC 保持一致的实时协议

- `RoomMetadataChanged`：读取 `muteAll`、`danmaku`、主持信息等；入会时也先读取快照。
- 权限变更、TrackPublished/Unpublished/Muted、成员增减和说话人事件：更新对应成员与轨道。
- 举手：participant attributes `handRaised='1'`，放下用空字符串。
- 聊天 topic `meeting-chat`，弹幕 topic `danmaku`；可靠发送 UTF-8 JSON `{text,name}`，文字上限与 PC 的 120 保持一致；本地发送成功后补一次本地展示，避免 SDK 不回传自己的消息。
- 会中聊天当前为房内实时数据，不承诺离线补拉、历史持久化和会后可读；如需保存应增加服务端能力。
- 邀请链接优先 `shareSlug`，保留旧会议号链接兼容；slug 是分享定位信息，不是主持人凭据。

## 6. 移动端必须补齐的系统能力

### 6.1 音频、后台与中断

Android 按系统版本配置音视频前台服务、会议进行中通知、通知操作及必要权限；iOS 配置会议音频会话与相应后台音频能力。后台保留用户明确加入的会议音频会话，摄像头退后台按系统限制关闭/暂停，返回后不意外自动恢复采集。

统一处理蓝牙/有线耳机插拔、扬声器与听筒、音频焦点、电话来电/系统中断和网络变化。入会前结束冲突的语音输入/录音，暂停 TTS 和语音消息播放；退会恢复可用的音频环境，但不自动重启录音。

现有 iOS 麦克风/相机权限说明只描述 AI 输入、拍照扫码，并声明不会后台使用麦克风。会议上线前须同步改为包含用户主动参加音视频会议和会中后台音频的真实用途；相关发布说明与隐私说明也要同步，不能只加 SDK。

### 6.2 屏幕共享

- Android：系统 MediaProjection 授权、共享生命周期与前台服务；处理系统停止共享、锁屏与重启授权，不保存/复用一次性授权票据。
- iOS：验证 ReplayKit Broadcast Upload Extension、App Group、签名/Provisioning、主 App 与扩展通信以及 LiveKit 发布。仅能共享 App 内画面的方案不能算作“全屏共享完成”。
- 观看共享须优先完成 Android/iOS 与 PC 互通；发布共享也是最终对齐项，按平台授权交互实现。
- 系统音频共享作为独立能力探测和测试，不承诺所有设备、所有 App 声音均可采集。
- 多人同时发起共享时的仲裁按当前服务器实际能力联调确认；若需独占，必须由服务端约束，不能仅靠本地发现有人共享后隐藏按钮。

### 6.3 会议邀请与推送

会议模块分别验收“App 前台显示会议邀请”“后台通知点击进入会前页”“已在会时后台保持会议音频”。不处理锁屏系统来电、接听按钮、CallKit/PushKit 或 Android 全屏来电，这些属于独立通话模块。

首批主流程覆盖前台会议邀请与后台通知承接，通知意图关联邀请消息、会话和会议标识；点击先登录/恢复会话，再核验会议状态，不能按陈旧推送自动入会。

现有 IM 推送有 uid 级在线判断风险：同账号 PC 在线可能导致手机后台被当作在线而不推送。会议通知发布前须在最新 `nuwax-im` 核验该逻辑；若仍存在，先补设备级 presence 与路由，不能依赖客户端不退后台解决。

### 6.4 小窗、性能与安全

- 默认做应用内小窗/会议条，不索要 Android 悬浮窗权限；系统 PiP 属增强能力。
- 只为可见视频/主舞台维持高质量订阅，离屏降级；共享优先保证可读性，弱网可手动关闭视频保持音频。
- 原生 Room 在进后台后自行维持媒体，不能依赖 UTS 定时器存活；回前台补齐状态快照。
- LiveKit token 仅在内存交给 SDK，不落日志、埋点与持久化；下载/播放 URL 到期重新现签，账号切换清理私有缓存与下载任务。
- 主持人权限始终由服务端验证；客户端默认关闭游客并显式传值，不能依赖服务端省略字段的默认值。

### 6.5 三端技术可行性评估（2026-11-09）

结论不是“三端可以同一套代码直接做完”，而是：**Android、iOS 技术路线成立，可以进入原生 PoC；鸿蒙的系统能力基本具备，但当前缺少可确认维护的 LiveKit 客户端和本仓可用的鸿蒙自定义基座链路，只能判定为条件可行、高风险，不能承诺与 PC/双端同期对齐。**

| 能力 | Android | iOS | 鸿蒙 App | 判定 |
|---|---|---|---|---|
| LiveKit 房间/音视频/DataChannel | 官方 Android SDK | 官方 Swift SDK | 官方客户端列表未提供 HarmonyOS；不能直接复用 Android AAR | Android/iOS 可做；鸿蒙阻塞 |
| UTS 接入第三方 SDK | 支持 Maven/AAR 和 Android 原生代码 | 支持 CocoaPods/XCFramework/Swift 原生代码 | 支持 ArkTS、HAR/SO 和原生组件扩展 | 桥接机制本身可行 |
| 原生视频渲染 | UTS 原生组件承载 SDK 视频 View | UTS 原生组件承载 SDK 视频 View | 平台可做原生组件，但缺少已验证 RTC 轨道实现 | 双端 PoC 必测；鸿蒙待定 |
| 麦克风/摄像头 | 系统运行时权限；前台服务受版本限制 | 系统隐私授权；需协调 AVAudioSession | 系统用户授权可用 | 三端 OS 均有能力 |
| 后台保留会议音频 | 前台服务 + 常驻通知 | `UIBackgroundModes=audio` + 活跃音频会话 | VOIP 长时任务 + `KEEP_BACKGROUND_RUNNING` | 均需真机功耗/中断验证 |
| 蓝牙/耳机/扬声器 | Android 12+ 设备选择涉及 `BLUETOOTH_CONNECT` | AVAudioSession 路由/蓝牙模式 | AudioRoutingManager 等平台能力 | 均需做共享音频协调层 |
| 观看屏幕共享 | 订阅远端共享轨道 | 订阅远端共享轨道 | 取决于 RTC 客户端能否订阅/解码 | 双端可做；鸿蒙待定 |
| 发布整机屏幕共享 | MediaProjection + `mediaProjection` 前台服务 | ReplayKit Broadcast Upload Extension；仅 App 内共享不能替代 | AVScreenCapture 有系统能力，但仍需接到 LiveKit 发布轨道 | Android 可做；iOS 有打包风险；鸿蒙阻塞 |
| 现有自定义基座 | Android 本地链路已存在 | iOS 真机/模拟器本地链路已存在 | `make base-harmony` 当前明确未实现 | 鸿蒙工程链路阻塞 |
| 总体风险 | 中 | 中高（主要是屏幕共享扩展和音频会话） | 高 | 首批只承诺 Android/iOS |

#### Android 兼容性与权限

1. RTC 插件通过 Maven/AAR 接入 LiveKit；正式 SDK 当前最低 Android API 为 21，本仓已有原生插件最低版本在 21/26 两档，版本维度没有明显硬冲突，但必须在阶段 0 锁定 LiveKit 版本、传递依赖、ABI、R8/ProGuard 和包体增量。
2. 需要由会议插件的 `AndroidManifest.xml` 合并声明并按系统版本运行时申请：`RECORD_AUDIO`、`CAMERA`、`FOREGROUND_SERVICE`、`FOREGROUND_SERVICE_MICROPHONE`、`FOREGROUND_SERVICE_CAMERA`、屏幕共享时的 `FOREGROUND_SERVICE_MEDIA_PROJECTION`；Android 13+ 建议申请 `POST_NOTIFICATIONS`，Android 12+ 主动枚举/切换蓝牙通信设备时处理 `BLUETOOTH_CONNECT`。
3. Android 14+ 对摄像头/麦克风前台服务应用“使用中权限”限制：必须在 App 可见、用户明确点击入会/开麦/开视频时启动，不能收到后台推送后静默开启媒体。已开始的会议退后台时以持续前台服务和通知承接；摄像头后台行为按系统限制暂停，不能承诺后台继续录像。
4. MediaProjection 每次共享都走系统授权，并在授权后启动 `mediaProjection` 类型前台服务；用户从系统停止、锁屏、进程重启、授权失效都要产生明确的“共享已停止”事件。不能缓存授权结果跨次使用。
5. 当前 `manifest.json` 的 `app-android` 区域没有会议前台服务相关声明；相机/录音声明出现在兼容的 `app-plus` 区域，不能据此认定 uni-app x 原生插件的完整权限已经就绪。以最终合并后的 APK Manifest 为验收对象。

#### iOS 兼容性与权限

1. LiveKit Swift 当前支持 iOS 13+，本项目部署目标为 iOS 15，最低版本可兼容。接入可走 CocoaPods 或 XCFramework；需要验证真机/模拟器 slice、Swift 运行库、隐私清单和最终包体。
2. `NSMicrophoneUsageDescription`、`NSCameraUsageDescription` 必须覆盖“用户主动参加音视频会议”；当前文案明确写着不会后台使用麦克风，与会议后台音频的真实行为冲突，上线前必须修改。拒绝麦克风后允许仅收听；拒绝相机不影响语音入会。
3. 本仓已经声明 `UIBackgroundModes: audio`，但这只提供后台音频运行条件，不代表 RTC 自动正确。会议插件必须统一管理 AVAudioSession category/mode、扬声器/听筒、蓝牙、耳机、来电/闹钟/Siri 中断，并与现有 PCM 录音、TTS、语音消息播放模块互斥。不能让多个模块各自 `setActive`。
4. 整机屏幕共享按 ReplayKit Broadcast Upload Extension 验证：主 App、扩展、App Group、签名与 Provisioning、进程间传输、LiveKit 共享轨道发布缺一不可。LiveKit 的默认 in-app capture 只共享本应用画面，不能算 PC 功能对齐。
5. DCloud 文档说明 HBuilderX 4.61+ 云端打包可随 UTS 插件带入原生 `.appex` 扩展；但本仓现有离线自定义基座流程没有证明可自动组装 Broadcast Extension。阶段 0 必须分别验证“开发调试基座”和“正式发行包”，否则 iOS 共享发布不能排进承诺工期。

#### 鸿蒙兼容性与权限

1. HarmonyOS 的 CAMERA/MICROPHONE 用户授权、VOIP 长时任务、音频路由和 AVScreenCapture 屏幕采集均有平台 API；当前目标 API 20 高于 VOIP 长时任务要求的 API 13，因此系统能力不是主要阻塞点。
2. 当前最大问题是 RTC 客户端：LiveKit 官方客户端 SDK 列表包含 Android、Swift、Web、Flutter、React Native、Unity 等，但没有 HarmonyOS；LiveKit C++ SDK也未把 HarmonyOS 列为已支持平台。自行把 libwebrtc/LiveKit 协议移植到鸿蒙属于独立原生 RTC 项目，不是普通 UTS 桥接工作。
3. DCloud 的鸿蒙 UTS 插件可以调用 ArkTS、集成 HAR/SO 并扩展原生组件，本仓也已有录音、播放、支付、BLE 等鸿蒙原生实现。这证明“能写鸿蒙原生插件”，不能证明“已有可用的 LiveKit 轨道、编解码、AEC、网络重连实现”。
4. 当前 PCM 插件只声明了 `MICROPHONE` 和 `KEEP_BACKGROUND_RUNNING`；会议还需补 CAMERA 权限、VOIP 长时任务声明/通知、屏幕采集授权流程和 RTC 网络能力。权限申请必须在用户明确操作时触发，永久拒绝后跳系统设置，不能冷启动连续弹窗。
5. 仓库的鸿蒙本地自定义基座仍是占位：`make base-harmony` 会直接失败。即使找到 RTC SDK，也必须先补齐 SDK 依赖注入、原生组件、签名、真机调试和发行包构建链路。
6. 可考虑用鸿蒙 Web 组件 + LiveKit JS 做“前台基础入会”探索，因为系统 Web 组件有 WebRTC 能力；但后台音频、系统路由、整机共享、原生小窗和性能均需另验，不能把这个降级方案计为三端功能对齐。

#### 当前基础设施阻塞项

- PC 分支的 101 测试环境当前返回 `ws://192.168.31.101:7880`。这是私网明文地址：公网/蜂窝设备不可达，iOS ATS 和 Android 明文流量策略也会带来额外限制。阶段 0 前必须提供移动真机可达的公网 `wss://` 地址，不能以放开明文例外作为正式方案。
- 自建 LiveKit 还必须验证 TURN：优先 UDP，企业网/校园网/蜂窝受限场景需要 TCP/TLS 兜底，并开放实际媒体端口范围。只在同一 Wi-Fi 直连成功不构成上线依据。
- 当前本机 HBuilderX 为 5.34，而自定义基座维护文档和离线 SDK 默认仍为 5.15。原生 SDK、UTS 编译器与基座版本必须一致；在版本统一并重打基座前，任何“插件能编译”的结论都不可复现。

#### 阶段 0 必做 PoC 与 Go/No-Go

1. **基础设施门槛**：公网 WSS、TURN/UDP/TCP/TLS 和测试账号就绪；Wi-Fi、蜂窝、禁 UDP 网络三种条件均能入会。未满足则不开始估算 UI 完整开发工期。
2. **Android 门槛**：UTS 插件可重复打包；与 PC 双向音视频、DataChannel、原生视频 View、后台 30 分钟音频、蓝牙切换、MediaProjection 发布/观看均通过；Android 12、13、14+ 各至少一台真机。
3. **iOS 门槛**：UTS 插件可重复打包；iOS 15+ 真机与 PC 双向音视频、后台 30 分钟音频、音频中断恢复通过；Broadcast Extension 在开发包和发行包都能发布整机共享。扩展打包不通过时，必须把 iOS“发布共享”单列阻塞，不得以仅观看共享替代。
4. **鸿蒙门槛**：先做两周内可终止的技术尖峰，只验证四件事：可维护 RTC 客户端来源、连接当前 LiveKit、原生视频渲染、后台音频。任一核心项无可靠路径即 No-Go，鸿蒙只开放会议列表/预约/记录等非媒体能力；不启动全量 UI 复制。
5. **共同门槛**：连续入退会、横竖屏、前后台、Wi-Fi/蜂窝切换不会残留摄像头/麦克风；与现有 ASR/TTS/聊天录音互斥；PC/Android/iOS 三方和共享轨道互通。

本评估不包含单聊/群聊通话入口、呼叫状态机、来电页、CallKit/PushKit 或 Android 全屏来电；这些能力不作为会议 PoC 的通过条件。

## 7. 接口复用与后端工作

基础前缀：`/api/instant-message/meetings`。以下均已在本次 PC 分支找到对应 Controller；实际部署是否开启仍需联调检查。

| 业务 | 现有接口 |
|---|---|
| 创建 / 结束房间 | `POST /rtc/rooms`；`DELETE /rtc/rooms/{room}` |
| 本人令牌 / 续签 | `POST /rtc/rooms/{room}/tokens`；`POST /rtc/rooms/{room}/tokens/refresh` |
| 成员 | `GET /rtc/rooms/{room}/participants` |
| 静音 / 移出 / 权限 | `POST /rtc/rooms/{room}/participants/{target}/mute`；`DELETE /rtc/rooms/{room}/participants/{target}`；`PATCH /rtc/rooms/{room}/participants/{target}/permissions` |
| 全员静音 / 会中开关 | `POST /rtc/rooms/{room}/mute-all`；`PATCH /rtc/rooms/{room}/settings` |
| 录制 | `POST /rtc/rooms/{room}/recordings`；`DELETE /rtc/rooms/{room}/recordings/{egressId}`；`GET` 对应任务/列表 |
| 预约 / 取消 | `POST /schedules`；`DELETE /schedules/{meetingId}` |
| 记录 / 详情 / 删除 | `GET /?beforeId=...&limit=...`；`GET /{meetingId}`；`DELETE /{meetingId}` |
| 播放 / 下载现签 | `GET /{meetingId}/files/{fileId}/url`，区分 `playUrl` 与 `downloadUrl` |
| 游客状态 / 令牌 | `GET /public/rooms/{room}`；`POST /public/rooms/{room}/guest-token` |

`target` 对登录成员可用 userId，游客用完整 identity，路径编码后传输。会议邀请跨端已处理使用 `/api/instant-message/calls/meeting-invite-handled`；同前述边界，该历史路径不代表会议模块承担其它通话接口。

会议记录列表使用 `beforeId` 游标，不能仅拉第一页就宣称历史齐全；当前 PC 组件默认只取 30 条，App 应实现按接口游标加载。暂不将本地过滤当前页包装成全量会议搜索；全量搜索需要明确后端支持。

后端/部署配合清单：

| 项目 | 是否新增 / 待确认 |
|---|---|
| 房间、预约、成员管理、录制、记录、转写 | 以复用为主；验证最新分支已部署、数据库迁移及对应模块启用 |
| RTC 连接 | HTTPS/WSS、LiveKit 对外地址、TURN 与公网/蜂窝可达性；验证 UDP 不可用场景 |
| 媒体兼容 | Android/iOS/PC 的编码、分层订阅、共享轨道和 DataChannel 互通 |
| 录制/转写 | Egress、对象存储、音频抽取、转写配置与失败状态；不能只验证前端能发请求 |
| 邀请与通知 | 会议邀请推送载荷、按设备路由、会议状态校验、多端已处理状态与通知清理 |
| 深链 | 确定统一分享域名、Android App Links / iOS Universal Links 关联配置；保留现有 PC 链接可用 |
| 平台与续签 | `harmonyos` 实际支持、同平台顶替、令牌刷新与断网恢复策略；以服务端和 SDK 实际行为确定 |

## 8. 分阶段交付

以下按 1 名 Android/UTS + 1 名 iOS/UTS 开发、后端按需配合、测试并行估算。是方案阶段工作量，不是发版承诺；阶段 0 后再给正式日期。仅会议模块的 Android/iOS 主体约 5～7 周；鸿蒙需单独估算。通话模块不计入本工期。

| 阶段 | 工作与交付 | 进入下一阶段的门槛 | 参考工期 |
|---|---|---|---|
| 0 技术验证与冻结 | 两端插件最小连接、原生视频视图、PC 三方互通、后台音频、耳机路由、共享样例；鸿蒙路径调查；确认 iOS 扩展打包 | HBuilderX 可重复构建；真机媒体互通；共享扩展/后台方案有验证结果；输出 SDK 与基座选择 | 3～5 工作日 |
| 1 基础闭环 | 会议页签、发起/加入、会前、基础会中、会议邀请卡片、退出/结束、全局小窗 | PC 与 Android/iOS 互相发起/加入会议；导航不掉会；重复邀请不误触发 | 6～8 工作日 |
| 2 PC 功能对齐 | 服务端预约、游客/深链、成员治理、五种布局、聊天/弹幕/举手、共享收发 | 逐项通过 §2.1 功能表；权限、跨端状态一致；共享收发真机可用 | 7～10 工作日 |
| 3 会后闭环 | 云录制、记录列表/详情、音视频回放、下载、转写、删除与跨入口刷新 | 未录制会议也能看到应有记录；异步状态不假报完成；权限与删除语义正确 | 4～6 工作日 |
| 4 稳定性与发布 | 后台/锁屏、蓝牙与来电中断、弱网/切网、温升/内存、包体与自定义基座、灰度和回归 | §9 验收完成；可关闭会议入口；现有 IM/ASR/TTS/推送无回归 | 5～7 工作日 |
| 独立里程碑 鸿蒙 | 兼容 SDK/协议、原生视图、后台与共享、完整功能回归 | 不仅 REST 可调，还须实际媒体与系统能力通过 | 路径验证后估算 |

阶段 1 是内测闭环，不代表“功能已对齐 PC”；Android/iOS 会议对齐验收必须包括阶段 2～4。单聊/群聊通话及系统来电由独立方案验收。

## 9. 验收标准

### 9.1 功能和权限

- PC 创建 → Android/iOS 加入；Android/iOS 创建 → PC 加入；三方语音、视频、共享互通。
- 预约跨端可见、受邀人收到邀请、开始不换会议号/链接；取消、未开始/结束状态正确。
- 会议邀请加入/忽略、离线补拉不重复弹层；本人多端处理后其余端收起邀请面板。
- 相同平台席位顶替有明确提示；一场会议不会因重复点击连接两次。
- 主持人静音/全员禁言/单独放行/收回/移出在 PC/App 交叉操作一致；游客不可越权，普通用户不能散会/录制。
- 权限被拒时可按能力收听；不开摄像头不采集；关闭视频不残留最后一帧。
- 聊天、弹幕开关和举手两端互通；重连后恢复可获取的当前状态，不凭空补造历史消息。
- 会议收起/切页面/横竖屏后继续；主持人“仅退出”不散会，“结束”让所有端退出。

### 9.2 录制和会后

- 音频、合成视频各验证一轮启动/停止/最终文件，录制状态对全员可见；端上离开不错误停止服务端任务。
- 录制中/收尾中/失败/无录制/转写中/转写失败分别展示；转写未启用时有合理空态。
- 回放可拖动并切横屏；下载走 attachment、播放走 inline；URL 过期可重新现签；不会暴露存储内部地址。
- 主持人删除影响全体、参会人删除仅自己；列表、聊天记录入口与详情保持一致，进行中不能删。

### 9.3 系统与性能

- Android/iOS 真机：锁屏、退后台、回前台、来电打断、耳机插拔、蓝牙路由、权限从系统设置恢复。
- Wi-Fi ↔ 蜂窝切换、短断网、TURN 中继、token 更新；区分重连与已终止，超时后明确提示可手动再加入。
- 建议建立可测目标：受控稳定网络下连接耗时 P95 ≤ 5 秒，短断网恢复网络后 P95 ≤ 10 秒；阶段 0 测得基线后冻结网络条件和阈值。
- 2/4/9 人可见视频、较大房间分页、连续音视频会议至少 60 分钟；记录温升、帧率、CPU/内存/耗电，低端机阈值按阶段 0 数据设定，不先承诺未经测量的最大人数。
- 连续进入/退出与小窗恢复，不残留麦克风占用、摄像头、Room、视频视图和后台通知。
- 已有 IM 消息、联系人、未读、推送、ASR/TTS、聊天语音、终端录音/纪要功能回归。

测试组合至少覆盖 Android ↔ PC、iOS ↔ PC、Android ↔ iOS、游客 Web ↔ App、同账号 PC + 手机。原生媒体以真机为准；自动化覆盖状态机、邀请时效/去重、ID/链接解析与权限判据，避免以 UI 单测替代真实互通。

## 10. 构建、产品线与发布

该能力属于通用 IM，业务模块按当前跨端需求线 `feat-2026.11` 开发，避免引入桌搭专属业务依赖。原生插件会要求含 SDK 的自定义基座，不能把“原先能跑官方基座”当作会议 SDK 也可用。

会议入口按“服务端可用 + 当前平台能力 + 本包包含插件”控制；官方通用基座缺少媒体能力时应保持可编译、提供明确不可用提示。需在阶段 0 冻结开源 basic 线维持官方基座的构建隔离方式，以及桌搭/带会议包的插件包含方式；不得为会议强行把 basic 线改为依赖桌搭基座。

所有平台通过 HBuilderX 构建验证。UTS 原生 SDK/权限/扩展发生变化后重打基座，业务 `.uvue/.uts` 变更沿用热更新流程。iOS 真机与模拟器分别管理依赖与产物，ReplayKit 扩展必须纳入正式包和签名校验。

灰度先开放 Android/iOS 已验能力，按平台/版本回退入口。关闭入口不应突然终止已经开始的会议。后续提交/合并按仓库约定同步两个托管端；本次只落方案文件，不提交、推送或修改业务代码。

## 11. 开发启动前的决策建议

| 决策 | 建议默认值 | 需要冻结的原因 |
|---|---|---|
| 首批平台 | Android + iOS；鸿蒙先验证后独立排期 | 原生 SDK、后台和共享接入路径不同 |
| 媒体路线 | UTS + LiveKit 原生 SDK | 保持 PC 后端不变，满足原生系统能力 |
| 会议入口 | 伙伴第三页签 + 会议邀请/记录卡片 | 贴合现有信息结构，不增加聊天页单聊/群聊通话入口 |
| 初始媒体 | 默认语音、摄像头关、游客关；开麦遵从会前选择/权限 | 与 PC 默认体验对齐并避免双端回声 |
| 共享范围 | Android/iOS 全屏共享与观看均为最终范围 | iOS 扩展必须提前验证，不能拖到最后发现无法打包 |
| 会后能力 | 录制/回放/转写；不自动扩 AI 纪要 | 对齐已有接口，避免混用 Vox 纪要 |
| 产品线与包 | 通用业务共用，原生媒体按包能力隔离 | 保留 basic 官方基座约束，支持含会议 SDK 的发布包 |

以上为建议方案，不视作用户已经确认的产品取舍。评审通过后先进入阶段 0，再根据双端原生验证结果冻结排期和详细 UI。

## 12. 代码依据

PC 侧均位于相邻仓库 `nuwax-im` 的 `feat-video-meeting@fb880f2`：

- `nuwax-im-web/src/components/MeetingPane.tsx`：会议入口、服务端预约、列表、发起/加入。
- `nuwax-im-web/src/store/meetingInvite.ts`：会议邀请发送与处理。
- `nuwax-im-web/src/components/MeetingRoomView.tsx`、`CallOverlay.tsx`：布局、会中交互、聊天、成员管理。
- `nuwax-im-web/src/lib/livekitRoom.ts`：LiveKit 事件、轨道、metadata、attributes、DataChannel。
- `nuwax-im-web/src/lib/meetingParticipants.ts`、`meetingLayout.ts`、`meetingLeave.ts`、`meetingRecord.ts`：成员聚合、布局、退出、记录/删除判据。
- `nuwax-im-web/src/components/MeetingDetailDialog.tsx`、`pages/GuestMeetingPage.tsx`：回放/转写与游客流程。
- `nuwax-im-web/src/api/index.ts`、`api/types.ts`：实际客户端契约。
- `nuwax-im-modules/nuwax-im-meeting/nuwax-im-meeting-web/.../MeetingRtcController.java`、`MeetingRecordController.java`、`MeetingPublicController.java`：房间/记录/公开 API。
- `nuwax-im-modules/nuwax-im-meeting/nuwax-im-meeting-application/.../MeetingRtcApplicationService.java`、`MeetingRecordApplicationService.java`：平台席位、权限、预约、删除与生命周期。

Mobile 侧：

- [IM 请求层](../../servers/im.uts)、[WS 事件桥](../../utils/im/imWsEventBridge.uts)、[WS 客户端](../../utils/im/imWsClient.uts)。
- [伙伴页](../../pages/message/message-content.uvue)、[页头页签](../../pages/message/components/im-header-tabs.uvue)、[聊天页](../../pages/message/chat.uvue)、[App 生命周期](../../App.uvue)。
- [现有邀请承接判据](../../utils/imInviteEntry.uts)、[离线推送现状](../engineering/im-offline-push.md)、[推送 fallback 计划](../engineering/im-push-fallback-plan.md)。
- [现有权限与模块配置](../../manifest.json)、[自定义基座维护](../engineering/local-custom-base-maintenance.md)。

核实边界：本方案完成静态代码核对和 Git 更新，尚未进行 PC 实机操作、会议后端环境联调或 App 原生 SDK 试编译；“PC 代码已实现”不等于当前部署环境所有能力均可用。

## 13. 官方资料依据

- LiveKit：[客户端 SDK 列表](https://docs.livekit.io/reference/)、[屏幕共享](https://docs.livekit.io/transport/media/screenshare/)、[自建端口与防火墙](https://docs.livekit.io/transport/self-hosting/ports-firewall/)、[Swift SDK](https://github.com/livekit/client-sdk-swift)、[Android SDK](https://github.com/livekit/client-sdk-android)。
- Android：[前台服务类型和权限](https://developer.android.com/develop/background-work/services/fgs/service-types)、[MediaProjection](https://developer.android.com/media/grow/media-projection)、[Android 13+ 通知权限](https://developer.android.com/develop/ui/compose/notifications/notification-permission)。
- DCloud：[UTS 插件与 iOS Extension](https://doc.dcloud.net.cn/uni-app-x/plugin/uts-plugin.html)、[UTS 原生组件](https://doc.dcloud.net.cn/uni-app-x/plugin/uts-component.html)、[鸿蒙 UTS/ArkTS 与 HAR 依赖](https://doc.dcloud.net.cn/uni-app-x/plugin/uts-for-harmony.html)。
- HarmonyOS：[CAMERA/MICROPHONE 权限准备](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V13/camera-preparation-V13/)、[动态申请用户权限](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/request-user-authorization/)、[长时任务/VOIP](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/continuous-task/)、[AVScreenCapture](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/avscreencapture-c-basic-process/)、[AudioRoutingManager](https://developer.huawei.com/consumer/en/doc/harmonyos-references/arkts-apis-audio-audioroutingmanager/)。
