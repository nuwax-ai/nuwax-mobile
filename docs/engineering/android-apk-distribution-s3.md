# Android APK · S3 发布

同步 HBuilderX **已经打好**的安卓正式 APK。支持本地文件和下载链接，生成与桌面客户端同风格的 `latest.json`。本流程不提交二进制、不触发打包，也不修改 App 当前读取租户配置的检查更新逻辑。

## 首次使用：准备环境与权限

以下命令在 **nuwax-mobile 仓库根目录**执行，以 macOS 为例。先更新到 `feat-2026.11`；已有本地修改时先按团队流程保存，再切换或拉取，不要直接覆盖。新同事可直接克隆当前功能分支：

```bash
git clone --branch feat-2026.11 https://github.com/nuwax-ai/nuwax-mobile.git
cd nuwax-mobile
```

### 1. 检查工具

```bash
node --version                  # 需要 v22 或更新版本
pnpm --version
aws --version
unzip -v
pnpm apk:publish --help
```

- **Node.js / pnpm**：使用 Node.js 22+ 和仓库约定的 pnpm 10。发布脚本只依赖 Node 内置模块，单独上传无需先安装全部项目依赖。
- **AWS CLI**：macOS 已装 Homebrew 时可运行 `brew install awscli`。
- **Android SDK Build-Tools**：可从 Android Studio 的 SDK Manager 安装，脚本需要其中的 `aapt2`。已有 SDK 时自动查找，也可指定：

  ```bash
  export NUWAX_AAPT2="/你的AndroidSDK/build-tools/版本号/aapt2"
  ```

如果未单独安装 Node/pnpm，但已有 HBuilderX，可使用它内置的 Node 22 执行同一脚本；先检查该 Node 的版本：

```bash
"/Applications/HBuilderX.app/Contents/HBuilderX/plugins/node/node" --version
"/Applications/HBuilderX.app/Contents/HBuilderX/plugins/node/node" scripts/publish-apk-s3.mjs --help
```

后续示例中的 `pnpm apk:publish` 可替换为上述 Node 路径加 `scripts/publish-apk-s3.mjs`，其余参数相同。

### 2. 配置发布凭证

先向 **S3 维护者**申请 `nuwax-packages/mobile-app/` 的发布权限及 Access Key / Secret Key，已有可用凭证的同事可复用。通过受控渠道领取，不在群消息、仓库或文档中粘贴真实凭证。

推荐创建独立 AWS profile，避免影响其它项目：

```bash
aws configure --profile nuwax-mobile
```

交互填写领取的 Access Key、Secret Key；region 填 `us-east-1`，output format 填 `json`。凭证保存在本机 AWS 配置目录，每次新开终端选择该 profile：

```bash
export AWS_PROFILE=nuwax-mobile
```

用已发布的更新 JSON 检查凭证能否读取目标前缀（该命令不会上传文件）：

```bash
aws s3api head-object \
  --endpoint-url https://s3.nuwax.com:9443 \
  --region us-east-1 \
  --bucket nuwax-packages \
  --key mobile-app/latest/latest.json \
  --no-cli-pager
```

返回对象信息说明读权限可用；写入和恢复所需的删除权限由维护者一并开通。endpoint、bucket、prefix 已有默认值，正常使用无需重复配置；若终端继承了其它项目的 `NUWAX_S3_*` 或 `AWS_*` 配置，先确认它们指向本项目。

## 每次发布：先预演，再上传

HBuilderX 打包完成后，准备正式 APK 文件或复制其**直接下载链接**。不传打包状态页/登录页地址。以下 `/绝对路径/app.apk` 替换为你本机的实际文件路径；macOS 可将 APK 拖进终端取得路径。

