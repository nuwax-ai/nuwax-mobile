# 自定义基座 S3 分发操作手册

适用于 Android、iOS 真机、iOS 模拟器和已产出基座的鸿蒙。分支选择、离线 SDK 和云打包入口见 [分支打包手册](./branch-packaging.md)。

## 同事下载和更新

需要 Bash、curl、Node.js 18 或更高版本、`shasum` 或 `sha256sum`。模拟器等 ZIP 产物另需 `unzip`。Windows 使用 Git Bash。下载使用 S3 公共读，不需要写入凭证、离线 SDK 或 HBuilderX 编译。

```bash
# 查看当前业务系列的匹配情况，再下载或更新
make base-info
make base-fetch

# 使用已知基座 ID，通道后续更新也不影响本次选择
NUWAX_BASE_VERSION=1.3.7 make base-fetch

# 只下载指定平台，显式指定的平台缺失时命令会失败
NUWAX_BASE_VERSION=1.3.7 NUWAX_BASE_TARGETS=android make base-fetch

# 临时跟随默认通道指针
NUWAX_BASE_CHANNEL=debug make base-fetch
```

- 固定版本和非默认通道保存到 `unpackage/debug/versions/<基座 ID>/`。同一工作区可以保留多个版本。HBuilderX 中选择「运行 → 使用自定义基座运行」，使用命令输出目录下对应的文件。
- 分支映射和仓库默认均保存到版本子目录。旧 App 系列映射和显式选择的 `debug` 通道写 `unpackage/debug/`。要让仍读取该目录的命令使用指定版本，可显式传 `NUWAX_BASE_DEST=unpackage/debug`。该目录是共享位置，需要保留多个版本时使用默认的版本子目录。也可用 `--dest DIR` 保存到单独目录。
- 下载先读取发布清单，校验文件大小和 SHA-256，模拟器包先解压，再替换目标文件。命令在下载、校验或解压阶段失败时保留已有包。更新时会清理下载器在该目录记录、但新版本未提供的旧包。
- 选择顺序为显式固定版本、显式通道、当前分支映射、仓库默认，然后是旧系列映射。没有映射文件的旧工作区和仓外 bootstrap 使用 `debug` 通道。配置文件存在但缺少本系列时，命令会提示维护映射。
- 没有指定平台时下载该版本清单里已有的平台。同一版本可分次下载不同平台。

| 文件 | 用途 |
| --- | --- |
| `android_debug.apk` | Android 真机、模拟器 |
| `iOS_debug.ipa` | iOS 真机。已签名 IPA 的描述文件须覆盖测试设备 UDID |
| `Pandora_simulator_debug.app` | iOS 模拟器。由同名 ZIP 解压 |
| `android_debug_vapor.apk`、`iOS_debug_vapor.ipa` | 历史 Vapor 基座，按原文件名下载 |
| `harmony_debug.*` | 已发布的鸿蒙基座 |

`pnpm base:fetch` 等价于 `make base-fetch`。脚本也可以直接调用，例如 `bash scripts/fetch-custom-base-s3.sh --channel vapor --targets android`。

### 找历史版本

以下入口只读 S3。列表需要 AWS CLI，可以匿名读取。信息查询会展示本次匹配的版本、HX 及产物名单。

```bash
make base-list
make base-info
NUWAX_BASE_VERSION=1.3.7 make base-info
```

也可使用 `pnpm base:list` 和 `pnpm base:info`。版本列表以发布清单为准，上传中断且未生成清单的版本不会列出。

单行下载入口由默认通道维护者更新。仓库脚本已更新时，可以直接用以上命令；需要从 S3 单独下载脚本时，等维护者通知该入口刷新后运行以下命令。

```bash
curl -fsSL https://s3.nuwax.com:9443/nuwax-packages/mobile-custom-bases/fetch-custom-base-s3.sh \
  | bash -s -- --channel debug
```

## 维护者上传

