# Android UniPush 原生来电适配

本目录由完整 App 本地基座构建使用，不是专用测试宿主。`configure_unipush.py` 在已配置 UniPush 且包含 `uts-nuwax-voip` 的工程中，把接收器源码复制到 App 原生模块；生成的 manifest 只声明这一个 GTIntentService 子类。它继承 HBuilderX 5.34 的 `UniPushIntentService`，普通推送、CID 与 SDK 状态回调沿用父类。

选择 App 原生模块承载这层可选适配，是为了让 `nuwax-voip` 媒体库不直接依赖 Getui SDK。当前基座锁定 HBuilderX 5.34、gtsdk 3.3.7.0、gtc-dcloud 3.2.16.7。重新生成资源和基座后仍会恢复接收器；取消 UniPush 配置会删除本适配的源码及 manifest 覆盖，恢复 SDK 原接收器。

## 处理顺序

1. Getui SDK 根据 manifest 自动选择接收器，沿用现有同意隐私政策、登录后初始化 UniPush 的流程。本适配不主动初始化推送 SDK。
2. 原生回调先调用媒体库里的 `VoipPushPayload`，只识别带 `type=voip` 或 `kind=voip.invite`、有效 convId/msgId 的邀请定位信息，兼容 JSON 字符串形式的 payload/data 包装。保留 int64 字符串，丢弃无关字段。
3. `VoipBridge.receiveUniPush()` 检查当前加密保存的真实业务会话及运行闸门，随后重新查询消息、校验参与方和时效，进入原生 Telecom/CallStyle。没有有效会话时交回 SDK；重复、取消或过期邀请不会重新响铃。
4. 普通消息调用 `super`。来电在 SDK 处理 `force_notification=true` 之前分流，避免只能等用户点击普通通知后才进入 UTS。

不依赖聊天页或 UTS 定时器执行，不增加常驻测试前台服务。实际推送仍依赖 SDK/厂商通道及系统给予的后台执行机会；自启动、省电策略、锁屏和系统回收必须分别用真机验证。

## 验证

```bash
pnpm voip:test
NUWAX_SIGNING_ENV=<与本地基座相同的受控环境文件> \
  bash scripts/voip-native/check-android-push.sh
```

前者验证重复生成、关闭适配后的恢复及既有通话逻辑；后者在隔离的 5.34 原生工程中，使用真实 Kotlin/JSONObject 运行载荷测试，不安装设备、不上传包。

调试日志只记录 `NuwaxVoip` 阶段和是否识别为来电，不输出正文、CID 或凭据。服务端发送成功不作为到达证明；必须观察原生接收日志、Telecom/通知状态和手机界面。

官方依据：[UniPush 2.0 在线推送与 force_notification](https://uniapp.dcloud.net.cn/unipush-v2.html)、[Getui Android 集成指南](https://docs.getui.com/getui/mobile/android/androidstudio/)。前者说明强制通知不产生 receive 内容回调；后者说明 3.x SDK 根据 manifest 自动发现 GTIntentService。
