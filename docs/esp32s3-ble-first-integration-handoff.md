# ESP32-S3 BLE Wi-Fi 配网首轮联调交接单

## 1. 交付状态

交付状态：`FIRMWARE_IMPLEMENTED_FIRST_INTEGRATION`。

本版本用于 Android Provider 与 ESP32-S3 首轮真机联调。固件已经完成编译验证，但尚未完成 Android + 实机联合验收，因此不能标记为 `INTEGRATION_VERIFIED` 或量产版本。

本期只支持 BLE 配网，不支持 SoftAP fallback。

## 2. 冻结技术基线

| 项目 | 值 |
| --- | --- |
| 芯片/模组 | ESP32-S3 / ESP32-S3-N16R8 |
| ESP-IDF | `v6.0` |
| ESP-IDF commit | `662a3be354759d9487bf4b1a629fadb766cb1800` |
| 配网组件 | `espressif/network_provisioning` `1.2.4` |
| 组件仓库 commit | `2de4980640bbe3d2d69473d7251640039e185b92` |
| 协议 | ESP-IDF `protocomm` |
| BLE Host | NimBLE |
| 安全 | Security 2，禁止降级 |
| 成功标准 | `IP_EVENT_STA_GOT_IP` |

## 3. Android Provider 输入

```text
Transport: ble
Primary Service UUID: 0000ffff-0000-1000-8000-00805f9b34fb
Service name prefix: PROV_
Service name format: PROV_ + final 3 STA MAC bytes, uppercase hexadecimal
Example: PROV_A1B2C3
Security: 2
Development username: device UID from serial log
Development PoP: <DEV_POP（受控渠道获取，勿入仓库）>
Required capability: wifi_prov
Optional capability: wifi_scan
Custom endpoint: device-info
Firmware credential timeout: 30000 ms
Recommended APP status timeout: 35000 ms
Total BLE provisioning window: 300000 ms
Post-success BLE query window: 15000 ms
```

APP 不得把 BLE address 当作永久设备 ID。Security 2 建立后，以 `device-info.serialNumber` 作为稳定设备身份。

## 4. Provider 调用顺序

```text
initialize
  -> scan(Service UUID + PROV_ prefix)
  -> connect
  -> establish Security 2(username + PoP)
  -> read proto-ver
  -> verify prov.sec_ver == 2
  -> verify prov.cap contains wifi_prov
  -> read device-info
  -> optional prov-scan
  -> prov-config set SSID/passphrase
  -> prov-ctrl apply
  -> query official provisioning status
  -> success or mapped failure
  -> optional final device-info read
  -> disconnect/dispose
```

`prov-ctrl`是配网结果的权威来源，`device-info`用于设备身份和辅助诊断。APP收到官方success后应立即进入成功页面，不应把再次读取`device-info`作为成功的必要条件。

## 5. 状态与错误映射

| APP状态 | 固件/协议来源 |
| --- | --- |
| `SECURITY_AUTH_FAILED` | Security 2 username/PoP不匹配 |
| `WIFI_AUTH_FAILED` | `NETWORK_PROV_WIFI_STA_AUTH_ERROR` |
| `NETWORK_NOT_FOUND` | `NETWORK_PROV_WIFI_STA_AP_NOT_FOUND` |
| `TIMEOUT` | 固件30秒观察超时或APP 35秒保护超时 |
| `INTERNAL_ERROR` | 未知Wi-Fi reason、protocomm错误或本地`ESP_ERR` |
| `SUCCESS` | `IP_EVENT_STA_GOT_IP` |

当前没有独立`DHCP_FAILED`原生状态。未获得IP且达到超时条件时映射为`TIMEOUT`。

`device-info.lastProvisioningOutcome`支持：

```text
none
success
auth_failed
network_not_found
timeout
internal_error
stopped
```

## 6. BLE生命周期

### 首次配网

