# 手机整屏共享与后台会议

## 当前实现

- Android：MediaProjection 默认显示器采集，Android 14+ 显式使用 `createConfigForDefaultDisplay()`，最终授权范围仍以系统界面为准。每次共享重新授权。SDK 的 mediaProjection 前台服务承载录屏；独立会议前台服务承载会议音频。
- iOS：ReplayKit Broadcast Upload Extension → LiveKit IPC → 主 App 原有 Room 发布屏幕轨。扩展不建第二个参会席位，也不接触 JWT。扩展在 IPC 前将整帧等比缩到最长边 1280、最短边不超过 720，上限 30fps；主 App 保留单层 H.264 优先、3Mbps 上限及实际编码诊断。这些是配置上限，不是已实测帧率。
- 用户点击系统开始广播、原生发布完成后才显示共享开启。取消、系统停止、断会或共享被接管均由原生收尾，不依赖页面轮询。后台释放占位复用现有 `POST /api/instant-message/meetings/public/rooms/{room}/share-holder/release`，服务端校验入会 JWT，仅允许释放本人席位。
- 不提供“小窗”按钮或“最小化”选择。返回其他页面自动保留会议并显示贴右边沿的白色会议图标（36×64、仅左侧圆角），可以上下拖动，点击回到会议。会议页不显示该入口，会议列表不再重复显示顶部返回横条；旧基座使用相同外形的业务组件备用入口。
- 退后台请求系统 PiP：Android 在宿主可用时注册 user-leave 监听，Android 12+ 开启 auto-enter，旧宿主补充生命周期/应用后台回调；授权录屏期间暂停 auto-enter。iOS 在前台准备稳定的来源视图，后台通知补充启动，并使用 SampleBuffer 视频渲染。系统 PiP 的窗口外形由系统管理，不能做成 App 内相同的窄边会议图标。没有申请 SYSTEM_ALERT_WINDOW。系统关闭 PiP 权限/自动画中画时，会议继续，但不能保证窗口展示。原生日志包含 PiP 可能性、启动结果或失败原因，需真机核对。
- 小窗由原生会话持有，不随会议页面销毁；不回显本端共享屏幕以避免镜像递归。右上角退出仍按主持人/参会人权限处理。另一场会议不能覆盖尚未离开的会议。
- 旧基座缺少后台配置/自动小窗导出时，仍保留原有入会、聊天、举手和 `requestScreenShare`（iOS 旧实现仅共享本 App），App 内保留返回会议提示。原生已连接但页面残留 exception 时按真实状态校准，不能误报要求更新组件。
- 录屏不包含其他应用的内部音频；会议麦克风继续使用原音轨。受系统保护内容可能不可录制，强制终止 App 不承诺继续会议。

## iOS 首次配置（HBuilderX 5.34）

交给负责 Apple 账号与打包的同事：[首次配置交接步骤](ios-broadcast-first-setup.md)。包含实际 Bundle ID、Team、两份描述文件和最终 IPA 检查。

源码位于 `native/ios-broadcast/`。预编译的 `.appex` 不能由单独一份 UTS 源码自动生成，必须先在 Xcode 导出一次；之后 HBuilderX 云打包按下述配置嵌入并签名。Android 无需此步骤。

1. 在 Apple Developer 中为实际主 App ID 和 `<主 Bundle ID>.broadcast` 开启同一个 App Group。为两者重新生成对应开发/发行描述文件；自定义基座与正式包分别使用匹配的签名。
2. 使用安装了 CocoaPods / xcodeproj 的 Ruby 环境。可在 `scripts/ios-broadcast` 下运行 `bundle install` 安装 Gemfile 中的依赖。
3. 生成独立扩展工程（命令不编译、不修改现有基座）：

```bash
bundle exec ruby scripts/ios-broadcast/generate.rb \
  --bundle-id <实际主App的BundleID> \
  --app-group <实际AppGroupID> \
  --team <AppleTeamID> \
  --host-profile <主App描述文件名称> \
  --extension-profile <广播扩展描述文件名称>
```

