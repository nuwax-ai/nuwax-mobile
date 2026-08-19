# ESP32-S3 BLE 配网文档入口

> 状态：固件已实现首轮联调版本，动态云端绑定（`1.3-dynamic-vox-config`）App 已对齐，双方进入 Android + ESP32-S3 真机联调阶段。

## 当前权威文档

1. [`esp32s3-ble-vox-config-handoff.md`](./esp32s3-ble-vox-config-handoff.md)：**动态云端绑定层最终实现**（`1.3-dynamic-vox-config`，App 代码基线 `56506861`）——`vox-config` endpoint、bind/密钥下发、WiFi 前时序与新错误码。
2. [`esp32s3-ble-app-firmware-handoff.md`](./esp32s3-ble-app-firmware-handoff.md)：APP/固件 BLE/Wi‑Fi 对接契约（`1.0-first-integration` 基线）。
3. [`esp32s3-ble-first-integration-handoff.md`](./esp32s3-ble-first-integration-handoff.md)：首轮联调操作、交付物和验收矩阵。
4. [`esp32s3-idf6-provisioning-contract.json`](./esp32s3-idf6-provisioning-contract.json)：双方机器可读契约，版本 `1.3-dynamic-vox-config`。
5. [`esp32s3-idf6-provisioning-code-plan.md`](./esp32s3-idf6-provisioning-code-plan.md)：APP 代码分层和实现说明。

## 已冻结基线

- ESP32-S3 / ESP-IDF `v6.0`。
- `espressif/network_provisioning` `1.2.4`。
- NimBLE、BLE-only、protocomm Security 2，不允许降级。
- Primary Service UUID：`0000ffff-0000-1000-8000-00805f9b34fb`。
- 广播名：`PROV_` + STA MAC 后三字节大写十六进制。
- 成功标准：`IP_EVENT_STA_GOT_IP`。
- 固件单次状态窗口 30 秒；APP 等待 35 秒。
- BLE 配网总窗口 300 秒；成功后保留查询窗口 15 秒。
- `prov-ctrl` 是配网终态权威来源；`device-info` 只负责稳定身份和辅助诊断。
- 自定义 endpoint：`device-info`（身份/诊断）与 `vox-config`（动态云端绑定，**必须在 WiFi 凭据下发之前**调用）。
- `cloud_prov` capability 位于 `proto-ver` 的 `nuwax.cap`（**不**在 `prov.cap`）。
- `vox-config` 三字段来源：`deviceId`=`device-info.serialNumber`=`bind.data.deviceId`；`deviceSecret`=`/api/app/devices/bind` 返回的最新值；`gatewayUrl`=`bind.data.websocketUrl`，App 不再自行拼接。详见 vox-config 交接文档。
- `cloud-config` / `credentialId` / `signature` / ECDSA bundle / claim-status 两阶段提交**已废弃**，不得继续实现。

## 校验命令

```bash
node scripts/check-esp-provisioning-contract.mjs
```

当前契约只代表首轮联调就绪，不代表量产就绪。逐设备 PoP、生产二维码、Secure Boot、Flash Encryption 和 factory NVS 保护仍是量产阻塞项。
