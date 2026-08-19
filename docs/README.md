# docs 文档索引

> 2026-08-19 梳理。**过时文档已移入 [archive/](archive/)**（保留历史参考，勿作为现行依据）。

## 工程手册 / 工具链（长期有效）

| 文档 | 说明 |
|---|---|
| [android-build-verify-playbook.md](android-build-verify-playbook.md) | Android 编译验证与真机运行三条路径决策表 |
| [local-custom-base-maintenance.md](local-custom-base-maintenance.md) | 本地离线自定义基座维护规范 |
| [custom-base-distribution-s3.md](custom-base-distribution-s3.md) | 自定义基座 S3 分发（拉取/发布） |
| [offline-sdk-distribution-s3.md](offline-sdk-distribution-s3.md) | 离线 SDK S3 分发 |
| [esp-provisioning-local-base.md](esp-provisioning-local-base.md) | 桌搭 BLE 配网本地基座总览 |
| [android-esp-provisioning-local-base.md](android-esp-provisioning-local-base.md) / [ios-…](ios-esp-provisioning-local-base.md) / [harmony-…（预留）](harmony-esp-provisioning-local-base.md) | 三端配网本地基座 |
| [pre-release-checklist.md](pre-release-checklist.md) | 发版前清理检查单 |

## vapor 线（当前主线工作）

| 文档 | 说明 |
|---|---|
| [vapor-tech-debt.md](vapor-tech-debt.md) | vapor 正式上线交接手册（CLAUDE.md 引用） |
| [vapor-known-issues.md](vapor-known-issues.md) | vapor 踩坑归档（遇渲染/编译异常先查这里） |
| [vapor-scss-flatten-rules.md](vapor-scss-flatten-rules.md) | SCSS 反嵌套规约（定稿） |
| [vapor-mainline-sync-notes.md](vapor-mainline-sync-notes.md) | 主线合并注意事项 + 两线逻辑差异 + 回归清单 |
| [ios26-webview-crash-resolution.md](ios26-webview-crash-resolution.md) | iOS26 WKWebView 崩溃：排查/根因/方案/验收 |
| [dcloud-ios26-webview-crash-report.md](dcloud-ios26-webview-crash-report.md) | DCloud 工单材料（#32215，已提交） |

## 业务对接 / 集成指南

| 文档 | 说明 |
|---|---|
| [agent_integration_guide.md](agent_integration_guide.md) | Agent 组件（文件树等）接入 |
| [app-asr-tts.md](app-asr-tts.md) | Vox ASR / TTS 对接 |
| [app-native-pay-integration.md](app-native-pay-integration.md) | App 原生支付（现行；webview 支付两份已废弃归档） |
| [SSE-Implementation-Guide.md](SSE-Implementation-Guide.md) | SSE 流式请求实现 |
| [Markdown-Custom-Renderer-Guide.md](Markdown-Custom-Renderer-Guide.md) | Markdown 自定义渲染元素 |
| [openui-mobile-integration.md](openui-mobile-integration.md) | OpenUI 移动端接入 |
| [auto-scroll-rules.md](auto-scroll-rules.md) | 会话组件自动滚动规则 |
| [markdown-acceptance.md](markdown-acceptance.md) / [markdown-capability-checklist.md](markdown-capability-checklist.md) | Markdown 渲染验收样本 / 能力清单 |
| [ios-app-store-submission-audit.md](ios-app-store-submission-audit.md) | iOS 提审就绪审计（2026-08-17） |

## BLE / 固件契约（硬件联调现行链）

| 文档 | 说明 |
|---|---|
| [ble-hardware-integration-alignment.md](ble-hardware-integration-alignment.md) | 配网接入方案对齐（参数冻结） |
| [esp32s3-ble-firmware-handoff.md](esp32s3-ble-firmware-handoff.md) | 固件文档入口（联调进行中） |
| [esp32s3-ble-app-firmware-handoff.md](esp32s3-ble-app-firmware-handoff.md) | APP/固件对接基线（已并入 vox-config 要点） |
| [esp32s3-ble-vox-config-handoff.md](esp32s3-ble-vox-config-handoff.md) | 动态云端绑定契约 `1.3-dynamic-vox-config`（现行权威） |
| [esp32s3-ble-first-integration-handoff.md](esp32s3-ble-first-integration-handoff.md) | 首轮联调基线（历史单据，被引用保留） |
| [esp32s3-idf6-provisioning-code-plan.md](esp32s3-idf6-provisioning-code-plan.md) | 固件代码方案基线 |

## 数据文件

`i18n-platform-default-import.csv / .json` —— i18n 平台默认文案（脚本 `pnpm i18n:*` 使用，勿移动）。

## archive/（已归档，仅历史参考）

归档原因分类：**已自我标注废弃**（webview 支付 ×2）、**perf-vdom 线一次性记录**（HANDOFF-phase4、webview 泄漏交接、perf-conversation-stream-render、perf-list-view-migration〔list-view 已弃〕、perf-mermaid-render-fix、perf-verification-plan、perf-baseline 快照）、**公式方案演进被取代**（perf-math-native-vs-proxy、rich-text-math-acceptance、svg-renderer-integration-handoff〔x-svg-renderer 已移除，现行 ratex〕）、**一次性修复/执行记录**（ask-question 渲染、taskStatus 卡死、退出登录死锁、openui-h5 提交、轮询竞态、i18n 执行日志与进度快照、git remote 切换、uni-modules 清理、主包优化）、**vapor 阶段性记录**（delivery-readiness 交付评估、20260818 规则扫描〔债务已修完〕、lime-alignment-plan〔搁置，重启时取出〕）。
