# AGENTS.md

本文档为 AI 助手提供本项目的开发指引。  
`CLAUDE.md` 为指向本文件的软链（社区常见做法，正文只维护此处）。

## 项目概述

女娲智能体移动端（nuwax-mobile），基于 **uni-app x**（Vue 3 + UTS）的跨平台 AI 智能体应用。

- 目标平台：Android / iOS / 鸿蒙 / H5（WEB，部署在 `{domain}/m/` 路径）/ 微信小程序（见 [platformConfig.json](platformConfig.json)）
- DCloud appid：`__UNI__8BF05E4`，微信小程序 appid：`wxbdaaa9ecab166aee`（见 [manifest.json](manifest.json)）
- 入口：[main.uts](main.uts)、[App.uvue](App.uvue)、[pages.json](pages.json)
- 主要目录：`pages/`（主包页面）、`subpackages/`（分包页面）、`components/`（可复用组件）、`servers/`（API 请求层，UTS）、`hooks/`、`utils/`、`constants/`、`types/`、`scripts/`（工程脚本）、`docs/`（设计与对接文档）
- 包管理：仓库同时存在 `pnpm-lock.yaml` 与 `yarn.lock`，根目录依赖主要是 Web 端渲染相关库（markdown-it、katex、文件预览等），不用于 App 端编译

## 产品线分支规范

仓库用两条长期 `release/*` 产品线区分「开源通用基座」与「桌搭自定义基座」。**日期月份只用于版本需求开发分支**，不得用在长期产品线上（禁止再用 `feat-app-zhuoda`、`feature/2026.07-zhuoda-dong` 这类名字当长期线）。

### 长期产品线

| 分支 | 产品 | 基座 | 合入 / 上线 |
|---|---|---|---|
| `release/nuwa-basic` | 开源 Nuwax App（可合 `main`） | uni-app x **官方通用基座** | → `main`；也可被桌搭线合入 |
| `release/nuwa-zhuoda` | 桌搭 App（终端 Tab 等） | **自定义基座**（`pnpm base:fetch` / 本地打基座） | **当前生产上线线**；不反向合入 basic |

### 版本需求开发分支（须带产品线 + 年月）

格式：`feat/nuwa-<line>-<YYYY.MM>`（月度合集）或 `feat/nuwa-<line>-<YYYY.MM>-<slug>`（单需求）。`YYYY.MM` 为需求启动月（两位月份），合入对应产品线后可删分支。

| 用途 | 命名格式 | 从哪拉 | 合回哪 |
|---|---|---|---|
| 开源月度迭代 | `feat/nuwa-basic-<YYYY.MM>` | `release/nuwa-basic` | `release/nuwa-basic` → 再择机合 `main` |
| 开源单需求 | `feat/nuwa-basic-<YYYY.MM>-<slug>` | `release/nuwa-basic` | 同上 |
| 桌搭月度迭代 | `feat/nuwa-zhuoda-<YYYY.MM>` | `release/nuwa-zhuoda` | `release/nuwa-zhuoda` |
| 桌搭单需求 | `feat/nuwa-zhuoda-<YYYY.MM>-<slug>` | `release/nuwa-zhuoda` | 同上 |
| 开源线紧急修复 | `fix/nuwa-basic-<YYYY.MM>-<slug>` | `release/nuwa-basic` | `release/nuwa-basic` |
| 桌搭线紧急修复 | `fix/nuwa-zhuoda-<YYYY.MM>-<slug>` | `release/nuwa-zhuoda` | `release/nuwa-zhuoda` |

示例：

- `feat/nuwa-basic-2026.07` / `feat/nuwa-zhuoda-2026.07` —— 当月版本开发合集分支
- `feat/nuwa-basic-2026.07-provision-wifi` —— 开源线单需求
- `feat/nuwa-zhuoda-2026.07-terminal-meeting` —— 桌搭单需求
- `fix/nuwa-zhuoda-2026.07-ble-scan` —— 桌搭 BLE 扫描热修

`slug` 用小写英文短横线，**只概括需求主题**（如 `terminal-meeting`、`provision-wifi`）；**禁止**人名、花名、个人后缀（如 `-dong`）。同一版本迭代可多个单需求分支并行。

