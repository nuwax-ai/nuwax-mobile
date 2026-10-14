# 自定义基座 · S3 分发（Nuwax MinIO）

对齐 [nuwa-cli `docs/distribution-s3.md`](../../../nuwa-cli/docs/distribution-s3.md)：基座二进制**不进 Git**，走公开读桶，同事免本地打自定义基座。

相关： [local-custom-base-maintenance.md](./local-custom-base-maintenance.md) · [esp-provisioning-local-base.md](./esp-provisioning-local-base.md)

## 本地目录 `unpackage/debug/`

本目录放 HX「自定义基座」文件，**二进制默认不入库**（整目录 gitignore）。经本文 S3 流程分发。

版本 = App [`manifest.json`](../manifest.json) → `versionName`；同版本覆盖；**不指定版本拉最新**。

### 同事：安装 / 同步更新

```bash
make base-fetch
# 或
curl -fsSL https://s3.nuwax.com:9443/nuwax-packages/mobile-custom-bases/fetch-custom-base-s3.sh | bash
```

| 文件 | 用途 |
|------|------|
| `android_debug.apk` | Android |
| `iOS_debug.ipa` | iOS 真机 |
| `Pandora_simulator_debug.app` | iOS 模拟器（勿与真机混用） |
| `harmony_debug.*` | 鸿蒙（预留） |

HX：**运行 → 使用自定义基座运行**。仅用基座的同事**不需要** iOS 开发证书。

### 维护者发布

```bash
# 推荐一键：HX appResource → 出包 → 上传 S3（需 HX 已开、项目已导入）
make base-ship
# 或：pnpm base:ship

# 分步（旧习惯仍可用）
make base-all
make base-publish    # 上传并更新 latest 指针
```

