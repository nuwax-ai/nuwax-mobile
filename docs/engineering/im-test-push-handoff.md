# 测试 IM 接入独立推送空间

IM 后端同学你好，App 访问 `https://testagent.xspaceagi.com` 时进入测试 IM。请让测试 IM 通过它自己的部署配置调用独立云空间 `nuwax-push-test`（`env-00jy72x2l4nj`）内的 `push-send-test`。生产 IM 沿用现有生产函数和签名，测试和生产沿用现有 UniPush AppID 与厂商接入。

## 测试 IM 的配置

| 项 | 取值 |
| --- | --- |
| `IM_UNIPUSH_URL` | `https://env-00jy72x2l4nj.dev-hz.cloudbasefunction.cn/push-send-test` |
| `IM_UNIPUSH_SIGN` | 测试空间的 `PUSH_SIGN_KEY`，通过 `X-Push-Sign` 发给云函数 |
| `IM_PUSH_OFFLINE_ENABLED` | 联调时确认测试实例已启用 |

请确认测试域名的 HTTPS、WebSocket 都接到测试 IM，数据库、Redis、推送队列及后台补推任务均使用测试资源。发件密钥通过团队密钥渠道交接。

## 设备注册和推送接口

- App 用现有 `POST /api/instant-message/devices` 上报设备 ID、`pushToken`（CID）和 `pushEnabled`。普通通知、`push-test` 和补推从测试 IM 自己的设备记录选取接收目标，沿用 `push_clientid` 和现有消息信封。
- 当前配置按云空间和各自的发送签名隔离，沿用普通 IM 设备回执。旧稿里的独立登记凭据、`pushBinding`、`push_bindings` 和测试云函数发送开关已退出本轮方案。
- 测试空间回读到的变量是 `PUSH_SIGN_KEY` 和 `PUSH_DEBUG_MESSAGE_CONTENT`。IM 传目标 CID 和邀请载荷，云函数按设备组装内部 `callRoute`。IM 在签名请求的 `payload.iosVoip` 中按 CID 附上 `registrationId`。APNs 环境由云函数按空间配置组装，测试函数缺省使用 `development`。[iOS 来电登记与云函数接口](voip-ios-im-cloud-handoff.md)

配置完成后，请回传**测试 IM 部署版本、实际生效的推送 URL（可脱敏）和一条出站日志**。日志请保留请求号、目标 CID 指纹和调用结果。我们先用一台 vivo 对账测试空间回执和手机通知，再验证真实 IM 单聊和其他场景。

[IM 离线推送对接说明](im-offline-push.md#11-测试与生产的推送配置)
