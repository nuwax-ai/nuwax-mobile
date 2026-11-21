# iOS 系统来电唤醒接入方案

2026-11-20 · 测试环境 · IM 后端与推送云函数对接

**锁屏语音基线已通过。** 11 月 20 日 23:16，Ego Browser 从测试 Web 发起真实单聊语音。拨号前 iPhone 16（iOS 27.3）已锁屏，测试 App 进程已退出。测试函数按这台手机当时的 CID、`registrationId` 和 `development` 发送。23:16:12 苹果系统收到 `com.nuwax.app.voip`，23:16:13 App 上报系统来电，23:16:24 用户接听，IM 记录通话 8 秒。

**11 月 21 日动态登记和标准拨号已通过。** 新版 App 在 iPhone 16 上登记成功。锁屏且 App 进程退出后，测试 Web 正常拨号。IM 按被叫设备的 CID 提供实际登记版本，测试云函数完成选路。手机收到 VoIP 推送并接听，Web 同一条通话记录显示 9 秒。基座、测试包和本地安装见 [iOS 本地调试与测试包](voip-ios-qa-package.md)。

## 从字段约定到测试上线

| 顺序 | 负责人 | 可验收的交付物 |
| --- | --- | --- |
| 1. 先对齐字段 | IM 后端、移动端 | 在 IM 出站模型中预留可选 `payload.iosVoip`。键是本批次目标 iPhone 的 CID，值是 `{registrationId}`。缺少有效登记就省略该条目。测试云函数支持该字段后，即可处理已有有效登记的设备。 |
| 2. 准备 IM PR | 移动端起草、IM 同学评审 | 设备登记／撤销、按被叫和 CID 取当前版本、在既有单聊与实时会议出站中填字段。PR 范围和评审用例见下节。 |
| 3. 改移动端仓库 | iOS 打包、云函数负责人 | 在打包时注入正确的个推客户端配置，在测试云函数逐 CID 构造内部路由。复用现有的 PushKit 处理、会议分发及个推发送逻辑。 |
| 4. 测试上线 | 云函数 → 测试 IM → 真机 | 先发布兼容旧请求的测试函数，再部署测试 IM 的登记与出站改动。用指定测试设备完成登记，随后用普通 App 拨号验证。验收时关闭本地固定值脚本，整条链路只由正常业务请求驱动。 |

## 给 IM 后端的 PR 说明草案

**建议标题**　支持 iOS 来电设备登记，在单聊和实时会议推送中携带设备登记版本

**背景**　已有单设备实拨验证苹果可以唤醒锁屏 iPhone 并接听。请将此次手工提供的登记版本接入 IM 现有设备管理和邀请发送，复用普通设备记录中的账号、设备与 CID 归属。目标仓库为独立的 `nuwax-im`，提交前和后端同学确认实际测试部署分支。

| 改动位置 | PR 内容 |
| --- | --- |
| 设备接口与持久化 | 扩展现有 `POST /api/instant-message/devices` 的可选 `iosVoip` 字段。从鉴权上下文取租户和被叫，校验设备与 CID，保存当前有效的 `registrationId` 及其 CID 绑定。结合 `ImDeviceServiceImpl` 的普通设备生命周期处理注销、换号、轮换。存储实现由 IM 同学按现有设备模型选择。 |
| `OfflinePushConsumer`、`UniPushChannel.buildBody` | 复用已选出的收件人与目标设备。在本批次可响铃的 iPhone 中查有效登记，只向签名请求的 `payload.iosVoip` 写入匹配 CID 的登记版本。IM 继续传现有 `push_clientid` 数组。 |
| `CallPushInfo` 与会议序列化 | 实时会议按当前受邀人补齐响铃定位和截止时间，普通会议卡片和静默邀请走既有路径。后文有完整请求示例。 |

**请在 PR 附上的测试**　首次登记及回显；旧撤销晚于新登记时新版本仍有效；同一账号两台 iPhone 各取自己的版本；Android／iPhone 混合批次仅有 iPhone 条目；另一账号的登记不能进入当前批次；单聊、可响铃会议和静默会议分别覆盖。附一条使用示例 CID 的出站 JSON，便于云函数同学按同一份数据验收。

## 我们自己的代码怎么改

