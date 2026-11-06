# VoIP 专用真机测试包

本包用于 Android 和 iPhone 的一对一语音、视频联调。应用名称为 **Nuwax VoIP Test**，启动后直接进入测试页；Android 首次启动仍须完成本地隐私授权。无需登录女娲平台账号，分别选择 Alice 和 Bob 即可互拨。

**当前测试服务不发送真实厂商电话推送。** 本页的服务检测、前台来电、媒体连接和原生通话界面均不能替代 PushKit / 厂商推送 / 鸿蒙 Push Kit 的冷启动、锁屏来电验收。当前只打 Android、iOS 两种包，鸿蒙需另行真机验收。

## 使用

1. 两台手机与电脑连到允许设备互访的网络。电脑启动 `VOIP_ADVERTISE_IP=<电脑IPv4> VOIP_DEV_HOST=0.0.0.0 pnpm voip:dev`。
2. 安装对应包；当前 Android applicationId / iOS bundleId 均为 `com.nuwax.app`，会更新同名应用，不是并存安装。构建脚本只出包；本轮已按用户指示使用 adb / devicectl 覆盖安装到 Redmi 和 iPhone 16 并启动，没有卸载或清理手机数据。
3. 两台手机都输入 `http://<电脑IPv4>:7890`。安卓选择 Alice，iPhone 选择 Bob（也可互换）；呼叫控制与 LiveKit 服务应分别显示可达。
4. Android 测试页点“开启测试监听”，确认显示已开启后可退到桌面。该服务由用户主动开启，可从测试页或常驻通知停止，仅专用 Debug 包声明它。
5. 一台点语音或视频，另一台在来电页接听。测试静音、扬声器、摄像头、摄像头切换、返回测试页再进入通话、挂断与释放。
6. 电脑浏览器打开同一服务，选择 agent，才可使用合成音轨替身；不代表正式智能体。

Android 测试页还单独显示通知、全屏来电提醒和高优先级通知通道的授权状态，并提供系统设置入口。这三项仅报告 Android 公共 API 的结果。部分厂商另设“锁屏显示”“后台弹出界面”等权限，需从“应用权限设置”进入应用信息核对，不能把三个“已允许”当作锁屏验收通过。

