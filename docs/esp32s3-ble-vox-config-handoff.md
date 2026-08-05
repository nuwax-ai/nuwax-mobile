# ESP32-S3 BLE 配网动态云端绑定交接文档

> 协议版本：`1.3-dynamic-vox-config`（2026-07-26 冻结）
> 文档定位：在 [`esp32s3-ble-app-firmware-handoff.md`](./esp32s3-ble-app-firmware-handoff.md)（`1.0-first-integration` BLE/Wi‑Fi 配网基线）之上，记录**动态云端绑定层**的最终 App 实现。
> 代码基线：提交 `56506861`（分支 `feat/nuwa-zhuoda-2026.07`），编译通过。
> 上游参考：硬件正式交接包 `ble-vox-config-formal-handoff-2026-07-26`。本文以**本仓 App 代码实现为准**；与上游描述冲突时，以代码与本文为准。

## 1. 范围与状态

本文回答：配网过程中，App 如何把「设备身份 + 正式语音网关地址 + 设备密钥」安全下发到固件，使设备 Wi‑Fi 上线后能直连正式 WSS。

- 芯片 / SDK / BLE / 安全 / Wi‑Fi 配网基线：见 [`esp32s3-ble-app-firmware-handoff.md`](./esp32s3-ble-app-firmware-handoff.md)，本文不重复。
- 本层只新增一个自定义 endpoint `vox-config` 与一次 App 账号 `bind` 调用，**在 Wi‑Fi 凭据下发之前**完成。
- 成功标准仍是 `IP_EVENT_STA_GOT_IP`（`WIFI_READY`）；正式云端在线是独立结果，不计入 Wi‑Fi 配网成功。

当前状态：

| 项 | 状态 |
| --- | --- |
| App 代码对齐 `1.3-dynamic-vox-config` | 已完成（`56506861`，编译通过） |
| 硬件固件 `vox-config` endpoint | 已实现并合入设备主工程 |
| 正式 WSS 真机链路 | 硬件已验收（多次应用层 `pong`，4/4 重启持久化） |
| iOS `vox-config` endpoint 发现 | 已能发现（需重启手机清 GATT 缓存） |
| Android Provider 三端联合验收 | **门槛，尚未完成**（模拟器结果不替代） |
| 量产硬化（PoP/NVS-Enc/Secure Boot/远程配网 API） | 未完成 |

## 2. 废弃项（重要）

以下旧协议字段与流程在 `1.3-dynamic-vox-config` 中**全部废弃，不得继续实现或下发**：

- `cloud-config` endpoint
- `credentialId`、`bundleVersion`
- `signature` 及 ECDSA 签名 bundle
- claim / status 两阶段提交（pending → active）

历史背景：`1.2-transactional-cloud-onboarding` 曾在 App 侧实现过 `cloud-config` 动态签名 bundle 路径，因 testagent 上 `/api/onboarding/*` 无接口、`bind` 仅返回 `deviceSecret`（无签名）、设备验签无签名源，已于 2026-07-25 晚 `git checkout` 全部回退。当前唯一动态下发通道是 `vox-config` 的扁平 payload。App 错误码中 `signature` 仅作为日志脱敏字段名保留，不再有业务语义。

## 3. `vox-config` endpoint 契约

### 3.1 endpoint 发现

- endpoint 名：`vox-config`，由固件按名称创建注册。
- characteristic UUID 由 provisioning manager **动态分配**，App **不得硬编码**：
  - Android：读取 characteristic 的 `0x2901 User Description` descriptor，以 endpoint 名称建立映射。
  - iOS：经 ESPProvision `sendData(to:Path:)` 按 endpoint 名发送。
- `vox-config` 只能在 Security 2 会话建立后访问，与 `device-info` 同级。

### 3.2 请求 payload（扁平）

```json
{
  "deviceId": "NX-3927-2693-9288",
  "gatewayUrl": "wss://testagent.xspaceagi.com/api/device/ws",
  "deviceSecret": "<bind 返回的最新设备密钥>"
}
```

仅三个字段，**无** `op` / `bundle` / `credentialId` / `signature`。

### 3.3 成功响应

```json
{
  "ok": true,
  "state": "active",
  "deviceId": "NX-3927-2693-9288"
}
```

响应**不得回显 `deviceSecret`**。App 必须校验三件事后再发送 Wi‑Fi 凭据：

1. `ok == true`
2. `state == "active"`
3. `deviceId ==` 请求中的 `deviceId`（= `device-info.serialNumber`）

任一不符视为设备拒绝动态配置，进入失败页（见 §6）。