- ESP-IDF Wi-Fi provisioned标志不存在时自动广播。
- 失败后在300秒总窗口内保持BLE服务，可以在同一连接重试。
- BLE意外断开后，只要总窗口未结束，设备继续广播并允许重连查询状态。
- 300秒仍未成功时停止BLE；用户需要重启未配网设备开启新窗口。

### 配网成功

- `GOT_IP`后返回success。
- BLE继续保留15秒供APP读取最终状态。
- 15秒后停止provisioning，固件继续正常业务启动。

### 已配网设备重新配网

物理操作：

1. 在设备上打开Wi-Fi详情页。
2. 保持手指基本静止并持续按住至少5秒。
3. 设备显示`BLE provisioning restart`状态。
4. 固件清除ESP-IDF Wi-Fi配置并重启。
5. 重启后自动进入BLE provisioning。

不提供远程无条件清除Wi-Fi的endpoint或云端命令。

## 7. 二维码与生产密钥

首轮联调使用串口取得username，并使用固定开发PoP。生产版本必须改为每设备独立PoP、salt和verifier；本次联调固件不代表生产密钥链路已经完成。

```json
{
  "ver": "v1",
  "name": "PROV_A1B2C3",
  "transport": "ble",
  "network": "wifi",
  "security": 2,
  "username": "NX-A1B2-C3D4-E5F6",
  "pop": "PER_DEVICE_RANDOM_POP"
}
```

开发固定PoP不得进入公开日志、截图、生产标签或正式发布固件。

## 8. 固件构建交付

本地构建验证：`PASS`。

| 产物 | 路径 |
| --- | --- |
| APP binary | `build/NuwaxAIPartner.bin` |
| ELF | `build/NuwaxAIPartner.elf` |
| MAP | `build/NuwaxAIPartner.map` |
| Bootloader | `build/bootloader/bootloader.bin` |
| Partition table | `build/partition_table/partition-table.bin` |
| OTA data | `build/ota_data_initial.bin` |
| 完整配置 | `sdkconfig` |
| 依赖锁 | `dependencies.lock` |
| 机器契约 | `main/nuwax_provision_new/esp32s3-idf6-provisioning-contract.json` |

烧录命令：

```powershell
idf.py -p <PORT> flash monitor
```

串口波特率：`115200`。日志禁止输出Wi-Fi密码、PoP、salt、verifier和Security 2会话材料。

## 9. 首轮验收矩阵

1. 正确username、PoP和2.4GHz Wi-Fi成功取得IP。
2. 错误PoP在Security 2阶段失败。
3. 错误Wi-Fi密码返回`WIFI_AUTH_FAILED`。
4. 不存在的SSID返回`NETWORK_NOT_FOUND`。
5. 单次超时返回`TIMEOUT`，并可在300秒窗口内重试。
6. BLE断开后重新扫描、连接并查询最近状态。
7. APP在15秒成功窗口内稳定读取官方success。
8. 已配网设备通过Wi-Fi详情页长按重新开放BLE配网。
9. 连续配网20次，记录成功率、总耗时、失败阶段和BLE断连原因。

## 10. 联调记录

联调时双方填写：

```text
Firmware git commit:
APP git commit:
Test date:
Device serialNumber:
Chip revision:
Android device/model:
Android version:
Tester:
Result:
Log location:
```

全部验收项通过后，双方将契约状态更新为`INTEGRATION_VERIFIED`。

## 11. 相关文档（本地离线自定义基座）

含原生依赖的配网插件无法注入标准基座，日常联调走本地离线自定义基座：

- 总览：[esp-provisioning-local-base.md](./esp-provisioning-local-base.md)
- 维护规范：[local-custom-base-maintenance.md](./local-custom-base-maintenance.md)
- Android：[android-esp-provisioning-local-base.md](./android-esp-provisioning-local-base.md)
- iOS：[ios-esp-provisioning-local-base.md](./ios-esp-provisioning-local-base.md)
- 鸿蒙（预留）：[harmony-esp-provisioning-local-base.md](./harmony-esp-provisioning-local-base.md)