在仓库根目录运行上述命令时，先设置 `BUNDLE_GEMFILE=scripts/ios-broadcast/Gemfile`。工程输出到 `out/ios-broadcast/`；如目录已存在，脚本拒绝覆盖，可另传 `--output`。

4. 在生成目录执行 `pod install`，打开 `MeetingBroadcast.xcworkspace`，选择 `MeetingBroadcastHost` scheme，在 Xcode Archive 并导出 IPA。这只是用于导出扩展的宿主，不替代业务 App。LiveKitClient 固定 2.19.0，与主 App 一致。
5. 解压导出的 IPA，将 `Payload/<宿主>.app/PlugIns/MeetingBroadcast.appex` 交给准备脚本：

```bash
python3 scripts/ios-broadcast/prepare_cloud.py \
  --appex <导出的MeetingBroadcast.appex绝对路径> \
  --bundle-id <实际主App的BundleID> \
  --app-group <实际AppGroupID> \
  --host-profile <主App.mobileprovision绝对路径> \
  --extension-profile <广播扩展.mobileprovision绝对路径>
```

该脚本先核对版本、Bundle ID、App Group、同一 Team、签名与描述文件，再生成：

- `uni_modules/nuwax-livekit/utssdk/app-ios/Plugins/MeetingBroadcast.appex`
- 插件 `Info.plist` 中的 `RTCAppGroupIdentifier` / `RTCScreenSharingExtension`
- 插件 `UTS.entitlements` 中的 App Group（保留其他已有 entitlement）
- `nativeResources/ios/ios-extension.json` 与扩展描述文件（保留其他扩展配置）

上述签名产物及环境配置均被 Git 忽略，不能因缺少这些文件就宣称其他机器的云基座已配置完成。脚本不会下载、生成或替换 `unpackage/debug` 的现有基座。升级 App 版本后须重新导出同版本扩展。

6. HBuilderX 用已包含 App Group 的主 App 描述文件重新云打自定义基座，并分别验证正式发行包。安装新基座后才能使用新增插件导出。仅重新打一个未嵌入扩展的基座仍不能整屏共享；此时先明确说明范围，用户可选择“共享本应用”恢复应用内共享，或取消。切到桌面及其他 App 的内容仍需广播扩展，不能把此备用路径视为整屏共享已配置。

现有离线 SDK 打基座脚本尚未接入广播扩展自动嵌入；本次交付提供的是官方支持的云打包路径，不把离线产物算作已验证。

## 验证

默认仅做静态检查，不自动运行 HBuilderX / Xcode 编译或云打包。

```bash
git diff --check
pnpm meeting:ios:check
pnpm meeting:ios:check-base
python3 -m unittest discover -s scripts/ios-broadcast -p 'test_*.py'
ruby -c scripts/ios-broadcast/generate.rb
node --test scripts/meeting-connect.test.mjs
```

真机需验证：授权取消/等待超过 60 秒、共享后 Home/切换其他 App、横竖屏、系统停止录屏、返回上一页会议图标与上下拖动（拖动结束不能误入会）、点击回会、其他端接管共享、后台被结束会议、离会时仍在授权弹窗、权限拒绝、断网重连、小窗关闭/恢复、系统关闭自动 PiP 后仍能继续会议。Android 与 iOS 对看时同时记录实际 codec/尺寸/fps，不能只看 `nativeOn=true` 判定传输流畅。预期基座诊断标记：Android `android-meeting-20261123-p8`，iOS `ios-meeting-20261123-p8`。

后台释放请求失败会记录简短诊断，回前台由媒体层再次校准；网络中断或 JWT 过期期间不能保证服务端占位立即释放。

参考：

- [DCloud UTS iOS Extension 云打包](https://doc.dcloud.net.cn/uni-app-x/plugin/uts-plugin.html#ios-extension)
- [Android MediaProjection](https://developer.android.com/media/grow/media-projection)
- [LiveKit 屏幕共享](https://docs.livekit.io/transport/media/screenshare/)
