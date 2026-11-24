# 手机整屏共享与后台会议

## 当前实现

- Android：MediaProjection 默认显示器采集，Android 14+ 显式使用 `createConfigForDefaultDisplay()`，最终授权范围仍以系统界面为准。每次共享重新授权。SDK 的 mediaProjection 前台服务承载录屏；独立会议前台服务承载会议音频。
- iOS：ReplayKit Broadcast Upload Extension → LiveKit IPC → 主 App 原有 Room 发布屏幕轨。扩展不建第二个参会席位，也不接触 JWT。扩展在 IPC 前将整帧等比缩到最长边 1280、最短边不超过 720，上限 30fps；主 App 保留单层 H.264 优先、3Mbps 上限及实际编码诊断。这些是配置上限，不是已实测帧率。
- 用户点击系统开始广播、原生发布完成后才显示共享开启。取消、系统停止、断会或共享被接管均由原生收尾，不依赖页面轮询。后台释放占位复用现有 `POST /api/instant-message/meetings/public/rooms/{room}/share-holder/release`，服务端校验入会 JWT，仅允许释放本人席位。
- 不提供“小窗”按钮或“最小化”选择。返回其他页面自动保留会议并显示贴右边沿的白底灰色会议图标（36×64、仅左侧圆角），可以上下拖动，点击回到会议。会议页不显示该入口，会议列表不再重复显示顶部返回横条；旧基座使用相同外形的业务组件备用入口。
- Android 退后台使用 `TYPE_APPLICATION_OVERLAY`，与 App 内相同的白底灰色会议图标（36×64、左侧圆角、可上下拖动），不再自动进入系统 PiP。首次在会中前台展示悬浮窗权限说明，用户点击“去设置”后开启“显示在其他应用上层”；拒绝后不重复弹窗，可从系统通知返回会议，之后也可在系统应用设置中手动授权。回前台隐藏桌面入口，会议页面隐藏 App 内入口；录屏授权期间和锁屏时隐藏桌面入口。
- Android 桌面窗口使用 Application context，生命周期由原生会议和前台服务持有，`stopWithTask=false`，移除最近任务/销毁 Activity 不主动断会或移除桌面入口。离会、断连或服务销毁必须移除窗口，不持久化或自动重建已结束的会议。部分厂商清理最近任务会同时杀死进程；强制停止或系统杀进程后无法保留窗口和通话。
- iOS 仍使用系统 PiP 展示后台会议，不支持 Android 式跨应用任意浮窗。本次只统一 iOS App 内入口的白底灰图标样式；系统 PiP 外形仍由系统管理。
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

真机需验证：授权取消/等待超过 60 秒、共享后 Home/切换其他 App、横竖屏、系统停止录屏、返回上一页会议图标与上下拖动（拖动结束不能误入会）、点击回会、其他端接管共享、后台被结束会议、离会时仍在授权弹窗、权限拒绝、断网重连、小窗关闭/恢复、系统关闭自动 PiP 后仍能继续会议。Android 与 iOS 对看时同时记录实际 codec/尺寸/fps，不能只看 `nativeOn=true` 判定传输流畅。预期基座诊断标记：Android `android-meeting-20261123-p11`，iOS `ios-meeting-20261123-p10`。

后台释放请求失败会记录简短诊断，回前台由媒体层再次校准；网络中断或 JWT 过期期间不能保证服务端占位立即释放。

参考：

- [DCloud UTS iOS Extension 云打包](https://doc.dcloud.net.cn/uni-app-x/plugin/uts-plugin.html#ios-extension)
- [Android MediaProjection](https://developer.android.com/media/grow/media-projection)
- [LiveKit 屏幕共享](https://docs.livekit.io/transport/media/screenshare/)

### Android 边沿悬浮窗验收（需新自定义基座/安装包）

以下为待真机验证项，静态检查不替代系统窗口和后台存活测试：

1. 首次入会：授权说明只弹一次；“暂不开启”不阻断聊天、共享或通话，之后退后台没有黑色 PiP，通知仍可返回会议。
2. 授权后：会议页不显示边沿入口；App 内其他页面和桌面分别显示白底灰色会议图标，上下拖动不能误触返回，点击直接回会。
3. Home、切换其他 App、移除最近任务分别验证；会议进程/前台服务仍存活时，入口和音频保持，点击能回会。若厂商杀进程，入口随进程消失，不自动重建会议。
4. 录屏授权、锁屏/解锁、横竖屏、设置中撤销悬浮权限分别验证，没有重复窗口、授权页遮挡或崩溃。
5. 正常离会、主持人结束会议、网络断开后最终离线：窗口和前台通知移除，旧入口不能打开下一场会议。
6. 两台设备验证后台音频及整屏共享继续工作；此改动不调整 LiveKit 发布、订阅或编码参数。

### 全局入口与返回路由

- App 全局导航成功后同步当前路由，手势返回和原生宿主切换由前台轻量轮询兜底；会中页隐藏入口，其余业务页显示，不再依赖逐页插入备用组件。Android 同时识别首页 UniAppActivity 与详情/会议页 UniPageActivity 的子类，跟随已恢复的页面宿主迁移原生 View，iOS 挂到当前 key window。
- App 内入口、桌面入口、通知、iOS PiP 恢复均消费同一个返回请求；前台使用轻量轮询接收点击，不依赖浮窗挂载成功。只有顶部路由确认为会议页才完成请求；回会只向前打开当前会议路由，不按可能过期的页面列表执行 navigateBack；原生 Room 仍复用，导航失败保留请求，重试间隔至少 1 秒。
- Android 原生会话仅在内存保存当前房间、返回路由和席位凭据。最近任务移除后若业务运行时重建、原生 Room 仍连接，则接回该 Room 后导航；不再次签票/连房，不把令牌写入 storage、日志或 Intent。主动离会后不恢复迟到快照，系统已杀死进程时不恢复已结束连接。
- 待真机验证：会议→任意详情/设置页→点击浮窗；桌面→点击浮窗/通知；移除最近任务→点击浮窗；iOS PiP 展开；页面栈较深时回会。均应直达当前会议，不停在消息首页，也不新增参会席位。

### Android 详情页返回与任务恢复边界（p11）

- 设备日志实际页面为 `io.dcloud.uniapp.appframe.activity.UniPortraitPageActivity`；SDK 中它继承 `UniPageActivity`，不是 `UniAppActivity`。只识别后者会漏掉会话详情和会议页，直到回消息首页才挂窗。
- 桌面入口和通知优先将保存的业务 task 移到前台，不重新运行 Launcher 并重排到首页；最近任务已移除时才启动入口。原生返回请求保留到当前会议页 `onShow` 显式确认，不能被消息首页/临时宿主提前消费。
- 点击 App 内浮窗只向前打开当前会议路由，不计算旧页面列表的返回层数；导航完成回调先于 Activity 切换时，至少等待 1 秒才重试，避免重复入栈。
- 此次只读取设备日志/任务栈与 SDK 类继承信息，未安装或编译新包。需新 Android 基座验证“会话卡片→会议→返回会话详情→点击浮窗”及“Home/移除最近任务→桌面浮窗→会议”两个完整链路。
