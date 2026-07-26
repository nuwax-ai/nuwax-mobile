# ESP32-S3 / ESP-IDF 6.0 配网代码方案

> 状态：APP 代码架构基线
> 固件：ESP32-S3 + ESP-IDF 6.0 + `espressif/network_provisioning`
> 安全：Security 2 已冻结，不允许降级
> 首联调平台：Android
> 本期范围：BLE 唯一正式传输，不实现 SoftAP fallback

## 1. 结论

APP 不再继续扩展现有 `FF01～FF05` 自定义 GATT 协议。现有页面、进度状态和 Mock 能力保留，底层改为面向乐鑫官方 Provisioning 语义：

```text
scan BLE device
→ connect primary provisioning service
→ discover protocomm endpoints/capabilities
→ establish Security 2 session
→ optional scanNetworks
→ set_config
→ apply_config
→ get_status
→ success/failure
```

## 2. 分层

```text
provision-scan / provision-wifi / provision-progress
                     │
                     ▼
        EspProvisioningController（业务状态机）
                     │
                     ▼
          EspProvisioningClient（统一契约）
             ┌───────┴────────┐
             ▼                ▼
 Android UTS 原生插件     Mock Client
             │
             ▼
 Espressif Android Provisioning Library
             │
             ▼
 ESP32-S3 network_provisioning + protocomm
```

新增代码契约：

- `types/enums/espProvisioning.uts`
- `types/interfaces/espProvisioning.uts`
- `utils/provisioning/espProvisioningClient.uts`
- `utils/provisioning/espProvisioningClientFactory.uts`
- `constants/espProvisioning.constants.uts`
- `docs/esp32s3-idf6-provisioning-contract.json`
- `scripts/check-esp-provisioning-contract.mjs`

当前已完成：统一 Client/Factory、跨页面单 Controller、BLE Mock Client、页面迁移、QR 安全校验、Android UTS 原生插件、乐鑫官方客户端适配和 Provider 自动注册。真实 Provider 固定使用 `com.github.espressif:esp-idf-provisioning-android:lib-2.4.4`。

`EspProvisioningClientFactory` 是平台实现注入口：Mock 模式注入 Mock Client；Android 启动时自动注册官方客户端实现。业务页面不感知当前使用哪种实现。

`esp32s3-idf6-provisioning-contract.json` 是 APP/固件共同维护的机器可读契约。所有 `TBD` 项必须在联调前变成明确值，变更时同步提升 `contractVersion`。

## 3. Android 原生插件设计

模块建议：

```text
uni_modules/nuwax-esp-provisioning/
├── package.json
└── utssdk/
    ├── interface.uts
    ├── unierror.uts
    ├── app-android/
    │   ├── config.json
    │   ├── AndroidManifest.xml
    │   ├── index.uts
    │   └── src/.../EspProvisioningBridge.kt
    ├── app-ios/
    └── app-harmony/
```

Android 首版通过 UTS 插件桥接乐鑫官方客户端库。插件内部持有原生 `BluetoothDevice` 和 `ESPDevice`，UTS 业务层只接收可序列化 DTO，不能把 Android 对象传到页面。

桥接 API：

```text
initialize(config)
startScan(onDevice)
stopScan()
connect(deviceId, primaryServiceUuid, security, username, pop)
getCapabilities()
scanNetworks()
provision(ssid, password, onProgress)
disconnect()
dispose()
```

Android 原生实现要点：

- `ESPProvisionManager.createESPDevice(TRANSPORT_BLE, SECURITY_2)`。
- 扫描时缓存 `deviceId → BluetoothDevice/ScanResult`，不向 UTS 泄漏原生对象。
- 从 ScanResult 获取 Primary Service UUID，不假设 endpoint UUID 为 `FF01～FF05`。
- Security 2 同时设置 username 与 PoP，并校验 `proto-ver.prov.sec_ver == 2`。
- 监听官方连接事件并转换为单一回调，插件销毁时注销监听。
- `ProvisionListener` 映射为建立会话、发送配置、应用配置、查询状态和终态事件。
- 日志只记录设备 ID 的脱敏值、阶段、耗时、错误码；禁止记录密码、PoP、salt/verifier。

依赖版本必须锁定，不使用动态版本。当前官方 Android 仓库 README 示例为 `lib-2.4.4`，接入前需用目标 ESP-IDF 6.0 `network_provisioning` 固件做兼容性 POC。

## 4. 配置与二维码

安全参数不得硬编码在 APP：

```json
{
  "ver": "v1",
  "name": "PROV_XXXXXX",
  "transport": "ble",
  "security": 2,
  "username": "...",
  "pop": "..."
}
```

最终字段以固件及产线方案为准。二维码解析后只保留在本次配网内存会话，退出流程立即清理。

生产约束：

- 禁止 Security 0。
- Security 2 的 username/password/salt/verifier 生成和烧录由硬件产线方案负责。
- 生产环境每台设备必须有独立 PoP，不使用全产品通用 PoP。
- service name 应能帮助用户识别设备，但不能直接暴露敏感的完整 SN。