### 流向（单向）

```text
feat/nuwa-basic-<YYYY.MM>[-<slug>]    →  release/nuwa-basic  →  main
                                               ↓ 定期 merge
feat/nuwa-zhuoda-<YYYY.MM>[-<slug>]   →  release/nuwa-zhuoda  →  生产发版
```

### 派生与合入规则

- **禁止**桌搭专属提交直接合入 `release/nuwa-basic` / `main`
- **推荐**定期把 `release/nuwa-basic` merge 进 `release/nuwa-zhuoda`
- `dev` 与历史 `feat-2026.*` 等旧分支保留不动；新需求一律按上表命名，**不要**再写 `feat/2026.07`、`feat/zhuoda/2026.07`、`feat-2026.7.18`、`feature/2026.07-zhuoda-dong` 这类旧格式

旧名对照（已删除远程旧分支）：`feat-app-zhuoda` → `release/nuwa-basic`；`feature/2026.07-zhuoda-dong` → `release/nuwa-zhuoda`。本地若仍停在旧名，执行 `git fetch --prune` 后切到对应 `release/*`。

## 构建工具链（重要）

**本项目没有 `uni` CLI / vite 的 npm scripts，所有平台的编译、运行、打包都必须通过 HBuilderX 完成**（本机安装版本 5.15，路径 `/Applications/HBuilderX.app`）。uni-app x 的 uts/uvue 编译依赖 HBuilderX 内置的编译器，不要尝试 `npx vite build` 或 `npm run dev` 来跑 App 端。

- HBuilderX CLI：`/Applications/HBuilderX.app/Contents/MacOS/cli`（建议软链或加入 PATH：`ln -sf /Applications/HBuilderX.app/Contents/MacOS/cli /usr/local/bin/hx-cli`）
- 内置 node：`/Applications/HBuilderX.app/Contents/HBuilderX/plugins/node/node`（v22.22.2）与 `plugins/node18/node`（v18.20.0）
- 内置 adb：`/Applications/HBuilderX.app/Contents/HBuilderX/plugins/launcher-tools/tools/adbs/adb`（35.0.2），系统未单独安装 adb 时用它
- 使用 CLI 前先启动 HBuilderX 主程序，项目需已导入 HBuilderX（本项目导入名称为 `nuwax-mobile`，可用 `cli project list` 确认）

## Android 调试（HBuilderX CLI）

日常 Android 调试优先使用 HBuilderX CLI 完成，无需打开 HBuilderX 界面点按钮。

```bash
CLI=/Applications/HBuilderX.app/Contents/MacOS/cli

# 1. 查看已连接设备（模拟器或真机）
$CLI devices list
# 输出示例：Pixel_10_Pro_XL【emulator-5554】
# 真机需开启 USB 调试；也可用内置 adb 检查：
# .../launcher-tools/tools/adbs/adb devices

# 2. 编译并运行到 Android（默认第一台设备，标准基座）
$CLI launch app-android --project nuwax-mobile

# 常用选项：
#   --deviceId emulator-5554     指定设备
#   --cleanCache true            清理 uni-app x 构建缓存（编译异常/缓存不一致时用）
#   --compile true               只编译不安装运行（快速验证编译是否通过）
#   --continue-on-error true     编译出错后继续运行
#   --pagePath pages/index/index --pageQuery "a=1&b=2"   指定启动页与参数
#   --playground custom          自定义基座（需云打包基座）

# 3. 查看运行日志（uni-app x 应用日志）
$CLI logcat app-android --project nuwax-mobile
#   --mode lastBuild   最近一次运行的日志（默认 prevBuild）
#   --deviceId ...     指定设备

# 4. 更底层的原生日志可用内置 adb：
ADB=/Applications/HBuilderX.app/Contents/HBuilderX/plugins/launcher-tools/tools/adbs/adb
$ADB -s emulator-5554 logcat | grep -iE "uts|uniapp|console"
```

## iOS 调试（HBuilderX CLI）