Android 使用 Core-Telecom 管理通话、CallStyle 通知提供接听/拒接操作，通知指向独立的原生接听 Activity；锁屏可语音接听，视频接听先由系统解锁。返回/收起不挂断，点击通话通知可恢复。系统在使用手机时可选择显示横幅，锁屏全屏展示受系统和厂商权限控制，见 [Android 全屏来电通知说明](https://developer.android.com/develop/connectivity/telecom/dialer-app)及 [全屏 Intent 授权](https://developer.android.com/reference/android/app/NotificationManager#canUseFullScreenIntent())。

2026-11-06 Redmi 早期前台排查记录：普通通知已允许，最初 `USE_FULL_SCREEN_INTENT` 实际 app-op 为 `ignore`，之后系统设置中确认为 `allow`。16:30–16:34 的 Telecom 日志已记录来电 `RINGING`，这一阶段的问题包含来电展示与清理。新增原生接听页后，前台来电展示、点击拒接、服务释放已在该机观察；取消和正常结束时先 disconnect Telecom 再结束 owner job，协程取消不再误报 `CALL_SYSTEM_UNAVAILABLE`。之后在系统 UI 中将本应用“锁屏显示”和“后台弹出界面”从拒绝改为始终允许；只调整来电展示相关项，未改变自启动或省电策略。已存在来电在 Keyguard showing=true 时可显示原生接听页；手机先完全睡眠后再发新邀请，本轮未观察到进入 Telecom，不算后台/锁屏新来电通过。该开发服务没有厂商电话推送，不能靠这些授权代替推送唤醒。上述已到达的邀请均由原生 SSE 送达。

### iPhone → 安卓后台呼入，2026-11-06 18:31 已接通

本轮由 iPhone 镜像在真实 Bob 测试页点击“语音通话”。Redmi Alice 停在桌面，已启用开发监听 `VoipDevControlService`。安卓随后显示系统 CallStyle 横幅，包含 Bob、来电、拒接和接听。用户接听并确认“已经通了”。服务端观察到以下完整时间线。

| 北京时间 | 权威事件 |
| --- | --- |
| 18:31:37.258 | ringing，version=1 |
| 18:32:13.312 | connecting，version=2 |
| 18:32:16.973 | active，version=3 |
| 18:32:25.119 | ended，version=4，reason=hangup |

callId 为 `edf7a091-c570-4951-b342-9d91a38ff6c5`。对应安装包为 Android `android_debug-20261106-175050.apk` 和 iOS `nuwax-voip-ios-20261106-181109.ipa`，构建自 `c67647b5d` 加当时未提交的测试监听、uni-push 配置及 iOS 测试宿主修改。包哈希和原始证据留在忽略目录。

这次验证覆盖真实 iPhone 发起、安卓桌面后台系统提示、接听、媒体 active 和挂断。开发服务的 `nativePush=false`，当前送达依赖已开启的开发监听。系统回收后推送、锁屏长测、视频和三端完整矩阵仍需继续验收。用户确认本次已通，自动观察记录只包含状态及界面，未录制人声。

结构整理后的新包单独记录编译结果，需安装后再执行回归。正式后端切换步骤见 [对接交接](voip-backend-integration.md)。

### iPhone → 安卓后台呼入：2026-11-06 17:20 复测未通过

从 iPhone 镜像中的真实 Bob 测试页点击语音通话，Android 使用已安装的 `6346b55ea` 代码包、Alice 身份，停在桌面后台，通知/全屏/厂商锁屏与后台弹出权限均已允许。只测试响铃，没有自动接听或采集音视频。

| 北京时间 | 实际观察 |
| --- | --- |
| 17:17:17.608 | Redmi 系统 `ActionExecute` 记录本应用 UID 的 `frozen … reason=tobg` |
| 17:20:10.498 | 开发服务收到真实 iPhone 呼叫，`119af7b2-d7e7-4383-b843-f878e1b64715` 进入 ringing，version=1 |
| 呼叫后 1 秒、5 秒及后续实屏 | 安卓仍在桌面，没有接听/拒接提示，应用通话前台服务不存在；用户也确认没有看到 |
| 17:20:44.558 | 主动打开 Android 应用，系统记录同 UID `thaw … reason=Activity Start` |
| 17:20:45.757 | 安卓才加入 Telecom，进入 RINGING；属于回前台后的延迟处理，不能计为后台来电成功 |
| 17:20:55.642 | 权威呼叫超时结束，version=2、reason=timeout；iPhone 实屏显示无人接听 |

当次结论为原生 SSE 随应用进程被厂商冻结，后台唤醒失败。上方 18:31 复测使用新增开发监听完成后台通话。开通知权限、增加全屏 Activity 都不能补齐这一环节。后续须由可用的厂商通话推送唤醒原生接收器，调用 `VoipBridge.incoming()` 查询权威状态，再接 Core-Telecom / CallStyle；需要匹配 applicationId、签名、设备 token、推送环境与通道权益，并让呼叫服务实际发送邀请。现有开发服务 `nativePush=false`，真实厂商接收器与发送通道仍待对接，正式后台/锁屏及冷启动来电继续按通道验收。

原始截图、受限的业务状态观察及本应用系统日志保存在本 worktree 忽略目录 `out/voip-device-install/`；不将推送凭据或个人通知内容提交到仓库。

LiveKit 使用 TCP 7880（信令）、TCP 7881 / UDP 7882（媒体）。服务可达仅表示 RoomService 查询成功；实际音视频与网络切换须继续看通话状态并用真机确认。测试页只保留最近 12 条状态记录，不显示平台 token、RTC JWT 或原生推送 token。

2026-11-06 切换 Wi-Fi 后，本机为 `192.168.32.42`，安卓为 `192.168.32.136`；已从安卓请求 `192.168.32.42:7890/health` 并收到 200。此为当时的网络检查记录，18:31 真机通话结果见上方。

16:13 安装后，安卓应用保持前台，实屏显示隐私确认页，交用户阅读确认；iOS 的安装、启动成功且回读进程仍存在。没有代用户同意隐私、申请采集权限或拨打测试电话；双向音视频与系统来电继续由真机测试确认。

## 重建

所有输入快照、资源、SDK 工作副本、DerivedData 和安装包均在本 worktree 忽略的 `out/`、`unpackage/` 中；保留主 checkout、原调试基座和共享 SDK 工程。

```bash
pnpm install --frozen-lockfile
node scripts/voip-native/prepare-device-project.mjs
/Applications/HBuilderX.app/Contents/MacOS/cli project open --path "$PWD/out/voip-device-project"
/Applications/HBuilderX.app/Contents/MacOS/cli publish app --type appResource --project "$PWD/out/voip-device-project"

# 使用当前 worktree out/voip-native-work/android/ 中的 5.34 SDK 工作副本。
# NUWAX_SIGNING_ENV 仅为本机受控配置路径，不把密码写入命令、仓库或日志。
NUWAX_SIGNING_ENV=/path/to/local-secrets.env bash scripts/voip-native/device/package-android.sh

bash scripts/voip-native/device/fetch-ios-sdk.sh
# 需要 Xcode、xcodegen，以及证书私钥和包含目标 iPhone 的开发描述文件。
NUWAX_SIGNING_ENV=/path/to/local-secrets.env bash scripts/voip-native/device/package-ios.sh
```

iOS SDK 固定 5.34 VDOM，下载来源为 [DCloud 官方 iOS SDK 页面](https://doc.dcloud.net.cn/uni-app-x/native/download/ios.html)。两端的本地资源均由 HBuilderX 5.34 导出。精简测试宿主复用真实客户端 CallManager、页面和原生桥，避免把完整业务 App 中未验收的插件打包能力混同为本包验证范围。

输出：`out/voip-device-packages/android_debug-latest.apk`、`iOS_debug-latest.ipa`，并复制到当前 worktree 的 `unpackage/debug/`。Android 为 Debug 变体加团队签名；iOS 为开发签名真机包，只能安装到描述文件已登记的设备，且需开启开发者模式。

测试入口要求 **原生 Debug + 明确包标记**，不依赖修改 `NODE_ENV`。普通发行包不会因为 storage 中残留开发身份而启用测试服务；生产通话总开关仍为关闭。iOS LAN ATS 例外仅写入这个隔离 Debug 测试宿主，没有改正式 manifest。

打包脚本验证 iOS 签名、可执行文件、bundleId、App 资源以及所有 `@rpath` framework 的实际嵌入。构建与签名通过仍不等于安装、双向通话或电话推送验收通过。

本轮优先补验方向为 **iPhone（Bob）→ Redmi（Alice）**：分别在安卓前台、桌面后台、锁屏发起新呼叫，确认系统 CallStyle 通知有接听/拒接，通知点击打开原生通话页；每项需单独记录送达、展示、接听、媒体与挂断结果。只验证安卓呼出或应用内来电页不能替代这一方向。

## 可选 uni-push 客户端配置

专用 Android 构建支持 `NUWAX_ANDROID_UNIPUSH_CONFIG=/受控路径/client.json`。配置包含与 applicationId 匹配的 `packageName`、`getuiAppId`，已开通小米通道时另提供 `xiaomi.appId/appKey`。配置文件只放本 worktree 忽略目录，权限 0600。脚本按 5.34 离线 SDK 文档锁定个推依赖，生成目录中的配置和密钥不入库。

2026-11-06 已核对发布的 1.3.3(133) APK，并在专用测试包中恢复 uni-push 注册，Redmi 显示“设备已注册”。该发布包未检出小米 SDK/metadata，DCloud 控制台配置仍待团队确认。CID 注册、邀请发送、厂商送达分别记录结果。

Android 测试 manifest 和 uni-push 配置统一由 `scripts/voip-native/device/configure-android.py` 管理，普通构建清理该脚本拥有的测试声明。测试监听不申请媒体采集，通话结束释放媒体与通话服务，开发监听由用户单独停止或退出测试身份时释放。
