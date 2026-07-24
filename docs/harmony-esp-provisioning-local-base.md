# Harmony 桌搭 BLE 配网 · 本地自定义基座（预留）

> 状态：**槽位已预留，待官方 uni-app x Harmony 原生 SDK 与本机 HX 版本对齐后再实现。**  
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
| 本地离线自定义基座脚本 | 未实现（见 `scripts/harmony-esp/README.md`） |
| `nuwax-esp-provisioning` 鸿蒙端 | 未实现 |
| 配网真机验收 | 不适用 |

## 环境变量（已预留）

见 `scripts/local-base-env.sh`：

- `UNIAPPX_HARMONY_SDK_ROOT`
- `HARMONY_ESP_WORK`
