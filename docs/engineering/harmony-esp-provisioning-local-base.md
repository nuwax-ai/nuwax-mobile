# Harmony 桌搭 BLE 配网 · 本地自定义基座（预留）

> 状态：**鸿蒙端已实现并真机验证通过（2026-08-19）。**
> 实现：`uni_modules/nuwax-esp-provisioning/utssdk/app-harmony/`（ArkTS 桥 `EspProvisioningBridge.ets` + `esp/` 吸收自 [esp-idf-provisioning-harmony@1.0.1](https://gitcode.com/Z_Heart/esp-idf-provisioning-harmony)，Apache-2.0，含多项安全/正确性修复，见下），BLE 层直连 `@ohos.bluetooth.ble`（不依赖 fastble），ohpm 依赖仅 `@ohos/crypto-js 2.0.5`、`@hadss/turbo-trans-protobuf 1.0.0-rc.0`。UTS 适配层 `utils/provisioning/harmonyEspProvisioningClient.uts`，`App.uvue` 以 `#ifdef APP-HARMONY` 注册。
> 真机验证：HUAWEI Pura 70 Pro+（HarmonyOS 6.0.0.130），扫描 → Security 2 会话 → device-info → bind → vox-config → WiFi 配网全链路通过（扫码到联网约 52s）。
> 总览：[esp-provisioning-local-base.md](./esp-provisioning-local-base.md)  
> 维护规范：[local-custom-base-maintenance.md](./local-custom-base-maintenance.md)

## 相对上游库的修复（吸收时落地）

| 修复 | 位置 | 说明 |
|------|------|------|
| CSPRNG | `esp/srp6a/SRP6Routines.ets` | SRP 私钥 a 由 `Math.random()` 改为 `cryptoFramework.createRandom()`（可预测会泄露会话密钥） |
| SRP 字节宽语义 | `esp/srp6a/BigIntegerUtils.ets` | 移除 Java `toByteArray()` 式无符号前导 0x00——固件 mbedtls 为自然字节宽，原实现导致 k/u/K/M1 全错（Security 2 握手必败的核心根因） |
| 会话密钥哈希输入 | `esp/srp6a/SRP6Routines.ets` | K = SHA512(S 自然字节宽)，对齐固件 `esp_srp_get_session_key`，非 PAD(S,384) |
| 定宽字段 | `esp/security/Security2.ets` | client_proof 固定 64 字节、client_pubkey 固定 384 字节（`padLeftTo`），满足固件长度校验 |

## 鸿蒙平台要点（联调沉淀）

- 固件 ATT MTU 必须 ≥ 419（SRP6a Cmd0 415 字节单包写）；当前固件已配 512
- `startBLEScan` 空过滤传 `[{}]`（空对象 filter），传 `[]` 报 401
- 系统对广播名解析不可靠，扫描过滤须从广播 AD 结构自行解析（桥内实现）
- `setBLEMtuSize` 后等 `BLEMtuChange` 事件取真实协商值（无 fastble 后已正确）
- 写固定 `WRITE`（带响应）——protocomm 依赖「写确认 → 读响应」时序

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
| 本地离线自定义基座脚本 | 未实现（见 `scripts/harmony-esp/README.md`）；当前走 HBuilderX 鸿蒙标准构建（签名配置由本机 HBuilderX 生成，不入库） |
| `nuwax-esp-provisioning` 鸿蒙端 | ✅ 已实现（ArkTS 桥 + 吸收源码 + ohpm 依赖声明，2026-08） |
| 配网真机验收 | ✅ 正路径全链路通过（2026-08-19）；负路径（错 PoP/错 WiFi 密码）待测 |

## 环境变量（已预留）

见 `scripts/local-base-env.sh`：

- `UNIAPPX_HARMONY_SDK_ROOT`
- `HARMONY_ESP_WORK`
