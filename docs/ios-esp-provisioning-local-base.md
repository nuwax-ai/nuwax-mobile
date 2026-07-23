# iOS 桌搭 BLE 配网 · 本地自定义基座打包指南

> 适用：用 **iPhone 真机** 调试桌搭 ESP32-S3 BLE 配网（Security 2）。
> 原因：`nuwax-esp-provisioning` 插件通过 **CocoaPods** 引入 ESPProvision（原生代码），
> 含 pods 的插件**无法注入预编译的标准基座**，必须用本地离线打包生成**自定义调试基座**。
> 本文与 [esp32s3-ble-first-integration-handoff.md](esp32s3-ble-first-integration-handoff.md) 配套。
>
> **本文按 2026-07-23 实际联调走过的流程整理**，含每一步的坑与解法（见「七、踩坑记录」）。

## 一、代码侧（已完成，在 nuwax-mobile 仓库内）

| 项 | 位置 | 说明 |
|---|---|---|
| 插件 iOS 配置 | [uni_modules/nuwax-esp-provisioning/utssdk/app-ios/config.json](../uni_modules/nuwax-esp-provisioning/utssdk/app-ios/config.json) | `deploymentTarget:13` + `dependencies-pods:[ESPProvision 3.1.0]` + 清华/CDN pod 源 |
| Swift 桥 | [utssdk/app-ios/EspProvisioningBridge.swift](../uni_modules/nuwax-esp-provisioning/utssdk/app-ios/EspProvisioningBridge.swift) | Security 2 / 扫描 / 连接 / device-info / 自定义 endpoint / WiFi 扫描与下发；静态外观 + UTS 闭包（无 @objc） |
| uts 接口层 | [utssdk/app-ios/index.uts](../uni_modules/nuwax-esp-provisioning/utssdk/app-ios/index.uts) | 与 Android 相同的 11 个 `*NativeEsp*` 导出；本地 Swift 类无需 import 直接调 |
| iOS 客户端 | [utils/provisioning/iosEspProvisioningClient.uts](../utils/provisioning/iosEspProvisioningClient.uts) | 实现 `EspProvisioningClient`，错误码与 Android 一致 |
| 注册 | [App.uvue](../App.uvue) | `#ifdef APP-IOS` → `registerIosEspProvisioningProvider()` |
| 平台开关 | [uni_modules/nuwax-esp-provisioning/package.json](../uni_modules/nuwax-esp-provisioning/package.json) | `app-ios: "y"` |
| 蓝牙权限文案 | [manifest.json](../manifest.json) | `NSBluetoothAlwaysUsageDescription` / `NSBluetoothPeripheralUsageDescription` |

> Swift 桥已用 ESPProvision 3.1.0 真实源码编成 module 后 `swiftc -typecheck` 通过（exit 0）。
> iOS 端无法用 HBuilderX CLI 预编译验证（含 pods 必须走自定义基座），故正确性以此 type-check 为准。

## 二、一次性准备

1. **uni-app x iOS 离线 SDK**：版本需与本机 HBuilderX（5.15）匹配，下载后工程为
   `iOS-SDK/SDK/HBuilder-Hello/HBuilder-Hello.xcodeproj`（**不是** HBuilder-Integrate）。
2. **DCloud 离线 AppKey**：dev.dcloud.net.cn 为 appid `__UNI__8BF05E4` 申请，填入工程 `Info.plist` 的 `dcloud_appkey`。
3. **签名材料**（已备好，`~/Downloads/Nuwa iOS 证书/`，p12 密码 `Admin123`）：
   - 开发证书 + `Nuwa_iOS_Dev.mobileprovision`（AppID `<REDACTED>.com.nuwax.nuwa`，含 HotspotConfiguration entitlement）。
   - **bundle id 固定 `com.nuwax.nuwa`**；蓝牙只需 Info.plist 文案，无需额外 entitlement。
4. **CocoaPods** 1.17.0。
5. **Xcode 版本（关键，见下）**。

