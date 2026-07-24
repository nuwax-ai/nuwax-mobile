# 本地离线自定义基座 · 维护规范

> 目标：用**可重建**方式维护 iOS / Android（及未来鸿蒙）自定义调试基座，避免云打包费用，并与业务仓解耦。  
> 总览：[esp-provisioning-local-base.md](./esp-provisioning-local-base.md)

## 1. 两仓分工

| 项目 | 路径 | 进 Git？ | 职责 |
|------|------|----------|------|
| 业务仓 | `nuwax-mobile` | ✅ | 插件、脚本、文档、契约、`Makefile` |
| 离线 SDK 仓（本机） | `nuwax-mobile-offline-sdk` | ❌（建议不进业务仓） | 官方 SDK + 可重建工作副本 + zip 归档 |

## 2. 四层模型

| 层 | 位置 | 说明 |
|----|------|------|
| 业务仓 | `nuwax-mobile` | 源码真相 |
| 官方 SDK | `$NUWAX_OFFLINE_SDK_HOME/sdk/{ios,android,harmony}/<ver>/` | 只读解压包，跟 HX 同版本 |
| 工作副本 | `$NUWAX_OFFLINE_SDK_HOME/work/{ios,android,harmony}/` | 可删可重建；禁止当源码仓 |
| 基座产物 | `nuwax-mobile/unpackage/debug/` | gitignore；本机/制品库分发 |

```text
nuwax-mobile/                          # Git
├── docs/local-custom-base-maintenance.md
├── scripts/local-base-env.sh
├── scripts/{ios,android,harmony}-esp/
└── Makefile

nuwax-mobile-offline-sdk/              # 本机统一入口
├── README.md
├── sdk/ios/5.15/…  sdk/android/5.15/…
├── work/ios/  work/android/  work/harmony/
└── archives/*.zip
```

历史路径（`UniAppX-*-5.15`、`nuwax-*-esp`）通过软链指向本目录，可逐步废弃。

## 3. 环境变量

统一入口：`source scripts/local-base-env.sh`。

| 变量 | 默认 | 含义 |
|------|------|------|
| `NUWAX_OFFLINE_SDK_HOME` | `…/nuwax-mobile-offline-sdk` | 离线目录根 |
| `NUWAX_SDK_ROOT` | `$HOME/…/sdk` | 官方 SDK |
| `NUWAX_LOCAL_BASE_ROOT` | `$HOME/…/work` | 工作副本 |
| `NUWAX_HX_VERSION` | `5.15` | 与 HBuilderX 对齐 |
| `NUWAX_MAIN_ROOT` | 业务仓根 | 同步 `unpackage/debug` |

兼容旧名：`UNIAPPX_SDK_ROOT`、`IOS_ESP_BUILD_ROOT`、`ANDROID_ESP_WORK` 等仍可覆盖。

## 3. 日常命令（仅出包）

先 HX「生成本地打包 App 资源」，再：

```bash
cd /Users/apple/workspace/nuwax-mobile
make base-android          # → unpackage/debug/android_debug.apk
make base-ios-device        # → unpackage/debug/iOS_debug.ipa
make base-ios-simulator    # → unpackage/debug/Pandora_simulator_debug.app
make base-all              # 三份一起打（不装设备）
```

| 文件 | 用途 |
|------|------|
| `android_debug.apk` | Android 真机 / 模拟器（同一包） |
| `iOS_debug.ipa` | **iOS 真机** HX 自定义基座 |
| `Pandora_simulator_debug.app` | **iOS 模拟器**（官方命名；与真机包分离，勿混用） |

一键脚本：`./scripts/package-custom-bases.sh`（`TARGETS=android,ios-device,ios-simulator`）。

## 5. 升级清单（换 HX / SDK）

1. 下载同版本官方 zip → `nuwax-mobile-offline-sdk/archives/`，解压到 `sdk/<platform>/<ver>/`。  
2. `export NUWAX_HX_VERSION=<新版本>`。  
3. 删 `work/<platform>/` 或 `FORCE_BOOTSTRAP=1` 后重建。  
4. 跑通 `make base-ios` / `base-android` 并验收。  
5. 更新平台文档版本表。

## 6. 禁止项

- 禁止把 `sdk/`、`work/` 提交进 `nuwax-mobile`。  
- 禁止手改 `sdk/` 当补丁源；补丁写进业务仓 `scripts/`。  
- 禁止只改 `work/` 里的插件拷贝而不改 `uni_modules/`。  
- iOS 须匹配 `DCloudUniappRuntime` 的 Xcode/Swift 版本。

## 7. 脏工程自愈

```bash
rm -rf "$NUWAX_OFFLINE_SDK_HOME/work/android"
FORCE_BOOTSTRAP=1 ./scripts/android-esp/official/setup_sdk.sh
make base-android

rm -rf "$NUWAX_OFFLINE_SDK_HOME/work/ios"
# 再按 iOS 文档跑 A→D
```

## 8. 鸿蒙预留

`sdk/harmony/`、`work/harmony/`、`scripts/harmony-esp/`、`docs/harmony-esp-provisioning-local-base.md` 已占位；官方 SDK 就绪后按 Android/iOS 同构补齐。