需要 Node.js 18 或更高版本，以及支持 `aws s3api put-object --if-none-match` 的 AWS CLI。使用组织配置的 AWS profile 或 `NUWAX_S3_ACCESS_KEY_ID`、`NUWAX_S3_SECRET_ACCESS_KEY`。维护者凭证需能列举基座前缀、读取已发布清单并写入发布目录和所负责的通道。证书、描述文件和凭证走受控渠道。

### 用已有产物发布

在对应源码的工作区运行。默认读取 `unpackage/debug/`。如果同时准备了几套包，用 `NUWAX_BASE_SOURCE` 或 `--source DIR` 指定本次产物目录。

新发布使用当前分支条目配置的 `X.Y.Z` 基座版本，也可显式给出新的版本。Android 和 iOS 发布时读取包内 App 版本并与源码核对，清单会保留各产物的内置 App 版本。业务分支下载基座时按映射选用，允许使用从其他兼容 App 版本构建的基座。

```bash
# 预演，检查产物、版本号以及目标路径
NUWAX_BASE_VERSION=2.1.0 NUWAX_BASE_CHANNEL=debug \
  NUWAX_BASE_TARGETS=android,ios-device,ios-simulator NUWAX_BASE_DRY_RUN=1 make base-publish

# 入库供固定版本验收
NUWAX_BASE_VERSION=2.1.0 NUWAX_BASE_CHANNEL=debug \
  NUWAX_BASE_TARGETS=android,ios-device,ios-simulator NUWAX_BASE_NO_PROMOTE=1 make base-publish

# 验收后提交 custom-base.lock.json 的映射修改
# 显式跟随 debug 通道的用户可另外更新通道指针
NUWAX_BASE_VERSION=2.1.0 NUWAX_BASE_CHANNEL=debug make base-promote
```

如发布对象是单端通道，把 `NUWAX_BASE_TARGETS` 设为该平台即可。未显式指定时会收集源目录里找到的产物；联调和稳定通道建议列明全部需要的平台，以免源目录里缺包或混入其他平台的旧包。Android 的 HX 版本从 APK 读取。仅发布 iOS 或鸿蒙时须填 `NUWAX_HX_VERSION` 为实际构建版本。

### 从源码出包并发布

启动 HBuilderX、导入当前项目并准备对应版本的离线 SDK。资源生成与签名步骤见 [本地基座维护规范](./local-custom-base-maintenance.md)。

```bash
# appResource → 三端出包 → 入库，等验收再切通道
NUWAX_HX_VERSION=5.34 NUWAX_BASE_VERSION=2.1.0 \
  NUWAX_BASE_NO_PROMOTE=1 make base-ship

# 单端流水线示例
TARGETS=android NUWAX_HX_VERSION=5.34 NUWAX_BASE_VERSION=2.1.1 \
  NUWAX_BASE_NO_PROMOTE=1 make base-ship
```

`base-ship` 的 `TARGETS` 同时控制出包和上传。流水线使用当前工作区的 `unpackage/debug/`，多份产物建议用不同工作区出包；共享同一份离线 SDK 工作副本时，错开打包。三个 Make 目标也对应 `pnpm base:publish`、`pnpm base:ship`、`pnpm base:promote`。

### Android 云打包后入库