## 三、Xcode 版本匹配（最容易踩的坑，先看这个）

uni-app x 的运行时框架 `DCloudUniappRuntime` 是 **DCloud 用 Swift 6.2.4（Xcode 26.3）预编译**的二进制。
Swift 编译器对预编译模块做**严格版本校验**：用过新的工具链会直接报

```
error: failed to build module 'DCloudUniappRuntime'; this SDK is not supported by the compiler
(the SDK is built with 'Apple Swift version 6.2.4 ...', while this compiler is '6.3.3 ...')
```

| 本机 Xcode | Swift | 能否编 UTS 插件 | 能否跑 iPhone(iOS 26) |
|---|---|---|---|
| 26.6 | 6.3.3 | ❌ 拒收 6.2.4 模块 | ✓ |
| **26.3** | **6.2.4** | **✓ 正好匹配** | **✓（iOS 26.2 SDK）** |

**结论：另装一个 Xcode 26.3（与 26.6 并存）**，用它编基座。下载：
`https://developer.apple.com/download/all/?q=Xcode%2026.3`（`Xcode_26.3.xip`，~8GB），解压为 `/Applications/Xcode-26.3.app`。

切换工具链（编基座用 26.3，日常可切回 26.6）：

```bash
sudo xcode-select -s /Applications/Xcode-26.3.app/Contents/Developer   # 编基座
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer        # 切回 26.6
```

## 四、生成 App 资源（每次 uts/uvue 改动后）

HBuilderX 菜单：**发行 → 原生App-本地打包 → 生成本地打包App资源**。

产物在 `unpackage/resources/app-ios/`：
- `__UNI__8BF05E4/www/` → 拷到工程 `Pandora/apps/__UNI__8BF05E4/`
- `uni_modules/<plugin>/utssdk/app-ios/`（已把 `index.uts` 编译成 `index.swift` 并把 Swift 桥归置到 `src/`）
  → 拷到工程 `UTSPlugins/<plugin>/app-ios/`

```bash
SDKH="/Users/apple/workspace/iOS-SDK 5.15/SDK/HBuilder-Hello"
SRC="/Users/apple/workspace/nuwax-mobile/unpackage/resources/app-ios"
# www
rm -rf "$SDKH/HBuilder-Hello/Pandora/apps/__UNI__8BF05E4"
cp -R "$SRC/__UNI__8BF05E4" "$SDKH/HBuilder-Hello/Pandora/apps/"
# 两个 UTS 插件
for P in nuwax-esp-provisioning uni-cmark; do
  rm -rf "$SDKH/UTSPlugins/$P"; mkdir -p "$SDKH/UTSPlugins/$P"
  cp -R "$SRC/uni_modules/$P/utssdk/app-ios" "$SDKH/UTSPlugins/$P/app-ios"
done
```

## 五、工程配置（plist / control.xml / 签名）

以下均在 `HBuilder-Hello.xcodeproj`（app target `HBuilder`）：

- `Info.plist` → `dcloud_appkey` = 申请的 AppKey；两条蓝牙文案改中文。
- `HBuilder-Hello/control.xml` → `<app appid="__UNI__8BF05E4" .../>`（`debug="true"` 保持）。
- **签名（手动）**：bundle id `com.nuwax.nuwa`、`DEVELOPMENT_TEAM = <REDACTED>`、
  `PROVISIONING_PROFILE_SPECIFIER = <描述文件UUID>`（**用 UUID 不用名字**；先把
  `.mobileprovision` 拷到 `~/Library/MobileDevice/Provisioning Profiles/<UUID>.mobileprovision`）。
- 描述文件需**注册该 iPhone 的 UDID**（开发者后台），手机开「开发者模式」。

## 六、CocoaPods 安装

```bash
cd "<iOS-SDK>/SDK/HBuilder-Hello"
export LANG=en_US.UTF-8
pod install        # 之后改用 HBuilder-Hello.xcworkspace
```

成功标志：`Pod installation complete! ... Installing ESPProvision (3.1.0) / SwiftProtobuf / unimoduleNuwaxEspProvisioning ...`

