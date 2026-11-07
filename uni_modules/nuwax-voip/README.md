# nuwax-voip

移动端一对一电话式通话桥。当前为接入验证实现，生产入口关闭；完整验收状态见 [验收记录](../../docs/engineering/voip-acceptance.md)。

UTS 不直接持有 SDK 对象，使用 JSON 命令和事件队列隔离 Kotlin/Swift/ArkTS 类型。应用级管理器在 `features/voip/callManager.uts`。

| API / 命令 | 含义 |
| --- | --- |
| `executeVoip(json)` / `initialize` | 提交经隐私、登录与开发/验收闸门检查的会话；native scope 隔离账号代次 |
| `watch` | 接收已经查询过权威状态的快照，启动原生系统通话及控制连接 |
| `action` | accept / reject / cancel / end；权限与设备所有权再次核实 |
| `microphone` / `camera` | 用户主动采集开关；后台停止摄像头 |
| `switchCamera` | 切前后摄像头 |
| `speaker` / `audioRoute` | 扬声器、听筒；Android 可选择已发现的蓝牙/有线 endpoint，iOS 可选 HFP 输入；鸿蒙外设由系统路由选择，未知路由返回错误 |
| `background` | 页面/应用前后台同步；不关闭原生呼叫控制连接 |
| `reset` | 登出/账号切换，立即释放媒体和系统通话并尽力结束旧服务端呼叫 |
| `drainVoipEvents()` | 消费界面事件；后台运行不依赖该 polling |
| `ensureVoipPermissions(type)` | 仅在拨打/接听时申请麦克风、视频所需的摄像头权限 |
| `VoipVideoBinding(element,local)` | Android/iOS 绑定原生视频视图；Harmony 提到持有两个视频轨道的原生媒体 Ability |

事件至少含 `type/scope/callId`。快照事件为 `snapshot`，其他包括 `connected/peerMediaReady/reconnecting/localEnded/error/microphone/camera/speaker/openPage`。错误仅传稳定 code，不传带凭据的 SDK error。`connected` 仅表示本机媒体就绪；通话计时还要求权威 active 和对端媒体就绪。

Android 推送接收器的原生集成 hook 为 `com.nuwax.voip.VoipBridge.incoming(context,payload)`。当前未绑定具体厂商 SDK 的冷启动回调；不能仅凭这个 hook 声称冷启动推送验收通过。

Harmony 原生配置/媒体宿主由 `pnpm voip:harmony:assemble` 从源码重新生成，再用 DevEco 的 Node/JBR/hvigor 构建。鸿蒙锁屏持续通话及系统应答仍需厂商权益和真机验证。iOS 17.4+ LCK、PushKit 的正式签名与推送同样需要真实环境。

依赖版本锁定见 [native-versions.json](native-versions.json)；接口见 [voip-client-contract.md](../../docs/engineering/voip-client-contract.md)。