1. 在打包分支确认 `manifest.json` 的 App 版本和构建号，记录实际参与打包的源码版本。在 HBuilderX 的「发行 → App-Android/iOS-云打包」中只选 Android，勾选「制作自定义调试基座」，使用项目的包名和联调签名。若要保留已有的 `unpackage/debug/android_debug.apk`，提交云打包前先另存一份。参见 [DCloud 云打包说明](https://doc.dcloud.net.cn/uni-app-x/tutorial/app-package.html)。
2. 云包下载完成后，将本次生成的 `android_debug.apk` 放到独立目录，例如 `out/android-cloud-base/`。在仓库根目录运行 `make base-list`，选一个尚未使用的数字基座版本。下面的 `1.4.0` 是示例基座 ID。

   ```bash
   BASE_VERSION=1.4.0
   NUWAX_BASE_VERSION="$BASE_VERSION" NUWAX_BASE_SOURCE=out/android-cloud-base \
     NUWAX_BASE_TARGETS=android NUWAX_BASE_NO_PROMOTE=1 NUWAX_BASE_DRY_RUN=1 make base-publish
   ```

   预演会读取 APK 内的 HX 运行时版本及 App 版本与构建号。确认生成的清单对应本次产物后，在相同源码下去掉 `NUWAX_BASE_DRY_RUN=1` 入库。
3. 用固定版本重新下载，在 HBuilderX 选择下载目录中的 APK，验证自定义基座可以启动，并检查本次变更涉及的原生功能。

   ```bash
   NUWAX_BASE_VERSION="$BASE_VERSION" NUWAX_BASE_TARGETS=android make base-fetch
   ```

4. 验收后提交对应的业务和原生插件改动、`manifest.json` 及 `custom-base.lock.json` 的新系列映射。仓库保存源码和映射，S3 保存 APK，离线 SDK 仅供本地重打包使用。版本映射优先按 Git 分支生效。若同一系列要默认支持 iOS，先准备包含所需平台的基座版本再更新映射。锁定版本生效后，同事更新对应分支并运行 `make base-info`、`make base-fetch`。

### 版本重发、失败和回退

| 场景 | 操作 |
| --- | --- |
| 新包、补齐平台 | 显式指定新的数字版本，清单包含这次交付的所有平台。 |
| 同名发布被拒绝 | 检查是否已有清单。已有清单时可直接下载或切通道。如需新产物，递增基座版本后重新发布。 |
| 占用 ID 后上传中断 | 该版本无发布清单时用新 ID 重试；失败目录不会进入可下载版本。 |
| 发布成功但通道更新失败 | 用同一 ID 执行 `base-promote`。若 `debug` 兼容指针更新失败，也用该命令补齐。 |
| 业务系列映射有问题 | 在 `custom-base.lock.json` 把对应系列恢复到上一个已验收基座，随后同事使用 `make base-fetch` 同步。 |
| 通道版本有问题 | 执行 `NUWAX_BASE_VERSION=<上一已验收版本> NUWAX_BASE_CHANNEL=<通道> make base-promote`，同事重新走通道下载即可。 |
| 同一通道多人维护 | 协调通道切换顺序，最后一次成功切换生效。不同通道可以独立切换。 |

## S3 目录与兼容

默认桶 `nuwax-packages`，默认前缀 `mobile-custom-bases`。

```text
mobile-custom-bases/
├── latest.json                       # debug 通道的兼容指针
├── channels/<通道>.json
├── fetch-custom-base-s3.sh           # debug 通道切换时刷新
└── versions/<基座 ID>/
    ├── reservation.json              # 新发布条件创建，用于占用 ID
    ├── artifacts/
    │   ├── …                         # 包文件
    │   └── manifest.json             # 所有包上传结束才写入
    └── scripts/fetch-custom-base-s3.sh
```

历史版本的路径和清单继续可读。新脚本只创建新版本目录；仍用旧版脚本上传会绕过同名保护，维护者切换新流程后统一使用新版脚本发布。

| 设置 | 说明 |
| --- | --- |
| `NUWAX_BASE_VERSION` | 发布新包必填 `X.Y.Z`。下载和通道切换也支持原有历史版本标识。 |
| `NUWAX_BASE_CHANNEL` | 显式指定通道时覆盖下载映射。发布和切换通道的默认值为 `debug`。 |
| `NUWAX_BASE_TARGETS` | 拉取或上传的平台，逗号分隔 |
| `NUWAX_BASE_SOURCE` / `NUWAX_BASE_DEST` | 分别覆盖已有产物上传源目录、下载目标目录 |
| `NUWAX_BASE_NO_PROMOTE=1` | 发布版本但不切换通道 |
| `NUWAX_BASE_DRY_RUN=1` | 预演上传，不写 S3 |
| `NUWAX_S3_ENDPOINT` / `NUWAX_S3_BUCKET` / `NUWAX_S3_PREFIX` | 覆盖 S3 地址、桶和前缀 |
| `NUWAX_S3_NO_VERIFY_SSL=1` / `NUWAX_S3_INSECURE=1` | AWS CLI 上传、curl 下载的自签证书兼容开关 |
