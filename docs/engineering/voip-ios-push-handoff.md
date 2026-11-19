# iOS APNs VoIP 对接契约

2026-11-17 当前执行顺序以 [最新总方案](voip-cn-provider-onboarding.md)和 [iOS 操作细则](voip-ios-cold-start-runbook.md)为准：优先在既有 UniPush／个推中接通真正的 VoIP 发送及 token 绑定。本文下述 `provider=apns`、专用 `/calls/devices` 和 HTTP/2 直连发送是已经编写的备用适配器契约，不代表本次要另起服务或强制新增这个接口；设备隔离、条件撤销与身份校验仍须在所选实际路线等价实现。

2026-11-10 用户确认：普通消息继续 UniPush，iOS 电话邀请采用 APNs VoIP。本批完成本地客户端、签名配置生成、mock 和测试；正式发送由后端同事实现。未改生产配置、证书、部署或设备安装，不修改 agent-platform/独立 IM 仓库。Android 同步方案见 [系统推送分工](voip-system-push.md)。

## 实际状态

2026-11-17 独立跟进补充：发送可以复用现有 UniPush／个推，无需另部署 VoIP 服务；官方映射、原生 token 绑定和现有 IM／云函数最小增量见 [无进程来电跟进](voip-ios-cold-start-followup.md)。本次修补 PushKit 完成时机及 Keychain 原位更新，112 项 Vitest／53 项 Swift 单测通过；未切换 provider、重新打包或部署，iPhone 无进程来电仍未通过。

2026-11-17 已按完整 iOS 产品流程复核客户端。未启动/回收后唤起、原生凭据续期、权威终态及原子接听仍需后端前置；完整场景矩阵和客户端修正见 [iOS 产品完整性检查](voip-ios-product-readiness.md)。本轮没有重新验证后端部署或发送真实 APNs，不沿用旧记录推断服务今日状态。

2026-11-16 复核后端 `feat-video-meeting@26dd3491` 及测试环境：鉴权 GET `/users/me` 正常，新增 `/calls/devices` 的 GET 与空请求体 POST 均返回 404，源码仍无专用发送实现。下述契约继续作为后端待交付项，不改回普通 UniPush 或将注册回执当作推送送达。

只读核对后端 `nuwax-im/feat-video-meeting@241f8a4ce6539f8abfc8cc8def9ef420347cf09a`：现有 UniPushChannel 发 CID 普通邀请，尚无专用 APNs VoIP 发送。下文 `/calls/devices` 是**待新增接口**，不是已部署接口。旧 `/devices` 的 voip_token 列会被普通刷新直接覆盖；本方案独立注册，不再写该列。若后端复用旧表，则必须实现等价的通道隔离、条件更新和撤销语义。

DCloud 当前应用 P8 配置存在，不能据此证明 VoIP topic 和私钥使用授权。团队需为后端通过受控配置提供授权凭据，不能未经确认从 DCloud 导出/替换其证书。既有 UniPush 普通消息不变。

### 2026-11-17 Apple Developer 配置核对与开发签名更新

用户授权后，通过其已登录的 ego-browser 页面核对并处理开发测试签名：

| 项目 | 实际结果 |
| --- | --- |
| Team / App ID | `89GQ2RJVW7` / 显式 `com.nuwax.app`，与本机签名资料一致 |
| Push Notifications | 已启用；沿用既有配置，没有新增其他 App ID 权益 |
| APNs Key | 已有 `Nuwax APNs`，Key ID `39H39LAJB9`，页面显示 `Team scoped (All topics) [Sandbox & Production]`；没有创建、编辑或撤销 Key |
| P8 文件 | 控制台 Download 已禁用，不能再次下载原私钥；本机统一签名目录已有同 Key ID 命名的 P8，结构校验通过，未复制或导出。后端仍须通过受控方式配置并验证发送，不能据文件存在声称推送已通 |
| 开发 profile | `NuwaxAppProfile` 原为 Invalid，已按现有证书及设备勾选重新生成，控制台不再显示 Invalid；下载回读 `aps-environment=development`、`get-task-allow=true` |
| 测试设备 | 保留原有 4 台已选设备，确认包含 LLD16 与 `zhengqiang`（用户提供的 ZQ 对应候选名称）；未新增或删除设备 |
| 签名证书 | 新 profile 内证书与本机现有有效签名 identity 一致；证书到期日为 2027-07-23，仍须以证书与 profile 较早到期日作为可用范围 |
| 生产发行 profile | `NuwaxAppProfileDistribution` 在本次核对前已显示 Invalid；按生产变更边界未修改，正式发行前需单独处理 |

按用户要求，新 profile 已覆盖统一签名目录的 `ios-app/NuwaxAppProfile.mobileprovision`；权威 `local-secrets.env` 与旧业务仓本地环境副本的 profile UUID/路径已同步。旧 profile 仅在签名目录内归档，Xcode 保留运行所需的系统安装副本。后续打包直接引用统一配置：