```bash
# 1. 本地文件预演，默认发布版本读取仓库 manifest.json 的 versionName
pnpm apk:publish --file "/绝对路径/app.apk" --dry-run

# 2. 核对预演显示的版本、构建号、S3 地址后，去掉 --dry-run 正式上传
pnpm apk:publish --file "/绝对路径/app.apk"

# 显式指定发布版本（例如上传历史 1.3.2 包），优先于 manifest.json
pnpm apk:publish --file "/绝对路径/app.apk" --version 1.3.2 --dry-run
pnpm apk:publish --file "/绝对路径/app.apk" --version 1.3.2

# 也支持 HBuilderX 直接下载链接；--silent 避免回显临时令牌
pnpm --silent apk:publish --url 'https://example.com/app.apk?token=...' --version 1.3.2 --dry-run
pnpm --silent apk:publish --url 'https://example.com/app.apk?token=...' --version 1.3.2

# 更新说明与机器可读结果（--silent 避免 pnpm 自身输出干扰 stdout）
pnpm --silent apk:publish --file '/path/to/app.apk' --notes-file '/path/to/更新说明.md' --json
```

`--notes-file` 指向普通 UTF-8 文本或 Markdown 文件，内容作为本次更新说明；不指定时说明为空。`--json` 用于自动化读取输出，手动发布时可以省略。

### 版本号如何指定

- 传入 `--version 1.3.2` 时，使用指定的发布版本；也接受 `--version v1.3.2`，统一为 `1.3.2`。
- 不传 `--version` 时，读取**本仓库根目录** `manifest.json` 的 `versionName`。发布版本仅支持 `X.Y.Z`，缺失或格式不正确时提示修正配置或传入 `--version`。
- 发布版本决定 S3 的 `v<version>/` 目录、`nuwax-<version>.apk` 文件名和两份 JSON 顶层的 `version`。
- APK 的实际 `versionName`、`versionCode` 仍从包内读取，分别记录在 `platforms.android.versionName`、`platforms.android.versionCode`；脚本不修改 APK。日志会同时展示发布版本及来源、APK 实际版本和构建号。

例如仓库 `versionName` 是 `1.3.3`，上传包内版本 `1.3.2 (132)` 的 APK：不传参数时发布到 `v1.3.3/nuwax-1.3.3.apk`，顶层 `version` 为 `1.3.3`，安卓条目仍记录 `versionName=1.3.2`、`versionCode=132`；传 `--version 1.3.2` 则发布到 `v1.3.2/nuwax-1.3.2.apk`。上传历史版本时应显式指定对应发布版本。

`--file`、`--url` 必须且只能选一个。`--dry-run` 会下载（链接来源）、读取包内版本并完整校验 APK，生成本地 JSON、打印目标地址，但不访问 S3，因而不检查远端构建号或写权限。

带临时令牌的链接使用 `pnpm --silent`，避免 pnpm 自身回显命令参数；发布脚本本身不输出下载链接。也可用本地文件来源。

实际发布需要 Node.js **22+**、`unzip`、Android SDK **build-tools/aapt2**、AWS CLI。macOS 可 `brew install awscli`；已有 HBuilderX 内置 Node 22 也可直接运行脚本。无需启动 HBuilderX，无需下载离线 SDK 或重新打包。

`aapt2` 自动从 PATH、`ANDROID_SDK_ROOT`、`ANDROID_HOME`、常见 Android SDK 和 Homebrew SDK 路径查找；也可用 `NUWAX_AAPT2=/absolute/path/to/aapt2` 指定。APK 包名必须匹配仓库 `manifest.json` 的 `app-android.distribute.packagename`；APK 实际版本与发布版本分别记录，支持 `X.Y.Z` 正式版。

## 如何确认发布成功

命令以退出码 `0` 结束，并显示类似结果；必须看到 **“发布完成”**，仅“预演完成”不会上传：

```text
发布完成：1.3.2 (132)
APK：https://s3.nuwax.com:9443/nuwax-packages/mobile-app/v1.3.2/nuwax-1.3.2.apk
版本 JSON：https://s3.nuwax.com:9443/nuwax-packages/mobile-app/v1.3.2/latest.json
最新 JSON：https://s3.nuwax.com:9443/nuwax-packages/mobile-app/latest/latest.json
本地 JSON：.../unpackage/apk-publish/run-.../latest.json
```

