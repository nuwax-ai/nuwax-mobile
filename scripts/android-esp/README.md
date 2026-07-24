# Android ESP 本地自定义基座（官方对齐）

配合 [docs/android-esp-provisioning-local-base.md](../../docs/android-esp-provisioning-local-base.md)  
维护规范：[docs/local-custom-base-maintenance.md](../../docs/local-custom-base-maintenance.md)

## 脚本

| 脚本 | 阶段 | 作用 |
|------|------|------|
| `../local-base-env.sh` | * | 统一 `NUWAX_*` / 兼容旧变量 |
| `official/setup_sdk.sh` | A | 下载/校验 SDK，同步工作副本 + gradle-wrapper + local.properties |
| `ensure_env.sh` | * | JAVA_HOME / ANDROID_HOME |
| `configure_app.py` | A | 包名 / appid / AppKey / 精简示例与可选远程依赖 |
| `inject_all_uts_modules.py` | B | 注入 HX 导出的全部 UTS 插件 |
| `inject_esp_module.sh` | B | 兼容入口 → `inject_all_uts_modules.py` |
| `sync_local_pack_resources.sh` | B | 同步 HX www + **整目录替换** kt + 注入插件 |
| `setup_as.sh` | C | 打开 Android Studio / 打印联调路径 |
| `build_device_base.sh` | D | `assembleDebug` → `unpackage/debug/android_debug.apk` |

## 一键构建

```bash
cd /Users/apple/workspace/nuwax-mobile
source scripts/local-base-env.sh
# 先 HX 生成本地打包 App 资源
make base-android
```

## 环境变量

优先使用 `scripts/local-base-env.sh`（`NUWAX_SDK_ROOT` / `NUWAX_LOCAL_BASE_ROOT` / `NUWAX_HX_VERSION`）。  
仍可用旧名覆盖：`UNIAPPX_ANDROID_SDK_ROOT`、`ANDROID_ESP_WORK`、`ANDROID_BUNDLE_ID`、`DCLOUD_APPKEY`。

## 注意

- 官方 SDK zip 常缺 `gradle-wrapper.jar`，`ensure_env.sh` 会自动补齐。
- 个推 / 广告 AAR 等非配网必需依赖会在 `configure_app.py` 中排除。
- 产物：`unpackage/debug/android_debug.apk` → HX「使用自定义基座运行」。
