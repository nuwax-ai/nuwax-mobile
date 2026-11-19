# IM 实时会议：三端权限、性能与兼容性清单

> 立项：2026-11-13　对应方案：[docs/integration/im-meeting-app-plan.md](../integration/im-meeting-app-plan.md)
> 适用范围：Android / iOS / 鸿蒙 App。H5 与微信小程序不纳入本轮会议媒体能力。
> 本文只写**已经在本仓库核对过的事实**与**必须做的动作**；未验证的能力一律标「待验」。

---

## 0. 一句话结论

- 三端**系统能力都有**，权限本身不构成阻塞；真正的阻塞是 **RTC 客户端**（LiveKit 无鸿蒙官方 SDK）与**基座链路**。
- Android/iOS 可以开工；**鸿蒙只能先做技术尖峰**，未通过前不开放音视频，可先开放会议列表/预约/记录（纯 REST）。
- 现有 iOS 麦克风用途文案写着「不会在后台使用麦克风」，**与会议后台音频直接冲突**，上线前必须改，不能只加 SDK 不改文案。

---

## 1. 权限总表

| 能力 | Android | iOS | 鸿蒙 |
|---|---|---|---|
| 入会（语音） | `RECORD_AUDIO`（运行时） | `NSMicrophoneUsageDescription`（系统弹窗） | `ohos.permission.MICROPHONE`（用户授权） |
| 开摄像头 | `CAMERA`（运行时） | `NSCameraUsageDescription` | `ohos.permission.CAMERA` |
| 会中保持音频 | `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MICROPHONE` + 常驻通知 | `UIBackgroundModes: audio` + 活跃 AVAudioSession | `KEEP_BACKGROUND_RUNNING` + VOIP 长时任务 |
| 后台开摄像头 | **不允许**（Android 14+ 使用中权限限制），退后台必须暂停采集 | 退后台系统限制采集 | 同左 |
| 屏幕共享（发布） | `FOREGROUND_SERVICE_MEDIA_PROJECTION` + MediaProjection 每次授权 | ReplayKit Broadcast Upload Extension + App Group | `AVScreenCapture`，尚未接到 RTC 发布轨道 |
| 会中通知 | `POST_NOTIFICATIONS`（13+ 运行时，**已声明**） | 无需额外声明（本地/远程通知授权） | 通知授权，常驻长时任务通知 |
| 蓝牙耳机切换 | `BLUETOOTH_CONNECT`（12+ 运行时，仅主动枚举/切换时） | 无需额外权限（AVAudioSession 路由） | `ohos.permission.ACCESS_BLUETOOTH`（按需） |
| 分享链接拉起 App | App Links（域名 + `intent-filter`，待配） | Universal Links（Associated Domains，待配） | `uris` scheme（已有 `nuwax://open`，会议深链待加） |

---

## 2. Android

### 2.1 现状（已核对）

- 根目录 [AndroidManifest.xml](../../AndroidManifest.xml) 目前只声明 4 个权限：`REQUEST_INSTALL_PACKAGES`、`READ_MEDIA_AUDIO`、`POST_NOTIFICATIONS`、`RECEIVE_BOOT_COMPLETED`。
- [manifest.json](../../manifest.json) `app-plus.distribute.android.permissions` 里的 `RECORD_AUDIO` / `CAMERA` 等属于**老 uni-app schema，uni-app x 云打包不读**（文件头注释与既往实测都记录了这一点）。
- 目前语音输入/录音能用，说明 `RECORD_AUDIO` 是由基座或某个原生插件合并进最终 APK 的；**会议插件不能依赖这条隐式链路**，必须自己声明并在最终 APK 上核对。

### 2.2 会议插件必须声明（写在 `uni_modules/nuwax-livekit/utssdk/app-android/AndroidManifest.xml`）

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_CAMERA" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" />
```

同时声明会议前台服务：

```xml
<service
    android:name=".MeetingForegroundService"
    android:foregroundServiceType="microphone|camera|mediaProjection"
    android:exported="false" />
