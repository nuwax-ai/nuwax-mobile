# 移动端 Bugly 崩溃诊断

女娲个人版使用旧版 Bugly 异常上报。Android SDK 固定为 `com.tencent.bugly:crashreport:4.1.9.7`，覆盖 Java/Kotlin、原生崩溃和 ANR。iOS SDK 固定为 `2.7.1.1`，覆盖原生崩溃。SDK 版本与接入 API 参见 [Android 指南](https://bugly.qq.com/docs/user-guide/instruction-manual-android/?v=1.0.0)和 [iOS 指南](https://bugly.qq.com/docs/user-guide/instruction-manual-ios/?v=1.0.0)。

**本次集成仅支持 Android 和 iOS。** HarmonyOS NEXT 的插件元数据明确标记为不支持，构建时排除 Bugly 原生实现与设置入口。鸿蒙冷启动只记录一次本地信息日志 `[CrashDiagnostics] init_skipped platform=app-harmony reason=unsupported_platform`，无 Bugly 初始化、授权读写或网络上报。

## 项目配置和授权

- [`constants/bugly.config.uts`](../../constants/bugly.config.uts) 按平台及发包环境选择 App ID。试点项目仅接收已配置测试域的上报。正式包配置团队管理的 Android、iOS 项目 ID，核对对应的包名、Bundle ID 及项目权限。正式包在同一平台的团队项目里按实际服务域区分环境。正式 App ID 为空时，正式包的设置入口隐藏，SDK 不初始化。
- 用户在「设置 → 崩溃诊断」主动开启，授权随 Bugly 项目保存在本机，跨退出登录保留。Android 同时需要 App 的首启隐私授权。关闭诊断或切换服务域时停止当前进程的采集。切换后，下次冷启动按新域名初始化。企业自定义域名默认关闭采集。
- 初始化前关闭 SDK 可选个人信息采集。Android 还关闭用户统计、Bugly 日志上传和 ANR 进程信息采集。App 不提供账号 ID、自定义设备 ID、会话内容或业务日志。上架前将实际启用的数据项、用途和供应商写入对外隐私政策、第三方 SDK 清单和商店申报。参见 [Bugly 合规指引](https://bugly.qq.com/docs/user-guide/instruction-manual-privacy/)、[Android SDK 隐私说明](https://privacy.qq.com/document/preview/4e23190d4ff04bd99e6ea89e0773a74f)和 [iOS SDK 隐私说明](https://privacy.qq.com/document/preview/fc748b3d96224fdb825ea79e132c1a56)。

## 按访问域名查日志

App 读取当前主 API 服务地址（`getApiBaseUrl()`），将匹配到的域名写入 Bugly 渠道及崩溃详情的 `service_host`，并写入 `environment`。新增环境时扩展 `BUGLY_SERVICE_ENVIRONMENTS`。上报字段只使用配置中的固定值。

企业登录可以填写租户自定义地址。下表是女娲官方场景的 Bugly 上报名单，独立于企业登录的域名验证。自定义服务地址生效后，App 停止当前 Bugly 采集，设置页隐藏崩溃诊断入口。使用该地址冷启动时，只在本地记录 `init_skipped reason=service_not_enabled`，日志不含租户地址。

| 当前访问的服务 | Bugly 渠道 | `environment` |
| --- | --- | --- |
| `https://testagent.xspaceagi.com` | `testagent.xspaceagi.com` | `test` |
| `https://agent.nuwax.com` | `agent.nuwax.com` | `production` |

在对应的 Android 或 iOS 项目进入「异常上报 → 高级搜索」，在「全渠道」中选目标域名，再按版本和日期缩小范围。初始化成功后，本地日志也会记录 `environment` 和 `service_host`。

Android 旧版 SDK 在构造上传请求时读取当前渠道。排查切域后补传的离线崩溃时，需对照个例详情里的 `service_host` 和 `environment`，确认事件发生时访问的服务。

## 云打包

1. 在打包机器的项目根目录运行 `python3 scripts/prepare-bugly-ios-sdk.py`，之后用 HBuilderX 打包。命令从腾讯下载 iOS SDK，也接受已下载的官方 ZIP 路径。它校验 ZIP 的 SHA-256，保留 iOS 真机 `arm64` 和模拟器 `arm64`/`x86_64`，去除旧 32 位切片与供应商库调试段，并核对公开符号和隐私清单。生成的 XCFramework 写入 iOS UTS 插件目录，由 HBuilderX 收集，磁盘体积约 5.54 MB。
2. 同一份源码、资源、HBuilderX 版本和发包选项生成的 `appResource` 可用 `pnpm size:check --cloud-input unpackage/resources` 估算上传体积。DCloud 公共云打包的免费体积门槛是编译后、压缩前小于 60 MB，以 HBuilderX 提交显示为准。云端生成的 APK 和 IPA 另用 `pnpm size:check --cloud-input unpackage/resources <apk路径> <ipa路径>` 检查，每个安装包上限是 60,000,000 字节。参见 [DCloud 云打包计费公告](https://ask.dcloud.net.cn/article/42315)。
3. iOS 在云打包窗口勾选生成 dSYM。该功能单独计费，下载链接有效期两天。及时归档同一构建的 IPA 和全部 dSYM，用 `xcrun dwarfdump --uuid` 核对 App 二进制与 dSYM，以及随包的 UTS Framework 与对应 dSYM，按 Bugly iOS 符号表文档上传。Android 若构建启用 R8，保留同一次构建的 `mapping.txt`。应用自有的原生库如有同构建调试符号，用 Bugly 工具处理后按版本上传。符号文件放在发布归档里。参见 [DCloud dSYM 指南](https://uniapp.dcloud.net.cn/tutorial/app-ios-dsym.html)、[Bugly iOS 符号表](https://bugly.qq.com/docs/user-guide/symbol-configuration-ios/?v=1.0.0)和 [Bugly Android 符号表](https://bugly.qq.com/docs/user-guide/symbol-configuration-android/?v=1.0.0)。

## 发布验收

- Android 和 iOS 分别用云端签名 QA 包，在真机验证未开启、开启后冷启动、关闭后及切换服务地址。通过授权前后的网络记录和测试项目事件确认采集边界。
- 鸿蒙包在真机验证冷启动可进入应用，设置页不展示崩溃诊断入口，日志中每个进程只出现一条 `init_skipped`，并确认没有 Bugly 网络请求。
- 用 QA 专用的临时崩溃入口触发 Android Java 和原生崩溃、ANR 以及 iOS 原生崩溃。重启后在各自测试项目按平台、版本和 `testagent.xspaceagi.com` 渠道查收，检查符号化后的业务栈和诊断字段。QA 崩溃入口随测试结束移除。
- 用配置团队项目的签名 QA 包分别连接测试和正式域，确认两个域名均可在「高级搜索」独立查到。验证离线崩溃在切域后延迟上传时保留崩溃时的域名和环境标签。
- 记录 HBuilderX 提交体积、最终 APK/IPA 字节数、平台版本、符号产物和测试结果。