```bash
NUWAX_SIGNING_ENV="${NUWAX_SIGNING_HOME:-$HOME/workspace/nuwax-signing}/local-secrets.env" \
  bash scripts/voip-native/package-business-ios.sh
```

此命令仅说明后续构建如何选中新 profile，仍须先准备本次完整 App 的测试环境资源。尚未据此生成新的 IPA；不能将签名准备等同于客户端产品缺口已补齐或冷启动来电已通过。

临时 `out/voip-apple-signing-20261117/` 中本次生成的 profile 与签名覆盖文件已清理，签名材料统一保存在 `nuwax-signing`，不入业务 Git、不上传。选择 profile 的现有构建函数已用统一目录的新文件验证，签名后仍需回读 App entitlement。通话后台模式由插件 `Info.plist` 与本地宿主生成器合入 `audio/voip/remote-notification`，麦克风/相机隐私声明在 App 资源中管理，不是 Apple Developer 网页上的单独 VoIP 开关。

## 通话设备注册

`POST /api/instant-message/calls/devices`，Bearer 平台登录身份，`X-Call-Device-Id` 必须与 body.deviceId 相同，账号从鉴权得出。注册仅在隐私同意、登录及功能闸门通过后由原生发起；后台不依赖 UTS 定时器。

```json
{
  "provider": "apns",
  "channel": "pushKit",
  "platform": "ios",
  "deviceId": "physical-device-id",
  "bundleId": "com.nuwax.app",
  "environment": "development",
  "token": "<PushKit token hex, not CID or ordinary APNs token>",
  "registrationId": "41db975c-eab8-4d60-a2ae-3233dd7ed309",
  "previousRegistrationId": "",
  "action": "register"
}
```

主键包含 userId/deviceId/provider/channel/bundleId/environment；只修改该记录。token 接受非空、偶数字符的十六进制，不硬编码为 64 位长度（客户端上限 1024 字节）；不能把任何通道 token 互换。包名/环境/设备须服务端校验。普通 CID 刷新不修改此表。

- 首次 registrationId 使用 UUID，previousRegistrationId 为空。相同 token/命名空间重试或恢复沿用已加密保存的注册标识，不能因重试不断新建记录。
- 轮换 token 时新建 registrationId，previousRegistrationId 指向此前标识。服务端对命名空间做比较更新：已有记录仅允许同一注册幂等或匹配 previousRegistrationId；否则返回 `CALL_PUSH_REGISTRATION_CONFLICT`，不能覆盖较新注册。同 ID 换 token 也冲突。
- action=revoke 时携带原 registrationId 和原 token，只有两者匹配当前记录才删除；不使用空 token 无条件清空。旧撤销不能删掉轮换后的新 token。
- 撤销/替换的注册标识保留终态，迟到 register 返回 `CALL_PUSH_REGISTRATION_REVOKED`，不能复活。真实服务需将终态保存到旧会话/请求可能到达的窗口结束，本地 mock 仅内存保存。
- 注销/切账号必须由后端撤销旧账号设备路由并拒绝该旧会话后续注册；不能仅依赖手机尽力发出的 revoke。APNs 410 等失效结果也只能撤销匹配 token/注册版本。

返回信封沿用 `code=0000`，data 必须明确确认命名空间：

```json
{
  "provider": "apns",
  "channel": "pushKit",
  "deviceId": "physical-device-id",
  "bundleId": "com.nuwax.app",
  "environment": "development",
  "registrationId": "41db975c-eab8-4d60-a2ae-3233dd7ed309",
  "registered": true,
  "nativePush": false
}
```

registered 只表示登记已完成。nativePush 表示服务端对发送配置/平台能力的就绪声明，不能当作送达证据。revoke 幂等返回 registered=false，回显本次注册标识，不返回 token。客户端校验注册回执的 provider/channel/device/bundle/environment/registrationId；旧接口只有 registered=true 也不能冒充 APNs 已支持。

原生最多 5 次注册尝试，间隔 1/2/4/8 秒；注销或 token 失效尽力条件撤销最多 3 次。退出、换账号、轮换会取消旧任务并忽略迟到成功。原生 `pushRegistration` 事件输出 provider/state/nativePush，不带 token；状态为 registering/registered/unavailable/configurationMissing/stopped，推送注册失败不结束当前在线通话。冲突或网络中断后本机不强制覆盖服务端，后续会话初始化可再试。

## 签名与构建

`scripts/voip-native/device/ios_push_config.py` 从 `IOS_PROVISIONING_PROFILE_UUID` 选定 profile 读取 aps-environment，核对 application-identifier/team/bundle 后生成：

- Info.plist：NuwaxVoipPushProvider=apns、NuwaxVoipAPNSEnvironment=development 或 production。
- App entitlement：相同 aps-environment。

