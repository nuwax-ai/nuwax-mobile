# iOS 本地调试与测试包

## 构建与校验

从移动端 `feat-2026.11` 开始。准备好 Xcode（真机联调用过 27.2）、HBuilderX 5.34、XcodeGen、CocoaPods、Node.js 和 `pnpm install --frozen-lockfile` 安装的项目依赖。启动 HBuilderX 并导入移动端 checkout。首次打包会下载 DCloud 的 iOS 5.34 离线 SDK 到 `out/voip-native-work/ios-sdk/`。已有相同版本时，可以用 `UNIAPPX_SDK_ROOT` 指定 `UniAppX-iOS@5.34` 目录。

签名用团队的 `nuwax-signing/local-secrets.env`，也可以设置 `NUWAX_SIGNING_ENV` 指向本机受控配置。先将 Apple Development 证书和私钥导入钥匙串，并在 Xcode 安装描述文件。参考 [签名配置示例](../../scripts/local-secrets.env.example)，填写 `DCLOUD_APPKEY`、`IOS_DEVELOPMENT_TEAM`、`IOS_PROVISIONING_PROFILE_UUID` 和 `IOS_PROVISIONING_PROFILE_PATH`。Getui 客户端配置由 `NUWAX_IOS_UNIPUSH_CLIENT_IPA` 指定的同应用基座提供，请保存在 `unpackage/debug` 之外。脚本验签时核对包名与 Getui 客户端配置。证书、描述文件、密钥、SDK 和签名包通过团队渠道管理。

**周一（11 月 23 日）签名待办**

- [ ] 与签名负责人确认新申请的 Apple Development 证书及对应私钥的配置方式。确认 `com.nuwax.app` 的开发描述文件包含该证书、同事的真机 UDID，并带 `aps-environment=development`。补齐同应用的 DCloud AppKey 和测试 UniPush 客户端配置后，由同事在自己的 Mac 构建并覆盖安装一次。

### 日常调试基座

```bash
make app-resource
make base-ios-device
pnpm hx:ios:device -- --playground custom --customType device \
  --deviceId "$IPHONE_ID" --ipaPath "$PWD/unpackage/debug/iOS_debug.ipa"
```

基座输出到 `unpackage/debug/iOS_debug.ipa`。运行前，将 `IPHONE_ID` 设为 `pnpm hx:ios:devices` 列出的设备序列号，也可在 HBuilderX 中选择“使用自定义基座运行”。只改业务页面时可以复用已生成的基座。修改 Swift 或其他原生插件后，重新生成资源并打基座。需要调试 HX 生成的 Swift 时，见 [HBuilderX 5.34 的 iOS 原生复用](voip-business-integration.md#hbuilderx-534-的-ios-原生复用)。

### 可直接安装的测试 IPA

```bash
make ios-tester
```

脚本先准备离线资源，再将当前源码快照复制到 `out/voip-business-qa-project`。该副本固定测试域名 `https://testagent.xspaceagi.com`，开启业务通话入口，并跳过会替换当前包的版本更新检查。QA 原生宿主还核对固定的 API origin，防止恢复旧安装遗留的生产电话身份。

HBuilderX 生成本地 iOS 发行资源，随后离线 SDK 构建 Debug 原生宿主、签名、验证 APNs 元数据并生成独立 IPA。SDK `ipatype=2`，不链接 HX DebugServe；调试基座仍沿用原流程及路径。全 App 编译可临时提高 HX 堆内存，构建结束恢复既有配置。资源、证书派生文件及产物都不进入版本库。

产物位置：

- `out/voip-business-packages/Nuwax-iOS-Test-<时间>.ipa`：发给同事安装的完整包。
- 同名 `.sha256`：文件完整性校验；同名 `.json`：构建变体元数据。
- `Nuwax-iOS-Test-latest.ipa`：最新包的本地软链，转发时选择实际 IPA 文件。
- `out/voip-business-packages/ios-qa-verification.json`：环境、内置资源与当前原生模块摘要核对结果。

`verify-business-qa-ios.py` 校验包名、真实产品名称、测试环境、发行宿主模式、后台模式、无 DebugServe、导出资源和内置资源逐文件一致、当前原生 Swift 实现一致及有效签名。签名与构建通过仍不代表实机启动或通话矩阵已验收。

## 安装和账号

1. iPhone 开启开发者模式，解锁并用 USB 连接。可以用 Apple Configurator 安装 IPA，也可以用 CoreDevice 安装本机生成且已签名的 `.app`。
2. 这是同一 `com.nuwax.app` 的测试包，安装会覆盖现有同包名 App。测试环境原账号可继续使用；若现有安装曾登录生产环境，须退出后重新登录测试账号，不能把旧生产凭据当作测试凭据。
3. 两台手机分别登录不同测试账号，在真实联系人单聊中点「＋ → 语音通话/视频通话」。不用填写 LAN 地址、Alice/Bob 或 RTC JWT。
4. 本机记录从同一加号面板的「通话记录」进入；只显示该账号在这台手机上观察到的呼叫。回拨重新创建呼叫和检查能力，不复用旧 callId。

```bash
# 将 COREDEVICE_ID 设为下列命令返回的目标设备 ID。
xcrun devicectl list devices
xcrun devicectl device install app --device "$COREDEVICE_ID" \
  out/voip-business-qa-ios-derived/Build/Products/Debug-iphoneos/UniAppX.app
```

## 分层测试

先测前台两账号双向拨号、拒接、取消、无人接听、接通/静音/挂断；每通核对两端界面、系统通话和动态岛计时是否清除。再测最小化返回通话、权限首次申请/拒绝与设置、视频后台停采、音频路由、系统音频打断、30 秒重连上限及挂断后资源释放。

验证冷启动时，先登录测试账号并确认原生日志出现 `PushKit registration state=registered senderReady=true`。关闭专注模式、锁屏，通过调试工具结束 App 进程，再从另一个测试账号正常拨号。核对系统来电、接听和主叫端同一条邀请的通话时长。流程中的 `registrationId` 由手机登记，由 IM 按目标 CID 交给测试云函数。后台、用户上滑退出、重启首次解锁前后分别记录。

11 月 21 日，iPhone 16（iOS 27.3）在锁屏、App 进程已退出状态下，通过测试 Web 的正常拨号收到 VoIP 推送并接听，Web 记录通话 9 秒。会议建房、RTC token 和在线邀请、接听、取消仍使用现有接口。

当前最低安装范围 iOS 15；iOS 15–17.3 使用 PushKit/CallKit，17.4+ 使用 PushKit/LiveCommunicationKit。两条路径都不因代码接入而视为验收通过，仍需分别验证前台、后台、锁屏和未启动时系统接听。
