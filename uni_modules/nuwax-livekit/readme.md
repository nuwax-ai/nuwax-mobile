# nuwax-livekit

会议 RTC 桥接：**Android / iOS 接 LiveKit 原生 SDK**，**鸿蒙留逻辑占位**（后续基于自研 LiveKitClient）。

媒体连接与设备开关统一走 `utils/meeting/meetingMedia.uts`；页面仅为 `<native-view>`
的 `@init` 导入本插件的视频视图方法。

## 当前状态（2026-11-14）

| 平台 | SDK | 状态 |
|---|---|---|
| Android | `io.livekit:livekit-android:2.28.2`（Maven） | 已接线：`MeetingRoomBridge.kt` 负责连接/退房/麦克风/摄像头/音频路由/人数 |
| iOS | CocoaPods `LiveKitClient 2.19.0` | 已接线：`MeetingRoomBridge.swift` + AVAudioSession 统一管理；版本固定在 `config.json` |
| 鸿蒙 | — | 占位：`isSupported()` 恒 false |

**`isSupported()` 在 Android/iOS 返回 true** ⇒ 会中页进页即签发令牌并连房；鸿蒙/标准基座
（不含本插件）返回 false ⇒ 只展示会议信息，设备按钮提示「音视频能力接入中」。

## 接口（三端一致）

```ts
isSupported(): boolean
sdkVersion(): string
connect(serverUrl, token, room, displayName, micOn, cameraOn): void
disconnect(): void
setMicEnabled(on): void
setCameraEnabled(on): void
setSpeakerEnabled(on): void
participantCount(): number
isConnected(): boolean
```

连接状态由 `isConnected()` 和 `lastError()` 轮询；iOS 设备层失败另写原生日志。

## ★★必须重打自定义基座

含 Maven / CocoaPods 依赖的 UTS 插件**不会进标准基座**：

```bash
make app-resource        # 生成本地打包资源
make base-android        # Android 基座
make base-ios-device     # iOS 真机基座（需证书）；模拟器用 make base-ios-simulator
```

然后用 HBuilderX「运行 → 使用自定义基座运行」选 `unpackage/debug/` 下的包。

## ★★iOS 视频桥接与基座核验（2026-11-15）

- `main=` 只表示诊断调用所在线程；真机曾记录 `main=1`，不能据此断言
  `createVideoView` 在非主线程崩溃。最后一条页面日志也无法区分 Swift 构造、
  UTS 返回值桥接、`bindIOSView` 和相机采集中的哪一步出错；需要原生分段日志及 `.ips` 堆栈。
- iOS 的 `.uvue` 页面由 JS 驱动，不能直接处理原生 `UIView`。当前接口让页面把
  `UniNativeViewElement` 传给 UTS 插件，在插件内创建 `VideoView` 并调用
  `bindIOSView`；每次 `@init` 创建新的视图，避免重复绑定。UIKit 操作仍收敛到主线程。
- 2026-11-15 20:10 的闪退使用的 `iOS_debug.ipa` 生成于 **20:06:14**，而上述
  视频桥接源码直到 **20:38** 才修改；该日志不能验证新桥接。旧 IPA 仍导出
  `createVideoView() -> UIView?`。当前 Swift 诊断带 `bridge=ios-native-view-v2`；
  页面看不到该标记时禁用摄像头及原生视频视图，提示更新 App。
- 插件源码或 Pod 版本变更后必须重新制作并安装 iOS 自定义基座。复测时先确认
  `diag=` 中有 `bridge=ios-native-view-v2`，再收集 `[MeetingBridge]` 分段日志与
  iPhone 的 `.ips` 崩溃堆栈，才能确定残余崩溃点。

### 新基座探针判读

- `diag=` 必须包含 `probe=ios-camera-20261115-p1`；看不到此值说明设备没有运行本次原生代码。
- 点摄像头只提示「音视频能力接入中」时，先看 `[Meeting] isSupported returned/ threw`
  和 `[Meeting] iOS base probe`。页面会同时输出 `sup/conn/connecting/err` 与原生诊断，
  可区分插件未加载、桥接调用失败和房间未连接。
