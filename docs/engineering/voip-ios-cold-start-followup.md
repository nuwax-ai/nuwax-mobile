# iOS 无进程来电跟进与 UniPush 闭环

日期：2026-11-17。工作树 `mobile-voip`，分支 `feat/nuwa-basic-2026.11-voip-calls`，基线 `ce67237dc08dc42a6553cd9514265236a956143e`。**iPhone 清理进程后的来电继续未通过。** 本次完成只读核查、客户端公共可靠性修补及测试，没有编译新 App、安装、发送推送或改生产配置。

## 现场证据

| 对象 | 本次核查 | 边界 |
| --- | --- | --- |
| 现有测试 IPA | 真实女娲 App `com.nuwax.app`、1.3.6（136）、固定测试环境、HBuilderX 5.34；签名有效 | 本次新代码尚未进入该 IPA |
| 原生启动 | 在实际加载的 `UniAppX.debug.dylib` 的 AppDelegate 启动方法中找到对 `NuwaxVoipBridge.restoreOnLaunch` 的调用 | 仅源文件／selector 字符串不算包内启动 hook 证据 |
| APNs 环境 | App entitlement、Info.plist、内嵌 profile 都为 development；后台模式含 audio／voip／remote-notification | 测试 API 域名不决定 APNs 环境，配置一致不证明送达 |
| iPhone 16 | 已安装 1.3.6（136），查询时主进程存在 | 没有停止／重启 App，不把该快照当作无进程来电测试；版本相同也不能单独证明手机二进制与本地 IPA 完全相同 |
| iPhone 13 | 枚举显示已连接，但 CoreDevice 查询安装信息失败 | 没有据此猜测安装版本或调整设备设置 |
| 测试环境 | 使用现有登录态，只读 GET `/api/instant-message/users/me` → 200／0000；GET `/calls/devices` → 404／IM_90001 | 未执行登记 POST、未提交虚构 token；不能仅凭 GET 404 断言所有等价接口不存在 |
| 后端源码 | 重新 fetch 的 `nuwax-im/origin/feat-video-meeting` 仍为 `0fa014fc86712a09bb9e321e24b5aa2dc4fc2ea0`，所查分支未发现 VoIP sender，设备 voipToken 仅落库 | 用户反馈没有已知独立 APNs VoIP 部署；尚未取得可用 sender 的实际部署版本。未修改后端仓库 |
| 当前 UniPush 云函数 | `push-send/voip.js` 识别业务邀请并限制 TTL，`index.js` 没有设置 `options.ios.type=voip` | 业务 payload 标记不等于系统 VoIP 类型，现有普通通知无法证明 PushKit 唤醒 |

私有证据在忽略目录 `out/voip-ios-cold-chain-20261117/`：签名包摘要、设备快照、只读接口结果和本地测试日志。没有导出 Keychain 电话身份、输出推送 token 或签名私钥。

## UniPush 能否闭环

**发送可以留在现有 UniPush／个推体系，不需单独部署一套 VoIP、APNs 或媒体服务。** iOS 原生仍使用唯一 PushKit registry → LCK → LiveKit，现有 RTC rooms/tokens、IM voip 消息及 3007 事件继续复用。

| 官方支持 | 项目需要接上的部分 |
| --- | --- |
| DCloud `sendMessage(options.ios)` 映射为个推 `push_channel.ios` | 现有云函数增加显式、鉴权的电话分支，而非继续发送普通通知 |
| 个推 `push_channel.ios.type=voip` | 当前应用的 VoIP topic、凭据和开发／生产路由必须核实；不能由普通推送成功推导 |
| 个推原生 `registerVoipTokenCredentials` | 当前插件没有调用。本机 5.34 SDK 头文件包含该接口；需将现有 PushKit token 绑定给现有 SDK，不能再建第二个 registry |
| UniPush `settings.strategy.ios=2` 表示仅厂商下发、不考虑在线状态 | 官方标注策略能力需单独申请开通；先确认本应用已有能力，不能默认可用或自动申请权益 |

