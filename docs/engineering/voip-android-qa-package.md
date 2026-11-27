# 荣耀／华为 Android 真实 App 测试包

使用包含当前 VoIP 实现的移动端分支（联调使用 `feat-2026.11`）、macOS 上的 HBuilderX 5.34 和同版本 Android 离线 SDK，生成 `com.nuwax.app` 完整女娲 App。标准测试包直接编译当前项目，再对导出资源设置测试环境；页面资源内置，安装后无需 HBuilderX、电脑或局域网测试服务。

## 本地准备与安装

日常使用标准 Android 打包入口。在 macOS 上启动 HBuilderX 5.34 并导入项目，再在仓库根目录执行命令。

```bash
pnpm install --frozen-lockfile
make android-tester   # 生成可直接安装的 unpackage/debug/android_release.apk

make app-resource    # 自己重打可供 HBuilderX 调试的基座时使用
make base-android     # 生成 unpackage/debug/android_debug.apk
```

标准入口读取资源的 HBuilderX 版本，按需下载 SDK 并生成本机工作副本。团队的 Android 签名和 DCloud 离线 AppKey 沿用现有签名配置。个推、华为、荣耀、vivo、小米和 OPPO 复用已发布 APK 的客户端配置。vivo、小米和 OPPO 的厂商适配用于普通推送，专用来电按各厂商实测结果验收。

先前发布的 `1.4.0` 云基座包含华为 SDK 和接听页，使用 DCloud 默认 UniPush 接收器。当前云打包和标准本地入口都会注册 `NuwaxUniPushIntentService`；它在无 Activity 时补普通 IM 通知，并把识别出的通话邀请送进原生流程。云端和本地包都必须重新验收 manifest、透传回调、通知展示及点击行为。

## 历史专用诊断包

旧的 `bash scripts/voip-native/package-business-qa-android.sh` 入口现在转到 `make android-tester` 的流程，不再创建或导入 QA 项目。下文专用包路径、专用验包和安装工具属于历史记录；`android-qa-device.py install` 只接受旧的专用包及其元数据，不适用于新的标准测试包。日志、快照和进程检查仍可单独使用。

签名配置从 `${NUWAX_SIGNING_HOME:-$HOME/workspace/nuwax-signing}/local-secrets.env` 加载；UniPush 客户端配置为同目录下 `android/unipush-client.json`，也可用 `NUWAX_ANDROID_UNIPUSH_CONFIG` 指向受控文件。结构为：

```json
{
  "packageName": "com.nuwax.app",
  "getuiAppId": "既有 UniPush 客户端 AppID",
  "huawei": { "appId": "既有华为数字 AppID" },
  "honor": { "appId": "既有荣耀数字 AppID" }
}
```

不填写厂商服务端密钥。2026-11-17 本机客户端标识已从既有已发布 1.3.3 APK 回读，并核对个推 AppID 与原本地配置一致；不是新建或更改生产通道。原本地离线脚本只恢复基础个推 SDK，遗漏了云打包已有的厂商依赖，本次补齐可重复打包。

