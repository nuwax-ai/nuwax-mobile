# CLAUDE.md

本文档为 AI 助手（Claude Code 等）提供本项目的开发指引。

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

排障要点：

- 编译产物输出到 `unpackage/dist/dev/app-android/`，该目录已 gitignore，不要提交
- 编译报错与代码状态不一致时，先加 `--cleanCache true` 重试
- 快速检查编译是否通过（不跑设备）可参考现成脚本 [scripts/run-uni-build.sh](scripts/run-uni-build.sh)，它直接调起 HBuilderX 内置的 uni 编译器并把错误摘要到终端
- H5/微信小程序同样走 HBuilderX（菜单 运行/发行），CLI 侧重 App 端

## 其他可用脚本

```bash
pnpm i18n:audit            # i18n 文案审计
pnpm i18n:export-defaults  # 导出平台默认文案
pnpm verify:mcp-ask        # 校验 mcp-ask 契约
./scripts/run-uni-build.sh # 编译 app-android 并提取关键错误
```

## 工程约定

- 组件/页面使用 `.uvue` + `.uts`（uni-app x），Web/小程序兼容代码注意条件编译（`#ifdef APP-ANDROID`、`#ifdef H5`、`#ifdef MP-WEIXIN` 等）
- 网络请求统一走 `servers/` 目录的 UTS 模块，不要在页面里直接写 `uni.request`
- `unpackage/` 下仅 `unpackage/dist/build/web/` 被允许提交（用于 H5 部署），其余产物不进版本库
- 样式变量统一放在 [uni.scss](uni.scss)
