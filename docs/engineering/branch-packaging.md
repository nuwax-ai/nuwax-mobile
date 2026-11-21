# 分支基座、离线 SDK 与发行打包

`make base-fetch` 和 `make sdk-fetch` 读取当前 Git 分支。对应关系存放在 [custom-base.lock.json](../../custom-base.lock.json) 的 `branches`。没有同名条目（包括 detached HEAD）时，使用该 checkout 内的 `default`。已匹配的版本如果未发布或缺少指定平台，下载失败。显式的 `NUWAX_BASE_VERSION`、`NUWAX_BASE_CHANNEL` 和 `NUWAX_HX_VERSION` 可用于查验和回退。

| 分支 | 自定义基座 ID | HBuilderX 和离线 SDK |
| --- | --- | --- |
| `feat-2026.11.24` | `2026.11.24` | `5.34` |
| `feat-2026.11` | `1.4.1`（现有 Android VoIP 基座） | `5.34` |

基座 ID 独立于 App 市场版本。发布新基座时分配新 ID，验证后更新分支映射。11.24 的初始 ID 待出包及入库。S3 的 5.34 离线 SDK 当前只有 Android。iOS 自建需另备同版本的官方 SDK、分支所需的 ESP 依赖和对应开发签名。

## 使用已经出包的基座

```bash
make base-info
make base-fetch
# 仅下载 Android，或检查目标平台是否已经交付
NUWAX_BASE_TARGETS=android make base-fetch
```

校验过的基座保存在当前项目的 `unpackage/debug/versions/<基座 ID>/`。HBuilderX 使用自定义基座运行时选命令输出的路径。若当前版本的 HBuilderX 只识别 `unpackage/debug`（包括使用 `--playground custom` 的脚本），可在**该分支专用 checkout**中执行 `NUWAX_BASE_DEST="$PWD/unpackage/debug" make base-fetch`，然后核对运行日志中的基座。iOS 真机和模拟器基座对应各自的包。

## 同事自建与维护

1. 为目标分支建独立 Git checkout。发行任务按已确认的完整 SHA 建新的 checkout，用完整绝对路径导入 HBuilderX，避免名称相同的项目选错。签名和 AppKey 从受控渠道配置到独立 checkout。设备也按任务区分，同包名的测试安装可能互相覆盖。
2. 本地 SDK 根按 checkout 路径、分支和 SDK 版本分开。Android 的原生工程和 iOS 会被改写的 SDK 都保存在各自根目录。下载前通过 `make base-env` 核对路径。用独立 shell 执行，检查继承的 `NUWAX_MAIN_ROOT`、`NUWAX_OFFLINE_SDK_HOME`、`ANDROID_ESP_PROJECT`、`UNIAPPX_SDK_ROOT` 和 `APP_RESOURCES_DIR` 等显式覆盖项。不要用同一份解包 SDK 同时构建多个分支。
3. 使用匹配的 HBuilderX 和 SDK。按下面顺序生成本次 App 资源再打基座。本地依赖用各分支维护手册的配置。更换源码或重跑发行时使用新的 checkout；若排查已有 checkout 的调试编译缓存，只在该项目执行「清除缓存后重新运行」。`--cleanCache true` 用于 CLI `launch`。同一 checkout 重做 App 资源时，先归档该 checkout 的 `unpackage/cache`、`unpackage/resources` 和旧基座，再重新生成，避免产物目录留有别的平台或版本的构建结果。

   ```bash
   make sdk-fetch
   make base-env
   make app-resource
   make base-android
   # 同版本 iOS SDK 和原生依赖就绪后，按需求执行对应目标
   make base-ios-device
   make base-ios-simulator
   ```

4. 检查产物后再上传基座。用明确的平台列表，SHA 和版本以回读为准。建议一次将本轮所需的平台准备齐全，因为基座 ID 发布后不能追加或覆盖包。命中分支条目时上传命令可自动取基座 ID，未命中时必须显式传入 `NUWAX_BASE_VERSION`；默认入库保留共享通道。

   ```bash
   # 在 11.24 上首次提交 Android 基座前，先做预演和产物检查
   python3 scripts/check-app-no-voip.py unpackage/debug/android_debug.apk
   NUWAX_BASE_TARGETS=android NUWAX_BASE_DRY_RUN=1 make base-publish
   # 通过后去掉 NUWAX_BASE_DRY_RUN，发布后在新目录固定版本回拉
   NUWAX_BASE_VERSION=2026.11.24 NUWAX_BASE_TARGETS=android \
     NUWAX_BASE_DEST="$PWD/out/readback-2026.11.24" make base-fetch
   python3 scripts/check-app-no-voip.py out/readback-2026.11.24/android_debug.apk
   ```

