# ESP32-S3 BLE 配网固件对接单

> 这是发给桌搭固件同学的精简入口文档。完整评审见 `ble-hardware-integration-alignment.md`，机器契约见 `esp32s3-idf6-provisioning-contract.json`。

## 本期冻结方向

- 芯片：ESP32-S3。
- SDK：ESP-IDF 6.0，具体 tag/commit 待填写。
- 本期传输：仅 BLE；不开发、不验收 SoftAP fallback。
- 协议：`espressif/network_provisioning` + BLE transport + protocomm。
- 安全：优先 Security 2；生产禁止 Security 0。若最终降为 Security 1，必须使用每设备唯一 PoP。
- APP 不按 `FF01～FF05` 自定义特征写 WiFi 密码。
- APP 角色为 BLE Central，桌搭为 BLE Peripheral。

## 固件同学先提供这些值

请直接修改 `esp32s3-idf6-provisioning-contract.json`，至少填完：

1. ESP-IDF 6.0 的 tag/commit、`network_provisioning` 精确组件版本。
2. NimBLE 或 Bluedroid，以及关键 `sdkconfig`。
3. BLE Primary Service UUID、广播名前缀、广播超时。
4. Security 2/1 最终选择、二维码字段样例和产线密钥生成方式。
5. capabilities、`device-info` custom endpoint 的请求/响应格式。
6. 成功边界：DHCP 成功或云端上线。
7. 配网成功/失败后的 BLE 断连、继续广播、重配策略。
8. WiFi 失败原始 reason code 到统一错误的映射。

草案检查：

```bash
node scripts/check-esp-provisioning-contract.mjs
```

全部冻结后检查：

```bash
node scripts/check-esp-provisioning-contract.mjs --release
```

## 固件交付物

- 可烧录固件和对应 ELF/MAP。
- 完整 `sdkconfig`、依赖锁文件、组件版本。
- 二维码样例至少 3 份，PoP/username 每设备不同。
- 串口日志抓取方法；日志不得输出 WiFi 密码、PoP、salt、verifier。
- 最小复现工程或固件分支地址。
- 3 台可区分编号的设备，其中至少 1 台保留故障注入能力。

## 固件最小状态与错误能力

APP 需要观察以下语义，具体 protobuf/native code 可由官方组件产生：

```text
BLE advertising
→ connected
→ security session established
→ credentials received
→ config applied
→ WiFi status pending
→ success | auth failed | AP not found | internal error | timeout
```

断连重连后，APP 必须能查询最近一次配网状态。不得只能依赖一次性 Notify。

## 首轮联调验收

1. Android 可发现且只筛出 BLE 配网设备。
2. Security 2/1 正确时完成安全会话，错误 PoP 必须失败。
3. 正确 2.4GHz WiFi 凭据配网成功。
4. 错误密码、AP 不存在、状态超时能得到可区分结果。
5. WiFi 扫描/关联期间 BLE 不应无解释断开；如按设计断开，必须可恢复查询状态。
6. 连续配网 20 次记录成功率、总耗时和失败阶段。
7. 已配网设备只有通过约定的物理操作才能重新开放配网。

## APP 已准备好的接口

APP 业务层已经按以下语义准备，不依赖固定 Characteristic UUID：

```text
initialize → startScan → connect → getCapabilities
→ optional scanNetworks → provision(set/apply/get_status)
→ disconnect/dispose
```

固件未完成时 APP 使用同接口 Mock 覆盖成功、连接抖动、发送失败、错误密码、AP 不存在、超时和意外断连。固件可用后只替换 Android Provider，页面和状态机不改。
