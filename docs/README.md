# docs 文档索引

> 2026-08-19 梳理。按目录分类：`engineering/`（工程手册）、`vapor/`（vapor 线）、`integration/`（业务对接）、`ble/`（BLE/固件契约）；**过时文档在 [archive/](archive/)**（仅历史参考，勿作现行依据）。

## engineering/ —— 工程手册 / 工具链（长期有效）

| 文档 | 说明 |
|---|---|
| [android-build-verify-playbook.md](engineering/android-build-verify-playbook.md) | Android 编译验证与真机运行三条路径决策表 |
| [local-custom-base-maintenance.md](engineering/local-custom-base-maintenance.md) | 本地离线自定义基座维护规范 |
| [custom-base-distribution-s3.md](engineering/custom-base-distribution-s3.md) | 自定义基座 S3 分发（拉取/发布） |
| [offline-sdk-distribution-s3.md](engineering/offline-sdk-distribution-s3.md) | 离线 SDK S3 分发 |
| [esp-provisioning-local-base.md](engineering/esp-provisioning-local-base.md) | 桌搭 BLE 配网本地基座总览 |
| [android-esp-provisioning-local-base.md](engineering/android-esp-provisioning-local-base.md) | Android 端配网本地基座 |
| [ios-esp-provisioning-local-base.md](engineering/ios-esp-provisioning-local-base.md) | iOS 端配网本地基座 |
| [harmony-esp-provisioning-local-base.md](engineering/harmony-esp-provisioning-local-base.md) | 鸿蒙端（预留） |
| [pre-release-checklist.md](engineering/pre-release-checklist.md) | 发版前清理检查单 |
| [ios-app-store-submission-audit.md](engineering/ios-app-store-submission-audit.md) | iOS 提审就绪审计（2026-08-17） |

## vapor/ —— vapor 线（当前主线工作）

| 文档 | 说明 |
|---|---|
| [vapor-tech-debt.md](vapor/vapor-tech-debt.md) | vapor 正式上线交接手册（CLAUDE.md 引用） |
| [vapor-known-issues.md](vapor/vapor-known-issues.md) | vapor 踩坑归档（遇渲染/编译异常先查这里） |
| [vapor-scss-flatten-rules.md](vapor/vapor-scss-flatten-rules.md) | SCSS 反嵌套规约（定稿） |
| [vapor-mainline-sync-notes.md](vapor/vapor-mainline-sync-notes.md) | 主线合并注意事项 + 两线逻辑差异 + 回归清单 |
| [ios26-webview-crash-resolution.md](vapor/ios26-webview-crash-resolution.md) | iOS26 WKWebView 崩溃：排查/根因/方案/验收 |
| [dcloud-ios26-webview-crash-report.md](vapor/dcloud-ios26-webview-crash-report.md) | DCloud 工单材料（#32215，已提交） |

## integration/ —— 业务对接 / 集成指南

| 文档 | 说明 |
|---|---|
| [agent_integration_guide.md](integration/agent_integration_guide.md) | Agent 组件（文件树等）接入 |
| [app-asr-tts.md](integration/app-asr-tts.md) | Vox ASR / TTS 对接 |
| [app-native-pay-integration.md](integration/app-native-pay-integration.md) | App 原生支付（现行；webview 支付已废弃归档） |
| [SSE-Implementation-Guide.md](integration/SSE-Implementation-Guide.md) | SSE 流式请求实现 |
| [Markdown-Custom-Renderer-Guide.md](integration/Markdown-Custom-Renderer-Guide.md) | Markdown 自定义渲染元素 |
| [openui-mobile-integration.md](integration/openui-mobile-integration.md) | OpenUI 移动端接入 |
| [auto-scroll-rules.md](integration/auto-scroll-rules.md) | 会话组件自动滚动规则 |
| [markdown-acceptance.md](integration/markdown-acceptance.md) | Markdown 渲染验收样本 |
| [markdown-capability-checklist.md](integration/markdown-capability-checklist.md) | Markdown 能力清单（对齐 PC Web） |

## ble/ —— BLE / 固件契约（硬件联调现行链）

| 文档 | 说明 |
|---|---|
| [ble-hardware-integration-alignment.md](ble/ble-hardware-integration-alignment.md) | 配网接入方案对齐（参数冻结） |
| [esp32s3-ble-firmware-handoff.md](ble/esp32s3-ble-firmware-handoff.md) | 固件文档入口（联调进行中） |
| [esp32s3-ble-app-firmware-handoff.md](ble/esp32s3-ble-app-firmware-handoff.md) | APP/固件对接基线（已并入 vox-config 要点） |
| [esp32s3-ble-vox-config-handoff.md](ble/esp32s3-ble-vox-config-handoff.md) | 动态云端绑定契约 `1.3-dynamic-vox-config`（现行权威） |
| [esp32s3-ble-first-integration-handoff.md](ble/esp32s3-ble-first-integration-handoff.md) | 首轮联调基线（历史单据，被引用保留） |
| [esp32s3-idf6-provisioning-code-plan.md](ble/esp32s3-idf6-provisioning-code-plan.md) | 固件代码方案基线 |
| `esp32s3-idf6-provisioning-contract.json` | APP/固件机器可读契约（同目录） |

## 根目录数据文件（勿移动）

`i18n-platform-default-import.csv / .json` —— i18n 平台默认文案，路径被 `scripts/i18n-export-defaults.mjs` 写死引用。

## archive/ —— 已归档（仅历史参考）

归档原因：**已自我标注废弃**（webview 支付 ×2）、**perf-vdom 线一次性记录**（HANDOFF-phase4、webview 泄漏交接、perf-conversation-stream-render、perf-list-view-migration〔list-view 已弃〕、perf-mermaid-render-fix、perf-verification-plan、perf-baseline 快照）、**公式方案演进被取代**（perf-math-native-vs-proxy、rich-text-math-acceptance、svg-renderer-integration-handoff〔x-svg-renderer 已移除，现行 ratex〕）、**一次性修复/执行记录**（ask-question 渲染、taskStatus 卡死、退出登录死锁、openui-h5 提交、轮询竞态、i18n 日志与进度快照、git remote 切换、uni-modules 清理、主包优化）、**vapor 阶段性记录**（delivery-readiness 交付评估、20260818 规则扫描〔债务已修完〕、lime-alignment-plan〔搁置，重启时取出〕）。