同事也可获得发布权限，见下文 [同事发布开通（权限）](#同事发布开通权限)。

## 版本策略

| 规则 | 说明 |
|------|------|
| 版本号 | 默认 = [`manifest.json`](../manifest.json) 的 `versionName`（与 App 一致，如 `1.0.0`） |
| 同版本发布 | **覆盖** `versions/<versionName>/artifacts/*`，只保留该版本最新一份 |
| 升 App 版本 | 改 `versionName` 后再 `make base-publish` → 新目录；旧版本仍可 `--version` 拉取 |
| 同事拉取 | **不指定版本 = 最新**（读 `channels/debug.json` / `latest.json`）；适合安装与同步更新 |

## 桶布局

默认桶 `nuwax-packages`，前缀 `mobile-custom-bases`。

```text
s3://nuwax-packages/mobile-custom-bases/
├── latest.json                          # 每次发布覆盖 → 当前最新 App 版本
├── channels/debug.json                  # 同上
├── fetch-custom-base-s3.sh
└── versions/
    └── 1.0.0/                           # = versionName；重复发布覆盖此目录
        ├── artifacts/
        │   ├── android_debug.apk
        │   ├── iOS_debug.ipa
        │   ├── Pandora_simulator_debug.app.zip
        │   ├── harmony_debug.*          # 预留
        │   └── manifest.json
        └── scripts/
            └── fetch-custom-base-s3.sh
```

| S3 对象 | 本地 | 说明 |
|---------|------|------|
| `android_debug.apk` | 同名 | Android |
| `iOS_debug.ipa` | 同名 | iOS 真机 |
| `Pandora_simulator_debug.app.zip` | 解压为 `.app` | iOS 模拟器（勿与真机混用） |
| `harmony_debug.*` | 同名 | 鸿蒙预留 |

## 发布

```bash
make base-all
# 可选：set -a; source ../nuwa-cli/.env; set +a
export NUWAX_S3_NO_VERIFY_SSL=1
make base-publish
# 或 bash scripts/publish-custom-base-s3.sh --dry-run
```

凭证：`NUWAX_S3_*` 或 `~/.aws` profile；**勿提交**。证书/p12 **禁止**上传公开桶。

## 同事发布开通（权限）

发布 = 写 `nuwax-packages` 桶，默认无权限。同事要上传只需三样：工具、S3 凭证、自签证书开关；endpoint / bucket / prefix 脚内已默认，无需配置。

### 1. 工具

```bash
brew install awscli    # 脚本强依赖 aws 与 node（manifest 生成用 node）
```

### 2. 凭证（向维护者要）

凭证不进仓库，向维护者索取 access key / secret（维护者本机权威副本在 `~/.aws/credentials` 的 `[default]`）。写入自己的 `~/.aws/credentials`：

```ini
[default]
aws_access_key_id = <向维护者索取>
aws_secret_access_key = <向维护者索取>
```

```bash
chmod 600 ~/.aws/credentials
```

- 该 key 对 `nuwax-packages` 桶**有写权限**（offline-sdk 前缀同样可写），走私密渠道传递，勿贴群、勿写进任何仓库
- 不想用 profile 可改用 `NUWAX_S3_ACCESS_KEY_ID` / `NUWAX_S3_SECRET_ACCESS_KEY` 环境变量，二选一

### 3. 验证与上传

```bash
# 验证凭证：必须带 --no-verify-ssl；MinIO 上 aws sts 会误判，用 s3 ls 实测
aws s3 ls s3://nuwax-packages/mobile-custom-bases/ \
  --endpoint-url https://s3.nuwax.com:9443 --no-verify-ssl

export NUWAX_S3_NO_VERIFY_SSL=1   # 自签证书，必设，否则 aws TLS 校验失败
make base-publish                 # 上传 unpackage/debug/ 下现有产物（或 pnpm base:publish）
# 先预演：bash scripts/publish-custom-base-s3.sh --dry-run
```

### 注意事项

| 事项 | 说明 |
|------|------|
| `--targets` 裁剪发布 | **别用**：只传单端会把远端 `versions/<ver>/artifacts/manifest.json` 覆盖成子集，拉取侧看到残缺清单，需手工合并重传 |
| 版本覆盖 | 版本默认取 `manifest.json` 的 `versionName`，同版本覆盖；发新版先 bump `versionName` |
| 基座产物 | 上传的是 `unpackage/debug/` 下已产出的包；从零打基座走 `make sdk-fetch` → `source scripts/local-base-env.sh` → `make base-ship`（需 HBuilderX 已导入项目） |
| iOS 真机基座 | 另需 Apple 证书 / profile（不随 S3 分发）；Android 基座无证书要求 |

## 拉取（同事：安装 / 同步更新）

不指定版本 = 最新：

```bash
curl -fsSL https://s3.nuwax.com:9443/nuwax-packages/mobile-custom-bases/fetch-custom-base-s3.sh | bash
# 或仓库内
make base-fetch
```

固定某一 App 版本：

```bash
NUWAX_BASE_VERSION=1.0.0 make base-fetch
```

然后 HX：**运行 → 使用自定义基座运行**。

## iOS 证书

| 角色 | 是否需要 `Nuwa iOS 证书`（p12 / cer / mobileprovision） |
|------|--------------------------------------------------------|
| 只 `make base-fetch` 用自定义基座 | **不需要**装到本机 |
| Android / iOS 模拟器 | **不需要** |
| iOS 真机装已签名 ipa | 电脑不需要证书；手机 **UDID 须已在描述文件**，否则要重签重发 |
| 自己 `make base-ios-device` | **需要** |

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `NUWAX_S3_*` | 同 nuwa-cli | endpoint / bucket / prefix / 凭证 |
| `NUWAX_BASE_CHANNEL` | `debug` | channel |
| `NUWAX_BASE_VERSION` | — | 固定版本；空则最新 |
| `NUWAX_HX_VERSION` | `5.15` | 写入 manifest |

## 鸿蒙

`harmony` target 已预留：有 `unpackage/debug/harmony_debug.*` 则上传；拉取时尝试下载。