```

### 2.3 申请时序（★顺序错了会被系统直接拒绝）

1. **用户明确点击「加入/开始会议」之后**才申请 `RECORD_AUDIO`（Android 14+ 对麦克风/摄像头前台服务有「使用中权限」限制，后台推送到达时静默开麦会被拒）。
2. 用户点「开摄像头」时才申请 `CAMERA`；拒绝不影响语音入会。
3. 入会成功后再启动前台服务与常驻通知（`POST_NOTIFICATIONS` 已声明，仍需运行时请求，拒绝则只影响通知显示，不能拦入会）。
4. 屏幕共享：**每次**发起都走 `MediaProjection` 系统授权，授权成功后再启动 `mediaProjection` 类型前台服务；不缓存、不复用授权结果。用户从系统停止/锁屏/进程重启都要派生「共享已停止」事件。
5. `BLUETOOTH_CONNECT` 只在**主动枚举/切换蓝牙设备**时申请（Android 12+），不在入会时无条件弹。

### 2.4 Android 兼容性要点

| 版本 | 约束 |
|---|---|
| Android 12 (31) | 蓝牙设备切换需要 `BLUETOOTH_CONNECT` 运行时授权 |
| Android 13 (33) | 通知需要 `POST_NOTIFICATIONS` 运行时授权 |
| Android 14 (34) | 麦克风/摄像头前台服务必须由**可见的前台交互**启动；退后台继续采集会被系统暂停 |
| Android 15+ (35) | 前台服务启动时机进一步收紧，退后台再拉起 FGS 会抛 `ForegroundServiceStartNotAllowedException` |

- LiveKit Android SDK 最低 API 21，与本仓已有原生插件（21/26 两档）无硬冲突；**但必须在阶段 0 锁定版本、传递依赖、ABI 与 R8 规则**，并测包体增量。
- 验收对象是**最终合并后的 APK Manifest**（`aapt2 dump permissions`），不是源文件。

---

## 3. iOS

### 3.1 现状（已核对）

- [manifest.json](../../manifest.json) `app-ios.distribute`：`deploymentTarget = 15.0`，已声明 `UIBackgroundModes: ["audio"]`。
- 麦克风文案现为：「麦克风仅用于您主动使用语音输入时录制音频……**App 不会在后台或您未主动录音时使用麦克风**。」
- 相机文案现为：「相机仅用于您主动拍摄照片或扫描设备二维码时使用……App 不会在后台启动相机」。

### 3.2 必须改的文案（★上线阻断项）

会议上线后，后台保留音频是**真实行为**，上面两句直接与事实冲突，属于审核与隐私合规风险。建议改为：

```text
NSMicrophoneUsageDescription:
麦克风用于您主动使用语音输入，以及您主动加入的语音/视频会议中采集语音。
会议进行中退到后台时，为保持通话不中断会继续使用麦克风，退出会议即停止。

NSCameraUsageDescription:
相机用于您主动拍摄照片、扫描二维码，以及您主动加入的视频会议中采集画面。
App 不会在您未操作时启动相机；会议退到后台时摄像头会停止采集。
```

同步需要更新：App Store 隐私说明（麦克风/相机用途）、发布说明、以及 `docs/appstore/` 下的提审审计文档。

### 3.3 音频会话（AVAudioSession）边界

- 本仓已有多个音频使用者：PCM 录音（ASR）、TTS、语音消息播放、`BackgroundAudioManager`（语音锁屏续播）。
- 会议插件必须**统一管理** category/mode/active，禁止各模块各自 `setActive`。入会前：结束语音输入、暂停 TTS 与语音播放；退会：恢复可用环境但**不自动重启录音**。
- 中断处理：来电、闹钟、Siri、其他 App 抢占 → 收到中断通知后暂停采集并在结束时恢复；路线变化（耳机插拔/蓝牙）需要即时切换并给 UI 反馈。

### 3.4 屏幕共享（发布）

- 整机共享必须用 ReplayKit Broadcast Upload Extension：主 App + 扩展 + App Group + 签名/Provisioning + 进程间传输 + LiveKit 共享轨道发布，缺一不可。
- LiveKit 默认 in-app capture 只共享本应用画面，**不能算 PC 功能对齐**。
- HBuilderX 4.61+ 云端打包支持随 UTS 插件带 `.appex`，但本仓离线自定义基座流程**尚未验证**能自动组装扩展 → 阶段 0 必须分别用「调试基座」和「正式发行包」各打一次。
- 若扩展打包不通：iOS「发布共享」单独列为阻塞项，**不得**用「只能观看」冒充完成。

---

## 4. 鸿蒙

### 4.1 现状（已核对）

- [harmony-configs/entry/src/main/module.json5](../../harmony-configs/entry/src/main/module.json5) 已声明：`INTERNET`、`VIBRATE`、`KEEP_BACKGROUND_RUNNING`（`audioPlayback` 长时任务）、`APP_TRACKING_CONSENT`、`WRITE_IMAGEVIDEO`。
- **缺**：`MICROPHONE`、`CAMERA`、蓝牙相关权限，以及 VOIP 长时任务声明。
- 目标 API 为 `6.0.0(20)`，高于 VOIP 长时任务要求的 API 13，系统能力不是阻塞点。

### 4.2 需要补的声明

```json5
{ "name": "ohos.permission.MICROPHONE",
  "reason": "$string:nuwax_meeting_mic_reason",
  "usedScene": { "abilities": ["EntryAbility"], "when": "inuse" } },
{ "name": "ohos.permission.CAMERA",
  "reason": "$string:nuwax_meeting_camera_reason",
  "usedScene": { "abilities": ["EntryAbility"], "when": "inuse" } }
