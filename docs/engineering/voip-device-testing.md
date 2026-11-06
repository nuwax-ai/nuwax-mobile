# VoIP 专用真机测试包

本包用于 Android 和 iPhone 的一对一语音、视频联调。应用名称为 **Nuwax VoIP Test**，启动后直接进入测试页；Android 首次启动仍须完成本地隐私授权。无需登录女娲平台账号，分别选择 Alice 和 Bob 即可互拨。

**当前测试服务不发送真实厂商电话推送。** 本页的服务检测、前台来电、媒体连接和原生通话界面均不能替代 PushKit / 厂商推送 / 鸿蒙 Push Kit 的冷启动、锁屏来电验收。当前只打 Android、iOS 两种包，鸿蒙需另行真机验收。

## 使用

1. 两台手机与电脑连到允许设备互访的网络。电脑启动 `VOIP_ADVERTISE_IP=<电脑IPv4> VOIP_DEV_HOST=0.0.0.0 pnpm voip:dev`。
2. 安装对应包；当前 Android applicationId / iOS bundleId 均为 `com.nuwax.app`，会更新同名应用，不是并存安装。构建脚本只出包；本轮已按用户指示使用 adb / devicectl 覆盖安装到 Redmi 和 iPhone 16 并启动，没有卸载或清理手机数据。
3. 两台手机都输入 `http://<电脑IPv4>:7890`。安卓选择 Alice，iPhone 选择 Bob（也可互换）；呼叫控制与 LiveKit 服务应分别显示可达。
4. 一台点语音或视频，另一台在来电页接听。测试静音、扬声器、摄像头、摄像头切换、返回测试页再进入通话、挂断与释放。
5. 电脑浏览器打开同一服务，选择 agent，才可使用合成音轨替身；不代表正式智能体。

LiveKit 使用 TCP 7880（信令）、TCP 7881 / UDP 7882（媒体）。服务可达仅表示 RoomService 查询成功；实际音视频与网络切换须继续看通话状态并用真机确认。测试页只保留最近 12 条状态记录，不显示平台 token、RTC JWT 或原生推送 token。

2026-11-06 切换 Wi-Fi 后，本机为 `192.168.32.42`，安卓为 `192.168.32.136`；已从安卓请求 `192.168.32.42:7890/health` 并收到 200。尚不代表 iPhone 访问或两端 RTP 音视频已验证。

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
