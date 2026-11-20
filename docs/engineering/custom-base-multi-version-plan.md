# 自定义基座多版本并行方案

## 现状与缺口

截至 2026-11-20，S3 有 13 个历史版本目录。默认 `debug` 通道指向 `1.3.7`，`vapor` 指向 `1.0.2-vapor`，两个版本都可读取发布清单。

原流程可以按版本下载，但默认把 App 的 `versionName` 作为基座版本，同一标识可覆盖。即使指定不同通道，发布也会更新全局 `latest.json`。各版本默认写到同一个 `unpackage/debug/`。同一个 App 版本的研发、联调和上线基座因此无法稳定地分别固定和回退。

## 版本和通道

| 项目 | 约定 |
| --- | --- |
| 基座版本 ID | 每一批产物用一个独立 ID，例如 `1.3.8-zhuoda-r1`。同一 App 版本的新包、原生插件改版或 HX 升级，用新的 ID，例如 `1.3.8-zhuoda-r2`。 |
| 通道 | 每条需要自定义基座的研发或交付路径有自己的通道。可采用 `zhuoda-dev`、`zhuoda-stable`、`voip-dev`，由各路径维护者认领。 |
| 通道切换 | 可先上传固定版本，由同事验收后将通道指向它。回退时把该通道指回已验收的版本。 |
| 本地并存 | 按版本或非默认通道拉取，保存到 `unpackage/debug/versions/<版本 ID>/`。在 HBuilderX 里选对应目录的文件。 |
| 原入口 | 无参数下载沿用 `debug` 通道和 `unpackage/debug/`，`latest.json` 作为 `debug` 的兼容指针。 |
| 适用范围 | 已采用自定义调试基座的研发与交付路径。官方通用基座和应用市场正式 APK/AAB 使用各自的流程。 |

## 给同事的使用说明

先切到带有新脚本的仓库分支。在对应的研发路径上，维护者会通知适用的通道、基座 ID、HX 版本和支持平台。

```bash
# 跟随通道。需要更新时执行同一条命令
NUWAX_BASE_CHANNEL=zhuoda-dev make base-fetch

# 联调、缺陷复现或回退到固定版本
NUWAX_BASE_VERSION=1.3.8-zhuoda-r1 make base-fetch
```

两个示例值需替换为维护者通知的实际通道或版本。下载后从命令输出的目录选包。验收记录填写实际下载的基座 ID，这样通道前进后仍可定位原包。

## 维护者发布

```bash
# 上传已经打好的 Android + iOS 真机 + iOS 模拟器，先提供给验收
NUWAX_BASE_CHANNEL=zhuoda-dev NUWAX_BASE_VERSION=1.3.8-zhuoda-r1 \
  NUWAX_BASE_TARGETS=android,ios-device,ios-simulator NUWAX_BASE_NO_PROMOTE=1 \
  make base-publish

# 验收后切换研发通道。回退时把版本改为上一个已验证的 ID
NUWAX_BASE_CHANNEL=zhuoda-dev NUWAX_BASE_VERSION=1.3.8-zhuoda-r1 make base-promote
```

- 发布版本前采用 S3 条件写入占用 ID，所有包上传完毕后才写发布清单，下载以清单为准。重复 ID、上传中断留下的 ID 都不会被后续发布覆盖。 [S3 条件写入](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
- 一个版本的清单列出这次上传的全部平台。通道如果需要三端，等三端准备齐再切换。单端适用的通道可以发布单端版本。
- 多个通道可以指向同一组已验收的产物。切换研发通道只改自己的指针，稳定通道可继续留在原版本。

## 推广步骤

1. 各路径维护者使用更新后的发布脚本，在独立通道先入库一个明确的平台组合。历史版本可直接按 ID 读取，原有通道继续使用。
2. 由同事分别下载固定版本和通道版本，检查路径、HX 兼容性及目标设备上的调试启动。用两个版本演练一次通道回退。
3. 把通道、推荐基座 ID、HX 版本、平台、对应代码分支发给本路径同事。稳定通道由对应维护者验收后切换。依赖 S3 单行下载入口的同事，在维护者刷新该入口前使用仓库脚本。
4. 维护者按 [S3 分发操作手册](./custom-base-distribution-s3.md) 处理凭证、历史版本查找、手工产物上传和故障恢复。