| 位置 | 最小改动 |
| --- | --- |
| iOS 打包 | 在 [prepare-ios.py](../../scripts/voip-native/device/prepare-ios.py) 生成业务宿主 Info.plist 时，从受控的客户端配置注入 `getui.appid`、`getui.appKey`、`getui.appSecret`。在 [ios_push_config.py](../../scripts/voip-native/device/ios_push_config.py) 检查最终签名包的三项值非空、无模板文字、AppID 匹配预期个推应用；沿用现有签名环境校验。UniPush 打包通过 `NUWAX_IOS_UNIPUSH_CLIENT_IPA` 指定经过确认的同 bundle iOS 基座，签名校验会将实际包的三项配置与该基座逐项比对。 |
| iPhone 原生 | 复用 [登记与撤销](../../uni_modules/nuwax-voip/utssdk/app-ios/NuwaxVoipApnsRegistration.swift) 和 [到达版本校验](../../uni_modules/nuwax-voip/utssdk/app-ios/NuwaxVoipPushInvitation.swift)。端上生成 UUID，与当前 CID 一起登记；推送中的 `routeRegistrationId` 必须匹配。首轮使用的固定值只存在于调试脚本。 |
| 测试云函数 | 在 [push-send-test/index.js](../../uniCloud-alipay/cloudfunctions/push-send-test/index.js) 的逐 CID 循环内读取原始签名请求的 `payload.iosVoip[cid]`，核验登记字段并构造内部 `callRoute`。把当前设备与业务载荷交给已有的 [prepareNativeVoip](../../uniCloud-alipay/cloudfunctions/push-send-test/voip.js) 和 `sendNativeVoip`，沿用其他设备的选路。 |
| 回归 | 在 [pushSend.test.ts](../../tests/voip/pushSend.test.ts) 覆盖无新字段、含多个设备的映射、旧版本、过期邀请、静默会议，以及其他设备看不到 iOS 登记映射。用新打的包查一次个推设备档案，确认当前 CID 属于预期个推应用。 |

## 为什么 PC Web 和 Android 已能工作，iPhone 还需要接入

| 接收场景 | 已知行为与本次关联 |
| --- | --- |
| PC Web 在线 | 页面通过 IM 长连接收到邀请，展示来电并进入 RTC。Web 作为主叫可以继续用同一套邀请协议。 |
| Android 厂商唤醒 | 测试中，Web 发起语音邀请后，锁屏且无 App 进程的华为手机经厂商通道冷启动，通过 Android Telecom 展示来电。该记录验证的是这台华为的来电展示。 |
| iPhone 离线 | 长连接可能已断。IM 要选中目标 iPhone，经个推发送 APNs VoIP 推送。iOS 唤醒 App、交给 PushKit 回调，App 随即向系统报告来电。普通通知只能证明通知送达。 |

### 改动落在哪一层

复用现有主叫、受邀人列表、多人／多设备分发、会议卡片、接听信令和 RTC。IM 仍传本次被叫的目标 CID 列表；若其中有已登记的 iPhone，建议在 `payload.iosVoip` 中附上对应 CID 的登记版本。云函数逐 CID 组装内部 `callRoute`。单聊和实时会议共用测试推送函数与现有 App ID。

| 负责方 | 本次交付 |
| --- | --- |
| IM 后端 | 增加 iPhone 来电能力登记与撤销。在签名出站请求的 `payload.iosVoip` 中按 CID 附上最新有效的 `registrationId`，补齐会议响铃字段。 |
| 测试云函数／个推 | 在 `push-send-test` 现有逐 CID 分发中读取 iOS 登记信息、构造路由，复用 iOS VoIP 发送分支并返回实际通道。确认个推向苹果沙箱的正确 topic 投递。 |
| iOS／联调 | 复用已安装的 `com.nuwax.app` 测试包。记录 PushKit 回调、系统来电和接听后的媒体或入会结果。 |

### 两个已定位的联调问题

- **个推应用配置。** 原 QA 包的 `getui` 三项仍是模板文字，个推将旧 CID 列为无效。改用同包名基座中与目标个推应用匹配的客户端配置并重新签名后，生成的新 CID 被个推识别为有效 iPhone。SDK 接受 token 参数之后，仍要核对 CID 归属。
- **专注模式。** 23:11 的上一通已经到达苹果系统并上报来电，但 iOS 日志明确记录 `call did not pass DND filter`。关闭专注后才完成上述锁屏接听。联调记录应区分厂商受理、设备收到、系统是否展示、用户是否接听。