可用受控路径 `IOS_PROVISIONING_PROFILE_PATH` 指定文件，但 UUID 仍须匹配。完整基座打包后回读已签 App 的 entitlement 与 Info.plist 校验一致。其他构建链路也须生成并验证同样元数据；原生不相信 DEBUG、API 域名或 UTS 传来的推送环境。缺元数据时发 configurationMissing，不猜环境注册。P8/APNs 私钥不进入客户端。

11 月 10 日本地实现批次只运行原生编译/单测，没有重新签名或安装。11 月 16 日恢复真实 App 调试后已重新导出资源并构建签名完整基座，安装进度见[验收记录](voip-acceptance.md)。Swift 源变化需要 HBuilderX 5.34 重新导出资源并重打本地完整基座，不能只热更业务资源。未上传基座。

## 后端专用发送

在现有后端的电话功能内实现 APNs 适配器，使用 HTTP/2 和团队受控 APNs 凭据。匹配 token 的 sandbox/production 环境，`apns-push-type=voip`，`apns-topic=com.nuwax.app.voip`。按 Apple 建议 apns-expiration=0 或仅数秒，不将 60 秒业务响铃窗口当作 APNs 长时间保留队列。证书认证需具备对应 VoIP topic；token 认证同样要验证凭据对目标 topic 的授权。

有效单聊邀请创建后单独进行电话设备路由/去重，不直接沿用 OfflinePushConsumer “在线设备不推送”的门禁。IM WS 在线不保证后台 App 能响应。针对已具备原生来电能力的 iOS 设备避免再发送同一电话的普通通知；普通消息路由不变。取消、挂断、拒接和抢接结果从业务控制连接与权威状态送达，不用 VoIP 推送保活/发取消。

APNs payload（业务 ID 全为字符串；expiresAt 是毫秒）：

```json
{
  "type": "voip",
  "callId": "b31ed56e-633d-44d9-90cf-52942595c99b",
  "convId": "245475557381246976",
  "msgId": "245798070866935808",
  "calleeId": "1794215421",
  "displayName": "主叫名称",
  "mediaType": "audio",
  "expiresAt": 1794312000000
}
```

示例时间仅说明格式。实际 expiresAt 不超过消息 sendTime+60 秒。禁止登录凭据、RTC JWT 和 URL。客户端兼容 payload 对象/JSON 包装，但不依赖 Getui VoIP 绑定或回执。收到 PushKit 后先报告 LCK，再查询实际消息详情及单聊成员；核对消息/呼叫 ID、媒体类型、账号、时效和已收到的终态。校验前点击接听会等候验证；提前拒接先关闭系统界面，验证后才向后端发拒接。

消息详情不是权威呼叫状态。正式服务仍需提供终态补偿、原子接听归属、房间权限和失联回收，才能覆盖重启前漏收取消与多设备抢接。APNs 200 只表示受理，日志保存脱敏请求标识，不输出 token/payload/私钥。

## 本地验证与真机边界

`pnpm voip:test` 覆盖普通 UniPush 兼容、APNs mock 命名空间、条件撤销、乱序、账号隔离和签名元数据；`pnpm voip:ios:push:check` 覆盖真实 Swift 注册器的重试/取消/恢复/迟到响应和邀请校验；`pnpm voip:ios:check` 编译 Swift 6 / LiveKit 2.19.0 / iOS 15 最低版本。

本地服务只将 APNs token 存内存并返回 nativePush=false，不读取 APNs 私钥、不发 APNs。它不能替代后端专用发送验收。正式后端新增接口前客户端会显示注册不可用状态，不虚报完成。

后端测试环境就绪并经用户确认安装后，验证 Android 前台主叫 → iPhone 前台/后台/锁屏/系统回收；主动强退单列。还需立即接听/拒接、迟到/重复/取消先到、token 轮换、登出换账号、双向音频和挂断释放。iOS 15–17.3 仍仅前台/普通通知，不注册 PushKit。当前没有本批真机送达记录。

2026-11-16 用户将“客户端未运行时被唤起”列为核心验收。必须记录拨号前 App 进程确实不存在，以及 APNs → PushKit → 系统会话 → 接听媒体的证据；在线 WS 来电和重启 App 后补收都不能替代。动态岛残留另补了带结束时间的系统挂断确认、迟到注册终态和音频引擎收尾，修补版已安装，真实挂断回归仍待完成。Apple 对系统挂断完成的定义见 [fulfill(dateEnded:)](https://developer.apple.com/documentation/livecommunicationkit/endconversationaction/fulfill(dateended:))。

官方依据：[Apple APNs 请求与 VoIP topic](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns)、[PushKit 来电与短有效期](https://developer.apple.com/documentation/pushkit/responding-to-voip-notifications-from-pushkit)、[LiveCommunicationKit](https://developer.apple.com/documentation/livecommunicationkit)。
