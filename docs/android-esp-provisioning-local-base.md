# Android 桌搭 BLE 配网 · 本地自定义基座（官方对齐）

> 适用：Android 真机调试 ESP32-S3 BLE 配网（Security 2），**零云打包费用**。  
> 对齐官方文档：
> - [原生 SDK 简介](https://doc.dcloud.net.cn/uni-app-x/native/)
> - [Android 集成](https://doc.dcloud.net.cn/uni-app-x/native/use/android.html)
> - [配置 UTS 插件](https://doc.dcloud.net.cn/uni-app-x/native/use/androiduts.html)
> - [原生联调](https://doc.dcloud.net.cn/uni-app-x/native/debug/android.html)
> - [SDK 下载](https://doc.dcloud.net.cn/uni-app-x/native/download/android.html)
>
> 脚本：[`scripts/android-esp/`](../scripts/android-esp/)  
> 维护规范：[local-custom-base-maintenance.md](./local-custom-base-maintenance.md)  
> iOS 对称文档：[ios-esp-provisioning-local-base.md](./ios-esp-provisioning-local-base.md)

## 官方对齐总表

| 官方要求 | 本仓实现 | 状态 |
|---------|---------|------|
| SDK 5.15 与 HX 同版 | `Android-uni-app-x-SDK@14915-5.15` | 已对齐 |
| 示例宿主 `uniappxnativepackage` | 工作副本 `$ANDROID_ESP_WORK/project` | 已对齐 |
| `uniappx` + `io.dcloud.uts.kotlin` | 沿用官方示例 | 已对齐 |
| UTS 插件 Android Library | `uts-nuwax-esp-provisioning` | 已对齐 |
| 插件 libs → 模块 + 主模块 | `inject_esp_module.sh` | 已对齐 |
| assets/apps/{appid} | `sync_local_pack_resources.sh` | 已对齐 |
| `applicationId=com.nuwax.nuwa` | `configure_app.py` | 已对齐 |
| 方案1 `android_debug.apk` → `unpackage/debug/` | `build_device_base.sh` | 已对齐 |
| 方案2 AS 联调 / HX 关联原生工程 | `setup_as.sh` | 已对齐 |

## 环境

```bash
export UNIAPPX_ANDROID_SDK_ROOT=/Users/apple/workspace/UniAppX-Android-5.15/Android-uni-app-x-SDK@14915-5.15
export ANDROID_ESP_WORK=/Users/apple/workspace/nuwax-android-esp
export ANDROID_HOME=/Users/apple/workspace/Android/sdk
export ANDROID_BUNDLE_ID=com.nuwax.nuwa
export ANDROID_COMPILE_SDK=36
export DCLOUD_APPKEY=02c109ded799bad828c3183534b330e3   # 与 iOS 同源，可覆盖
```

- HBuilderX **5.15**  
- Android Studio JBR / JDK 17+、`platforms;android-36`、`build-tools;35.0.0`  
- 插件本地依赖已在仓：`esp-idf-provisioning` + EventBus AAR（**无远程 Maven 拉乐鑫**）

## 标准流程（A → B → C → D）

```bash
cd /Users/apple/workspace/nuwax-mobile
source scripts/local-base-env.sh

# 0) HX：发行 → 原生App-本地打包 → 生成本地打包App资源
#    → unpackage/resources/app-android/

# A→D 一键
make base-android
# 或：./scripts/android-esp/official/setup_sdk.sh && ./scripts/android-esp/build_device_base.sh
```

分步：

```bash
./scripts/android-esp/official/setup_sdk.sh
python3 scripts/android-esp/configure_app.py
./scripts/android-esp/sync_local_pack_resources.sh   # www + kt 整目录替换 + inject_all
./scripts/android-esp/setup_as.sh                    # 可选
./scripts/android-esp/build_device_base.sh
```

### HX 联调

| 方式 | 操作 |
|------|------|
| **方案1** | `unpackage/debug/android_debug.apk` →「使用自定义基座运行」 |
| **方案2** | AS 打开 `$ANDROID_ESP_WORK/project`；HX 关联该原生工程根目录 |

### 已验证

- `BUILD SUCCESSFUL`：`applicationId=com.nuwax.nuwa`，产物写入 `unpackage/debug/android_debug.apk`
- 注入模块：`uts-nuwax-esp-provisioning` / `uts-nuwax-android-native-pay` / `uts-uni-cmark` / `uts-uni-highlight`

## 真机验收

与 iOS / Android 业务契约一致：扫码 → Sec2 → device-info → Wi‑Fi → `GOT_IP`。

## 云打包兜底

本机 SDK/证书不可用时仍可用 HX / `cli pack --iscustom true`。日常联调优先本文本地方案。
