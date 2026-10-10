# iOS 桌搭 BLE 配网 · 本地自定义基座（官方对齐）

> 适用：iPhone 真机调试 ESP32-S3 BLE 配网（Security 2），**零云打包费用**。  
> 对齐官方文档：
> - [制作 DCloudUTSExtAPI](https://doc.dcloud.net.cn/uni-app-x/native/modules/ios/modules.html)
> - [制作 UTS 插件](https://doc.dcloud.net.cn/uni-app-x/native/use/iosuts.html)
> - [启动与通信](https://doc.dcloud.net.cn/uni-app-x/native/use/iosapi.html)
> - [原生联调](https://doc.dcloud.net.cn/uni-app-x/native/debug/ios.html)
> - [SDK 下载](https://doc.dcloud.net.cn/uni-app-x/native/download/ios.html)
>
> 脚本：[`scripts/ios-esp/`](../scripts/ios-esp/)（含 [`official/`](../scripts/ios-esp/official/)）  
> 维护规范：[local-custom-base-maintenance.md](./local-custom-base-maintenance.md)

## 官方对齐总表

| 官方要求 | 本仓实现 | 状态 |
|---------|---------|------|
| SDK 5.15 与 HX 同版本 | `UniAppX-iOS@5.15`，`uniRuntimeVersion=5.15` | 已对齐 |
| ExtAPI 按模块 Embed | TemporarySample → `SDK/Libs/DCloudUTSExtAPI.xcframework`；`setup_extapi.sh` + manifest 校验 | 已对齐（使用 SDK 预置完整 ExtAPI，而非从零手搓源码） |
| UTS 插件 Framework 工程 | `unimoduleNuwaxEspProvisioning`：UTSOC / uts-config / Dynamic / `-ObjC` / Verifier NO | 已对齐 |
| `dependencies-pods: ESPProvision` | 插件 `config.json` 保留（云打包）；本地用**同源码编译**的 framework（见下「Distribution 坑」） | 结果对齐 |
| 主工程 Embed & Sign | `inject_frameworks.py` | 已对齐 |
| Target=`UniAppX`、`ipatype=1`、DebugServe | `configure_demo.py` | 已对齐 |
| 方案1 `iOS_debug.ipa` → `unpackage/debug/` | `build_device_base.sh` 自动打包同步 | 已对齐 |
| 方案2 原生工程基座指 `.app` | 脚本结束打印 DerivedData 路径 | 已对齐 |
| Workspace 源码断点 | `official/setup_workspace.sh` → `NuwaxUniAppX.xcworkspace` | 已对齐 |

### 刻意说明（与文档字面的差异）

1. **无 HBuilder-Hello / 无主工程 Podfile**：5.15 zip 只有 `UniAppXDemo`；本地不走 `pod install` 到 Demo。  
2. **ESPProvision 不开启 `BUILD_LIBRARY_FOR_DISTRIBUTION`**：模块名与类名均为 `ESPProvision`，开 Distribution 会生成坏的 `swiftinterface`，下游无法 `import`。官方链路脚本用 `-allow-internal-distribution` 打 xcframework。  
3. **UTSOC.h/mm**：5.15 的 `SDK/ExtApiSrc` 无此文件，按 SDK 内 `UTSPluginExample` 拷贝（与官方示例一致）。  
4. **云打包路径不动**：`utssdk/app-ios/config.json` 的 `dependencies-pods` 继续给云端用。

## 环境

路径全部由 [`scripts/local-base-env.sh`](../scripts/local-base-env.sh) 统一派生（基于 `NUWAX_OFFLINE_SDK_HOME`，默认 `$HOME/workspace/nuwax-mobile-offline-sdk`）。**不要写死 `/Users/xxx`**；本机没有 SDK 时先拉取（见 [offline-sdk-distribution-s3.md](./offline-sdk-distribution-s3.md)）：

```bash
cd <本仓根目录>                       # nuwax-mobile
make sdk-fetch                        # 本机没有离线 SDK 时拉取
source scripts/local-base-env.sh      # 自动派生 UNIAPPX_SDK_ROOT / IOS_ESP_BUILD_ROOT / IOS_ESP_OUT …
```

敏感值（离线 AppKey / Team / Profile UUID）写到 `scripts/local-secrets.env`（已 gitignore），`local-base-env.sh` 会自动 source，**勿入仓库**。

> ⚠️ SDK 路径已迁移到 `$NUWAX_OFFLINE_SDK_HOME/sdk/ios/5.15/...`，**旧的 `/Users/.../UniAppX-iOS-5.15` 已作废**。

- Xcode **26.3 / Swift 6.2.4**（与 `DCloudUniappRuntime` 匹配）  
- bundle `com.nuwax.app`；离线 AppKey / Team / Profile UUID 见 `scripts/local-secrets.env`（gitignore）

## 标准流程（A → B → C → D）

```bash
cd <本仓根目录>                # nuwax-mobile
source scripts/local-base-env.sh

# 0) HBuilderX：发行 → 原生App-本地打包 → 生成本地打包App资源
#    产物：unpackage/resources/app-ios/

# 也可：make base-ios（需已完成 ExtAPI / 插件链）

# A) ExtAPI 规范化 + manifest 校验
./scripts/ios-esp/official/setup_extapi.sh

# B) 官方插件链：SwiftProtobuf → ESPProvision → unimodule（源码编译）
#    默认真机；模拟器加：OFFICIAL_PLATFORM=all
./scripts/ios-esp/official/build_esp_chain.sh

# C) Workspace（源码断点）
./scripts/ios-esp/official/setup_workspace.sh
# open "$IOS_ESP_BUILD_ROOT/official/workspace/NuwaxUniAppX.xcworkspace"

# 注入 Demo + 配置
python3 scripts/ios-esp/inject_frameworks.py
python3 scripts/ios-esp/strip_sample_unimodules.py
python3 scripts/ios-esp/configure_demo.py

# D) 真机自定义基座 + iOS_debug.ipa → unpackage/debug/
./scripts/ios-esp/build_device_base.sh
```

### HX 联调两种官方方式

| 方式 | 操作 |
|------|------|
| **方案1** | 脚本已写入 `unpackage/debug/iOS_debug.ipa` → HX「使用自定义基座运行」 |
| **方案2** | HX「原生工程基座」填 `build_device_base` 打印的 `UniAppX.app` 路径 |

## 目录约定

| 路径 | 用途 |
|------|------|
| `uni_modules/nuwax-esp-provisioning/utssdk/app-ios/` | 仓库源码（桥 + config.json） |
| `$IOS_ESP_BUILD_ROOT/src/` | 生成工程用的源码树 |
| `$IOS_ESP_BUILD_ROOT/unimoduleNuwaxEspProvisioning/` | 官方结构插件 xcodeproj |
| `$IOS_ESP_BUILD_ROOT/official/build/frameworks-iphoneos/` | 无 Distribution 的 `.framework` |
| `$IOS_ESP_OUT/*.xcframework` | Embed 用产物（同步到 `SDK/Libs`） |
| `$IOS_ESP_BUILD_ROOT/official/workspace/NuwaxUniAppX.xcworkspace` | 联调 Workspace |

## 真机验收（桌搭）

扫码（开发 PoP）→ Sec2 → `device-info.serialNumber` → Wi‑Fi → 35s 内 `GOT_IP`。  
锁屏时 `devicectl launch` 会失败，解锁后点图标即可。

## 云打包兜底

本机证书/SDK 不可用时：`cli pack --iscustom true`（按次计费）。插件 `config.json` 仍声明 `ESPProvision 3.1.0`。

## 历史说明

旧文 `HBuilder-Hello` + `pod install` **已废弃**（5.15 zip 无此工程）。  
旧 backup xcframework 仅作回滚，日常以 `official/build_esp_chain.sh` 为准。