### 3.4 三字段唯一来源

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `deviceId` | `device-info.serialNumber`，且必须等于 QR / 手动输入的 username | 永久身份，**不**用 BLE address |
| `deviceSecret` | 现有 `/api/app/devices/bind` 返回的最新值 | App **不生成、不改写、不写死**，仅原样放入 payload |
| `gatewayUrl` | `/api/app/devices/bind` 返回的 `websocketUrl` | App **不拼接、不改写**，仅将该值放入 payload 的 `gatewayUrl` |

任一来源失败时，App 必须停在 `vox-config` 之前，**不得继续下发 Wi‑Fi 凭据**（冻结契约硬约束）。

> `gatewayUrl` 由后端通过绑定响应的 `websocketUrl` 统一下发，App 不再根据 `API_BASE_URL` 派生。

### 3.5 代码位置

| 关注点 | 文件 |
| --- | --- |
| endpoint 名常量 | `hooks/useEspProvisioning.uts` `VOX_CONFIG_ENDPOINT = 'vox-config'` |
| 下发 + 响应校验主逻辑 | `hooks/useEspProvisioning.uts` `EspProvisioningController.bindAndDeliverSecret()` |
| `gatewayUrl` 来源与下发 | `hooks/useEspProvisioning.uts` `EspProvisioningController.bindAndDeliverSecret()` |
| bind 接口 | `servers/vox/voxDevice.uts` `apiVoxBindDevice()` |
| bind 参数类型 | `types/interfaces/voxDevice.uts` `AppDeviceBindParams` |
| 原生下发（Android/iOS） | `EspProvisioningBridge.sendCustomData`（UTS 插件） |
| Mock 响应 | `utils/provisioning/mockEspProvisioningClient.uts` |

## 4. 正确时序：必须在 Wi‑Fi 之前下发

`vox-config` 有硬性时序约束 `mustRunBefore`：**必须在 `prov-config set/apply` 之前下发**。

原因：Wi‑Fi 一旦配网成功，乐鑫 SDK 会清理 Security 2 会话；此后再 `sendCustomData('vox-config', …)` 会得到 `SECURITY_AUTH_FAILED`。因此下发必须在 Security 2 会话仍然存活的窗口内完成。

App 实现的两条调用路径都遵循「selectAndPrepare → bindAndDeliverSecret → provision」：

**主流程**（`subpackages/pages/provision/provision-progress/provision-progress.uvue:175-183`）：

```text
selectAndPrepare(device, ssid, password)   // 连接 + Security 2 + proto-ver + device-info 校验 serialNumber  → phase=READY
  → bindAndDeliverSecret("")                // bind 取 deviceSecret → 扁平 payload 下发 vox-config → 校验响应
  → provision(ssid, password)               // prov-config set/apply → 轮询 prov-ctrl status → WIFI_READY
```

**重连重试流程**（`hooks/useEspProvisioning.uts` `retry()`，RECONNECT 分支）：

```text
selectAndPrepare(device)                    // Security 2 会话重建
  → bindAndDeliverSecret("")                // 必须重新 bind + 下发（会话已重建）
  → provision(pendingSsid, pendingPassword)
```

> 重连之所以要重做整条链路：Security 2 会话随断连销毁，重连后是新会话，`vox-config` 必须在新会话内重新下发。

任一来源失败（缺 serialNumber / bind 失败 / 缺 deviceSecret / 设备拒绝 vox-config / 原生下发异常）一律**硬失败进失败页**，由 `retry()` 重做整个流程；不再像旧实现那样软提示且不阻断 Wi‑Fi。

## 5. bind 集成

- 接口：`apiVoxBindDevice(AppDeviceBindParams{ deviceId, displayName })`，`displayName` 为空时回退为 `deviceId`。
- 复用主站 `{code, data}` 包络，`code == 0000` 视为成功，从 `data.deviceSecret` 取密钥。
- `deviceId` = 已校验过的 `device-info.serialNumber`（不是 BLE MAC、不是 `currentDevice.deviceId`）。
- 失败映射：
  - bind 接口 `code != 0000` → `SEND_CONFIG_FAILED` → 失败页（RECONNECT）。
  - 响应缺 `deviceSecret` → `SEND_CONFIG_FAILED` → 失败页（RECONNECT）。
  - bind 抛异常 → 转 `EspProvisioningError` → 失败页（RECONNECT）。

## 6. 错误码与文案

`vox-config` 设备侧拒绝时，App 按设备返回的 `error` 字符串区分两个新错误码（`types/enums/espProvisioning.uts`）：

| App 错误码 | 触发条件 | i18n key |
| --- | --- | --- |
| `VOX_CONFIG_INVALID` | 设备返回 `ok:false`，且 `error` 不含 `persist` / `nvs`（字段或设备身份非法） | `Mobile.Provision.Error.voxConfigInvalid` |
| `VOX_CONFIG_PERSIST_FAILED` | 设备返回 `ok:false`，且 `error` 含 `persist` / `nvs`（无法写入 NVS） | `Mobile.Provision.Error.voxConfigPersistFailed` |

