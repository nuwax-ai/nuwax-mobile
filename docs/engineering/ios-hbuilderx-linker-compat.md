# HBuilderX iOS 编译：Xcode 27 链接兼容

本轮环境：HBuilderX `5.26.2026091802`、Xcode `27.1`。原生认证分支：`feat/nuwa-zhuoda-2026.10-native-idp`，独立于 H5 提测分支。

## 原因与修复范围

原失败摘要为 `clang++: error: linker command failed`，Xcode 完整日志实际为：

```text
ld: library 'd64' not found
```

本机 HBuilderX 的 `uts-development-ios/dependences/buildFramework/xcode_buildsetting.js` 在生成 UTS 工程时加入 `OTHER_LDFLAGS = [-ld64, -ObjC, $(inherited)]`。当前 Xcode 将 `-ld64` 作为查找 `d64` 库的参数，导致认证插件和已有设备标识插件都不能链接。这不是缺少微信 SDK 或认证插件的 Swift 语法问题。

新增仓库入口 [run-ios-compile.mjs](../../scripts/run-ios-compile.mjs)，仍调用 **HBuilderX 内置 Node 与 uni-app x 编译器**，显式指定当前检出的 `UNI_INPUT_DIR`。它只编译，不安装、签名或上传包。

Xcode 主版本 >= 27 时，该入口在**编译子进程**加载 [hx-ios-linker-compat.cjs](../../scripts/hx-ios-linker-compat.cjs)，只对指定 HBuilderX 安装目录下的 UTS 工程生成器过滤 `-ld64`，保留 `-ObjC`、继承值和其他链接依赖。兼容层支持通过开关停用；不改 HBuilderX 安装文件、Xcode 选择、系统配置或其他已运行的编译会话。旧版 Xcode 保留 HBuilderX 原行为。

继续编译时，现有 ESPProvision/SwiftProtobuf 的 Pods 仍声明 iOS 13/9，低于当前 SDK 的 iOS 15 下限。入口读取所选 SDK 的 `MinimumDeploymentTarget`，只提高生成工作目录中 Pods 工程的过低目标，保留更高版本、依赖源码与 `manifest.json`（App 原本最低 iOS 15）。若 App 自身配置低于所选 SDK，入口报错要求选择匹配 SDK，不自动提高产品最低系统版本。

## 使用

```bash
pnpm hx:ios:compile

# 指定源码、日志和超时（首次拉取项目已有 CocoaPods 依赖可能较慢）
node scripts/run-ios-compile.mjs \
  --project /absolute/path/to/nuwax-mobile \
  --log /absolute/path/to/ios-compile.log \
  --timeout-ms 600000
```

完整项目在 4GB 编译堆上曾发生 OOM，因此入口默认给编译器 8GB 上限，可通过 `NUWAX_IOS_HEAP_MB` 调整。

默认输出 `unpackage/dist/dev/app-ios/`，日志为 `unpackage/logs/ios-compile.log`；均不提交。`HX_APP_ROOT` / `HX_NODE` / `HX_Version` 可指定另一套本地 HBuilderX。`--no-compat` 可用来复现原始工具链行为；不要同时另行注入兼容层。

脚本只在本次编译器输出 `ready in ...` 且未出现编译失败时返回成功；超时、中断、子进程异常均失败。结束时只停止自己创建的进程组，不使用 `pkill`。同一 HBuilderX 的 iOS UTS 生成器共用临时工程目录，请串行运行 iOS 编译。

## 验证及边界

- 原生认证独立项目：原始参数失败，移除该参数后 HBuilderX 编译通过。
- 兼容层测试覆盖：保留其他依赖、开关关闭、只处理指定 SDK 路径、磁盘源文件不变、只调整生成 Pods 的过低目标；与登录专项合计 97 项。
- ESP 配网独立项目：原有 Pods 目标不兼容，调整生成目标后 HBuilderX 编译通过。
- 完整 77 页业务工程：`pnpm hx:ios:compile` 编译通过，编译器输出 `DONE Build complete` / `ready in 17392ms`（缓存后的验证）。已有样式兼容提示仍在；未生成新签名安装包。
- 该兼容层只在上述仓库命令生效。直接点击 HBuilderX GUI 或绕过入口的 CLI 构建仍可能触发相同工具链参数；升级工具链后应先检查原始构建，再决定是否移除兼容层。
- 真机安装、系统浏览器回跳、首次关联和业务/IM Token 联调另行验收；本次不开放原生开关、不接微信 SDK、不合入 H5 提测分支。