## 5. 现有代码迁移

| 当前模块 | 处理方式 |
| --- | --- |
| `provision-scan.uvue` | 保留 UI，数据源切到 `EspProvisioningClient` |
| `provision-wifi.uvue` | 保留手输；后续增加设备端 `scanNetworks` 列表 |
| `provision-progress.uvue` | 保留 UI，阶段映射到官方 provision 回调 |
| `useProvision.uts` | 改为 `EspProvisioningController`，不再直接写 GATT 特征 |
| `BleAdapter` | 仅保留给旧 Mock/底层诊断，不作为官方协议业务接口 |
| `UniBleAdapter` | 不继续实现五特征业务；真实 Android 由原生 Provisioning 插件接管 |
| `MockBleAdapter` | 逐步替换为 `MockEspProvisioningClient` |
| `provisionSession.uts` | 增加 QR 安全参数，仍只存内存 |
| `provisionProtocol.uts` | 旧自定义字节协议标记 legacy，不再扩展 |

## 6. 状态映射

| 官方客户端事件 | APP 阶段 |
| --- | --- |
| BLE scanning | `SCANNING` |
| BLE connecting/discovering | `CONNECTING / DISCOVERING` |
| create security session | `ESTABLISHING_SESSION` |
| `wifiConfigSent` | `SENDING_CREDENTIALS` |
| `wifiConfigApplied` | `APPLYING_CONFIG` |
| poll/get provision status | `CHECKING_STATUS` |
| `deviceProvisioningSuccess` | `SUCCESS` |
| failure callback | `FAILED` + 统一错误码 |

错误映射至少覆盖：

- 权限/蓝牙关闭。
- BLE 扫描、连接、服务不匹配、意外断开。
- Security 版本不匹配、PoP 错误、安全会话失败。
- 发送配置、应用配置失败。
- WiFi 认证失败、网络不存在、状态超时。
- 未知固件错误，保留原始错误码用于日志。

## 7. 生命周期

配网流程必须由单一 Controller 持有原生客户端实例，跨扫描、WiFi 和进度页面共享。页面不得分别覆盖单例 BLE 回调。

```text
创建会话：进入配网入口
保持会话：scan → wifi → progress
释放会话：成功、主动取消、页面栈整体退出
后台：记录时间；超过阈值后断开并要求重新扫描
```

这会修复当前多页面 Controller 覆盖 Adapter 回调，以及返回重配后 Adapter 已关闭的问题。

## 8. 联调诊断

每次流程生成 `traceId`，输出结构化事件：

```text
traceId, platform, appVersion, osVersion
firmwareVersion, protocolVersion, securityVersion
event, elapsedMs, retryCount
maskedDeviceId, rssi, nativeErrorCode
```

以下字段绝不进入日志：WiFi 密码、PoP、Security 2 password、salt、verifier、完整二维码。

## 9. 实施顺序

1. 硬件提供可运行的 ESP-IDF 6.0 `network_provisioning` 示例固件。
2. 冻结组件版本、Service UUID、广播名、Security 版本及二维码。
3. 用乐鑫官方 Android 示例 APP 验证固件成功链路。
4. 创建 Android UTS 插件并桥接官方库。
5. 新增 `MockEspProvisioningClient`，迁移现有 UI 状态机。
6. Android 真机完成成功链路和安全会话。
7. 完成错误密码、AP 不存在、超时、断连、重配测试。
8. 再评估 iOS、HarmonyOS 和微信小程序客户端实现。

## 10. 当前状态

- [x] `espressif/network_provisioning` `1.2.4`。
- [x] ESP-IDF `v6.0` / `662a3be354759d9487bf4b1a629fadb766cb1800`。
- [x] Security 2，不允许降级。
- [x] BLE Service UUID、`PROV_` 广播名前缀。
- [x] `wifi_prov`、`wifi_scan`、`cloud_prov` 和 `device-info`、`vox-config`。
- [x] 动态云端绑定 `vox-config`（`1.3-dynamic-vox-config`）：`bindAndDeliverSecret` 在 WiFi 前 bind 取 `deviceSecret` 并扁平下发，响应校验 `ok/state/deviceId`，新增 `VOX_CONFIG_INVALID`/`VOX_CONFIG_PERSIST_FAILED`，日志脱敏。详见 [`esp32s3-ble-vox-config-handoff.md`](./esp32s3-ble-vox-config-handoff.md)。
- [x] 成功边界为 `IP_EVENT_STA_GOT_IP`，不要求云端上线。
- [x] 成功后 BLE 保留 15 秒；总配网窗口 300 秒。
- [x] Android Provider、iOS Provider（CocoaPods ESPProvision 3.1.0）、Mock 和调试凭据内存入口。
- [ ] Android + ESP32-S3 首轮真机三端联合验收（bind → vox-config → WiFi → 正式后端在线）。
- [ ] 逐设备生产 PoP、二维码和产线密钥链路。