```bash
CLI=/Applications/HBuilderX.app/Contents/MacOS/cli

# 查看设备（真机 + 模拟器）
$CLI devices list --platform ios-iPhone
$CLI devices list --platform ios-simulator

# 跑模拟器（无需签名，先验证编译/UI 用这条）
$CLI launch app-ios --project nuwax-mobile --iosTarget simulator --deviceId <UDID>

# 跑真机
$CLI launch app-ios --project nuwax-mobile --iosTarget device --deviceId <设备序列号>

# 看日志
$CLI logcat app-ios --project nuwax-mobile
```

**iOS 真机签名（重要）**：iOS 真机无法运行未签名的标准基座，三条路：

1. **模拟器** —— 无需签名，但不能装微信/支付宝，支付链路只能验证到 `app-native` 请求
2. **重签名标准基座** —— 用自己的 Apple 证书签 `plugins/uniappx-launcher/base/iPhone_base.ipa`（bundle id `io.dcloud.uniappx`），替换后跑真机。iPhone 需开启开发者模式
3. **自定义基座** —— 调试支付/推送/ESP 配网等原生插件时必需（标准基座不含这些 UTS 原生模块）。基座从 S3 同步，见下一节。

排障要点：

- 编译产物输出到 `unpackage/dist/dev/app-android/`，该目录已 gitignore，不要提交
- 编译报错与代码状态不一致时，先加 `--cleanCache true` 重试
- 快速检查编译是否通过（不跑设备）可参考现成脚本 [scripts/run-uni-build.sh](scripts/run-uni-build.sh)，它直接调起 HBuilderX 内置的 uni 编译器并把错误摘要到终端
- H5/微信小程序同样走 HBuilderX（菜单 运行/发行），CLI 侧重 App 端

## 本地自定义基座打包流程（含离线 SDK）

含原生插件（ESP 配网 / 支付 / 推送 等）联调时必须用**自定义基座**（标准基座不含这些 UTS 模块）。两种得到方式：

- **A. 直接拉现成基座**（最快，无需 SDK/证书）：`make base-fetch`（见下文「自定义基座同步更新」）
- **B. 本机从源码打**（改了原生插件 / 需重签 iOS 真机包时）：按下面完整流程

### B. 完整流程

```bash
# Step 0  拉离线 SDK（仅首次 / 换机器 / 升级 HX；本机已有则跳过）
make sdk-fetch                       # → NUWAX_OFFLINE_SDK_HOME（sdk/ + archives/，不含 work/ 与证书）

# Step 1  派生各平台路径（UNIAPPX_*_SDK_ROOT / *_ESP_WORK 等）
source scripts/local-base-env.sh     # 若提示缺 SDK，回到 Step 0

# Step 2  生成本地打包 App 资源（HX CLI，iOS+Android 一起出；需 HBuilderX 已启动 + 项目已导入）
make app-resource                 # = cli publish app --type appResource --project <本仓绝对路径>
#   产物：unpackage/resources/app-ios、app-android

# Step 3  出基座（按目标选一个）
make base-android                    # → unpackage/debug/android_debug.apk
make base-ios-device                 # → unpackage/debug/iOS_debug.ipa（真机，需证书）
make base-ios-simulator              # → Pandora_simulator_debug.app（模拟器，免签）

# Step 4  iOS 真机另需自备 Apple 证书 / Profile / DCloud AppKey（不随 SDK 分发）

# Step 5  用 / 发
#   HX：运行 → 使用自定义基座运行 → 选 unpackage/debug 下对应包
#   或发给同事：make base-publish   /   make base-ship（一键：资源→出包→S3）
```

要点：
- iOS 真机与模拟器是**两套包**，勿混用；模拟器包免签但不能验支付/推送等原生链路。
- **改了 UTS 原生插件** → Step 0/1 免（SDK 不变），从 Step 2 重跑（重新生成本地资源 + Step 3 重打基座）。
- **仅改 uvue/uts 业务代码** → 直接 HX「使用自定义基座运行」热更，不必重打基座。
- 详细：[docs/local-custom-base-maintenance.md](docs/local-custom-base-maintenance.md)、[offline-sdk-distribution-s3.md](docs/offline-sdk-distribution-s3.md)、各平台 [android](docs/android-esp-provisioning-local-base.md) / [ios](docs/ios-esp-provisioning-local-base.md)。

