# 荣耀／华为 Android 真实 App 测试包

使用 `mobile-voip` 的 `feat/nuwa-basic-2026.11-voip-calls` 源码、本机 HBuilderX 5.34 和对应隔离 SDK，生成 `com.nuwax.app` 完整女娲 App。仅忽略目录中的 QA 副本固定测试环境 `https://testagent.xspaceagi.com`，跳过商店版本升级，保留真实单聊语音／视频入口。页面资源内置，安装后无需 HBuilderX、电脑或局域网测试服务。

## 本地准备与安装

```bash
bash scripts/voip-native/package-business-qa-android.sh
# 手机接上并允许 USB 调试后；只有一台 Android 时不需要指定序列号
python3 scripts/voip-native/android-qa-device.py install
```

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
