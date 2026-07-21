# ESP32-S3 BLE 配网文档入口

> 状态：固件已实现首轮联调版本，双方进入 Android + ESP32-S3 真机联调阶段。

## 当前权威文档

1. [`esp32s3-ble-app-firmware-handoff.md`](./esp32s3-ble-app-firmware-handoff.md)：APP/固件完整对接契约。
2. [`esp32s3-ble-first-integration-handoff.md`](./esp32s3-ble-first-integration-handoff.md)：首轮联调操作、交付物和验收矩阵。
3. [`esp32s3-idf6-provisioning-contract.json`](./esp32s3-idf6-provisioning-contract.json)：双方机器可读契约，版本 `1.0-first-integration`。
4. [`esp32s3-idf6-provisioning-code-plan.md`](./esp32s3-idf6-provisioning-code-plan.md)：APP 代码分层和实现说明。

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

## 校验命令

```bash
node scripts/check-esp-provisioning-contract.mjs
```

当前契约只代表首轮联调就绪，不代表量产就绪。逐设备 PoP、生产二维码、Secure Boot、Flash Encryption 和 factory NVS 保护仍是量产阻塞项。
