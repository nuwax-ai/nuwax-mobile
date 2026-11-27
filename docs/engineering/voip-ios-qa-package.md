# iOS 本地调试与测试包

## 构建与校验

从移动端 `feat-2026.11` 开始。准备好 Xcode（真机联调用过 27.2）、HBuilderX 5.34、XcodeGen、CocoaPods、Node.js 和 `pnpm install --frozen-lockfile` 安装的项目依赖。启动 HBuilderX 并导入移动端 checkout。首次打包会下载 DCloud 的 iOS 5.34 离线 SDK 到 `out/voip-native-work/ios-sdk/`。已有相同版本时，可以用 `UNIAPPX_SDK_ROOT` 指定 `UniAppX-iOS@5.34` 目录。

签名用团队的 `nuwax-signing/local-secrets.env`，也可以设置 `NUWAX_SIGNING_ENV` 指向本机受控配置。先将 Apple Development 证书和私钥导入钥匙串，并在 Xcode 安装描述文件。参考 [签名配置示例](../../scripts/local-secrets.env.example)，填写 `DCLOUD_APPKEY`、`IOS_DEVELOPMENT_TEAM`、`IOS_PROVISIONING_PROFILE_UUID` 和 `IOS_PROVISIONING_PROFILE_PATH`。Getui 客户端配置由 `NUWAX_IOS_UNIPUSH_CLIENT_IPA` 指定的同应用基座提供，请保存在 `unpackage/debug` 之外。脚本验签时核对包名与 Getui 客户端配置。证书、描述文件、密钥、SDK 和签名包通过团队渠道管理。

开发描述文件须包含对应的 Apple Development 证书、目标手机的 UDID，并带 `aps-environment=development`。如果同一份 IPA 要安装到 iPhone 13 和 iPhone 16，描述文件需覆盖两台设备。使用仓库内的本机签名配置时，先按示例填写，再执行 `export NUWAX_SIGNING_ENV="$PWD/scripts/local-secrets.env"`。

### 日常调试基座

```bash
make app-resource
make base-ios-device
pnpm hx:ios:device -- --playground custom --customType device \
  --deviceId "$IPHONE_ID" --ipaPath "$PWD/unpackage/debug/iOS_debug.ipa"
```

