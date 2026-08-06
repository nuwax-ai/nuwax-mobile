# 本地离线自定义基座 · 维护规范

> 目标：用**可重建**方式维护 iOS / Android（及未来鸿蒙）自定义调试基座，避免云打包费用，并与业务仓解耦。  
> 总览：[esp-provisioning-local-base.md](./esp-provisioning-local-base.md)

## 1. 三处本机分工

| 项目 | 路径 | Git | 职责 |
|------|------|-----|------|
| 业务仓 | `nuwax-mobile` | ✅ 可推远程 | 插件、脚本、文档、契约、`Makefile`；`local-secrets.env.example` 仅模板 |
| 离线 SDK（本机） | `nuwax-mobile-offline-sdk` | ✅ **仅本地**（禁 push）；**团队同步走 S3** | 官方 SDK + `work/` + `archives/`；**不含任何证书**。说明见该目录 [README.md](../../nuwax-mobile-offline-sdk/README.md) |
| 签名材料（本机） | `nuwax-signing`（`NUWAX_SIGNING_HOME`） | ✅ **仅本地**（禁 remote / push） | 签名实体 + **`local-secrets.env` / `local-secrets.env.example`**；永不进业务仓远程 / SDK / S3 |

关系：`local-base-env.sh` 派生 SDK 路径 → **优先** source `$NUWAX_SIGNING_HOME/local-secrets.env`。首次配置：`cp $NUWAX_SIGNING_HOME/local-secrets.env.example $NUWAX_SIGNING_HOME/local-secrets.env`。业务仓 `scripts/local-secrets.env.example` 为同步空模板（便于查阅，勿填真实值推远程）。

## 2. 四层模型

| 层 | 位置 | 说明 |
|----|------|------|
| 业务仓 | `nuwax-mobile` | 源码真相 |
| 官方 SDK | `$NUWAX_OFFLINE_SDK_HOME/sdk/{ios,android,harmony}/<ver>/` | 只读解压包，跟 HX 同版本 |
| 工作副本 | `$NUWAX_OFFLINE_SDK_HOME/work/{ios,android,harmony}/` | 可删可重建；禁止当源码仓 |
| 基座产物 | `nuwax-mobile/unpackage/debug/` | gitignore（仅 README 入库）；**S3 分发**见 [custom-base-distribution-s3.md](./custom-base-distribution-s3.md) |

```text
nuwax-mobile/                          # Git
├── docs/local-custom-base-maintenance.md
├── scripts/local-base-env.sh
├── scripts/local-secrets.env.example  # 与签名目录模板字段同步；勿填真实值推远程
├── scripts/{ios,android,harmony}-esp/
└── Makefile

nuwax-mobile-offline-sdk/              # 本机：本地 Git + S3 分发（无证书）
├── README.md                          # 本机说明（本地 Git vs S3）
├── docs/LOCAL-AND-S3.md
├── sdk/ios/…  sdk/android/…           # 大文件：gitignore；靠 sdk-fetch
├── work/ios/  work/android/  …
└── archives/*.zip

nuwax-signing/                         # 本机：签名 + 口令权威（敏感）
├── local-secrets.env.example          # 权威空模板
├── local-secrets.env                  # 本机实值（仅本地 Git）
├── android/  ios-app/  macos-…/  windows-ev/
└── （本机 README / 上架指南；仅本地 Git）
```
历史路径（`UniAppX-*-5.15`、`nuwax-*-esp`）通过软链指向本目录，可逐步废弃。

## 3. 环境变量

统一入口：`source scripts/local-base-env.sh`。

| 变量 | 默认 | 含义 |
|------|------|------|
| `NUWAX_OFFLINE_SDK_HOME` | `…/nuwax-mobile-offline-sdk` | 离线 SDK 根（无证书） |
| `NUWAX_SIGNING_HOME` | `…/nuwax-signing` | 签名材料根；含 `local-secrets.env(.example)` |
| `NUWAX_SDK_ROOT` | `$NUWAX_OFFLINE_SDK_HOME/sdk` | 官方 SDK |
| `NUWAX_LOCAL_BASE_ROOT` | `$NUWAX_OFFLINE_SDK_HOME/work` | 工作副本 |
| `NUWAX_HX_VERSION` | 见 `local-base-env.sh` | 与 HBuilderX 对齐 |
| `NUWAX_MAIN_ROOT` | 业务仓根 | 同步 `unpackage/debug` |

