# Android ESP 本地自定义基座（官方对齐）

配合 [docs/android-esp-provisioning-local-base.md](../../docs/android-esp-provisioning-local-base.md)  
维护规范：[docs/local-custom-base-maintenance.md](../../docs/local-custom-base-maintenance.md)

## 脚本

| 脚本 | 阶段 | 作用 |
|------|------|------|
| `../local-base-env.sh` | * | 统一 `NUWAX_*` / 兼容旧变量 |
| `official/setup_sdk.sh` | A | 下载/校验 SDK，同步工作副本 + gradle-wrapper + local.properties |
| `ensure_env.sh` | * | JAVA_HOME / ANDROID_HOME |
| `configure_app.py` | A | 包名 / appid / AppKey / 精简示例与可选远程依赖；默认打入 HX `debug-server`（`ENABLE_HX_DEBUG`） |
| `inject_all_uts_modules.py` | B | 注入 HX 导出的全部 UTS 插件 |
| `inject_esp_module.sh` | B | 兼容入口 → `inject_all_uts_modules.py` |
| `sync_local_pack_resources.sh` | B | 同步 HX www + **整目录替换** kt + 注入插件 |
| `setup_as.sh` | C | 打开 Android Studio / 打印联调路径 |
| `build_device_base.sh` | D | `assembleDebug`/`assembleRelease` → `android_debug.apk` / `android_release.apk` |
| `build_store_release.sh` | Release | 生产资源 + 正式签名 → 应用市场 APK/AAB |

## 一键构建

```bash
cd <本仓根目录>  # nuwax-mobile
source scripts/local-base-env.sh
# 先 HX 生成本地打包 App 资源
make base-android
```

### 发给测试同学（推荐 · 流程化）

```bash
make android-tester
# 或：pnpm android:tester
# 跳过资源导出：SKIP_APP_RESOURCE=1 make android-tester
```

流水线脚本：[`build_tester_release_apk.sh`](./build_tester_release_apk.sh)  
步骤：环境预检 → appResource → 显式切换测试 API → Release 出包（`ENABLE_HX_DEBUG=0`）→ 复制 `nuwa-zhuoda-release-YYYYMMDD-HHMM.apk` → 验收摘要。

环境约定：`android:tester` 使用 `https://testagent.xspaceagi.com`；
`android:release` 使用 `https://agent.nuwax.com`。两条流水线都会在同步到原生宿主前
重写并校验 Android appResource，因此使用 `SKIP_APP_RESOURCE=1` 也不会串环境。

### 应用市场正式包

先复制模板到签名目录并填写：

```bash
cp "${NUWAX_SIGNING_HOME:-$HOME/workspace/nuwax-signing}/local-secrets.env.example" \
   "${NUWAX_SIGNING_HOME:-$HOME/workspace/nuwax-signing}/local-secrets.env"
# 编辑 ANDROID_RELEASE_* / DCLOUD_APPKEY / IOS_* 等
```

再执行：

```bash
pnpm android:release
# 默认同时生成 APK+AAB；只生成一种：
ANDROID_RELEASE_FORMATS=apk pnpm android:release
ANDROID_RELEASE_FORMATS=aab pnpm android:release
```

正式命令在非 `release/nuwa-zhuoda` 分支或脏工作区运行时会警告并继续，产物
只能用于验包；上线流水线应设置 `STRICT_RELEASE_GIT=1`，强制要求生产分支和
干净工作区。产物写到 `unpackage/release/`，脚本会拒绝测试接口、Debug 证书、
错误包名/版本以及 `debuggable` APK。

## 环境变量

优先使用 `scripts/local-base-env.sh`（`NUWAX_SDK_ROOT` / `NUWAX_LOCAL_BASE_ROOT` / `NUWAX_HX_VERSION`）。  
仍可用旧名覆盖：`UNIAPPX_ANDROID_SDK_ROOT`、`ANDROID_ESP_WORK`、`ANDROID_BUNDLE_ID`、`DCLOUD_APPKEY`。

| 变量 | 默认 | 说明 |
|------|------|------|
| `ANDROID_BUILD_TYPE` | `debug` | `debug` 联调基座；`release` 接近发行性能；两者默认使用同一正式签名。 |
| `ANDROID_SIGNING_MODE` | `release` | `release` 统一使用 `ANDROID_RELEASE_*` 证书；仅临时排障时可覆盖为 `debug`。 |
| `ENABLE_HX_DEBUG` | `1` | `0` 去掉 debug-server / DCLOUD_DEBUG |

Debug 包保留 LeakCanary 内存泄漏检测，但构建脚本会关闭其名为 `Leaks` 的桌面图标与动态快捷方式。

注意：官方示例把 LeakCanary 写成 `implementation`，Release 会闪退（`LeakCanary in non-debuggable build`）。`configure_app.py` 会自动改成 `debugImplementation`。

## 注意

- 官方 SDK zip 常缺 `gradle-wrapper.jar`，`ensure_env.sh` 会自动补齐。
- 个推 / 广告 AAR 等非配网必需依赖会在 `configure_app.py` 中排除。
- Debug 产物：`unpackage/debug/android_debug.apk` → HX「使用自定义基座运行」。
- Release 产物：`unpackage/debug/android_release.apk` → 发给测试安装（非上架证书）。