基座输出到 `unpackage/debug/iOS_debug.ipa`。运行前，将 `IPHONE_ID` 设为 `pnpm hx:ios:devices` 列出的设备序列号，也可在 HBuilderX 中选择“使用自定义基座运行”。只改业务页面时可以复用已生成的基座。修改 Swift 或其他原生插件后，重新生成资源并打基座。需要调试 HX 生成的 Swift 时，见 [HBuilderX 5.34 的 iOS 原生复用](voip-business-integration.md#hbuilderx-534-的-ios-原生复用)。

### 可直接安装的测试 IPA

iOS 的测试出包入口是 `make ios-tester`，对应 Android 的 `make android-tester`。在仓库根目录执行：

```bash
make ios-tester
```

脚本直接从当前 checkout 生成资源，不再复制或导入 `voip-business-qa-project`。服务地址、通话入口和更新检查均遵循当前分支代码与设备上保存的配置；当前代码在发行模式下默认生产域名，设备已保存的域名优先。运行时确认所选环境，再登录对应账号。

HBuilderX 生成本地 iOS 发行资源，随后离线 SDK 构建 Debug 原生宿主、签名、验证 APNs 元数据并生成独立 IPA。SDK `ipatype=2`，不链接 HX DebugServe；调试基座仍沿用原流程及路径。资源、证书派生文件及产物都不进入版本库。

产物位置：

- `out/voip-business-packages/Nuwax-iOS-Test-<时间>.ipa`：发给同事安装的完整包。
- 同名 `.sha256`：文件完整性校验。
- `Nuwax-iOS-Test-latest.ipa`：最新包的本地软链，转发时选择实际 IPA 文件。
- `out/voip-business-packages/ios-qa-verification.json`：内置资源与当前原生模块摘要核对结果；未固定域名时 `apiOrigin` 为 null。

`verify-business-qa-ios.py` 校验包名、真实产品名称、发行宿主模式、后台模式、无 DebugServe、导出资源和内置资源逐文件一致、当前原生 Swift 实现一致及有效签名。它不将服务地址固定为测试环境。签名与构建通过仍不代表实机启动或通话矩阵已验收。

## 首次安装与覆盖更新

iPhone 解锁后用 USB 连接 Mac，确认信任电脑并开启开发者模式。运行 `xcrun devicectl list devices`，核对机型，再复制该行的 **Identifier**。注册开发描述文件时使用的是设备 UDID。

从仓库根目录运行 [安装脚本](../../scripts/voip-native/install-nuwax-ios.sh)。iPhone 13 和 iPhone 16 使用相同命令，每次传入目标设备的 Identifier 和本次构建的 IPA。脚本也接受打包生成的 `out/voip-business-qa-ios-derived/Build/Products/Debug-iphoneos/UniAppX.app`。

```bash
xcrun devicectl list devices
COREDEVICE_ID='替换为目标 iPhone 的 Identifier'
IPA='/path/to/Nuwax-iOS-Test-本次时间戳.ipa'
shasum -a 256 "$IPA"
bash scripts/voip-native/install-nuwax-ios.sh "$COREDEVICE_ID" "$IPA"
```

首次安装和更新都用上述脚本。它先验证 `com.nuwax.app` 的签名，直接安装或覆盖，再回读手机上的版本和构建号。出现「设备回读通过」后，在手机上打开「女娲Nuwax」，确认能进入 App。两次打包可能沿用同一版本和构建号，交接时请记录本次 IPA 的 SHA-256。Apple Configurator 也可用于安装已签名的 IPA。

如果安装失败，保留现有 App 和数据，先检查连接、信任、解锁状态、开发者模式，以及描述文件是否覆盖该手机、是否与签名证书匹配。

## 测试账号

1. 测试环境原账号可继续使用；若现有安装曾登录生产环境，须退出后重新登录测试账号，不能把旧生产凭据当作测试凭据。
2. 两台手机分别登录不同测试账号，在真实联系人单聊中点「＋ → 语音通话/视频通话」。不用填写 LAN 地址、Alice/Bob 或 RTC JWT。
3. 本机记录从同一加号面板的「通话记录」进入；只显示该账号在这台手机上观察到的呼叫。回拨重新创建呼叫和检查能力，不复用旧 callId。

## 分层测试

先测前台两账号双向拨号、拒接、取消、无人接听、接通/静音/挂断；每通核对两端界面、系统通话和动态岛计时是否清除。再测最小化返回通话、权限首次申请/拒绝与设置、视频后台停采、音频路由、系统音频打断、30 秒重连上限及挂断后资源释放。

验证冷启动时，先登录测试账号并确认原生日志出现 `PushKit registration state=registered senderReady=true`。关闭专注模式、锁屏，通过调试工具结束 App 进程，再从另一个测试账号正常拨号。核对系统来电、接听和主叫端同一条邀请的通话时长。流程中的 `registrationId` 由手机登记，由 IM 按目标 CID 交给测试云函数。后台、用户上滑退出、重启首次解锁前后分别记录。

11 月 21 日，iPhone 16（iOS 27.3）在锁屏、App 进程已退出状态下，通过测试 Web 的正常拨号收到 VoIP 推送并接听，Web 记录通话 9 秒。会议建房、RTC token 和在线邀请、接听、取消仍使用现有接口。

当前最低安装范围 iOS 15；iOS 15–17.3 使用 PushKit/CallKit，17.4+ 使用 PushKit/LiveCommunicationKit。两条路径都不因代码接入而视为验收通过，仍需分别验证前台、后台、锁屏和未启动时系统接听。