UniPush 继续负责普通消息和厂商路由；只保留一套 SDK 初始化与原生接收器。依赖锁定：个推 `gtsdk:3.3.7.0`／`gtc-dcloud:3.2.16.7`；华为辅助 `hwp:3.1.4`／HMS Push `6.12.0.300`；荣耀辅助 `honor:3.6.0`／荣耀 Push `7.0.61.303`。厂商辅助 SDK 是 UniPush 离线通道的客户端组成，不是额外独立推送服务。[个推集成说明](https://docs.getui.com/getui/mobile/vendor/androidstudio/)

产物为 `out/voip-business-packages/Nuwax-VoIP-Test-<时间>.apk`，对应 `.json`、`.sha256` 保存环境和校验信息；`Nuwax-VoIP-Test-latest.apk` 指向已通过校验的最新包。打包不安装、不上传、不覆盖现有 `unpackage/debug` 基座。

这是关闭 HX DebugServe 的 Debug 原生宿主，以便采集受控的通话阶段日志。没有测试监听服务声明，不使用常驻开发服务代替推送唤醒。原生 QA origin 限制还会拒绝恢复旧安装中的生产电话身份。安装脚本核对 APK 校验和、已有 App 签名及安装后文件摘要，覆盖安装但不卸载、不清账号数据；生产账号需要退出并重新登录测试账号。

同一个 APK 可供支持 Android APK 的华为／荣耀手机独立使用；仅支持鸿蒙原生应用的机型需要 HAP。首次安装后按系统界面完成隐私同意、测试账号登录、通知及音视频权限。两台手机使用不同账号。

## 联调与证据

```bash
python3 scripts/voip-native/android-qa-device.py logs
# 另开终端，在每轮拨号前后保存状态
python3 scripts/voip-native/android-qa-device.py snapshot --label before-lockscreen-call
python3 scripts/voip-native/android-qa-device.py snapshot --label after-lockscreen-call
# 无通话、已退桌面时：只尝试系统允许的 cached-process kill，不强停
python3 scripts/voip-native/android-qa-device.py reclaim
```

证据保存在 `out/voip-android-qa-<日期>/`。日志仅采集本功能不含凭据的 `NuwaxVoip` 阶段；快照保存机型／系统版本、主进程及推送进程、当前用户强停标志、锁屏状态与全屏通知 app-op。工具不修改权限、自启动、省电策略或控制台。设备若要求变更后台策略，先确认具体设置并记录条件。

| 顺序 | 拨号前条件 | 验收重点 |
| --- | --- | --- |
| 1 | 两端真实 App 前台，不同测试账号 | 双向邀请、接听、双向声音、挂断，系统通话和媒体释放 |
| 2 | 荣耀退桌面，主进程存在 | iPhone 呼入，系统接听／拒接，回到 App 与终态一致 |
| 3 | 荣耀锁屏，记录进程状态 | 锁屏系统来电、接听双向音频、对端取消和挂断释放 |
| 4 | 当前用户未强停，全部本 App 进程不存在 | 保持不打开 App，iPhone 呼入；关联后端发送、厂商到达、原生 push 路由、系统来电及媒体 |

`reclaim` 使用 `am kill`，若推送进程仍在或进程立即重启，会明确拒绝把结果归类为全部进程不存在；不升级为 `force-stop`。这属于受控缓存进程回收，自然系统回收另列记录。主动强停、未首次启动／未登录、重启首次解锁前也与正常系统回收分开。

有进程的在线邀请、普通通知展示或点击通知后打开 App，都不能代替“进程被回收后自动系统来电”通过。个推明确普通厂商透传不保证拉起已被杀死进程；专用通话权益及后端电话发送策略仍需逐厂商核对。荣耀专用 VoIP Kit 另要求 MagicOS 10.0+，本次不将普通辅助 SDK 当作专用 Kit 已接入。[荣耀 Kit](https://developer.honor.com/cn/docs/voip/guides/dev-overview)

本地包、单元测试和依赖校验不代表上述真机矩阵已通过。生产设置／部署保持用户确认边界，正式后端和通话能力缺口见 [系统推送分工](voip-system-push.md)及[后端清单](voip-backend-required.md)。

2026-11-17 用户自行安装本包后，已确认前台调通，并明确确认荣耀退桌面、锁屏两种状态均能来电、接听、挂断。本次按用户实机确认记为通过；进程被系统回收后的自动来电仍待单独验证，详见[验收记录](voip-acceptance.md#用户实机确认荣耀退桌面与锁屏接打通过)。

随后用户补充：清理荣耀 App 后仍能收到语音来电；此操作的进程快照和具体清理方式尚未取得，按“用户清理后台后可来电”记录通过，仍与“确认全部进程不存在后自动唤醒”分开。iPhone 相应操作后未收到来电，专用 APNs 链路核对见同一[验收记录](voip-acceptance.md)。

### 本轮铃声与锁屏展示回归

最新用户反馈细分为：荣耀锁屏有通知且能亮屏，但在响铃／音量／勿扰设置正常时没有来电铃声；华为锁屏通知带接听／拒接，但不亮屏／不弹来电界面。早前通过仅覆盖提示到达、接听和挂断，不能扩展为完整电话提醒已通过。

修补版在同一 UniPush 接收路径上使用独立来电渠道 `nuwax-voip-incoming-v2`（**音视频通话邀请通知**）与静音通话中渠道 `nuwax-voip-ongoing-v1`（**通话状态**）。来电使用随 App 打包的原创铃声、电话铃声音频属性与持续提醒标志，同一呼叫不重复发布；接听后通知更新停止提醒，拒接／取消／超时／挂断移除通知。Android 12+ 响铃时直接发布 Telecom 来电通知，自身通话前台服务从接听后开始；Android 11 及以下保留前台服务关联以确保 CallStyle 排序，采集仍只在主动拨打／接听后开始。

v2 保留旧渠道的禁用、重要度、显式静音、自选声音及振动，只把可确认未由用户修改的旧系统默认声音迁移为随包铃声；旧系统无法可靠读取用户选择时保留原声音，不强制打开声音或绕过勿扰。分类默认值应由 App 提供，不要求用户去隐藏设置中选铃声。覆盖安装后打开 App 并接收一次来电才会创建新渠道；系统强制要求的通知／全屏授权仍按标准界面申请。

`python3 scripts/voip-native/generate-android-ringtone.py` 可从源码重复生成 PCM 铃声和四种语言的原生分类名称。分类文案只维护 `constants/i18n-locales/` 两个 VoIP key；本地打包钩子校验生成资源与词典一致后复制到插件 Android library，缺失或过期时终止打包。APK 校验同时核对铃声原字节、原生分类名称及 v2 实现。`NuwaxVoip` 日志记录权限、渠道、铃声音量与模式、勿扰、锁屏、全屏 Intent 和通知分组，不采集凭据或业务载荷。

重新测试：来电持续响铃、重复在线／推送不导致声音停止或重启、接听停铃、拒接／主叫取消／超时停铃，以及通话中更新通知不再响铃。再核对华为锁屏是否展示来电界面。修补包构建通过仍须这两台真机复测，不能预先登记已修复。

早前 `Nuwax-VoIP-Test-20261117-173810.apk`（1.3.6／136）使用 v1 渠道，华为实测仍未响铃或亮屏；不作为本次 v2 产品修补包。安装时只使用校验完成后的 `Nuwax-VoIP-Test-latest.apk`，保留账号数据，随后打开 App 再测试。新包构建通过不等于两台手机的铃声／锁屏界面已通过，生产设置不动。

本次 v2 最终包为 `Nuwax-VoIP-Test-20261117-185702.apk`，SHA-256 `003a29af892d0629b59f8e736328a30bfd94acd72dd3a15447dcdaf7c2e75995`；已覆盖安装华为 ABR-AL80。19:00 用户确认锁屏来电有铃声、亮屏且显示来电界面，系统日志同时确认原生 Activity 可见；结束后通知和通话服务不存在。未改系统设置。荣耀可用同包复测铃声，尚不登记通过。该轮在线邀请先到，不作为全部进程不存在的推送唤醒验收。
