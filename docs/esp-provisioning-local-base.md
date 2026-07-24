# 桌搭 BLE 配网 · 本地离线自定义基座总览

双端（及未来鸿蒙）均按 [uni-app x 原生 SDK](https://doc.dcloud.net.cn/uni-app-x/native/) 做本地离线自定义基座，避免每次云打包。

| 平台 | 文档 | 脚本 |
|------|------|------|
| **维护规范** | [local-custom-base-maintenance.md](./local-custom-base-maintenance.md) | `scripts/local-base-env.sh` + 根目录 `Makefile` |
| iOS | [ios-esp-provisioning-local-base.md](./ios-esp-provisioning-local-base.md) | `scripts/ios-esp/` |
| Android | [android-esp-provisioning-local-base.md](./android-esp-provisioning-local-base.md) | `scripts/android-esp/` |
| 鸿蒙 | [harmony-esp-provisioning-local-base.md](./harmony-esp-provisioning-local-base.md) | `scripts/harmony-esp/`（预留） |

共性：

- appid `__UNI__8BF05E4`，包名 / bundle `com.nuwax.nuwa`
- HX「生成本地打包 App 资源」→ 同步到离线宿主 → 打 debug 基座 → `unpackage/debug/`
- 插件：`uni_modules/nuwax-esp-provisioning`
- 云打包路径保留作兜底

快捷命令（**只出包、不装设备**）：

```bash
cd /Users/apple/workspace/nuwax-mobile
make base-android          # android_debug.apk
make base-ios-device        # iOS_debug.ipa（真机）
make base-ios-simulator    # Pandora_simulator_debug.app（模拟器，与真机分离）
make base-all
```

`unpackage/debug/` 中 **iOS 真机与模拟器是两套包**，勿混用。

阅读顺序：本总览 → [维护规范](./local-custom-base-maintenance.md) → 对应平台方案文档 → 脚本 README。  
业务契约见 [esp32s3-ble-first-integration-handoff.md](./esp32s3-ble-first-integration-handoff.md)。
