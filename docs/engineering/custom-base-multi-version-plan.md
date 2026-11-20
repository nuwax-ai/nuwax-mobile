# 业务 App 与自定义基座版本规范

业务 App 和自定义基座各自使用 `X.Y.Z` 数字版本。修改原生能力、升级 HX / 离线 SDK 或补发平台包时，可以独立发布新基座。业务代码升级后，只要原生接口及运行时兼容，可以继续使用已验收的基座。

| 版本 | 记录位置 | 什么时候更新 |
| --- | --- | --- |
| 业务 App 版本 | `manifest.json` 的 `versionName` 和 `versionCode` | 发布新的业务 App 时更新。 |
| 基座版本 | 新基座发布时显式填写 `NUWAX_BASE_VERSION`，S3 清单记录基座、HX、源码 Git 提交和产物摘要 | 原生实现、运行时或基座产物有变更，需要分发新包时更新。已发布版本不覆盖。 |
| 业务系列使用的基座 | [custom-base.lock.json](../../custom-base.lock.json) 的 `appVersionSeries` | 验收通过后更新对应系列的映射。每条分支维护自己的映射并随代码评审。 |

## 业务 App 正式发版

1. 确定该 App 同一升级路径上一次实际发布的 Git tag 或提交，核对应用商店及其他分发入口的最高已用构建号。并行发版使用同一包名时，发版负责人要协调编号。
2. 更新根目录 `manifest.json`。兼容修复增加 PATCH，兼容新功能增加 MINOR，破坏性变更增加 MAJOR。正式发版使用大于上次的 `versionName`，`versionCode` 使用更大的正整数。两者分别维护，构建号从上次实际发行继续递增。
3. 在正式出包前运行版本检查。以下 tag 是示例，换成本次上架路径实际使用的上一次正式版本。

   ```bash
   pnpm app:version:check v1.3.8
   # 使用自定义基座联调时核对映射
   make base-info
   ```

4. 按 [发布前清理清单](./pre-release-checklist.md) 出正式包，核对包内版本、构建号、签名和目标环境。发版记录保留源码提交或 tag、App 版本、构建号及验收时使用的基座版本。发版流程引用 [正式 Android 包分发说明](./android-apk-distribution-s3.md)。

业务版本若从 `1.3.8` 升为 `1.3.9`，仍命中 `1.3.x` 的映射。首次进入 `1.4.x` 等新系列前，在配置里添加相应条目，验收后随该系列代码提交。可以将新系列映射到经过验证的现有基座。

## 基座发布与映射切换

新基座也使用 `X.Y.Z`。兼容修复、重打包或补齐平台一般增加 PATCH，兼容原生能力增加 MINOR，改变基座兼容约定时评估 MAJOR。选定版本前用 `make base-list` 查已发布版本。S3 会拒绝覆盖已用或已占用的 ID。

1. 维护者在对应源码提交上用独立基座版本发布，示例 `2.1.0`，见 [S3 分发操作手册](./custom-base-distribution-s3.md)。
2. 同事先用 `NUWAX_BASE_VERSION=2.1.0 make base-fetch` 下载候选基座，并在目标平台上运行需要支持的业务代码。
3. 验收通过后，通过 PR 更新分支的 `custom-base.lock.json`。键为 App 的 `主版本.次版本`，值为已经发布的基座版本。下例展示两个系列各自选择基座。同一个已验收基座也可以分配给多个系列。

   ```json
   {
     "appVersionSeries": {
       "1.3": "1.3.7",
       "1.4": "2.1.0"
     }
   }
   ```

4. 用 `make base-info` 核对实际命中的 App 系列、基座版本、HX 版本和平台。需要回退时，把对应映射改回上一已验收基座。显式跟随通道的同事走 `base-promote` 切换通道指针。

## 同事和 Agent 怎样使用

在对应业务分支执行 `make base-info` 查看匹配关系、`make base-list` 查看 S3 上有发布清单的基座。运行 `make base-fetch` 会按当前 App 版本系列自动下载，兼容 HBuilderX CLI 使用的 `unpackage/debug/`。配置里缺少该系列时命令会报错，便于维护者补上映射。

临时验收其他基座时显式传 `NUWAX_BASE_VERSION`，下载进入独立版本目录。临时跟随 S3 通道时显式传 `NUWAX_BASE_CHANNEL`。维护者需要长期调整时提交映射修改，业务版本仍按自己的发版流程更新。

本次初始映射为 `1.3.x → 1.3.7`，沿用原有默认通道的基座。其发布清单记录 HX `5.34`，包含 Android、iOS 真机和 iOS 模拟器。