补充：

- 响应非 JSON、或 `ok/state/deviceId` 校验不通过 → `VOX_CONFIG_INVALID`。
- 原生 `sendCustomData` 抛异常 → 透传原生错误码（如 `SECURITY_AUTH_FAILED`），并打印原生 `ESPSessionError.description`。
- 两个新错误码均映射到 `errorI18nKey`（`hooks/useEspProvisioning.uts` `errorI18nKey()`），并已补齐 `en-us` / `zh-cn` / `zh-hk` / `zh-tw` 四套文案。
- 其余既有错误码（`SECURITY_AUTH_FAILED` / `WIFI_AUTH_FAILED` / `NETWORK_NOT_FOUND` / `TIMEOUT` / `DEVICE_ID_MISMATCH` / `BUSY` / `SEND_CONFIG_FAILED` 等）见 [`esp32s3-ble-app-firmware-handoff.md`](./esp32s3-ble-app-firmware-handoff.md) §8。

## 7. 安全与脱敏

- `deviceSecret` 仅内存持有，随 payload 下发后即弃，**不写 storage、不进日志、不回显**。
- `servers/useRequest.uts` 对请求体与响应体做正则脱敏，命名字段值替换为 `***`：
  - 请求：`deviceSecret` / `signature` / `password` / `accessToken` / `token`
  - 响应：同上字段集合
- `bindAndDeliverSecret` 的日志只记录 `deviceId` 与 `gatewayUrl`，**不记录 `deviceSecret`**：
  - 成功：`[VoxBind] vox-config 下发成功 deviceId=… state=active`
  - 失败：`[VoxBind] vox-config 下发异常 deviceId=… | code=… | msg=<原生描述> | detail=… | nativeCode=…`
- iOS 端 `sendCustomData` 失败时额外打印原生 `ESPSessionError.description`（`sessionNotEstablished` / `securityMismatch` / `encryptionError` / `sendDataError`），用于定位「`device-info` 成功但 `vox-config` 失败」这类 BLE 边界问题。
- 历史上曾硬编码进工作区的真实 `deviceSecret` / `signature` 已清除，未进入 git 历史。

## 8. Mock 行为

`utils/provisioning/mockEspProvisioningClient.uts` 的 `sendCustomData` 对 `vox-config` 返回冻结契约形态，以通过 App 的响应校验：

```json
{ "ok": true, "state": "active", "deviceId": "<回显请求 payload 中的 deviceId>" }
```

其他 endpoint 仍返回 `{"saved":true}`。Mock 不调用正式 `bind`，也不持有用户登录态。

## 9. 固件侧关注点（来自上游交接包）

App 工程师需了解的固侧行为（实现由固件团队负责）：

- **NVS 持久化**：成功配置原子写入 `namespace: nuwax_cloud` / `key: active`，值为 `version + deviceId + gatewayUrl + deviceSecret`；重启后恢复，不重新进入 BLE、不重新下发密钥。
- **固件校验**：
  - `deviceId` 必须等于硬件 UID。
  - `gatewayUrl` 只接受 ASCII `ws://` / `wss://`；禁止账号密码、fragment、IPv6 literal；显式端口必须 `1..65535`；生产必须是 `wss://`，`ws://` 仅测试构建。
  - `deviceSecret` 为 `1..95` 个可打印 ASCII 字符（`0x21..0x7E`），可安全用于 `X-Bridge-Token`。
- **WSS 鉴权**：设备连接时发送 `X-Bridge-Token: <deviceSecret>`；WebSocket 建立后发 hello v1：
  ```json
  { "type": "hello", "version": 1, "device_id": "NX-…", "device_secret": "<同一动态密钥>",
    "features": { "remote_ble_reprovision": true } }
  ```
  密钥只在 TLS 内传输，固件清空序列化缓冲区，不记录 header / hello JSON / 密钥。
- **capability**：`cloud_prov` 在 `proto-ver` 的 `nuwax.cap` 中，**不**在 `prov.cap`。`ESPDevice.getDeviceCapabilities()` 只覆盖 `prov.cap`，不能代替对 `nuwax.cap.cloud_prov` 的检查。

## 10. 正式服务真机验收（上游 2026-07-26）

硬件在正式联调环境 `wss://testagent.xspaceagi.com/api/device/ws` 已完成设备侧验收：