## 自定义基座同步更新

含原生插件联调时，从 S3 拉最新基座到 `unpackage/debug/`（**不指定版本 = 最新**）。详情：[docs/custom-base-distribution-s3.md](docs/custom-base-distribution-s3.md)。

```bash
pnpm base:fetch
# 或：make base-fetch
# 或：curl -fsSL https://s3.nuwax.com:9443/nuwax-packages/mobile-custom-bases/fetch-custom-base-s3.sh | bash
# 自签证书：NUWAX_S3_INSECURE=1
# 固定版本：NUWAX_BASE_VERSION=1.0.0 pnpm base:fetch
```

HX：运行 → **使用自定义基座运行** → 选 `unpackage/debug/` 下 apk / ipa / 模拟器 `.app`（真机与模拟器勿混用）。仅同步使用**不需要**本机打基座，也不需要 iOS 开发证书。

## 离线 SDK 同步

本地自定义基座需要 uni-app x 离线 SDK + 乐鑫配网依赖。从 S3 拉取到 `NUWAX_OFFLINE_SDK_HOME`（默认 `$HOME/workspace/nuwax-mobile-offline-sdk`）：**只含 `sdk/ + archives/`，不含 `work/`（跨机不可用，由构建脚本生成），也不含 iOS 证书**。详情：[docs/offline-sdk-distribution-s3.md](docs/offline-sdk-distribution-s3.md)。

```bash
make sdk-fetch
# 或：curl -fsSL https://s3.nuwax.com:9443/nuwax-packages/mobile-offline-sdk/fetch-offline-sdk-s3.sh | bash
# 自签证书：NUWAX_S3_INSECURE=1
# 固定版本：NUWAX_HX_VERSION=5.15 make sdk-fetch
# 维护者发布：make sdk-publish
```

拉取后 `source scripts/local-base-env.sh` 派生各平台路径，再 `make base-*` 出基座。**iOS 真机基座另需自备 Apple 证书 / Profile / AppKey**（不随 SDK 分发，各端通过受控渠道配置）。

## 其他可用脚本

```bash
pnpm i18n:audit            # i18n 文案审计
pnpm i18n:export-defaults  # 导出平台默认文案
pnpm verify:mcp-ask        # 校验 mcp-ask 契约
pnpm uni:build             # 编译 app-android 并提取关键错误
pnpm base:fetch            # 同步最新自定义基座（S3）
pnpm base:publish          # 发布自定义基座到 S3（维护者）
pnpm base:ship             # 一键：appResource → 出包 → 上传 S3（维护者）
pnpm base:help             # 列出 make 基座相关目标
pnpm sdk:fetch             # 拉取离线 SDK（sdk/+archives/，首次/换机）
pnpm sdk:publish           # 发布离线 SDK 到 S3（维护者）

# HBuilderX CLI（需本机已开 HX；项目名默认 nuwax-mobile；可用 HX_CLI / HX_PROJECT 覆盖）
pnpm hx:devices            # 列出已连接设备
pnpm hx:android            # 运行到 Android（标准基座，默认第一台）
pnpm hx:android:custom     # 运行到 Android（自定义基座）
pnpm hx:android:compile    # 只编译不安装
pnpm hx:android:clean      # 清缓存后运行
pnpm hx:android:log        # Android 应用日志
pnpm hx:ios:devices        # iOS 真机列表
pnpm hx:ios:simulators     # iOS 模拟器列表
pnpm hx:ios:sim -- --deviceId <UDID>      # 跑模拟器（须指定 UDID）
pnpm hx:ios:device -- --deviceId <序列号>  # 跑真机
pnpm hx:ios:log            # iOS 应用日志

# 卡顿/崩溃/性能诊断（grab-* 抓 logcat + bugreport 全线程栈 + HANG 主线程栈 + 内存，归档到 .diag/<tag>/）
bash scripts/grab-diag.sh [tag]               # 默认 Redmi 真机 8PNNT4TKHIJVU8RO；定位卡死看 main-stacks.txt（at uni.* / at uts.*）
PERF_DEV=<serial> bash scripts/grab-diag.sh   # 多设备指定
bash scripts/grab-freeze-state.sh             # 冻结/ANR 状态
bash scripts/grab-perf-stats.sh               # 性能统计
# 注：grab-* 含全角字符，macOS 自带 bash 3.2 + set -u 会误报 "unbound variable"，
#     用 zsh 直接跑、或 brew install bash 用 bash 5+、或临时 set +u
```