兼容旧名：`UNIAPPX_SDK_ROOT`、`IOS_ESP_BUILD_ROOT`、`ANDROID_ESP_WORK` 等仍可覆盖。

## 3. 日常命令

### 3.1 维护者一键（推荐）

`base-ship` = 生成本地打包 App 资源 → 打三端基座 → 上传 S3：

```bash
cd <本仓根目录>  # nuwax-mobile
# 需先打开 HBuilderX，且项目已导入；发 S3 需 NUWAX_S3_* 或 ~/.aws
make base-ship
# 或：pnpm base:ship
```

| 开关 | 含义 |
|------|------|
| `SKIP_APP_RESOURCE=1` | 跳过 HX `publish app --type appResource`（资源已就绪时） |
| `SKIP_PUBLISH=1` | 跳过 S3，只本地出包 |
| `TARGETS=android` 等 | 只打部分平台（同 `package-custom-bases.sh`） |

实现：[`scripts/ship-custom-bases.sh`](../scripts/ship-custom-bases.sh)。

### 3.2 仅出包（不上传）

先 HX「生成本地打包 App 资源」（或 CLI：`pnpm hx:…` / `scripts/hx-cli.sh publish app --type appResource`），再：

```bash
make base-android          # → unpackage/debug/android_debug.apk
make android-tester        # → 发测试 Release：appResource + ENABLE_HX_DEBUG=0 + assembleRelease
make base-ios-device        # → unpackage/debug/iOS_debug.ipa
make base-ios-simulator    # → unpackage/debug/Pandora_simulator_debug.app
make base-all              # 三份一起打（不装设备、不上 S3）
```

| 文件 | 用途 |
|------|------|
| `android_debug.apk` | Android 真机 / 模拟器（同一包；默认含 HX `debug-server`，见 `ENABLE_HX_DEBUG`） |
| `android_release.apk` | 给测试的接近发行包：`ENABLE_HX_DEBUG=0 ANDROID_BUILD_TYPE=release make base-android`（内测 debug 签名，非上架） |
| `iOS_debug.ipa` | **iOS 真机** HX 自定义基座 |
| `Pandora_simulator_debug.app` | **iOS 模拟器**（官方命名；**Release + 默认 x86_64/Rosetta**，对齐 ExtAPI 仅有的 x86_64-sim；与真机包勿混用） |

一键出包（不含资源/S3）：`./scripts/package-custom-bases.sh`（`TARGETS=android,ios-device,ios-simulator`）。

Android 调试基座：`configure_app.py` 默认 `ENABLE_HX_DEBUG=1`（`app/libs/debug-server` + `DCLOUD_DEBUG`），否则 HX 控制台无 `console.log`。正式向 / 发测试包用 `ENABLE_HX_DEBUG=0`，并建议 `ANDROID_BUILD_TYPE=release`（`assembleRelease`，debuggable=false）。`configure_app.py` 会把官方示例的 LeakCanary 改为 `debugImplementation`，避免 Release 启动闪退。

iOS 模拟器注意：官方 5.15 `DCloudUTSExtAPI` 无 arm64-simulator slice。Apple Silicon 上若出现「UTS-Storage / uni-getSystemInfo 模块不存在」，请用脚本默认的 `SIM_FORCE_X86_64=1` 重打，并安装/选用 **支持 Rosetta** 的 iOS Simulator runtime（见 DCloud 模拟器文档）。

## 4. S3 分发（同事免打包）

版本默认 = `manifest.json` 的 `versionName`；**同版本覆盖**；同事 **不指定版本 = 最新**（安装/同步更新）。

```bash
make base-ship       # 维护者：资源 + 出包 + 上传（推荐）
make base-publish    # 仅上传当前 unpackage/debug（需 NUWAX_S3_* 或 ~/.aws）
make base-fetch      # 拉最新到 unpackage/debug/
```

详见 [custom-base-distribution-s3.md](./custom-base-distribution-s3.md)。仅用自定义基座的同事不需要 iOS 开发证书。

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
