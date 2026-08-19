# Harmony 桌搭 BLE 配网 · 本地自定义基座（预留）

> 状态：**鸿蒙端 UTS 插件已实现（源码吸收方案），待真机联调验收。**
> 实现：`uni_modules/nuwax-esp-provisioning/utssdk/app-harmony/`（ArkTS 桥 `EspProvisioningBridge.ets` + `esp/` 吸收自 [esp-idf-provisioning-harmony@1.0.1](https://gitcode.com/Z_Heart/esp-idf-provisioning-harmony)，Apache-2.0，含 SRP6a CSPRNG 安全修复），依赖经 `config.json` 声明 ohpm（`@ohos/fastble 2.0.6`、`@ohos/crypto-js 2.0.5`、`@hadss/turbo-trans-protobuf 1.0.0-rc.0`）。UTS 适配层 `utils/provisioning/harmonyEspProvisioningClient.uts`，`App.uvue` 以 `#ifdef APP-HARMONY` 注册。
> 总览：[esp-provisioning-local-base.md](./esp-provisioning-local-base.md)  
> 维护规范：[local-custom-base-maintenance.md](./local-custom-base-maintenance.md)

## 规划对齐（与 Android / iOS 同构）

| 官方能力就绪后 | 本仓计划 |
|----------------|----------|
| Harmony 离线 SDK | `$NUWAX_SDK_ROOT/UniAppX-Harmony-$VER/` |
| 示例宿主工程 | `$HARMONY_ESP_WORK`（`nuwax-harmony-esp`） |
| UTS 插件注入 | `scripts/harmony-esp/inject_*` |
| 本地资源同步 | HX「生成本地打包 App 资源」→ sync |
| 自定义基座产物 | `unpackage/debug/` 下官方命名产物 |

## 能力矩阵（当前）

| 能力 | 状态 |
|------|------|
| 本地离线自定义基座脚本 | 未实现（见 `scripts/harmony-esp/README.md`）；当前走 HBuilderX 鸿蒙标准构建（manifest.json 已配签名） |
| `nuwax-esp-provisioning` 鸿蒙端 | 已实现（ArkTS 桥 + 吸收源码 + ohpm 依赖声明，2026-08） |
| 配网真机验收 | 待测（CP-1~CP-9 检查点见集成计划：扫描/Security 2 会话/device-info/vox-config/配网全链路 + 负路径） |

## 环境变量（已预留）

见 `scripts/local-base-env.sh`：

- `UNIAPPX_HARMONY_SDK_ROOT`
- `HARMONY_ESP_WORK`
