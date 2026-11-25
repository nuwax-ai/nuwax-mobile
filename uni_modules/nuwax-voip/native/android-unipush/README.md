# Android 厂商 VoIP 推送适配

云打包和本地基座共用的 Getui 回调桥、普通 IM 无 Activity 通知逻辑已迁到
`nuwax-push-keepalive/utssdk/app-android/src/com/nuwax/pushkeepalive/`。该目录会被
HBuilderX 云打包直接识别；本地 `configure_unipush.py` 保留 SDK 原接收器，只配置厂商适配。

本目录仅保留需要 App 原生模块覆盖的厂商适配（目前为 vivo VoIP receiver）。

## 处理顺序

1. 保留 Getui 固定启动的 `DCloudUniPush.UniPushIntentService`，沿用现有同意隐私政策、登录后初始化 UniPush 的流程；保活服务恢复时先包装 `PushActionHolder` 回调，避免无 Activity 的冷启动消息被空回调丢弃。
2. 原生回调先调用媒体库里的 `VoipPushPayload`，只识别带 `type=voip` 或 `kind=voip.invite`、有效 convId/msgId 的邀请定位信息，兼容 JSON 字符串形式的 payload/data 包装。保留 int64 字符串，丢弃无关字段。
3. `VoipBridge.receiveUniPush()` 检查当前加密保存的真实业务会话及运行闸门，随后重新查询消息、校验参与方和时效，进入原生 Telecom/CallStyle。没有有效会话时交回 SDK；重复、取消或过期邀请不会重新响铃。
4. 普通消息有 Activity 时转发到 DCloud 原回调。非厂商设备无 Activity 时，`ImHeadlessPush` 检查已确认的原生会话、推送开关、环境、通知权限和去重回执，再调用 SDK 的通知创建方法；不把已处理消息重复交回 UTS。来电在普通消息处理前分流。
5. 普通通知继续使用 SDK 的渠道、payload 和点击 Intent；不全局修改 `force_notification`。原生闸门由 `nuwax-push-keepalive` 同步，退出时先关闭展示再停锚点服务；去重只存哈希和时间。

不依赖聊天页或 UTS 定时器执行，不增加常驻测试前台服务。实际推送仍依赖 SDK/厂商通道及系统给予的后台执行机会；自启动、省电策略、锁屏和系统回收必须分别用真机验证。

完整的 iOS/Android 通道分工、厂商冷唤醒条件、后端电话路由与真机矩阵见 [系统推送方案](../../../../docs/engineering/voip-system-push.md)。本接收器只有在系统允许原生执行时才能展示来电；普通通知送达或自启动开启不能作为进程回收后已接通的证据。

## 验证

```bash
pnpm voip:test
NUWAX_SIGNING_ENV=<与本地基座相同的受控环境文件> \
  bash scripts/voip-native/check-android-push.sh
```

前者验证重复生成、关闭适配后的恢复及既有通话逻辑；后者在隔离的 5.34 原生工程中，使用真实 Kotlin/JSONObject 运行载荷测试，不安装设备、不上传包。

`NuwaxVoip` 记录来电阶段，`NuwaxImPush` 分别记录桥接恢复、SDK 在线、原生收包和通知提交，不输出正文、完整 CID 或凭据。`notification submitted` 只代表通知调用完成；必须观察手机通知栏与点击行为。完整边界与脚本回归见 [划掉后推送修复](../../../../docs/engineering/push-swipe-kill-sticky-keepalive.md#4-当前实现与验收)。

官方依据：[UniPush 2.0 在线推送与 force_notification](https://uniapp.dcloud.net.cn/unipush-v2.html)、[Getui Android 集成指南](https://docs.getui.com/getui/mobile/android/androidstudio/)。前者说明强制通知不产生 receive 内容回调；后者说明 3.x SDK 根据 manifest 自动发现 GTIntentService。
