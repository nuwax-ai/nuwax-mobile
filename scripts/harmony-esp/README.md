# Harmony 本地自定义基座脚本（预留）

官方 uni-app x Harmony 原生 SDK 发布并与本机 HBuilderX 对齐后，在此目录按 Android/iOS 同构补齐：

```text
official/setup_sdk.sh
sync_local_pack_resources.sh
inject_*.py / inject_*.sh
configure_app.*
build_device_base.sh
```

在此之前请使用：

```bash
make base-harmony
# → 打印未实现说明
```

文档：[docs/harmony-esp-provisioning-local-base.md](../../docs/harmony-esp-provisioning-local-base.md)  
维护规范：[docs/local-custom-base-maintenance.md](../../docs/local-custom-base-maintenance.md)