测试登记沿用普通设备注册接口。iPhone 先正常上报本机 CID，PushKit 取得登记版本后调用同一接口更新 `iosVoip`。

[苹果开发文档 · PushKit 如何接收来电并唤醒 App](https://developer.apple.com/documentation/pushkit/responding-to-voip-notifications-from-pushkit)

## iPhone 向测试 IM 登记什么

通过现有 `POST /api/instant-message/devices` 登记。使用已登录会话，提交当前 iOS 设备的 `deviceId`、`platform`、`pushToken` 和可选 `iosVoip`。普通设备注册先完成 CID 关联。带 `iosVoip` 的更新只修改来电登记。

### 登记请求示例

```json
{
  "deviceId": "qa-iphone-16",
  "platform": "ios",
  "pushToken": "exampleCidA",
  "iosVoip": {
    "registrationId": "7adf48c0-492f-4f23-8405-4e98f9e155e6",
    "previousRegistrationId": "",
    "action": "register"
  }
}
```

| 字段 | 用途 |
| --- | --- |
| `deviceId`、`pushToken` | 核对当前登录账号、租户、iOS 设备和已登记 CID。 |
| `registrationId`、`previousRegistrationId` | 当前和上一版登记 UUID。首次登记前驱为空，轮换时携带前驱。比较更新确保旧版本撤销只影响自身。 |
| `action` | `register` 登记或轮换，`revoke` 按版本撤销。现有设备注销同时清除来电登记。 |

### 成功回执示例

```json
{
  "code": "0000",
  "data": {
    "deviceId": "qa-iphone-16",
    "platform": "ios",
    "status": 1,
    "pushEnabled": true,
    "pushSubscriptionSaved": false,
    "iosVoip": {
      "registrationId": "7adf48c0-492f-4f23-8405-4e98f9e155e6",
      "registered": true,
      "nativePush": true
    }
  }
}
```

`registered` 表示当前版本已保存，`nativePush` 表示部署已开启来电推送。撤销回执中两项为 `false`。环境由云函数在选路时补齐。

## IM 调推送云函数要扩展哪些字段

**建议只扩展一个可选字段 `payload.iosVoip`。** IM 沿用 `UniPushChannel.buildBody` 的 `push_clientid` 数组，以及原有单聊／会议业务字段。即使只有一台设备，格式也相同。调用继续使用 `X-Push-Sign` 鉴权。

| IM → 云函数字段 | 谁填、怎么用 |
| --- | --- |
| `push_clientid` | IM 现有目标 CID 列表。本次请求对应同一个被叫账号，可以包含其多台设备。 |
| `payload.iosVoip[<cid>].registrationId` | **核心字段**。App 生成、IM 确认的当前登记版本，小写 UUID。发送前按当前租户、被叫和 CID 取有效记录。个推的 CID 档案无法提供这个业务版本。 |
| `callRoute.environment` | 由云函数使用空间配置 `NUWAX_VOIP_IOS_APNS_ENVIRONMENT`，测试函数缺省为 `development`。 |
| 生成路由所需的其余字段 | 云函数用当前 CID 填 `cid`，在有效 iOS 登记分支内填 `platform=ios`、`transport=ios-voip`。PushKit token 由手机交给个推 SDK。 |

`iosVoip` 为本方案拟新增的服务端字段，键是 CID，每个值包含 `registrationId`。仅为本批次有有效登记的目标 iPhone 添加条目；全是 Android、普通消息或静默会议邀请时省略整个字段。IM 从服务端设备登记生成它，云函数只在选路时读取它。

### 单聊语音或视频邀请

```json
{
  "type": "voip",
  "push_clientid": [
    "exampleCidA"
  ],
  "title": "女娲来电",
  "content": "收到通话邀请",
  "payload": {
    "type": "voip",
    "scene": "call",
    "convType": 1,
    "convId": "1001",
    "msgId": "2001",
    "callId": "call-2001",
    "calleeId": "3001",
    "mediaType": "audio",
    "sendTime": 1795161600000,
    "expiresAt": 1795161660000,
    "iosVoip": {
      "exampleCidA": {
        "registrationId": "7adf48c0-492f-4f23-8405-4e98f9e155e6"
      }
    }
  }
}
```

### 实时会议邀请同一被叫的 iPhone 和 Android

```json
{
  "type": "voip",
  "push_clientid": [
    "exampleCidA",
    "exampleAndroidCid"
  ],
  "title": "女娲会议来电",
  "content": "收到实时会议邀请",
  "payload": {
    "type": "voip",
    "scene": "meeting",
    "convType": 2,
    "convId": "1002",
    "msgId": "2002",
    "callId": "ring-2002",
    "calleeId": "3001",
    "mediaType": "video",
    "inviteId": "inv-2002",
    "roomName": "room-demo",
    "title": "项目讨论",
    "senderName": "发起人",
    "silent": false,
    "groupCall": true,
    "sendTime": 1795161600000,
    "expiresAt": 1795161660000,
    "iosVoip": {
      "exampleCidA": {
        "registrationId": "7adf48c0-492f-4f23-8405-4e98f9e155e6"
      }
    }
  }
}
```

第二例中，云函数只为 `exampleCidA` 使用 iOS 登记；`exampleAndroidCid` 继续走现有设备选路。`convId`、`msgId`、`calleeId` 是十进制字符串。`mediaType` 取 `audio` 或 `video`。`sendTime` 和 `expiresAt` 为 Unix 毫秒整数，以消息落库时间为准，响铃窗口最长 60 秒。示例时间仅用于展示。

现查 IM 分支的会议序列化已有 `inviteId`、`roomName`、`title`、`senderName`、`silent`、`groupCall` 和可选 `passcode`，但 `callId`、`calleeId`、`sendTime`、`expiresAt` 只在单聊分支写入。请为实时会议也填这四项。`calleeId` 按当前受邀人填写，`callId` 对同一次邀请保持稳定，使用字母、数字、下划线或短横线。

`groupCall` 表示会议业务属性，`convType` 取实际会话类型。`silent=true`、预约提醒等走既有会议通知。响铃仅用于当下可接听、可入会的音视频邀请。

## 云函数改造与多人场景的衔接

### 从 IM 的登记信息生成内部路由

1. **取出服务端字段。** 在构造干净的业务载荷前读取 `payload.iosVoip`，按去重后的 `push_clientid` 逐个匹配。只处理当前目标列表中的 CID，忽略额外键。现有业务载荷构造器按白名单取字段，因此必须从原始签名请求读取这张映射。
2. **逐设备组装。** 对当前 CID 核对小写登记 UUID，从云空间配置取得 APNs 环境，生成下面的内部对象。仅在处理有效、需要响铃的邀请时交给 `prepareNativeVoip`。调用该函数时，内部请求的 `push_clientid` 为当前单个 CID 字符串。
3. **沿用已有发送。** `prepareNativeVoip` 将当前版本写入手机收到的 `routeRegistrationId`，设置 `options.ios.type=voip`、`settings.strategy.ios=2` 和最长 5 秒的投递 TTL。手机将收到的版本与本地当前登记比对。发送到个推、普通通知或 Android 的载荷均需剔除整张 `iosVoip` 映射。
4. **按目标回执。** 无 iOS 条目时继续现有的厂商识别或普通通知处理。条目无效时放弃该目标的 iOS 原生尝试，按现有规则回退或跳过，并记录原因。过期邀请跳过响铃。每台设备只选一条投递路径，其他设备各自处理。

以下是云函数为示例 iPhone 生成的内部 `callRoute`。

```json
{
  "cid": "exampleCidA",
  "platform": "ios",
  "transport": "ios-voip",
  "environment": "development",
  "registrationId": "7adf48c0-492f-4f23-8405-4e98f9e155e6"
}
```

测试空间 `nuwax-push-test` 的 `push-send-test` 从 `payload.iosVoip` 构造路由后向个推发送 VoIP，发布后已回下载核对代码。开发签名真机已用 IM 动态提供的字段完成单聊语音接听。生产签名和供应商环境另行验证。

### 逐 CID 回执

沿用批量返回的 `data.results`。建议为每个目标提供 `cid`、`errCode`、实际投递方式 `delivery`，原生发送附上 `transport`、`requestId` 和可用的个推任务结果。回退或跳过时提供 `reason`。这样 IM 可以沿用按 CID 解析的逻辑，分辨厂商受理与普通通知回退。以下为建议格式。

```json
{
  "errCode": 0,
  "data": {
    "total": 2,
    "results": [
      {"cid": "exampleCidA", "errCode": 0, "delivery": "native",
       "transport": "ios-voip", "requestId": "example-request",
       "tasks": [{"taskId": "example-task", "status": "successed_offline"}]},
      {"cid": "exampleAndroidCid", "errCode": 0, "delivery": "notification"}
    ]
  }
}
```

### 一次会议邀请多人时，沿用现有分发

例如 A 和 B 都受邀，A 有一台 iPhone 和一台 Android，B 有一台 iPhone。现有 IM 规则先决定应通知谁、哪些设备需要离线推送。按现有收件人分发为 A、B 各填自己的 `calleeId` 和目标 CID 列表。A 的请求可以包含 iPhone 和 Android，其 `iosVoip` 只列 A 的 iPhone；B 的请求只携带 B 自己的登记信息。同一账号有两台已登记的 iPhone 时，分别以各自 CID 为键取各自版本。

沿用现有在线、免打扰、已处理与去重规则。按目标设备判定离线并记录投递。相同邀请的并发消费或超时重试应复用同一投递标识；一台设备失败可独立定位。A 加入或忽略会议后，复用 `meeting-invite-handled` 同步 A 的其他端，B 仍可响应邀请。

聊天中的 `meeting_invite` 卡片保留。客户端接听后会按 `convId`、`msgId` 请求 IM 消息并校验 `inviteId`、`roomName`，再进入既有入会流程。过期、已取消或已处理的邀请应停止响铃；取消和多端状态同步沿用 IM 信令。

## 测试部署与交付验收

### 部署范围

更新测试 IM 的登记接口和既有来电发送逻辑；若 API 和离线推送消费者分开部署，两处分别确认生效版本。云函数沿用独立空间 `nuwax-push-test` 中的 `push-send-test`，单聊和会议共用该入口。后端同学请回传 IM／消费者版本、函数版本、生效路由和脱敏后的回执。

IM 变更基于 `nuwax-im/feat-video-meeting@d2f4c54`。现有数据库先执行 `sql/add-ios-voip-registration.sql`，再部署 IM API 和离线消费者。沿用现有离线推送开关、UniPush 地址和签名，确认 IM API 与离线消费者指向测试推送空间。登记回执和自动出站应使用同一台设备的当前版本。

云函数与 IM 对齐测试 HTTPS 地址和 `X-Push-Sign`。测试与生产共用 UniPush 应用，个推侧先确认沙箱配置的作用范围。Apple 侧复用现有 App ID 和签名。先用指定账号和设备验证测试环境的登记与出站。

### 按一条真实邀请对账

| 验证项 | 通过条件 |
| --- | --- |
| 登记 | 真机返回 `code=0000`，登记版本回显一致，`registered=true`、`nativePush=true`。普通刷新、轮换、退出后均可确认当前路由归属。 |
| 出站契约 | 核对 IM 的实际请求中目标列表为数组，顶层省略 `callRoute`。验证两台 iPhone 各自收到匹配本机的登记版本、混合批次 Android 分支正常、旧请求省略 `iosVoip` 时原有路径可用。 |
| 单聊唤醒 | 另一台手机分别发起语音、视频。目标 iPhone 锁屏，各自记录 IM 出站、函数 requestId／厂商任务、PushKit 回调、系统来电、接听和双向媒体。视频在前台验证双向画面。 |
| 实时会议 | 同一会议邀请一名 iPhone 用户及另一受邀人。iPhone 锁屏出现会议来电，接听进入正确房间；其同账号其他端收铃，其他受邀人仍可入会。静默、过期邀请与重复投递分别回归。 |
| 定位结果 | 用同一 `callId`（会议另记 `inviteId`）、`convId`、`msgId`、目标设备指纹串起各段。锁屏时 App 挂起与系统回收后无进程分别留证；记下拨前进程状态、日期和测试版本。 |

锁屏单聊语音已经用 IM 动态登记走通。视频、会议入会和双向媒体质量单独验收，各场景记录 `callId`、IM 出站和设备接听结果。