5. 离线 SDK 由维护者在独立目录准备。 SDK 版本对应 HBuilderX 版本。用同版本的原始 Android、iOS SDK 与其所需归档输入，不要从 App 本地构建修改过的 iOS SDK 目录直接打包。预演显示源、版本及平台，按受控凭证运行正式发布。对共享 SDK 已存在的版本补齐平台时，将已发布平台和新平台都放进 staging，核对上传对象及回拉包哈希，避免覆盖成少平台的包。

   ```bash
   NUWAX_OFFLINE_SDK_HOME=/absolute/path/to/sdk-staging NUWAX_HX_VERSION=5.34 \
     NUWAX_SDK_NO_PROMOTE=1 NUWAX_SDK_DRY_RUN=1 make sdk-publish
   # 预演通过后仅去掉 NUWAX_SDK_DRY_RUN，发布后从干净目录运行 make sdk-fetch 回读
   ```

## 11.24 正式云打包

1. 从两个托管端回读 `feat-2026.11.24`。发布人锁定已审核的完整提交和 tree。两端 SHA 不同时确认业务差异并明确唯一来源，等需要的提交纳入发布范围后再打包。正式发布前根据上次实际商店发布记录确认 App 版本，`node scripts/check-app-release-version.mjs <上次发布的提交或标签>` 核对两项均递增。当前 11.24 的 `1.3.8 / 138` 与仓库 `v1.3.8` 一致，需要和实际渠道记录核对。
2. 用干净发行 checkout，确认 `git status --short`、`git rev-parse HEAD HEAD^{tree}`、`manifest.json` 和 `pages.json`。项目内不要有其他分支的 `uni_modules`、调试基座、APP 打包资源、`.hbuilderx/launch.json` 或本地打包任务配置。检查 `uni_modules/nuwax-voip`、`uni_modules/nuwax-livekit`、来电页面和原生权限未进入源码和构建资源。保留已有 UniPush 和录音能力。
3. 在本次源码执行 `node scripts/generate-app-privacy-policy.mjs` 与 `node scripts/prepare-offline-h5.mjs`。核对生成器是否改变已跟踪文件。选中该项目，在 HBuilderX「发行 → App-Android/iOS-云打包」提交普通发行包。使用既有 Android 发布签名和 iOS Distribution 证书、Profile，保持正式包名 `com.nuwax.app`，关闭「制作自定义调试基座」。Android 选择实际渠道需要的 APK/AAB，iOS 选择 App Store。云打包从本次源码构建，不需要先同步或选择调试基座。鸿蒙若在同批，走独立的鸿蒙发行入口，检查生成工程与最终 HAP 的权限、Ability 和语音录制/下载能力。 [DCloud 云打包说明](https://doc.dcloud.net.cn/uni-app-x/tutorial/app-package.html)
4. 从云打包任务下载实际待发文件，保留任务 ID、开始和结束时间、Git SHA/tree、HBuilderX 版本、平台和文件 SHA-256。对 APK、AAB 和 IPA 运行 `python3 scripts/check-app-no-voip.py <产物路径...>`。APK/IPA 再用 `node scripts/verify-offline-h5-artifact.mjs <产物路径>` 复核离线 H5。
5. 下载包核对 Android 的实际包名、版本、签名摘要与权限/组件（APK 用 `apkanalyzer manifest print` 和 `apksigner verify --print-certs`，AAB 用 `bundletool dump manifest`、`jarsigner -verify`），iOS 解出 `Info.plist`、`codesign -d --entitlements :-` 和 Profile。确认无 VoIP 后台模式、电话服务/接听 Activity 或 VoIP 扩展，有普通 APNs/UniPush 和后台录音所需的 `audio` 配置。扫描器检查已知原生类、依赖和资源标记，结合清单和真机行为验收。
6. 在隔离设备先做干净安装，再从当前正式版覆盖升级，核对 API 指向 `https://agent.nuwax.com`，验证待办、录音/播放/下载、断流恢复、普通 IM 离线通知、配网，以及没有出现 VoIP 来电入口、响铃或系统接听界面。上架前回读两端分支和分发平台最终待发版本及哈希，确认审核、真机验收和上架使用的是同一构建。