来源：[DCloud options 映射](https://doc.dcloud.net.cn/uniCloud/uni-cloud-push/options.html)、[DCloud settings／strategy](https://doc.dcloud.net.cn/uniCloud/uni-cloud-push/api.html#settings)、[个推 VoIP 类型](https://docs.getui.com/getui/server/rest_v2/common_args/)、[个推原生 VoIP 绑定](https://docs.getui.com/getui/mobile/ios/xcode/)、[个推 P8 说明](https://docs.getui.com/getui/mobile/ios/apns/)。旧个推回调示例不能替代 Apple 当前系统来电及 completion 要求。

## 在现有服务内完成的最小增量

1. **客户端原生**：在现有 token 回调里完成个推绑定、轮换与生命周期处理，保留原生冷启动恢复、先报告系统来电及业务鉴权。SDK BOOL 只表示接受绑定参数，不能冒充远端登记或可达。当前 `/calls/devices` 登记／回执须随最终路线一起适配，不能切到个推后仍依赖缺失接口反复报错。
2. **IM 设备归属**：复用现有账号／设备／CID，补电话能力、最低 iOS 版本、bundle、签名环境、登录代次／登记版本及可靠撤销。采用个推 CID→PushKit token 绑定时，IM 不必再重复存一套原始 token；但账号、登录和可接电话设备的归属不能省略。可扩展 `/devices`，也可沿用 `/calls/devices`；普通刷新、旧账号和旧撤销不能清空／复活新记录。
3. **既有 `uniCloud-alipay/cloudfunctions/push-send/`**：显式电话分支只针对有电话能力的 iOS CID；完整校验 callId、convId、msgId、calleeId、媒体类型和 expiresAt，拒绝凭据／URL，构造 `options.ios.type="voip"`。不无条件透传外部 options，不向混合 Android／iOS CID 广播电话分支。普通消息语义沿用现状。
4. **IM 邀请触发**：在既有有效 `msgType=voip` 单聊邀请成功后，通过现有可靠事件／任务扇出。当前 `OfflinePushConsumer.gate()` 跳过在线设备，电话不能机械套用这一门禁；后台 WS 在线状态不代表 App 可以及时执行。同设备同呼叫去重，已有原生电话路线不再叠加普通邀请通知。取消／结束／拒接继续用业务控制，不发 VoIP 保活或取消推送。
5. **只更新现有测试部署**：提供 IM commit／部署版本、`push-send` 云函数版本、实际设备契约、已验证的 topic／环境和厂商直投能力。当前未取得这些交付版本。无需另起服务，但增量代码仍须部署到当前测试服务才能联调；本任务没有自动部署。

发送参数示意，尚未实现或部署（仅面向已登记的 iOS 电话 CID）：

```js
await uniPush.sendMessage({
  push_clientid: [eligibleIosCid],
  title: '来电', content: '通话邀请',
  payload: validatedInvitation,
  settings: {
    ttl: Math.min(5000, validatedInvitation.expiresAt - Date.now()),
    strategy: { ios: 2 } // 先核实本应用已有该策略能力
  },
  options: { ios: { type: 'voip', payload: JSON.stringify(validatedInvitation) } }
})
```

发送前须拒绝已过期邀请，实际 expiration 须经供应商和发送结果核对，不能假定上述 TTL 自动映射为 `apns-expiration=0`。业务 60 秒响铃窗口不等于 APNs 保留队列。若现有 UniPush 应用无法取得 VoIP topic／直投能力，再使用[原有后端直连 APNs 适配器契约](voip-ios-push-handoff.md)；按设备明确选一条发送路线，不无条件双投。本轮没有自动切换当前 provider，也没有新申请、上传或替换证书。

## 本次已完成的客户端修补

- **PushKit 完成与校验解耦**：`NuwaxVoipPushWork` 让异步 delegate 只等待 LCK 报告；HTTP 校验在独立、可取消的后台断言内继续。额度耗尽／退出时取消，网络异步等待后再核对取消、账号代次和 pending 邀请；正常／失败／取消均只释放一次断言。保留已有过期、重复和系统终态保护。
- **会话持久化原位更新**：`NuwaxVoipSessionStorage` 使用 `SecItemUpdate`，仅在不存在时 `SecItemAdd`。不再先删除上一份身份再尝试写入，更新失败保留原可恢复记录；退出仍删除。保护等级维持 `AfterFirstUnlockThisDeviceOnly`，没有降低重启首次解锁前的保护。
- **诊断与包检查**：仅 DEBUG 输出 PushKit 接收、callId／系统 UUID 关联、校验与登记阶段，不输出 token／payload／凭据。签名检查增加实际 AppDelegate 调用验证，识别 Xcode 加载的 debug companion，防止只看源码或 selector 就判定 hook 存在。

本地验证：VoIP Vitest **15 文件／112 项**，macOS Swift Foundation／Security 单测 **53 项**，桥接 Swift 语法解析及 `git diff --check` 通过。新增用例验证报告前不提前返回、HTTP 阻塞不拖延 PushKit 完成、报告失败释放、超时／退出取消、旧任务隔离、Keychain 写失败保留身份，以及假启动 hook 的构建拒绝。没有运行 HBuilderX、iOS 平台类型检查／链接或新 App 构建；不能把本地单测当作用户原问题已修复。

Apple 依据：[PushKit 来电处理](https://developer.apple.com/documentation/pushkit/responding-to-voip-notifications-from-pushkit)。Apple 示例在系统来电报告完成时调用 completion，网络连接与后续动作独立处理；本文将同一时序用于既定 LCK 接入。

## 下一次真实验收的入口条件

先取得上述服务版本和原生绑定的新签包，再用一通 callId 串起：有效设备归属／绑定 → 云函数 taskId 或 APNs 受理标识 → PushKit 原生回调 → LCK 来电 → 接听后双向媒体 → 挂断及系统／采集释放。UniPush errCode=0、SDK BOOL、`registered`、`nativePush` 和 APNs 200 均单独记录，不能替代手机收到。

分别留证：后台且进程存在、系统回收无进程、用户从多任务界面上滑退出、重启尚未首次解锁、重启已首次解锁但未打开 App。拨号前记录进程状态，避免 HBuilderX 自动启动干扰；不从普通通知规则直接推断 PushKit 强退结果。首次解锁前当前 Keychain 身份不可保证可用，应准确记录保护边界。服务和新包未就绪时不让用户反复拨号或修改权限。
