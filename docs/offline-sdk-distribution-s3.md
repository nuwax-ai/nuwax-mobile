# 离线 SDK · S3 分发

> 把 `nuwax-mobile-offline-sdk`（DCloud uni-app x 5.15 SDK + 乐鑫配网依赖的官方源材料）放到 Nuwax S3（MinIO），团队成员一条命令拉取，避免"每人各自找 SDK / 路径写死本机"。
>
> 与自定义基座分发同构：[custom-base-distribution-s3.md](./custom-base-distribution-s3.md)。维护规范：[local-custom-base-maintenance.md](./local-custom-base-maintenance.md)。

## 打包内容（关键）

| 目录 | 是否打包 | 说明 |
|------|----------|------|
| `sdk/`     | ✅ | 各平台解压好的 uni-app x SDK（`{ios,android,harmony}/5.15/...`） |
| `archives/`| ✅ | 官方原始 zip（版本溯源 / 重钉） |
| iOS ESP 源码（`work/ios/{src/SwiftProtobuf,src/ESPProvision,SwiftProtobuf,ESPProvision}`） | ✅ | **非派生输入**；iOS 从源码编 ESPProvision/SwiftProtobuf framework 必需，否则打不出 iOS 模拟器基座 |
| `work/` 派生产物（`build/` `out/` DerivedData） | ❌ | 跨机不可用（DerivedData 绑绝对路径/签名），由各机构建脚本按需生成 |
| **iOS 证书 / Profile / 密钥** | ❌❌ | **绝不打包、绝不外传**。见下文「iOS 签名」 |

打包脚本：[`scripts/publish-offline-sdk-s3.sh`](../scripts/publish-offline-sdk-s3.sh) 打包 `sdk/ + archives/ + iOS ESP 源码`，排除 `work/` 的派生产物。已核实包内无 `.p12 / .mobileprovision / .cer / .key`。

## 发布（维护者）

```bash
# 前置：本机已有完整的 nuwax-mobile-offline-sdk（sdk/ + archives/）
make sdk-publish
# 或：bash scripts/publish-offline-sdk-s3.sh
# 固定版本：NUWAX_HX_VERSION=5.15 make sdk-publish
# 试跑：make sdk-publish --dry-run   （实际用 bash scripts/publish-offline-sdk-s3.sh --dry-run）
```

- 凭证只走环境变量 / `~/.aws` profile：`NUWAX_S3_ACCESS_KEY_ID` / `NUWAX_S3_SECRET_ACCESS_KEY`（或 `AWS_*`）；自签证书 `NUWAX_S3_NO_VERIFY_SSL=1`。
- 版本 = `NUWAX_HX_VERSION`（默认 5.15）；同版本覆盖；每次更新 `latest.json`。
- 产物：`s3://nuwax-packages/mobile-offline-sdk/versions/<ver>/nuwax-mobile-offline-sdk-<ver>.tar.gz` + `manifest.json`（含 sha256）+ `latest.json` + 引导 `fetch-offline-sdk-s3.sh`。

## 拉取（所有人）

```bash
# 仓库内（推荐）
make sdk-fetch
# 或：bash scripts/fetch-offline-sdk-s3.sh
# 固定版本：NUWAX_HX_VERSION=5.15 make sdk-fetch

# 仓库外（one-liner，无需克隆）
curl -fsSL https://s3.nuwax.com:9443/nuwax-packages/mobile-offline-sdk/fetch-offline-sdk-s3.sh | bash
# 自签证书：NUWAX_S3_INSECURE=1
```

- 公开读，只需 `curl` + `tar`；自签证书失败自动 `-k` 重试。
- 默认解压到 `$NUWAX_OFFLINE_SDK_HOME`（默认 `$HOME/workspace/nuwax-mobile-offline-sdk`）；`--dest` 可覆盖。
- 下载后 **sha256 校验**（对照 manifest），通过才解压。
- 还原后**自检** `sdk/android/<ver>`、`sdk/ios/<ver>`、`archives/` 是否齐全。

## 还原机制

拉取 = 下载一个 `nuwax-mobile-offline-sdk-<ver>.tar.gz` → 校验 sha256 → `tar xzf -C $NUWAX_OFFLINE_SDK_HOME`，**精确恢复 `sdk/` + `archives/` 两棵子树**（与 `local-base-env.sh` 期望的路径完全一致）。

`work/` 不在包内：拉取后执行构建脚本时自动生成——

```bash
source scripts/local-base-env.sh    # 派生 UNIAPPX_*_SDK_ROOT / ANDROID_ESP_WORK / IOS_ESP_BUILD_ROOT …
make base-android                   # 自动建 work/android
# iOS：./scripts/ios-esp/official/build_esp_chain.sh 等（见 ios-esp-provisioning-local-base.md）
```

> 若 `local-base-env.sh` source 时提示"未找到离线 SDK"，即说明需要先 `make sdk-fetch`。

## iOS 签名（不随包分发，各端自备）

**离线 SDK 包不含任何 Apple 签名材料**（证书 `.p12` / `mobileprovision` / AppKey 都不进 S3）。iOS 真机基座构建需要每位开发者本机具备：

- Apple 开发者证书（导入本机钥匙串）
- 匹配的 Provisioning Profile（`IOS_PROVISIONING_PROFILE_UUID` 指向它）
- DCloud 离线 AppKey（`DCLOUD_APPKEY`）
- Xcode 版本与 `DCloudUniappRuntime` 匹配（见 [ios-offline-base-xcode-version](../) / 维护文档）

这些**不可外传**，请通过团队约定的受控渠道各自配置。Android 无此要求。

## 版本与升级

- 换 HX/SDK 大版本时：维护者按 [local-custom-base-maintenance.md](./local-custom-base-maintenance.md) 的升级清单准备好新 `sdk/`+`archives/`，再用新 `NUWAX_HX_VERSION` 发布；其他人 `make sdk-fetch`（默认拉 latest）即可。
- 旧版本仍可在 `versions/<ver>/` 取到（固定版本用 `NUWAX_HX_VERSION=<ver> make sdk-fetch`）。
