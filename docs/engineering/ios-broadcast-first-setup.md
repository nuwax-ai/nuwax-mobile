# iOS 整屏共享首次配置交接

适用于当前 nuwax-mobile 的 HBuilderX 5.34 云自定义基座。请由有 Apple Developer 标识符、描述文件管理权限的同事完成。此流程没有在当前账号上执行，也没有生成签名扩展。

## 本次核对结果

当前本地 `unpackage/debug/iOS_debug.ipa` 包含会议原生插件，但没有广播 `.appex`、`RTCAppGroupIdentifier`、`RTCScreenSharingExtension`；主描述文件也没有 App Group。因此仅重复云打基座不能启用整屏共享。

| 配置 | 当前值 / 计划值 |
| --- | --- |
| 主 App Bundle ID | `com.nuwax.app` |
| Apple Team | `89GQ2RJVW7`（从当前基座读取，请在账号中确认） |
| 广播扩展 Bundle ID | `com.nuwax.app.broadcast` |
| App Group | 建议 `group.com.nuwax.app`，需先确认账号内可用；若改名，全链路使用实际值 |
| 旧主描述文件 | `NuwaxAppProfile`，缺少 App Group，需要重新生成 |
| 当前审计包版本 | `1.4.1 (141)`；实际制作时以仓库 `manifest.json` 为准 |

## 1. Apple Developer 配置

1. 登录 [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list)，选择正确 Team。
2. Identifiers → `+` → App Groups，注册上述 App Group。若已存在，确认属于当前 Team 后复用。
3. Identifiers → App IDs → 找到 `com.nuwax.app` → Edit，启用 App Groups → Configure，选中该组并保存。保留主 App 已有 Push Notifications 等能力。
4. 注册 Explicit App ID `com.nuwax.app.broadcast`，启用 App Groups，选中同一组并保存。扩展不需要登录 IM 或独立申请通话推送能力。
5. Profiles 中重新生成主 App 描述文件，再创建广播扩展描述文件。两份文件必须属于同一 Team、使用匹配的签名类型和证书；Development / Ad Hoc 包需要包含测试设备 UDID。正式 App Store 包另用对应的发行配置。
6. 下载两份 `.mobileprovision`。执行构建的 Mac 需要匹配的证书和私钥。通过团队受控渠道传递，勿提交到 Git。

交给开发同事：实际 App Group ID、Team ID、两份描述文件、描述文件 Name、签名类型，以及已安装匹配证书和私钥的构建机器。不是只给文件名或证书公钥。

## 2. 生成并导出真实广播扩展

在仓库根目录操作。需 Xcode、Ruby Bundler、CocoaPods；以下命令由负责打包的同事执行。

```bash
export BUNDLE_GEMFILE="$PWD/scripts/ios-broadcast/Gemfile"
bundle install
bundle exec ruby scripts/ios-broadcast/generate.rb \
  --bundle-id com.nuwax.app \
  --app-group group.com.nuwax.app \
  --team 89GQ2RJVW7 \
  --host-profile '填写新主描述文件的Name' \
  --extension-profile '填写广播扩展描述文件的Name'
cd out/ios-broadcast
bundle exec pod install
open MeetingBroadcast.xcworkspace
```

如果 App Group 或 Team 有变，请替换示例。脚本默认拒绝覆盖已有输出，可传 `--output` 指定新目录。

在 Xcode 中选择 `MeetingBroadcastHost` scheme、真机通用目标，检查 Host / MeetingBroadcast 两个 target 的签名，分别选择对应描述文件；Product → Archive → Distribute App，按基座匹配的签名方式导出 IPA。这个 Host 只用于导出扩展，不替代业务 App。LiveKitClient 固定为 2.19.0。

解压导出的 IPA，取得 `Payload/<宿主>.app/PlugIns/MeetingBroadcast.appex`。必须是编译签名后的完整目录，不能只复制 `SampleHandler.swift`。App 版本变化后需重新生成/导出匹配版本扩展。

在 Mac 上对扩展可执行文件执行 `otool -L '/实际导出目录/MeetingBroadcast.appex/MeetingBroadcast'`。生成工程会把 LiveKitClient 和 LiveKitFFI 静态链接进扩展。第三方动态依赖应只有由主 App 的 `Frameworks/` 提供的 `LiveKitWebRTC.framework` 和 `RustLiveKitFFI.framework`。

## 3. 接入 HBuilderX 云打包

回到仓库根目录执行，使用真实绝对路径：

```bash
python3 scripts/ios-broadcast/prepare_cloud.py \
  --appex '/实际导出目录/MeetingBroadcast.appex' \
  --bundle-id com.nuwax.app \
  --app-group group.com.nuwax.app \
  --host-profile '/受控目录/主App.mobileprovision' \
  --extension-profile '/受控目录/广播扩展.mobileprovision'
pnpm meeting:ios:check
```

准备脚本校验并放置扩展、Info.plist 两个配置键、UTS.entitlements 和 `nativeResources/ios/ios-extension.json`；这些本机签名文件已被 Git 忽略。换机器必须重新准备，不能靠拉代码获得。

HBuilderX 云打包选择新主 App 描述文件和匹配证书，生成自定义基座。先完成插件代码修改再打包，避免包内原生源码版本与热更新资源不一致。正式发行包也需要同样嵌入扩展。

```bash
# 审计实际下载的包；默认命令检查 unpackage/debug/iOS_debug.ipa
pnpm meeting:ios:check-base
# 或指定实际输出
python3 scripts/ios-broadcast/check_package.py --ipa '/实际路径/iOS_debug.ipa'
```

检查通过只说明配置齐全，不替代签名有效性及真机测试。本流程不自动运行构建、不下载或替换现有基座。

## 4. 验收

- 安装新包后点击共享，出现系统广播选择器并能选择会议共享扩展；授权未完成前不显示已开启。
- 开始广播后切到桌面和另一个 App，Android / PC 接收端应看到对应手机屏幕；停止广播后状态正确收起。
- 验证取消、锁屏、横竖屏、断网恢复、共享与摄像头并用，以及聊天、举手、离会仍正常。
- 新会议原生探针预期 `ios-meeting-20261123-p8`，共享配置 `broadcastCfg=ready`。探针只证明对应代码存在，不证明画面传输已验证。
- “共享本应用”是未配置扩展时的备用方案，不能作为整屏共享通过验收。

参考：[Apple App Groups](https://developer.apple.com/help/account/identifiers/register-an-app-group/)、[Apple 能力配置](https://developer.apple.com/help/account/identifiers/enable-app-capabilities/)、[DCloud iOS Extension 云打包](https://doc.dcloud.net.cn/uni-app-x/plugin/uts-plugin.html#ios-extension)。
