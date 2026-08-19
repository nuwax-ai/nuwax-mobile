# Vapor 规则全仓扫描报告（2026-08-18，合并主线 tip b327d594 后）

> 扫描依据：[vapor-scss-flatten-rules.md](../vapor/vapor-scss-flatten-rules.md)（R1 纯后代/R2 融合 amp/R3 撞色）+ [vapor-known-issues.md](../vapor/vapor-known-issues.md)（B1 styleIsolation/B2 选择器丢弃/A 工具链）。
> 定位：合并主线 36603849 后的**增量债务清单**（修复按规则人工逐文件，不上脚本）。

## 结论总览

| 违规类 | 数量 | 处置 |
|---|---|---|
| 纯后代嵌套（R1，运行时丢样式） | ~~74~~ **35 处 / 4 文件**（初版扫描器注释行误报已修正） | ✅ 已全部修复（2026-08-18） |
| 复合 `.a.b`（R3） | 1 处业务 | ✅ file-preview-h5 已拆条件类（katex-el 属 uni_modules 上游） |
| 伪类 `:active/:hover/:last-child` | ~46 处 | **可放弃渐进增强**（规则原文），不修 |
| `defineOptions({styleIsolation})` 缺失 | 18 文件（example 已删） | ✅ 已全部补齐 |
| `android.*` 业务 import | 0 | webviewTextZoom 已 `#ifndef APP-ANDROID` 门控 ✅ |
| 模板多行属性 | 0 | ✅ |
| 三方 uni_modules（lime/uni-ai-x 嵌套 ~1000 处） | 上游债 | 走上游升级（lime-v4 对齐另案） |

## R1 明细（74 处，按优先级）

| 文件 | 处数 | 来源 | 备注 |
|---|---|---|---|
| `pages/terminal/terminal.uvue` | 32 | 主线设备列表新样式 auto-merge 进 | 终端 tab 主页面，优先 |
| `subpackages/pages/chat-conversation-component/components/new-conversation-set/new-conversation-set.uvue` | 19 | 合并残留 | 已补收尾 `}` 保编译 |
| `.../file-tree/file-tree-node.uvue` | 8 | 合并残留 | |
| `subpackages/pages/login/components/login-form/login-form.uvue` | 6 | 主线新登录样式 | |
| `components/pane-tabs/example.uvue` | 8 | demo 文件 | 可忽略/删除 |
| `components/page-preview-iframe/page-preview-iframe.uvue` | 1 | | |

## defineOptions 缺失（19 文件）

agent-search、category-agent-list、terminal-{group-members,monitor-detail,monitor-records,device-detail,my-computer,meeting-detail,meeting-records}、about-me/{about-me,edit-profile,reset-password}、其余 7 个见扫描输出。全部为合并带入的主线页面，补 `defineOptions({ styleIsolation: 'app' })` 即可。

## 已知功能债（非样式）

- **webviewTextZoom**：蒸汽编译器不解析 `android.*` 业务 import，已门控禁用。恢复候选：① manifest `app-plus.webview.textZoom:100` 在 vapor 实测是否生效 ② vapor 等价原生 API（getIOSView/getAndroidView 路径）
- **chat-conversation-component 主线新功能未移植**：问题建议按钮区、任务执行中 loading、enable-voice 透传（vapor 结构与主线模板差异大，需按 vapor 结构人工移植）
- **chat-comp 主线的 mp-html 路线**：被 vapor 渲染架构取代（H5/MP 分支保留在 #ifdef 中）

## 修复验证

每文件修完跑 `make app-resource`（android vapor + ios 双端），再真机 vapor 包目检。
