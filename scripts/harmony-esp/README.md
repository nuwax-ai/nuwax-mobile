# Harmony 本地自定义基座脚本（预留）

官方 uni-app x Harmony 原生 SDK 发布并与本机 HBuilderX 对齐后，在此目录按 Android/iOS 同构补齐：

```text
official/setup_sdk.sh
sync_local_pack_resources.sh
inject_*.py / inject_*.sh
configure_app.*
build_device_base.sh
```

配网 UTS 插件鸿蒙端已在 `uni_modules/nuwax-esp-provisioning/utssdk/app-harmony/`（HarmonyOS NEXT API 20）。
Security 2 / 配网全链路已按 [esp-idf-provisioning-harmony](https://gitcode.com/Z_Heart/esp-idf-provisioning-harmony) 源码内置落地（方案：[docs/engineering/harmony-esp-provisioning-integration.md](../../docs/engineering/harmony-esp-provisioning-integration.md)），ArkTS 编译已验证；基座打包脚本仍未实现。

在此之前请使用：

```bash
make base-harmony
# → 打印未实现说明
```

文档：[docs/engineering/harmony-esp-provisioning-local-base.md](../../docs/engineering/harmony-esp-provisioning-local-base.md)  
维护规范：[docs/engineering/local-custom-base-maintenance.md](../../docs/engineering/local-custom-base-maintenance.md)
