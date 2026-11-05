# Android APK · S3 发布

同步 HBuilderX **已经打好**的安卓正式 APK。支持本地文件和下载链接，生成与桌面客户端同风格的 `latest.json`。本流程不提交二进制、不触发打包，也不修改 App 当前读取租户配置的检查更新逻辑。

## 使用

```bash
# 本地文件（路径有空格时加引号）
pnpm apk:publish --file "/Users/apple/Downloads/Nuwax APP Files/Android/v1.3.2/__UNI__8BF05E4_1104184546.apk" --dry-run
pnpm apk:publish --file "/Users/apple/Downloads/Nuwax APP Files/Android/v1.3.2/__UNI__8BF05E4_1104184546.apk"

# 从 HBuilderX 复制的下载链接；引号保留查询参数
pnpm --silent apk:publish --url 'https://example.com/app.apk?token=...'

# 更新说明与机器可读结果（--silent 避免 pnpm 自身输出干扰 stdout）
pnpm --silent apk:publish --file '/path/to/app.apk' --notes-file '/path/to/更新说明.md' --json
pnpm apk:test
```

`--file`、`--url` 必须且只能选一个。`--dry-run` 会下载（链接来源）、读取包内版本并完整校验 APK，生成本地 JSON、打印目标地址，但不访问 S3，因而不检查远端构建号或写权限。

带临时令牌的链接使用 `pnpm --silent`，避免 pnpm 自身回显命令参数；发布脚本本身不输出下载链接。也可用本地文件来源。

实际发布需要 Node.js **22+**、`unzip`、Android SDK **build-tools/aapt2**、AWS CLI。macOS 可 `brew install awscli`；已有 HBuilderX 内置 Node 22 也可直接运行脚本。无需启动 HBuilderX，无需下载离线 SDK 或重新打包。

`aapt2` 自动从 PATH、`ANDROID_SDK_ROOT`、`ANDROID_HOME`、常见 Android SDK 和 Homebrew SDK 路径查找；也可用 `NUWAX_AAPT2=/absolute/path/to/aapt2` 指定。APK 包名必须匹配仓库 `manifest.json` 的 `app-android.distribute.packagename`。版本使用 **APK 内的 versionName/versionCode**，与仓库当前版本无关；首版支持 `X.Y.Z` 正式版。

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

对应公开 APK 地址为 `https://s3.nuwax.com:9443/nuwax-packages/mobile-app/v1.3.2/nuwax-1.3.2.apk`。`--json` 返回 `apkUrl`、`versionJsonUrl`、`latestUrl`、包内版本、摘要、`metadataFile` 和生成的 `metadata`；进度写入 stderr。失败返回非零退出码。

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

1. 复制或下载 APK 到 `unpackage/apk-publish/run-*/`，校验 ZIP、包名、真实版本和包内离线资源，再计算摘要。
2. 保存三个目标对象的旧内容及内容类型、缓存等元数据。若当前 latest 的 `versionCode` 更大，或 JSON 无法解析，写入前终止。
3. 上传 APK，从公开地址流式完整读取并核对大小、SHA-256；通过后上传并回读版本 JSON，最后上传并回读固定 latest。
4. 任一步失败（包括中断）均尝试恢复已经触及的对象，原来不存在的对象则删除；恢复后通过 S3 回读核对。若恢复也失败，报出对象键并保留本地备份，供人工处理。

同版本可覆盖同一 APK 地址，即使 `versionCode` 相同也允许再次发布；已有安装的升级仍应提高 APK 内的构建号。可覆盖文件使用 `public, max-age=0, must-revalidate`，固定 latest 使用 `no-store`。覆盖过程涉及多个对象，已有地址上的在途下载可能受影响，不承诺多对象原子切换。

**同一 S3 前缀串行发布**，包括不同机器。脚本用本地锁阻止本机重复发布；进程被强制结束（例如 SIGKILL/断电）时无法保证自动恢复。此时先检查 `unpackage/apk-publish/<hash>.lock/owner.json` 的 PID、工作目录与远端对象，恢复后再移除残留锁。不要在另一个机器仍在发布时移除锁重试。

本地 APK、JSON 和失败备份均在已忽略的 `unpackage/`，成功后自动移除恢复用备份，保留本次 APK、`latest.json`、`result.json`。定期按需清理成功运行目录；失败目录应先确认恢复情况再清理。