## 七、踩坑记录（本次真实遇到 + 解法）

1. **CocoaPods specs 全量仓库拉不动**（git clone 卡死/exit 137）：
   Podfile 的 `source 'https://github.com/CocoaPods/Specs.git'` 换成 **CDN** `source 'https://cdn.cocoapods.org/'`
   （按需拉单 pod spec，免下几个 GB 的全量仓库）。若还有第二个 `volcengine` 源且没启用 LivePusher，可删。
2. **`uniapp_uts_plugins.rb` 生成的 podspec 校验失败**（缺 authors/homepage/license/source）：
   在 `write_podspec` 补 `s.homepage / s.authors / s.license`，并把 `s.source` 改成
   `{ :git => 'https://example.invalid/local.git', :tag => '1.0.0' }`（本地 path pod 不会被 fetch）。
3. **uni-cmark 报 `frameworks with conflicting names: scopeparser4ios.framework`**：
   根因是生成的 `s.vendored_frameworks = 'Frameworks/**/*.{framework,xcframework}'` 里的 `**`
   同时匹配了外层 `.xcframework` 和内部 device/simulator 两个 `.framework`（basename 相同）。
   改成只匹配顶层：`['Frameworks/*.framework', 'Frameworks/*.xcframework']`。
   （顺带：脚本把 config 的 `frameworks` 全塞 `s.frameworks`，需区分系统 framework 名与 vendored 路径。）
4. **命令行 `PROVISIONING_PROFILE_SPECIFIER=...` 覆盖会传染到 Pods 库 target**（库不能签 profile）：
   签名只在 **app target 的 project.pbxproj** 里设，命令行别传 profile 覆盖。
5. **`No profile for team ... matching 'dev-wildcard'`**：profile specifier 要写成 **UUID**，
   且 app target 的 build config 块（不是 project 级默认块）都要改对。
6. **`import DCloudUniappRuntime` 无法解析 → 版本鸿沟**：
   `uniapp/UTS` 子模块原本只 vendored `DCloudUTSFoundation.framework`，缺 `DCloudUniappRuntime`。
   从 HBuilderX 内置 UTS 模板 `plugins/uts-development-ios/.../xcode_uts_template_x/dependencies/iphoneos/`
   把 `DCloudUniappRuntime.framework`、`DCloudUTSExtAPI.framework` 拷进 `SDK/Libs/`，并加入
   `uniapp.podspec` 的 `UTS` 子模块 `vendored_frameworks`。**但最终卡在第三节的 Swift 版本校验**，
   必须用 Xcode 26.3 编。

## 八、真机验证

1. 桌搭上电，进入配网（或详情页点 BLE 按钮重启进 300s 窗口）。
2. App 扫码（开发二维码带开发 PoP `<REDACTED>`）→ 直连（30s 窗口）→
   Security 2 身份核验（`device-info.serialNumber == QR username`）→ 设备返回 2.4G WiFi 列表 →
   选中输入密码 → 35s 内 `prov-config=connected`（`IP_EVENT_STA_GOT_IP`）即成功。
3. 失败看 Xcode 控制台/设备日志，错误码与 Android 一致
   （`SECURITY_AUTH_FAILED` / `WIFI_AUTH_FAILED` / `NETWORK_NOT_FOUND` / `STATUS_TIMEOUT` / `DEVICE_ID_MISMATCH` …）。

## 九、排障要点

- **标准基座起不来/提示插件不可用**：正常，必须走自定义基座。
- **蓝牙扫不到**：确认两条 `NSBluetooth*UsageDescription` 生效；手机设置里给 App 开蓝牙权限。
- **连接超时**：iOS `createESPDevice` 内部会按名再扫 ~5s，确认设备在 300s 广播窗口内、名称为 `PROV_XXXXXX`。
- **编译报 `DCloudUniappRuntime ... not supported by the compiler`**：Xcode 版本不对，见第三节，换 26.3。
