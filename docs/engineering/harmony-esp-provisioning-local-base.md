# Harmony 桌搭 BLE 配网 · 本地自定义基座（HarmonyOS NEXT）

> 目标运行时：**纯血 HarmonyOS NEXT 6.0 / API 20 / DevEco 5.x**（无 AOSP）。  
> 插件实现方案：[harmony-esp-provisioning-integration.md](./harmony-esp-provisioning-integration.md)  
> 总览：[esp-provisioning-local-base.md](./esp-provisioning-local-base.md)  
> 维护规范：[local-custom-base-maintenance.md](./local-custom-base-maintenance.md)

## 插件状态（与基座脚本分离）

配网业务 API 冻结。鸿蒙端只补原生实现：

| 能力 | 状态 |
|------|------|
| `uni_modules/nuwax-esp-provisioning/utssdk/app-harmony` | 已接入：13 个原生函数签名对齐 Android/iOS |
| BLE 扫描 + GATT + 0x2901 endpoint 名 | 已实现（`@kit.ConnectivityKit`） |
| Security 2 / proto-ver / device-info / vox-config / provision | 已接到现有 13 函数；协议改编自 [esp-idf-provisioning-harmony](https://gitcode.com/Z_Heart/esp-idf-provisioning-harmony)（Apache-2.0），**未引入 FastBLE** |
| `ohos.permission.ACCESS_BLUETOOTH` | 插件 `module.json5` 已声明，运行时申请 |
| 本地离线自定义基座脚本 | 仍预留（见 `scripts/harmony-esp/README.md`） |

若现有 NEXT 自定义基座 HAP 已能加载 UTS 鸿蒙插件，只需编进本插件；缺蓝牙权限或 API 20 编译失败再重打 **HarmonyOS 6 HAP 基座**（不是 Android 基座）。

## 环境变量（基座脚本预留）

见 `scripts/local-base-env.sh`：

- `UNIAPPX_HARMONY_SDK_ROOT`
- `HARMONY_ESP_WORK`

## 验收注意

- BLE `deviceId` 每次扫描可能变化，不能当永久设备 ID；稳定身份是 Security 2 之后的 `device-info.serialNumber`
- 禁止把 `HarmonyBleAdapter` 当配网主路径
- 禁止把 FastBLE / OHPM HAR 当运行时依赖；只改编其 Security 2 协议代码
- 强制 Security 2：`proto-ver.sec_ver != 2` 映射为 `SECURITY_MISMATCH`
