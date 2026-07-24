# iOS ESP 本地自定义基座脚本

配合 [docs/ios-esp-provisioning-local-base.md](../../docs/ios-esp-provisioning-local-base.md)  
维护规范：[docs/local-custom-base-maintenance.md](../../docs/local-custom-base-maintenance.md)

## 官方对齐脚本（优先）

| 脚本 | 阶段 | 作用 |
|------|------|------|
| `../local-base-env.sh` | * | 统一 `NUWAX_*` / 兼容旧变量 |
| `official/setup_extapi.sh` | A | ExtAPI → `SDK/Libs` + Demo 路径 + manifest 校验 |
| `official/verify_extapi_modules.py` | A | 启发式模块符号检查 |
| `official/build_esp_chain.sh` | B | 源码编译 SPB→ESP→unimodule，打 xcframework |
| `official/setup_workspace.sh` | C | `NuwaxUniAppX.xcworkspace` |
| `build_device_base.sh` | D | 真机基座 + `iOS_debug.ipa` → `unpackage/debug/` |

## 通用脚本

| 脚本 | 作用 |
|------|------|
| `gen_projects.py` | 生成三个 framework 的 xcodeproj（官方链调用） |
| `inject_frameworks.py` | 注入 Demo Embed |
| `strip_sample_unimodules.py` | 去掉 Demo 示例 unimodule 链接 |
| `sync_local_pack_resources.sh` | 同步 HX www + xcframework → Libs |
| `configure_demo.py` | appid / AppKey / 签名 / 蓝牙文案 / ipatype |
| `run_simulator.sh` | 模拟器冒烟 |

## 一键 / 环境

```bash
cd /Users/apple/workspace/nuwax-mobile
source scripts/local-base-env.sh
make base-ios   # 需已完成 ExtAPI + 插件链

# 或覆盖旧变量名
export UNIAPPX_SDK_ROOT=...
export IOS_ESP_BUILD_ROOT=...
export OFFICIAL_PLATFORM=iphoneos   # 或 all / iphonesimulator
```

## 二进制不进 git

xcframework / DerivedData 均在仓外 `IOS_ESP_BUILD_ROOT`。云打包仍走插件 `config.json` 的 CocoaPods。