脚本在显示成功前，已从公开地址下载 APK 校验大小和摘要，并回读两份 JSON。将 **APK 地址**交给下载者，将固定的 **latest JSON 地址**交给后续更新功能对接；JSON 中安卓下载地址位于 `platforms.android.url`，构建号位于 `platforms.android.versionCode`。

可直接打开 [固定 latest.json](https://s3.nuwax.com:9443/nuwax-packages/mobile-app/latest/latest.json)，核对 `version` 与 `versionCode`；它会随之后的发布更新。需要固定某版时使用版本目录中的地址。

首次验收（2026-11-05）使用 HBuilderX 产物 `__UNI__8BF05E4_1104184546.apk`，实际版本 `1.3.2 (132)`、包名 `com.nuwax.app`、大小 `49,070,376` 字节。该包首次上传、同版本覆盖及三个公开地址回读均已通过，SHA-256 为 `5ff61208adf0b686953c10f5ea6c5944c8a82c4feb6eb2f5d4664f98ddf67507`。后续 latest 指向新版本时，不再代表该历史快照。

## 常见问题

| 现象 | 处理方式 |
| --- | --- |
| 找不到 `apk:publish` 命令 | 确认在仓库根目录、已更新 `feat-2026.11`，可运行 `pnpm apk:publish --help` 检查。 |
| Node 版本过低、找不到 pnpm | 使用 Node 22+，或使用上文 HBuilderX 内置 Node 的直接执行方式。 |
| 找不到 `aapt2` | 安装 Android SDK Build-Tools，检查 `NUWAX_AAPT2` 指向可执行文件。 |
| `S3 对象备份/回读` 或 `S3 上传` 执行失败 | 先用上面的 `head-object` 检查 profile、凭证、网络；确认具备读取/写入/删除权限。只读通过不代表可上传。 |
| S3 API 提示证书验证失败 | 优先配置本机信任的证书；确属受控自签证书环境时可设 `NUWAX_S3_NO_VERIFY_SSL=1`。公开下载域名仍需有效信任。 |
| 下载失败 / APK ZIP 校验失败 | 本地文件确认下载完整；链接来源确认未过期且能直接下载 APK，重新从 HBuilderX 获取链接后重试。 |
| APK 包名不匹配 / 版本格式不支持 | 使用本项目正式 APK，版本名为 `X.Y.Z`；不要为绕过校验而修改 JSON 标注。 |
| `manifest.json versionName` 格式错误或缺失 | 修正仓库版本配置，或通过 `--version 1.3.2` 显式指定发布版本。 |
| APK 离线资源校验失败 | 交给打包同事检查离线资源准备和构建流程，重新出包后重试。 |
| 拒绝将 latest 降到较低构建号 | 当前入口已发布更高 `versionCode`；核对选包是否正确。不要手工改 JSON 绕过降级检查。 |
| 同一前缀已有发布任务 | 等当前任务完成；异常退出残留按下文检查锁和备份，不直接删锁并发上传。 |
| 校验不一致 / 恢复失败 | 保留错误信息、工作目录及备份交给维护者处理，确认远端状态后再发布；分享诊断时不附凭证或临时下载令牌。 |

开发维护者可用 `pnpm apk:test` 运行脚本回归测试；普通发布者无需每次运行测试。

## 存储与凭证

| 配置 | 默认值 / 用途 |
| --- | --- |
| `NUWAX_S3_ENDPOINT` | `https://s3.nuwax.com:9443`，S3 API 地址 |
| `NUWAX_S3_REGION` | `us-east-1` |
| `NUWAX_S3_BUCKET` | `nuwax-packages` |
| `NUWAX_S3_PREFIX` | `mobile-app`，与调试基座目录独立 |
| `NUWAX_S3_PUBLIC_BASE_URL` | 默认 `<endpoint>/<bucket>`；可设为 CDN 的公开桶根地址，**不含 prefix** |
| `NUWAX_S3_NO_VERIFY_SSL` | 默认不开启；`1` 仅关闭 AWS CLI 的 TLS 校验 |

凭证沿用 AWS CLI 的环境变量、`AWS_PROFILE`、`~/.aws/credentials`；也兼容 `NUWAX_S3_ACCESS_KEY_ID`、`NUWAX_S3_SECRET_ACCESS_KEY`、`NUWAX_S3_SESSION_TOKEN`，同名 AWS 变量优先。不读取或修改仓库外其它项目的环境文件，不将凭证或原始临时下载链接写进结果。

桶/前缀需要具有读取、上传和删除权限（删除用于首次发布失败后的恢复），APK 和 JSON 必须允许匿名读取。公开下载域名必须受客户端信任；`NO_VERIFY_SSL` 不影响公开地址校验。

默认目录：

```text
s3://nuwax-packages/mobile-app/
├── v1.3.2/
│   ├── nuwax-1.3.2.apk
│   └── latest.json
└── latest/latest.json
```

对应公开 APK 地址为 `https://s3.nuwax.com:9443/nuwax-packages/mobile-app/v1.3.2/nuwax-1.3.2.apk`。`--json` 返回 `apkUrl`、`versionJsonUrl`、`latestUrl`、发布版本 `version`、版本来源 `versionSource`（`argument` / `manifest`）、APK 实际版本 `apkVersionName`、实际构建号 `versionCode`、摘要、`metadataFile` 和生成的 `metadata`；进度写入 stderr。失败返回非零退出码。

## latest.json

版本目录和固定入口使用同一份 JSON：

```json
{
  "version": "1.3.2",
  "notes": "更新说明（未指定时为空字符串）",
  "pub_date": "2026-11-05T09:00:00.000Z",
  "platforms": {
    "android": {
      "url": "https://s3.nuwax.com:9443/nuwax-packages/mobile-app/v1.3.2/nuwax-1.3.2.apk",
      "versionName": "1.3.2",
      "versionCode": 132,
      "packageName": "com.nuwax.app",
      "size": 123456,
      "sha256": "<APK SHA-256 十六进制>",
      "signature": "<APK SHA-512 Base64>"
    }
  }
}
```

`size` 为实际字节数，`pub_date` 为本次发布时间（UTC）。`signature` 沿用桌面客户端字段，表示 SHA-512 摘要，**不是 Android 签名证书**。Android 升级判断可使用条目中的数字 `versionCode`。本次只生成发布入口，App 接入该入口由后续需求完成。

## 校验、覆盖与恢复

1. 从 `--version` 或仓库 `manifest.json` 确定发布版本；复制或下载 APK 到 `unpackage/apk-publish/run-*/`，校验 ZIP、包名、真实版本和包内离线资源，再计算摘要。
2. 保存三个目标对象的旧内容及内容类型、缓存等元数据。若当前 latest 的 `versionCode` 更大，或 JSON 无法解析，写入前终止。
3. 上传 APK，从公开地址流式完整读取并核对大小、SHA-256；通过后上传并回读版本 JSON，最后上传并回读固定 latest。
4. 任一步失败（包括中断）均尝试恢复已经触及的对象，原来不存在的对象则删除；恢复后通过 S3 回读核对。若恢复也失败，报出对象键并保留本地备份，供人工处理。

同版本可覆盖同一 APK 地址，即使 `versionCode` 相同也允许再次发布；已有安装的升级仍应提高 APK 内的构建号。可覆盖文件使用 `public, max-age=0, must-revalidate`，固定 latest 使用 `no-store`。覆盖过程涉及多个对象，已有地址上的在途下载可能受影响，不承诺多对象原子切换。

**同一 S3 前缀串行发布**，包括不同机器。脚本用本地锁阻止本机重复发布；进程被强制结束（例如 SIGKILL/断电）时无法保证自动恢复。此时先检查 `unpackage/apk-publish/<hash>.lock/owner.json` 的 PID、工作目录与远端对象，恢复后再移除残留锁。不要在另一个机器仍在发布时移除锁重试。

本地 APK、JSON 和失败备份均在已忽略的 `unpackage/`，成功后自动移除恢复用备份，保留本次 APK、`latest.json`、`result.json`。定期按需清理成功运行目录；失败目录应先确认恢复情况再清理。