- `vox-config` 返回 `ok=true, state=active`，动态配置写入 `active`。
- 设备获得 IP，达到 `WIFI_READY`。
- 正式 WSS TLS / Upgrade 成功，服务接受 `X-Bridge-Token` 与 hello 动态密钥。
- 设备连续收到应用层 `pong`；本地测试网关在线设备数为 0，排除误连本地服务。
- 4/4 连续硬重启均从 NVS 恢复配置并自动重连正式 WSS。
- 模拟器「让设备进入配网模式」按钮经 USB 控制命令复验通过（精确 BLE 广播 → Security 2 → vox-config → prov-config → WIFI_READY）。

> 上述验收确认的是**设备到正式 WSS 的动态鉴权链路**。Android App 从 `bind` 取值到 `sendDataToCustomEndPoint("vox-config", …)` 的端到端验收，仍是首轮 Android Provider 联调门槛，不应由模拟器/固件侧结果代替。

## 11. 状态展示

- `WIFI_READY`（`prov-config connected` / `IP_EVENT_STA_GOT_IP`）= Wi‑Fi 配网成功。
- 正式云端在线应从正式后端状态接口独立观察（如 `{ "deviceId": "NX-…", "online": true }`）。
- 后端状态接口未冻结前，App **不得**把本地模拟器的 `NOT_OBSERVED` 转成配网失败。

## 12. 已知边界与尚未验收

- **Android Provider 真机三端联合**（用户登录态 `bind → vox-config → Wi‑Fi → 正式后端在线`）尚未完成；模拟器不调用正式 `bind`。
- iOS `vox-config` 已能发现，但**正式下发的真机响应**待首轮联调确认（已知要点：需重启手机清 GATT 缓存才能发现新 endpoint）。
- 不同 Android / iOS 设备与权限行为未覆盖。
- 20 次以上重复配网、长时间在线、错误凭据恢复、纯 WPA3-only AP 未验收（当前通过的是 WPA2/WPA3 transition AP）。
- 量产逐设备 PoP、NVS Encryption、Flash Encryption、Secure Boot 未完成。
- 正式后端「远程进入配网模式」的用户鉴权 / 设备所有权 API 未冻结（远程命令需后端验证登录态与设备所有权，App 禁止直接持有设备 WebSocket 管理权限）。
- 历史一次未复现的 `StoreProhibited` 自动恢复事件，根因未确认，需 ≥20 次冷热重启长稳回归。

> 交付判断：当前版本可进行首轮协议联调，**不可**标记为量产稳定版。

## 13. 首轮 App 验收门槛

- QR / 手动两条路径均能锁定正确设备（`serialNumber == username`）。
- 错误 PoP 必须得到 `SECURITY_AUTH_FAILED`。
- 扫描过程中点击开始，不得并发执行扫描和配网。
- 正确 Wi‑Fi 达到 `WIFI_READY`；错误密码 / SSID 不存在能稳定映射。
- `vox-config` 不回显、不记录 `deviceSecret`。
- 正式后端确认相同 `deviceId` 在线；与 Wi‑Fi 成功分别显示。

## 14. 相关文档与代码索引

- BLE / Wi‑Fi 配网基线：[`esp32s3-ble-app-firmware-handoff.md`](./esp32s3-ble-app-firmware-handoff.md)（`1.0-first-integration`）
- 首轮联调操作与验收矩阵：[`esp32s3-ble-first-integration-handoff.md`](./esp32s3-ble-first-integration-handoff.md)
- 机器可读契约：[`esp32s3-idf6-provisioning-contract.json`](./esp32s3-idf6-provisioning-contract.json)（`1.3-dynamic-vox-config`）
- App 代码分层：[`esp32s3-idf6-provisioning-code-plan.md`](./esp32s3-idf6-provisioning-code-plan.md)
- Vox 后端 / 网关集成要点：[`app-asr-tts.md`](./app-asr-tts.md)、`servers/vox/voxDevice.uts`（绑定接口）
- 上游硬件交接包：`ble-vox-config-formal-handoff-2026-07-26`（外部，仅供参考）

核心代码：

```text
hooks/useEspProvisioning.uts                 bindAndDeliverSecret / retry / VOX_CONFIG_ENDPOINT / errorI18nKey
subpackages/pages/provision/provision-progress/provision-progress.uvue   主流程 selectAndPrepare→bindAndDeliverSecret→provision
utils/provisioning/iosEspProvisioningClient.uts    iOS sendCustomData 原生错误透传
utils/provisioning/mockEspProvisioningClient.uts   vox-config mock 响应
servers/vox/voxDevice.uts                    apiVoxBindDevice
servers/useRequest.uts                       deviceSecret/signature/password/token 脱敏
types/enums/espProvisioning.uts              VOX_CONFIG_INVALID / VOX_CONFIG_PERSIST_FAILED
types/interfaces/voxDevice.uts               AppDeviceBindParams
constants/i18n-locales/*.uts                 voxConfigInvalid / voxConfigPersistFailed 文案
```