- 真正进入相机路径时，Swift `NSLog` 依次记录 `camera enter`、`camera task begin`、
  `camera permission begin/end`、`camera sdk begin/end`、`camera attach begin/end`。
  本机预览另记录 `makeLocalView: VideoView init begin/end`，UTS 另记录
  `local view -> Swift/bindIOSView/bound`。停止在哪个阶段，就针对该阶段取 `.ips`。
- `[Meeting] setCamera true <- native` 仅表示异步原生调用已提交，不能当作相机启动成功；
  以 `camera sdk end` 和 `cam=1` 为准。探针不要打印令牌或音视频内容。

## ★★iOS LiveKit 版本

当前固定使用 `LiveKitClient 2.19.0`。该版本已包含 `2.10.2` 引入的 `VideoView`
零尺寸崩溃修复：`2.10.1` 在视频尺寸尚未就绪、宽高同时为 0 时可能崩溃；会中页在用户
开启摄像头后会立即创建并绑定渲染视图，正好会命中该窗口。LiveKit `2.15+` 要求
Swift 6.1 / Xcode 16.3+；当前本机 Xcode 26.6 工具链满足要求。
修改版本后必须重新打 iOS 自定义基座，业务资源热更新不会替换原生 Pod。

## 已实现的细节（改代码前先读）

- **麦克风权限**：入会时申请；摄像头只在 `cameraOn=true` 时申请。**拒绝麦克风不阻断入会**（可仅收听），与 PC 口径一致。
- **入会即开麦**：在 SDK `connect` 成功后由原生侧执行（UTS 侧不能在连接前调，会失败）。
- **音频输出**：Android 用 `AudioManager`（`MODE_IN_COMMUNICATION` + `isSpeakerphoneOn`），离开时复位 `MODE_NORMAL`；iOS 用 `AVAudioSession.overrideOutputAudioPort`。
- **连接状态**：Android 以 `room.connect()` 是否成功为准 + 3 秒人数轮询（`room.events` 的 `Flow.collect` 在云打包环境反复命中重载歧义，事件订阅留到下一轮）；iOS 用 `RoomDelegate`。**不在未连接时伪造 `connected=true`**。
- **单例**：一场会一个 Room，重复 `connect` 会先断开上一场；`disconnect` 只断本端不删房。

## 待办（真机联调阶段）

1. 验证自建 LiveKit 地址是手机可达的 **`wss://`**（`ws://` 私网真机进不去；iOS ATS 也会拦）。
2. **Android 事件订阅**：`room.events.collect` 的重载歧义解决后，把成员进出/重连/断开接上（替换现在的 3 秒轮询）。
3. 新版 iOS 自定义基座上的本机/远端视频真机验收，以及崩溃报告归档。
4. 屏幕共享（Android MediaProjection / iOS ReplayKit 扩展）、成员治理、DataChannel 聊天。
5. 鸿蒙：自研 LiveKitClient（见 `utssdk/app-harmony/index.uts` 文件头）。

## 不要做的事

- 不要在未连接时回调 `connected = true`（页面会显示"已在会中"）。
- 不要在冷启动或收到推送时静默拉起摄像头/麦克风（Android 14+ 会拒绝，且违反平台规范）。
- 不要把「仅退出」实现成删房（结束会议是主持人动作，走服务端 `DELETE /rtc/rooms/{room}`）。
- **不要随手给插件加新导出**：uni-app x 的 `?uts-proxy` 只认既有导出表，新加的
  `export function` 会让业务侧 import 直接编译失败（报
  `"xxx" is not exported by ...?uts-proxy`，2026-11-15 实测，清缓存重跑也不生效）。
  排查用的信息优先走「原生 `NSLog("[MeetingBridge] …")` + 业务层用现有导出拼」，见
  `utils/meeting/meetingMedia.uts` 的 `meetingMediaDebugLine`。