```

并在 `EntryAbility.backgroundModes` 增加 `voip`（长时任务需要同时在 `module.json5` 的 `requestPermissions` 里配 `KEEP_BACKGROUND_RUNNING` 的 `usedScene`）。

### 4.3 鸿蒙的真实阻塞（不是权限）

1. **没有可维护的 RTC 客户端**：LiveKit 官方客户端列表无 HarmonyOS，C++ SDK 也未列鸿蒙。自行移植 libwebrtc 属于独立原生项目，不是 UTS 桥接工作量。
2. **本地自定义基座链路未打通**：`make base-harmony` 当前直接失败，即使拿到 SDK 也没有可重复的打包/调试路径。
3. 可探索的降级：鸿蒙 `Web` 组件 + LiveKit JS 做「前台基础入会」（系统 Web 有 WebRTC），但后台音频、系统音频路由、整机共享、原生小窗均需另验，**不能计入三端对齐**。

→ 结论：鸿蒙先把 REST 能力（会议列表、预约、详情、回放）开放并如实标注「本端暂不支持音视频」，媒体能力等尖峰结果。

---

## 5. 运行时申请顺序（三端统一）

```
点击「加入会议」
  └─ 系统权限：麦克风（必需）/ 摄像头（用户点开视频时才要）
      ├─ 拒绝麦克风 → 允许「仅收听」入会（不拦）
      └─ 拒绝摄像头 → 不影响语音入会
  └─ 连接 RTC → 成功后才起前台服务/常驻通知（Android）/ 激活音频会话（iOS）
  会中「共享屏幕」 → 每次系统授权（Android MediaProjection / iOS ReplayKit）
  退会 → 停采集 → 停前台服务/通知 → 释放音频会话（不重启其他模块的录音）
```

硬规则：

- **永不在冷启动连续弹权限**；永久拒绝后引导到系统设置。
- 推送到达时**不静默开麦/开摄像头**（Android 14+ 会直接失败，iOS 也会被系统记异常）。
- 权限状态变化（用户从系统设置恢复）需要可重新尝试，不要求重启 App。

---

## 6. 性能预算与约束

| 项 | 约束 | 判据 |
|---|---|---|
| 视频订阅 | 只对**可见**格子维持高质量订阅；离屏降级或退订 | 2/4/9 人场景 CPU 与解码数不线性上涨 |
| 宫格分页 | 竖屏每页 ≤4 路可见，横屏/大屏 6~9 路 | 每页可见数不改变成员管理完整性 |
| 布局重排 | 只在「人数/共享结构」变化时重排；说话切换加稳定窗口（防抖） | 不出现画面频繁跳动 |
| 渲染路径 | 视频走**原生视图**绑定轨道，绝不 JS/UTS 逐帧传图 | 无每帧跨语言拷贝 |
| 后台 | Room 由原生层自持，不依赖 UTS 定时器存活；回前台补状态快照 | 后台 30 分钟音频不中断、回前台状态一致 |
| 音频互斥 | 与 ASR/TTS/语音播放/录音共享协调层 | 入会后不再有第二个模块抢麦或改 AudioSession |
| 网络 | 弱网可手动关视频保音频；区分「重连中」与「已终止」 | 连接 P95 ≤5s，短断网恢复后 P95 ≤10s（阶段 0 基线冻结） |
| 内存/温升 | 连续会议 ≥60 分钟 | 记录温升、帧率、CPU/内存，低端机阈值按阶段 0 实测设定 |
| 包体 | LiveKit SDK + webrtc 会显著增大包体 | 阶段 0 量出增量后再决定是否分渠道包 |

UI 侧通用约束（与本仓既有约定一致）：触控区 ≥44pt/48dp、适配安全区/横屏/长昵称/大字号/多语言；视频格子与消息列表都遵循「局部渲染」原则，避免页面级 tick 触发整页重渲。

---

## 7. 现状差距与落地顺序

| # | 动作 | 阻塞级别 |
|---|---|---|
| 1 | 公网可达的 `wss://` LiveKit 地址 + TURN（UDP/TCP/TLS） | **P0，没有它无法做任何真机验证**（PC 分支当前为私网 `ws://192.168.31.101:7880`） |
| 2 | HBuilderX 版本与离线 SDK 统一（方案写 5.34 vs 文档默认 5.15） | P0 |
| 3 | Android 插件 + 前台服务 + 权限声明，最终 APK 核对 | P0 |
| 4 | iOS 插件 + AVAudioSession 统一 + 后台音频 | P0 |
| 5 | iOS 麦克风/相机文案与隐私说明改写（§3.2） | P1，**上线阻断** |
| 6 | ReplayKit 扩展打包验证（调试基座 + 发行包） | P1，不通则 iOS 发布共享单列阻塞 |
| 7 | 鸿蒙 RTC 尖峰（两周期限，四件事：客户端来源/连通/原生渲染/后台音频） | P1，No-Go 则只开 REST |
| 8 | App Links / Universal Links / 鸿蒙 scheme 深链 | P2 |

---

## 8. 验证方式

- Android：`aapt2 dump permissions unpackage/debug/xxx.apk` 核对合并后权限；真机覆盖 Android 12 / 13 / 14+ 各一台。
- iOS：真机（非模拟器）验证麦克风/相机授权文案与后台音频；扩展分别在调试基座与发行包验证。
- 鸿蒙：真机验证授权弹窗时机与长时任务通知。
- 三端共同：连续入退会、横竖屏、前后台、Wi-Fi↔蜂窝切换后不残留麦克风/摄像头/Room/通知。
