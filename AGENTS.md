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
```

## 工程约定

- 组件/页面使用 `.uvue` + `.uts`（uni-app x），Web/小程序兼容代码注意条件编译（`#ifdef APP-ANDROID`、`#ifdef H5`、`#ifdef MP-WEIXIN` 等）
- 网络请求统一走 `servers/` 目录的 UTS 模块，不要在页面里直接写 `uni.request`
- `unpackage/` 下仅 `unpackage/dist/build/web/` 被允许提交（用于 H5 部署），其余产物不进版本库
- 样式变量统一放在 [uni.scss](uni.scss)