## 带三方依赖的 UTS 插件集成（以 x-svg-renderer 为例）

含 Maven/CocoaPods 三方依赖的 UTS 插件（x-svg-renderer 依赖 `com.caverock:androidsvg` / SVGKit）有两套编译路径，行为不同：

| 路径 | 三方依赖处理 | 用途 |
|---|---|---|
| `cli launch` 运行流（`pnpm hx:android` / `--compile` / `--playground custom`） | 重编 uni_modules UTS 插件，**需 HBuilderX【设置-运行配置】配 Gradle/JDK/Android SDK**，否则 error18「找不到名称」 | 日常运行调试 |
| `cli publish appResource`（`make app-resource`） | 不卡（三方依赖留给离线 SDK Gradle） | 打基座/打包前置 |

**本地打含三方依赖插件的自定义基座**（解决"基座只有依赖库没插件产物 → 运行必 error18"）：

```bash
make app-resource && make base-android        # iOS 模拟器：make base-ios-simulator（免签）
```

- `scripts/android-esp/inject_all_uts_modules.py` 把每个插件 config.json 的 `dependencies` 以 `compileOnly` 注入对应 uts 模块 build.gradle；DCloud 约定坐标 `-aar` 后缀是打包类型提示，真实 artifactId 不含（`androidsvg-aar`→`androidsvg`）
- 打出的基座 dex 含插件产物（`uts/sdk/modules/<Plugin>/`），运行不再重编插件

**带三方依赖插件的 HBuilderX 运行配置**（cli launch 必需，本机已知路径）：

- Gradle 7.5~8.x：`~/.gradle/wrapper/dists/gradle-8.14.3-bin/*/gradle-8.14.3/bin/gradle`
- JDK 17：`/opt/homebrew/opt/openjdk@17`（`ensure_env.sh` 只认这个 + Android Studio jbr，不认 HBuilderX corretto）
- Android SDK：`~/workspace/Android/sdk`（需 platforms android-30+ / build-tools 30+；**不是**空的 `~/Library/Android/sdk`）

填到 HBuilderX【工具 → 设置 → 运行配置】。

**UTS 编译已知坑**（带三方依赖/原生插件常踩）：

- 禁止可选链赋值 `a?.b = v`（报 `left-hand side must be a variable`；Swift 允许但 UTS 禁）→ `const x = this.foo; if (x != null) x.bar = ...`
- `watch(() => props.x, cb)` 的 getter 必须显式返回类型 `(): T =>`，否则泛型推断退化为 Unit 报 `Return type mismatch`
- 先声明后引用（异步闭包 / showModal 回调内同样）

**每个仓库需自己的 `scripts/local-secrets.env`**（gitignore，含 DCLOUD_APPKEY + Android/iOS 签名）：`local-base-env.sh` 只 source 同目录的；缺则 `make base-android` configure 阶段报「未设置 DCLOUD_APPKEY」。从 `nuwax-mobile_diff` 或 `~/workspace/nuwax-signing` 复制（同机同一套密钥）。

## 工程约定

- 组件/页面使用 `.uvue` + `.uts`（uni-app x），Web/小程序兼容代码注意条件编译（`#ifdef APP-ANDROID`、`#ifdef H5`、`#ifdef MP-WEIXIN` 等）
- 网络请求统一走 `servers/` 目录的 UTS 模块，不要在页面里直接写 `uni.request`
- `unpackage/` 下仅 `unpackage/dist/build/web/` 被允许提交（用于 H5 部署），其余产物不进版本库
- 样式变量统一放在 [uni.scss](uni.scss)
