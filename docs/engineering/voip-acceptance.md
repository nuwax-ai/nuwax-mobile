# VoIP 接入验收记录

日期：2026-11-06。工作树 `mobile-voip`，分支 `feat/nuwa-basic-2026.11-voip-calls`；从双远程一致的 `feat-2026.11@5c71314ca028c580098623ba4f214d19d0cb206e` 派生。主 checkout 与已有调试基座未替换。

**当前状态：开发接入与构建验证，尚未完成三端真机验收。生产开关保持关闭。** 本文中的构建通过、浏览器测试和模拟服务结果不能替代正式后端、推送或手机验收。

## 已取得的证据

| 项目 | 结果与实际范围 |
| --- | --- |
| 状态/开发契约/媒体生命周期 | `pnpm voip:test` 31 项通过：乱序、过期、终态、多设备获胜者、账号代次、房间异步操作中挂断、凭据权限、设备 token 命名空间、取消后迟到连接、后台不启动摄像头、测试身份退出/抢登录隔离、开发凭据不转发平台 token、控制与媒体健康分别报告，以及 CID 迟到回调隔离和功能集成边界 |
| 真实 LiveKit 本地媒体 | 固定 server 1.13.11；ego-browser 中 alice→agent 媒体替身完成接听、双向合成音轨订阅、active、挂断；未申请真人麦克风，不证明模型能力 |
| Android HBuilderX | 5.34 页面/UTS/原生插件编译通过；标准基座不包含新插件，未将其当作安装包验收 |
| Android 原生依赖 | 在 worktree 忽略目录复制的 5.34 SDK 工程中生成 UTS library，`:uts-nuwax-voip:assembleDebug` 通过；LiveKit/Core-Telecom 依赖从 config 注入。未安装或替换主工作区 APK |
| iOS 原生桥 | `pnpm voip:ios:check` 通过：真实 Swift SDK 2.19.0、Swift 6、arm64/x86_64 simulator framework；最低系统 15.0，动态产物确认 LCK 为 `LC_LOAD_WEAK_DYLIB` |
| iOS HBuilderX 资源 | App 资源导出成功；完整模拟器基座验证受 5.34 模拟器标准基座缺失阻断，真机标准基座未签名。独立 framework 编译不能代替自定义基座集成与安装 |
| 专用真机安装包 | 5.34 的三页面测试工程从源码生成并经 HBuilderX 导出。Android 完整 APK 构建及团队签名校验通过；iOS 5.34 完整原生测试宿主、3 个 UTS 模块、LiveKit SDK 和开发签名构建通过，并校验 App 资源、bundleId 与 framework 嵌入。已按用户指示覆盖安装到 Redmi / iPhone 16 并启动，未卸载或清数据。首次安装时安卓实屏为隐私确认页，iOS 回读进程仍在；当时尚未执行双机通话，后续局部结果见下一项，不能等同全业务 App 或系统推送验收。详见 [真机测试说明](voip-device-testing.md) |
| Android 原生来电排查 | Redmi API 36 已收到 native SSE 邀请并进入 Telecom RINGING。新增专用原生接听 Activity、CallStyle 的独立通知目标及公共 API 权限诊断；5.34 资源导出和完整 APK 构建通过、覆盖安装成功。前台显示接听/拒接，点击拒接后权威状态为 rejected，前台服务消失，未再出现原来的 CALL_SYSTEM_UNAVAILABLE。全屏通知已允许，并经系统 UI 允许本应用锁屏显示和后台弹出。已存在来电在 Keyguard showing=true 时展示成功；完全睡眠后新邀请未观察到进入 Telecom，后台/锁屏新来电仍未通过。仅响铃检查，没有自动接听或启动音视频采集 |
| iPhone→Android 后台真实呼入，17:20 历史记录 | **当次未通过**。17:20:10 iPhone Bob 发起呼叫，服务端 ringing；安卓桌面没有通知/接听提示，用户确认未看到。系统日志记录该应用退后台被冻结；17:20:44 打开应用解冻后，17:20:45 才进入 Telecom RINGING，随后 45 秒超时。当前原生长连接不能替代厂商推送唤醒。详细时间与通道前置见 [复测记录](voip-device-testing.md#iphone--安卓后台呼入2026-11-06-1720-复测未通过) |
| iPhone→Android 后台真实呼入，18:31 复测 | **专用 Debug 开发监听条件下已接通**。真实 iPhone Bob 拨打 Redmi Alice，安卓桌面显示含接听/拒接的系统通知，18:32:13 接听、18:32:16 active、18:32:25 hangup。用户确认已通，callId `edf7a091-c570-4951-b342-9d91a38ff6c5`。开发服务 nativePush=false，厂商冷启动、锁屏长测、视频及鸿蒙继续补验。详见 [真机记录](voip-device-testing.md) |
| Harmony | HBuilderX 5.34 生成工程后，`pnpm voip:harmony:assemble` 重建 Ability、权限、推送监听与 ArkWeb 资源；ArkTS 编译、PackageHap/assembleHap 通过；产物未配置正式签名 |
| 功能聚合后的构建 | 31 项 VoIP 测试通过。完整 App 的 Android HBuilderX 编译、iOS 资源编译导出通过，鸿蒙 HBuilderX 编译及重新注入后的 assembleHap 通过（未签名）；Android/iOS 专用宿主重新构建并通过签名检查，整理版未安装复测。Android 配置另验证重复执行、旧目录迁移清理、普通构建移除测试声明、Release 拒绝启用 |
| Harmony 重复生成 | 注入脚本多次运行后无重复 Ability/页面/push listener，随后原生打包通过。不是只手改生成目录 |
| 全量 Vitest 对比 | 结构整理后 679 通过 / 37 失败（716 项）；与整理前的 VoIP 报告 674 通过 / 37 失败逐项比对，失败名称集合一致。此前未改动基线为 648 通过 / 37 失败。全量仍有原有 8 个测试文件待处理 |
| 离线 H5 脚本回归 | 18 项中 16 通过 / 2 失败；未改动基线同样因 `mobileLoginDestination` 缺失出现这两项失败，未修改该既有问题 |
| i18n 对比 | 新增通话文案进入四份词典。全仓审计仍有 22 项原有问题；未改动基线也是同样 22 项，涉及原隐私启动页和请求层 |

正式后端交接与功能归属见 [对接说明](voip-backend-integration.md)。可重复执行的入口见 [开发说明](voip-development.md)。构建日志、SDK 工作副本、生成资源、密钥和产物均在忽略目录，不提交编译产物或签名资料。

## 用户提供的 LiveKit 测试站

已用 ego-browser 查看 [livekit-test.nuwao.com](https://livekit-test.nuwao.com/) 的控制台、房间列表和前端 API：`/api/health`、`/api/rooms`、`/api/token`。页面配置展示内网 `ws://…:7880` 信令地址。尚未确认 HTTPS 页面可完成信令及双向媒体连接，也没有把这些 room/token 接口当作移动端业务 calls 接口。

仅以单独 `codex-voip-20261106-…` 身份/房间尝试无采集的传输探测，没有请求麦克风、摄像头、投屏，没有主动加入他人已有房间。探测期间浏览器被用户接管，结果未回读；后续继续时需核实连接结果并检查、清理本次探测可能留下的同名前缀自建房间。暂停期间不绕过浏览器控制权继续操作。

NW-367 推送前置仅作为用户提供的关联线索，未独立核实工单状态。该控制台能加载、能签发房间凭据都不能证明电话式来电、抢接、后台控制和锁屏接听已实现。

## 必须补完的真实环境验收

以下均仍需完成完整验收，上面的局部检查不代表整项通过。现有 Redmi 和 iPhone 16 已完成上述一轮语音呼叫，完整双向语音/视频矩阵、锁屏及冷启动继续逐项留证，尚缺鸿蒙真机。

| 类别 | 必测内容 |
| --- | --- |
| 三端交叉 | Android↔iOS、Android↔Harmony、iOS↔Harmony，各自语音与视频 |
| 系统来电 | 前台、后台、锁屏、系统回收后冷启动；主动强停单列系统限制 |
| 呼叫裁决 | 拒接、忙线、45 秒超时、主叫取消、多设备抢接、重复/迟到邀请、断线续接 |
| 权限与路由 | 首次/永久拒绝麦克风与摄像头、蓝牙/有线/扬声器切换、蜂窝电话打断 |
| 网络 | Wi-Fi/蜂窝切换、断网、重连、凭据过期、控制流 401/403 后清理 |
| 持续与释放 | 锁屏双向语音 30 分钟；挂断后无麦克风/摄像头占用、通知、FGS 或 VoIP 长时任务残留 |
| 账号 | 登出、切账号、登录刷新、旧请求返回、旧设备/旧 token 来电隔离 |
| 既有音频 | 录音取消、ASR/TTS、消息音视频与通话互斥；冷启动系统接听也要验证原生音频焦点，无旧录音自动恢复 |
| iOS 安装范围 | iOS 15–17.3 前台与普通通知；17.4+ PushKit/LCK；两种系统版本分别安装测试 |
| Harmony ArkWeb | 系统接听、锁屏持续双向音频、主 Ability 返回、媒体 Ability 生命周期、相机前后台切换和后台挂断释放 |
| 正式智能体 | 正式服务真实呼叫、正确上下文、双向语音；合成音轨不计入此项 |

## 仍需交付方配合的条件

- 正式后端按 [契约](voip-client-contract.md) 实现，补齐推送、原子抢接、房间授权、媒体事件核验和失联回收。开发服务不提供正式账号、持久化或生产可靠性保证。
- Android 分发基座的国内厂商/FCM 接收器接到 `VoipBridge.incoming()`。当前提供原生 hook 与普通 app-push 适配，**具体供应商冷启动回调尚未绑定/验收**。
- iOS/Harmony 证书、PushKit/HMS 环境、VoIP 权益和真实 token。使用正确 5.34 SDK 出隔离自定义基座，再验证安装包中的插件、权限、SPM 依赖和 native hooks。
- 确认可访问的 LiveKit 信令/TURN 地址。正式环境使用 HTTPS/WSS；不把开发 HTTP/ATS 例外带进生产。
- 发布前同步正式隐私政策/SDK 目录，说明用户主动通话中的音视频与后台麦克风用途。代码已更新权限用途描述并保留同意、登录与生产功能闸门。

在上述条件和真机矩阵通过之前，不打开生产入口、不自动合并、不部署生产。
