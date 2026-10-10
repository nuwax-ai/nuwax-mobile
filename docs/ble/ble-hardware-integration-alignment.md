# 桌搭 BLE 配网接入方案对齐文档

> 文档状态：技术路线评审完成；首轮联调参数已冻结
> APP 平台：Android 首联调，后续覆盖 iOS / HarmonyOS
> 通信角色：APP = BLE Central，桌搭硬件 = BLE Peripheral
> 核心目标：APP 通过 BLE 将 WiFi 凭据安全下发给桌搭，并获取联网结果及设备身份信息
> 本期范围：BLE 是唯一正式配网传输；不实现、不验收 SoftAP 配网，不为两套传输维护并列业务流程

> 输入方案：[`桌宠硬件 WiFi 配网技术需求文档 v1.0（DH-WIFI-PROV-20260716）`](https://agent.nuwax.com/static/file-preview.html?sk=61e33ecd20c5447999fd9fd7c91b282a&dl=1)
> 评审结论：可作为需求草案，不建议按 v1.0 原样进入固件开发；需先完成第 2.1 节中的技术路线决策和协议修订。

APP 代码级方案见 [`esp32s3-idf6-provisioning-code-plan.md`](./esp32s3-idf6-provisioning-code-plan.md)，双方机器可读参数契约见 [`esp32s3-idf6-provisioning-contract.json`](./esp32s3-idf6-provisioning-contract.json)。

硬件回传后的权威联调文档为 [`esp32s3-ble-app-firmware-handoff.md`](./esp32s3-ble-app-firmware-handoff.md) 和 [`esp32s3-ble-first-integration-handoff.md`](./esp32s3-ble-first-integration-handoff.md)。若本文中的早期草案假设与权威联调文档冲突，以 `1.0-first-integration` 契约为准。

## 1. 对齐目标

本次对接需要共同冻结以下内容：

1. 桌搭进入、退出配网模式的条件。
2. BLE 广播格式与 APP 识别规则。
3. GATT Service / Characteristic UUID 及属性。
4. WiFi 凭据的数据格式、写入顺序与分包规则。
5. 设备信息和配网状态的数据格式。
6. 超时、重试、断连、重复配网和重置行为。
7. BLE 链路及 WiFi 密码传输的安全方案。
8. 双方日志、测试固件及联调验收标准。

本文所称“配网”是通过 BLE 给桌搭配置 WiFi。若业务还包含“设备绑定到用户账号”，需额外确认设备 SN、激活凭证及服务端绑定接口。

## 2. 当前 APP 侧方案

APP 本期 BLE 主链路如下：

```text
进入扫描页
  → 初始化手机蓝牙
  → 扫描待配网桌搭
  → 用户选择设备
  → 输入 2.4GHz WiFi SSID 和密码
  → 建立 BLE GATT 连接
  → 发现并校验乐鑫 Provisioning Service
  → 通过 protocomm 建立 Security 2 安全会话
  → 查询能力（可选：由设备扫描附近 WiFi）
  → 通过 network_provisioning set/apply 下发 WiFi 凭据
  → 等待设备联网结果
  → 成功、失败、超时或重试
```

APP 当前已有页面、BLE 优先的统一语义接口、跨页面状态机、二维码校验和 Mock 模拟；真实 Android 原生 Provisioning Provider 尚待接入。下文保留的五特征表仅用于解释旧草案，不能作为本期固件实现依据。

### 2.1 对 DH-WIFI-PROV-20260716 v1.0 的评审结论

#### 总体判断

方案对业务目标、基本流程、页面状态和异常场景的描述合理，并且与当前 APP Mock 实现基本一致。但它同时提出：

1. 使用 ESP-IDF 官方 `wifi_provisioning`。
2. 自定义 `WIFI_SSID / WIFI_PASSWORD / PROV_STATUS / DEVICE_INFO / COMMAND` 五个 GATT Characteristic。

这不是同一套线上协议。ESP-IDF 官方 Unified Provisioning 使用 `wifi_prov_mgr + protocomm`，内部已经提供 BLE GATT transport、会话安全、PoP、protobuf 消息和 WiFi 配网端点。若采用官方方案，APP 不能继续按当前五特征协议直接写入 SSID 和密码；若采用自定义五特征，则不能再把它描述为直接采用官方 `wifi_provisioning` 协议。

#### 建议技术路线

推荐优先选择：

```text
ESP32-S3：ESP-IDF 6.0 + 独立 `network_provisioning` 组件 + BLE transport + protocomm
安全：Security 2（优先）或 Security 1 + 每设备 PoP
身份：机身/包装二维码携带 name、transport、security、PoP
APP：通过平台原生桥接接入乐鑫 Provisioning Client，UTS 层保留统一业务接口
扩展：SN/型号/固件等通过官方 custom endpoint 获取
```

选择该路线的理由：

- 不自行发明密钥协商、加密、重放防护和凭据事务协议。
- 固件端直接复用乐鑫配网状态机、WiFi 配置端点和安全会话。
- Android/iOS 有乐鑫官方客户端实现可参考或集成。
- 支持 WiFi 扫描、设置配置、应用配置和查询状态的完整事务。
- 设备能力和自定义信息可以通过 protocomm custom endpoint 扩展。

需要接受的代价：

- 当前 APP 的简单五特征协议和 `useProvision` 数据层需要调整。
- uni-app x 需要 Android/iOS 原生插件或在 UTS 中完整实现 protocomm/protobuf；推荐原生插件。
- HarmonyOS、微信小程序没有同等成熟的官方客户端，需要单独验证和排期，不能在方案阶段直接承诺体验完全一致。

如果项目最终决定保留自定义五特征协议，则必须单独设计并评审：会话握手、设备 PoP、应用层加密、nonce/请求 ID、事务提交、分包、完整性校验和重放防护，不能使用明文写特征作为生产方案。

#### v1.0 必须修订项

| 编号 | v1.0 当前表述/问题 | 评审意见 |
| --- | --- | --- |
| R-01 | 官方 `wifi_provisioning` + 自定义五特征混用 | 二选一并冻结；推荐官方 Unified Provisioning |
| R-02 | “Just Works 够用” | Just Works 不提供 MITM 防护，不适合直接保护 WiFi 密码；应使用 PoP + Security 2/1 |
| R-03 | “随机 Service UUID 防重放” | Service UUID 不是防重放机制；使用固定正式 UUID，重放通过安全会话 nonce/密钥处理 |
| R-04 | 独立写 SSID、密码后自动开始联网 | 缺少事务边界；应使用官方 set/apply，或增加独立 START/COMMIT 命令 |
| R-05 | 状态 Byte 1-2 仅写“预留、可选” | 必须冻结字节序、完整错误码、未知值和协议版本行为 |
| R-06 | DEVICE_INFO 只有字段名称 | 必须冻结数据格式、长度、版本和敏感字段访问控制 |
| R-07 | 笼统写“ESP32 不支持 5GHz” | ESP32 系列能力不同，例如部分新型号支持 5GHz；必须先确认具体 SoC |
| R-08 | “ESP-IDF v5.x 默认 Bluedroid、NimBLE 节省 50%” | 不作为协议结论；以具体 SoC、IDF 版本、sdkconfig 和实测资源为准 |
| R-09 | NVS 加密只描述为打开单个配置 | 需与 Flash Encryption、密钥分区、Secure Boot 和量产烧录方案联合设计 |
| R-10 | WiFi 失败“使用不同信道重试” | STA 不能任意为目标 AP 选择信道；应按 reason code、BSSID/同名 AP 策略处理 |
| R-11 | Notify 超时才 Read 状态 | 无论 Notify 是否正常，都应定义可恢复的 get_status/read 语义 |
| R-12 | 已配网设备自动进入配网模式 | 需要物理在场或认证约束，避免附近用户触发改网 |
| R-13 | 承诺小程序/HarmonyOS 全平台一致 | 需先做 API 和安全协议 POC，再确定正式范围 |
| R-14 | “成功”仅写连接 WiFi | 明确成功边界：关联成功、DHCP 成功、互联网可达或云端上线 |
| R-15 | 未冻结 ESP-IDF 主版本 | 已确认 ESP-IDF 6.0；使用独立 `network_provisioning` 组件，不再按 v5.x 内置 `wifi_provisioning` 接入 |
| R-16 | `0000ffff-...` 一概标为占位 UUID | 该值也是乐鑫 BLE Provisioning 的默认 Service UUID；若走官方方案可保留或通过官方 API 设置自定义 128-bit UUID |

#### 与当前 APP 代码的影响

若选官方 Unified Provisioning：

- 保留现有扫描、WiFi 选择、进度和结果 UI。
- 保留平台无关 `BleAdapter/ProvisionController` 的分层思想，但调整接口语义。
- 删除“直接写 SSID 特征、直接写密码特征”的业务假设。
- 增加 QR/PoP、建立安全会话、获取 capabilities、scanNetworks、provision/getStatus。
- ESP32 状态映射到 APP 现有 `ProvisionPhaseEnum` 和用户错误文案。

若选自定义协议：

- 当前 APP 改动较小。
- 固件和 APP 的安全、分包、事务、兼容性成本显著增加。
- 必须先完成正式协议 v1.0，而不是直接沿用当前 Mock 字节格式。

## 3. 硬件基本信息

| 项目 | 硬件侧填写/确认 |
| --- | --- |
| 芯片/模组 | ESP32-S3（乐鑫）；具体模组型号待确认，例如 ESP32-S3-WROOM-1/1U |
| BLE 版本 | ESP32-S3 支持 Bluetooth LE；具体控制器版本、扩展能力及 sdkconfig 待确认，不支持 Classic Bluetooth |
| ESP-IDF 版本 | 已确认 6.0；补丁版本、commit/tag、关键 sdkconfig 待确认 |
| BLE 协议栈 | 待确认：NimBLE / Bluedroid |
| 支持的 ATT MTU | 待确认 |
| WiFi 频段 | ESP32-S3 集成 2.4GHz WiFi，不支持 5GHz |
| WiFi 安全类型 | 待确认：开放/WPA2/WPA3 等 |
| 固件版本 | 待确认 |
| 测试设备数量及编号 | 待确认 |
| 是否支持 OTA | 待确认，本次是否涉及 |
| 设备唯一身份 | 待确认：SN/MAC/芯片 ID/证书 |
| 是否需要账号绑定 | 待产品和服务端确认 |

### 3.1 ESP32 平台专项确认

| 对齐项 | 需要硬件/固件确认 |
| --- | --- |
| 具体 SoC | 已确认 ESP32-S3；芯片 revision 待确认 |
| 模组型号 | 具体模组、Flash/PSRAM 规格、天线形式 |
| ESP-IDF | 已确认 6.0；补丁版本、commit/tag、SDK 配置及是否基于自研框架待确认 |
| 配网组件 | 使用独立 `espressif/network_provisioning`；精确组件版本待确认并锁定 |
| BLE Host | NimBLE 或 Bluedroid |
| GAP/GATT 示例基线 | 当前固件参考的乐鑫示例或组件版本 |
| WiFi/BLE 共存 | BLE 保持连接并同时连接 WiFi 时的资源、射频和断连策略 |
| ATT MTU | 默认值、协商目标值、单次安全负载长度 |
| 连接参数 | connection interval、latency、supervision timeout |
| MAC/身份 | 广播地址类型；public/static random/RPA；不可把随机地址直接当稳定设备 ID |
| NVS 行为 | WiFi 凭据何时写入、失败时是否保留、RESET 清理哪些 namespace/key |
| 串口日志 | 波特率、日志级别、抓取工具和敏感信息脱敏方式 |

ESP32 同时进行 BLE 通信和 2.4GHz WiFi 连接时存在射频共存，需要在真实设备上重点验证 Notify 延迟、BLE 意外断开以及 WiFi 扫描/关联期间的稳定性。

已确认固件基于 ESP-IDF 6.0。该版本已将原 `wifi_provisioning` 迁移并更名为独立 `network_provisioning` 组件，因此固件侧需要在 `idf_component.yml` 中声明并锁定组件版本，同时向 APP 侧提供实际启用的 transport、Security 版本、PoP/二维码格式、Service UUID 和 endpoint/capability 清单。

## 4. 配网模式与物理交互

| 对齐项 | 待确认内容 |
| --- | --- |
| 首次上电 | 是否自动进入配网模式，持续多久 |
| 手动进入 | 按键组合、长按时间、声光反馈 |
| 已配置设备 | 是否广播；是否允许覆盖原 WiFi |
| 配网超时 | 超时后停止广播、休眠还是继续广播 |
| 配网成功 | 是否立即停止广播/断开 BLE/重启 |
| 配网失败 | 是否继续保持 BLE 连接，能否直接重写凭据 |
| 恢复出厂 | 触发方式、是否清除 WiFi、账号绑定和其他数据 |
| 状态指示 | 指示灯/屏幕/声音分别如何表达各状态 |

建议硬件在未配置和主动进入配网模式时才开放配网 GATT 服务，降低被附近手机误配的风险。

## 5. BLE 广播协议

### 5.1 广播字段

| 字段 | APP 当前假设 | 最终约定 |
| --- | --- | --- |
| Local Name | `NUWAX-PET-*` | 待确认 |
| 配网 Service UUID | Mock 占位 `0000ffff-0000-1000-8000-00805f9b34fb` | 待确认正式 128-bit UUID |
| Manufacturer ID | 未定义 | 待确认 |
| Manufacturer Data | 未定义 | 待确认字段及字节序 |
| Service Data | 未定义 | 待确认 |
| Connectable | 是 | 待确认 |
| 广播间隔 | 未定义 | 待确认，建议兼顾发现速度和功耗 |

### 5.2 APP 设备识别规则

需要确认 APP 采用哪一种或哪几种组合筛选设备：

- 配网 Service UUID。
- Local Name 前缀。
- Manufacturer ID + 产品型号。
- 广播中的配网状态位。
- 广播中的稳定设备标识。

不建议只依赖广播名。iOS 返回的 `deviceId` 不是硬件 MAC，APP 如需跨会话识别同一设备，应从广播字段或连接后的设备信息中获得稳定身份。

### 5.3 建议的 Manufacturer Data

若硬件目前尚未定义，可评估下面的最小格式：

| 偏移 | 长度 | 字段 | 说明 |
| ---: | ---: | --- | --- |
| 0 | 1 | protocolVersion | 广播协议版本 |
| 1 | 1 | productType | 产品类型/型号编码 |
| 2 | 1 | flags | bit0=待配网，bit1=已配置，其他保留 |
| 3 | 6 或 N | stableDeviceId | 稳定设备标识，不建议直接暴露敏感身份 |

最终格式需结合隐私、安全和广播包长度共同确认。

## 6. GATT 协议

### 6.1 Service 与 Characteristic

| 名称 | APP Mock UUID | 方向 | 当前假设属性 | 最终 UUID/属性 |
| --- | --- | --- | --- | --- |
| PROV_SERVICE | `0000ffff-0000-1000-8000-00805f9b34fb` | - | Primary | 待确认 |
| WIFI_SSID | `0000ff01-0000-1000-8000-00805f9b34fb` | APP → 设备 | Write | 待确认 |
| WIFI_PASSWORD | `0000ff02-0000-1000-8000-00805f9b34fb` | APP → 设备 | Write | 待确认 |
| PROV_STATUS | `0000ff03-0000-1000-8000-00805f9b34fb` | 设备 → APP | Notify + Read | 待确认 |
| DEVICE_INFO | `0000ff04-0000-1000-8000-00805f9b34fb` | 设备 → APP | Read | 待确认 |
| COMMAND | `0000ff05-0000-1000-8000-00805f9b34fb` | APP → 设备 | Write | 待确认 |

需要逐项明确：

- 使用 Write Request 还是 Write Without Response。
- 是否要求加密连接、认证连接或 BLE Bond。
- Characteristic 最大值长度。
- 是否支持长写，还是由应用层分包。
- CCCD 订阅成功后是否立即上报当前状态。
- 单连接限制和多手机同时连接时的行为。

### 6.2 DEVICE_INFO

APP Mock 当前按 UTF-8 字符串解析：

```text
SN|MODEL|FIRMWARE
```

建议正式协议采用带版本的 TLV 或固定头结构，至少提供：

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| protocolVersion | 是 | APP 判断协议兼容性 |
| sn/stableDeviceId | 是 | 设备唯一身份及后续绑定依据 |
| productModel | 是 | 产品型号 |
| firmwareVersion | 是 | 固件版本和问题定位 |
| hardwareVersion | 建议 | 区分硬件批次 |
| capabilities | 建议 | 功能位，便于协议演进 |

待确认 DEVICE_INFO 是否包含敏感信息，以及未认证手机是否允许读取。

## 7. WiFi 凭据下发协议

### 7.1 当前 APP 假设

- SSID 和密码分别写入两个 Characteristic。
- 编码为原始 UTF-8，不带 `\0` 结束符。
- SSID 长度为 1～32 UTF-8 字节。
- 密码为空表示开放网络，否则为 8～64 UTF-8 字节。
- APP 先写 SSID，再写密码。
- 密码写入成功后，硬件自动开始连接 WiFi。
- 写操作使用 Write Request，APP 最多重试 3 次。

### 7.2 必须由硬件确认

| 对齐项 | 最终约定 |
| --- | --- |
| 字符编码 | UTF-8 / 其他 |
| 是否包含长度字段 | 待确认 |
| 是否包含结束符 | 待确认 |
| SSID 最大字节数 | 待确认 |
| 密码最大字节数 | 待确认 |
| 是否支持空密码 | 待确认 |
| 是否支持隐藏 SSID | 待确认 |
| 是否需要 BSSID | 待确认 |
| 是否需要 WiFi 安全类型 | 待确认 |
| 超过 ATT MTU 的处理 | 长写/分包/协议限制，待确认 |
| 写入顺序 | 待确认 |
| 提交配网方式 | 写完密码自动提交/独立 START 命令 |
| 重复写入语义 | 覆盖/追加/拒绝，待确认 |
| 中途断连 | 临时凭据是否立即清除 |

建议使用独立的 `START_PROVISION` 命令完成事务提交，避免只写入一半凭据或 APP 重试时触发非预期联网。

## 8. 配网状态协议

### 8.1 APP 当前假设

当前 Mock 状态包为 3 字节：

| 偏移 | 长度 | 字段 | 当前解释 |
| ---: | ---: | --- | --- |
| 0 | 1 | status | 配网状态 |
| 1 | 2 | errorDetail | 小端错误详情码，无错误为 0 |

当前状态值：

| 值 | 名称 | APP 行为 |
| ---: | --- | --- |
| `0x00` | IDLE | 等待凭据 |
| `0x01` | PROVISIONING | 继续等待 |
| `0x02` | CONNECTED | 配网成功 |
| `0x03` | FAILED | 按错误详情展示失败 |
| `0xFF` | ALREADY_CONFIGURED | 当前 APP 视为已成功配置 |

当前错误详情假设：

| 值 | 含义 |
| ---: | --- |
| `0x0001` | WiFi 密码错误 |
| `0x0002` | 找不到 AP |
| `0x0003` | DHCP 失败 |
| `0x0004` | 联网超时 |

### 8.2 建议补充的状态/错误

- SSID 或密码格式非法。
- 不支持的 WiFi 安全类型。
- 仅发现 5GHz 网络。
- 认证失败。
- Association 失败。
- DHCP 失败。
- DNS/互联网不可达——需明确“连上局域网”还是“可访问云端”才算成功。
- 云端激活失败——如本次包含激活。
- 设备忙、协议版本不兼容、内部错误。
- 配网被取消或已恢复出厂。

需确认状态 Notify 的发送次数、间隔、是否保证终态、APP 重订阅后能否 Read 到最后状态。

## 9. COMMAND 命令

APP Mock 当前定义：

| 值 | 命令 | 当前假设 |
| ---: | --- | --- |
| `0x01` | RESET | 清除 WiFi 凭据并重新进入配网模式 |
| `0x02` | SCAN | 触发设备扫描附近 AP，当前 APP 尚未使用 |

需要确认：

- 命令是否需要请求 ID、参数和校验码。
- RESET 是仅清 WiFi，还是完整恢复出厂。
- RESET 是否立即应答、Notify、断开并重启。
- 是否需要 `START_PROVISION`、`CANCEL_PROVISION`、`GET_STATUS` 等命令。
- 危险命令是否要求认证或物理在场确认。

## 10. 推荐交互时序

```text
APP                                      桌搭
 |                                         |
 | -------- 扫描配网广播 ----------------> |
 | <------- 广播/设备身份/配网标记 -------- |
 | -------- GATT Connect ----------------> |
 | -------- Discover Service/Chars ------> |
 | -------- Read DEVICE_INFO ------------> |
 | <------- 设备信息 ---------------------- |
 | -------- Subscribe PROV_STATUS -------> |
 | <------- IDLE/当前状态 ----------------- |
 | -------- Write WIFI_SSID -------------> |
 | -------- Write WIFI_PASSWORD ---------> |
 | -------- START_PROVISION（建议） ------> |
 | <------- PROVISIONING ----------------- |
 |                                         | ---- 连接 WiFi
 | <------- CONNECTED 或 FAILED ---------- |
 | -------- 可选 ACK/完成 ----------------> |
 | <------- 可选断开/停止广播 ------------- |
```

### 建议超时初值

| 操作 | APP 当前值 | 最终确认 |
| --- | ---: | --- |
| 扫描 | 15 秒 | 待确认 |
| 单次 BLE 连接 | 10 秒 | 待确认 |
| 连接重试 | 3 次，1/2 秒退避 | 待确认 |
| 特征写入重试 | 3 次，间隔 500ms | 待确认 |
| 等待联网结果 | 30 秒 | 待确认，需覆盖弱网/DHCP 场景 |

## 11. 安全方案

当前 APP Mock 会将 WiFi SSID 和密码以明文 UTF-8 写入 BLE 特征。正式方案必须在以下选项中明确选择：

1. BLE Secure Connections + 加密 GATT Characteristic。
2. 应用层握手及加密，例如设备公钥/临时密钥协商。
3. 一次性配网码、二维码或设备屏幕确认，用于验证物理在场。
4. 配网窗口限制，例如按键开启后 5 分钟有效。

至少需要回答：

- 任意附近手机是否都能连接并改写 WiFi？
- APP 如何确认连接的是用户面前的那台设备？
- 如何防止重放之前捕获的配网数据？
- 设备已绑定后，其他账号是否允许重配？
- RESET 命令如何防止被恶意触发？
- 日志是否会输出 SSID、密码、密钥或完整设备身份？

安全方案未冻结前，不建议在生产固件中开放明文配网。

## 12. 连接、断连与重试语义

| 场景 | 硬件预期行为 | APP 预期行为 |
| --- | --- | --- |
| 扫描不到 | 继续/周期广播 | 提示进入配网模式并重新扫描 |
| 连接失败 | 保持广播 | 最多重试 3 次 |
| 写 SSID 失败 | 不开始联网 | 重写 SSID |
| 写密码失败 | 不开始联网 | 重写密码或整组凭据 |
| 等待结果时 BLE 断开 | 待确认是否仍继续联网 | 重连后读取状态 |
| WiFi 密码错误 | 保持 BLE 可连接 | 保留 SSID，允许用户修改密码 |
| 配网成功后 BLE 断开 | 正常 | 以已收到成功终态为准 |
| 已配置设备再次进入 | 待确认覆盖规则 | 展示已配置/要求重置 |
| APP 退出配网页 | 清临时凭据或超时清理 | 取消订阅、断开、清内存密码 |
| 设备重启 | 待确认广播和状态恢复 | 重新扫描/连接 |

特别需要明确：如果设备在联网过程中主动断开 BLE，APP 应将其视为成功、失败，还是重连读取最终状态。

## 13. APP 与硬件日志约定

建议双方日志均带单调时间戳，并可通过一次联调编号关联。

APP 侧记录：

- 平台、系统版本、APP 版本。
- 扫描开始/结束、设备名、RSSI、脱敏设备标识。
- 连接、服务发现、订阅、读写及系统原始错误码。
- 写入数据长度，不记录 WiFi 密码正文。
- 收到的状态码、错误详情和原始十六进制。
- 重试次数、超时和断连原因。

硬件侧记录：

- 固件、硬件和协议版本。
- BLE 广播、连接、MTU、订阅和断开事件。
- 收包长度、请求 ID、解析结果，不记录密码正文。
- WiFi scan/auth/association/DHCP/云端连接阶段。
- 最终状态和原始内部错误码。

## 14. 硬件侧联调交付物

正式开始 APP 编码前，希望硬件侧提供：

- [ ] BLE 协议文档及版本号。
- [ ] 正式 128-bit UUID 清单。
- [ ] 广播包示例和字段解析说明。
- [ ] 每个 Characteristic 的属性与最大长度。
- [ ] DEVICE_INFO、凭据、状态和命令的十六进制示例。
- [ ] 完整状态码、错误码表及字节序。
- [ ] 配网状态机和断连/重启行为说明。
- [ ] 安全方案说明。
- [ ] 可调试固件及固件烧录/升级方式。
- [ ] 至少两台测试设备，明确 SN、型号、固件版本。
- [ ] 串口日志获取方式。
- [ ] nRF Connect 或 LightBlue 的人工操作步骤。
- [ ] 正常、错误密码、AP 不存在等可复现场景。

## 15. 联调分阶段验收

### 阶段 A：使用通用 BLE 工具验证固件

- [ ] 能稳定扫描到设备。
- [ ] 广播字段与协议一致。
- [ ] 能连接并发现完整 Service / Characteristic。
- [ ] 能读取 DEVICE_INFO。
- [ ] 能订阅状态。
- [ ] 手工写入凭据后能收到成功/失败状态。
- [ ] 重启、重置和重复配网行为符合约定。

### 阶段 B：APP Android 最小成功链路

- [ ] 权限申请和蓝牙关闭提示正常。
- [ ] APP 能发现、去重并展示设备。
- [ ] APP 能连接、发现服务、读取信息和订阅状态。
- [ ] APP 能下发 ASCII 及中文 SSID。
- [ ] APP 能收到联网成功并正确清理 BLE 资源。

### 阶段 C：异常路径

- [ ] WiFi 密码错误。
- [ ] 找不到 AP。
- [ ] DHCP 失败。
- [ ] 联网超时。
- [ ] 弱信号和连接失败。
- [ ] 写入中断、BLE 意外断开。
- [ ] APP 杀进程、切后台和返回重进。
- [ ] 已配置设备重新配网。
- [ ] RESET 及恢复出厂。

### 阶段 D：兼容性与安全

- [ ] Android 版本及主流厂商兼容性。
- [ ] iOS 接入与 deviceId 差异处理。
- [ ] 多设备同场扫描和选中正确性。
- [ ] 多手机竞争连接。
- [ ] 配网窗口、身份验证、加密和重放防护验收。
- [ ] 日志脱敏检查。

## 16. 首次对接会议议程

建议按以下顺序在一次会议内给出明确结论：

1. 确认产品术语：“桌搭”与当前代码中的“桌宠配件”是否为同一设备。
2. 演示硬件如何进入配网模式及状态指示。
3. 确认广播包、正式 UUID 和特征属性。
4. 逐字节确认 DEVICE_INFO、凭据、状态、命令格式。
5. 确认写入提交、Notify、断连、重启的完整时序。
6. 冻结状态码和错误码。
7. 决定配网安全和设备身份验证方案。
8. 明确“联网成功”的判定边界。
9. 确定测试固件、测试设备、日志工具和双方负责人。
10. 确定 Android 首次端到端联调日期。

## 17. 待决策记录

| 编号 | 问题 | 结论 | 负责人 | 截止日期 |
| --- | --- | --- | --- | --- |
| D-01 | 桌搭是否等同于代码中的桌宠配件 |  |  |  |
| D-02 | 正式 Service / Characteristic UUID |  |  |  |
| D-03 | 广播识别及稳定设备身份 |  |  |  |
| D-04 | DEVICE_INFO 正式格式 |  |  |  |
| D-05 | 凭据封包、分包及提交方式 |  |  |  |
| D-06 | 状态及错误码表 |  |  |  |
| D-07 | 联网成功判定边界 |  |  |  |
| D-08 | BLE 断连后的配网行为 |  |  |  |
| D-09 | 配网安全和设备身份验证 |  |  |  |
| D-10 | 是否包含用户账号绑定 |  |  |  |
| D-11 | Android 首联调固件和日期 |  |  |  |

## 18. 双方接口负责人

| 角色 | 姓名 | 联系方式 | 负责范围 |
| --- | --- | --- | --- |
| APP |  |  | Android BLE、页面、日志 |
| 固件 |  |  | BLE GATT、WiFi、状态机 |
| 硬件 |  |  | 模组、射频、按键和指示状态 |
| 服务端 |  |  | 设备绑定/激活，如涉及 |
| 产品/测试 |  |  | 流程、文案和验收 |
