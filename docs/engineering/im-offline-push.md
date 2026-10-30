# IM 离线推送（uni-push 2.0）对接说明

面向：nuwax-im 后端开发 / 后续维护者。

## 1. 链路总览

```text
App（Android / iOS / HarmonyOS）
  └─ uni.getPushClientId() → cid
       └─ POST /api/instant-message/devices  { pushToken: cid, pushEnabled: true }
            └─ 后端落 im_user_device.push_token（DEV-422 已有字段，无需改表）

用户离线时
后端 ── POST <云函数URL>/push-send ──> uniCloud 云函数 push-send（本仓 uniCloud-alipay/）
                                          └─ uniPush.sendMessage() → DCloud → 华为 HMS / Push Kit → 设备
```

要点：**后端全程不接触华为服务账号密钥**，厂商通道由 DCloud 托管。华为侧配置（项目级服务账号、
HMS / 鸿蒙 NEXT 厂商参数）已在 DCloud 开发者中心填好，只用于 DCloud 自己调华为接口。

## 2. 后端要做的事（按优先级）

| # | 事项 | 必要性 | 说明 |
|---|---|---|---|
| 1 | 确认设备注册接口把 `pushToken` 落进 `im_user_device.push_token` | 必须 | DEV-422 已有字段，联调时抓一次 App 启动的注册请求确认 |
| 2 | 消息投递时判定「该用户是否离线」 | 必须 | 现有 presence/WS 连接表即可；在线用户**不要**推（App 端 `receive` 事件刻意不处理，推了也不会有横幅） |
| 3 | 选设备并调云函数 `push-send` | 必须 | 条件：`pushEnabled = true` 且 `pushToken` 非空且 `platform ∈ {android, ios, harmonyos}`；Web 设备（`platform = web`）继续走原有 Web Push 链路，两者分流 |
| 4 | 推送过滤 | 必须 | 自己发的消息、已读、会话免打扰（dnd）、已撤回/已删除不推；这些规则**只能在服务端做**，设备离线时 App 端没有代码在跑 |
| 5 | 节流合并 | 建议 | 同一会话 5~10s 内多条只推最后一条，或按会话维度的合并窗口，避免通知风暴 |
| 6 | 失效 cid 清理 | 建议 | 云函数返回的 `data.results` 里失败的 cid 对应设备置 `pushEnabled = false`，避免长期无效推送 |
| 7 | 与消息主链路解耦 | 必须 | 离线推送是旁路，任何失败/超时都不能影响消息落库与 WS 投递；建议异步队列或至少 fire-and-forget + 超时 3s |

联调顺序建议：先用一条真实的 cid 手工 `curl` 调通云函数（能收到通知），再接后端逻辑。

### 2.1 后端代码接入位置（2026-10-30 核查后的现状）

`nuwax-im` 里离线推送框架已经齐了：`OfflinePushConsumer` 消费 `PUSH_OFFLINE`、
`OfflinePushChannel` 接口 + `WebPushChannel`（唯一实现）+ `ImOfflinePushChannelGuard`（启动打印通道覆盖矩阵）。
**但没有任何代码调 `push-send`，移动端在覆盖矩阵里显示"（无通道）"**。要接入需改 4 处：

1. **新增 `UniPushChannel implements OfflinePushChannel`**：`supports()` 返回 ANDROID/IOS/HARMONYOS，
   `push()` 里 POST 云函数；`configured()` 判断云函数 URL 与签名密钥是否配好（没配就让 guard 报出来，别静默跳过）。
2. **★改 `OfflinePushConsumer.pushToDevices()` 的设备过滤**（隐藏坑，不改前面全白做）：

   ```java
   // 现状：移动端设备结构上就没有 p256dh/auth，会被整批跳过
   if (isBlank(d.getPushToken()) || isBlank(d.getPushP256dh()) || isBlank(d.getPushAuth())) {
       skippedNoSubscription.incrementAndGet(); continue;
   }
   ```

   接口注释写的"新增实现类即可，不用改消费逻辑"**并不成立**。要么把这个判断拆成
   Web Push（三要素齐全）与移动端（只要 `pushToken` 非空）两条分支，要么把这个校验下沉进各
   `OfflinePushChannel` 自己实现。
3. **`ImPushProperties` 增加配置**：云函数 URL、`X-Push-Sign` 密钥（走配置中心/密钥管理，不要写进 yml 提交）。
4. **`badge` 计算**：consumer 目前不算未读总数，需要按接收者取一次 `/api/instant-message/unread-total`
   同口径的值（= `total`，已排除免打扰）塞进请求体；同时保证**一次调用一个接收者**（见 3.2 的角标约束）。

`Subscription` record 是为 Web Push 设计的（`endpoint/p256dh/auth`），移动端只需用到 `deviceId` +
查库拿 `pushToken`，不必强行把 cid 塞进 `endpoint`。

## 3. 后端调云函数的契约

### 3.1 存 cid（复用现有接口，无需新增）

设备注册接口已有 `pushToken` 字段（`DeviceRegisterRequest`，DEV-422，落 `im_user_device.push_token` 列，
与 Web Push 的 endpoint 共用该列，按 `platform` 区分语义）。

App 端上报形如：

```json
POST /api/instant-message/devices
{
  "deviceId": "9f2c...",
  "platform": "harmonyos",
  "appName": "nuwax-mobile",
  "appVersion": "1.2.8",
  "osVersion": "...",
  "pushEnabled": true,
  "pushToken": "380d3a1b2c..."
}
```

- `pushToken` **语义**：移动端是 uni-push 的 **cid**（不是华为 push token、不是 Web Push endpoint）
- `pushEnabled=false`（App 未取到 cid：标准基座 / 未开通 / 用户拒绝通知）时**跳过离线推送，不要重试**
- 每次 WS `CONNECT_ACK` 后 App 都会 UPSERT 一次，记住这是刷新语义，不是新建

### 3.2 触发离线推送

判定为离线（用户所有设备均无活跃 WS 连接）时，调云函数 URL：

```http
POST https://env-00jy6ydc5dxi.dev-hz.cloudbasefunction.cn/push-send
Content-Type: application/json
X-Push-Sign: <与云函数 SIGN_KEY 一致的共享密钥>
```

```json
{
  "push_clientid": ["cid1", "cid2"],
  "title": "张三",
  "content": "在吗",
  "payload": {
    "convId": "1234567890",
    "convType": 1
  },
  "badge": 5,
  "force_notification": true,
  "request_id": "可选，用于幂等"
}
```

字段说明：

| 字段 | 必填 | 说明 |
|---|---|---|
| `push_clientid` | ✅ | 单个字符串或数组；云函数内部按 500 个一批自动分包。★**一批必须是同一个接收者的设备**（见下方角标） |
| `title` | ✅ | 通知标题（单聊=发送者名，群聊=群名）。**官方限制小于 20 字**，云函数会裁到 19 + `…` |
| `content` | ✅ | 通知正文（摘要）。**官方限制小于 50 字**，云函数会裁到 49 + `…` |
| `payload` | ⬜ | **点击跳转依据**，原样透传到客户端 `onPushMessage` 的 `res.data`。官方限制 **800 字符**，超长时云函数只保留 `convId`/`convType` |
| `badge` | ⬜ | 应用图标角标，Number 或 String（`5` 置为 5；`"+1"` 累加；`"-1"` 递减仅 iOS）。**填该接收者的未读总数** |
| `category` | ⬜ | 消息分类，默认 `{"harmony":"IM","huawei":"IM","vivo":"IM"}`。★**鸿蒙通道必填**，不配会被判为营销类限量推送；一般不用传 |
| `force_notification` | ⬜ | 默认 true：离线时由系统通知栏展示 |
| `request_id` | ⬜ | 幂等键，10~32 位，重复会导致消息丢失 |

`payload` 约定（App 端 [utils/im/imPushClient.uts](../../utils/im/imPushClient.uts) 读取）：

- `convId`：**必须**，没有则点击只拉起 App 不进会话
- `convType`：1 单聊 / 2 群聊 / 4 团队，缺省按 1
- ~~`name`、`avatar`~~：**不建议再传**。端上会话页本来就会自己拉标题和头像，而带签名的头像 URL 很容易顶满 800 字符额度，挤掉跳转必需字段。

#### ★角标（badge）的三个约束

1. **一次调用只能一个接收者**。`badge` 是单值，不是数组；若把多个用户的 cid 拼成一批，不只角标会错，`title`/`content` 也会串到别人手机上。
2. **值填未读总数，不要填 `+1`**。总数方案每次推送都把角标拉回真实值，自带纠偏；`+1` 在丢一条推送后会永久偏小且无法自愈。
3. **口径 = `/api/instant-message/unread-total` 返回的 `total`**。该值**已排除免打扰会话**（后端 `ImUnreadCounter` 不变式：`total == Σ(dnd=0 会话未读)`），**不要再减 `dndTotal`**，否则与 App 内 TabBar 角标对不上。

#### 平台支持（官方限制，不是我们能改的）

| 平台 | badge |
|---|---|
| iOS | ✅ |
| 鸿蒙 | 文档标注支持，**待真机验证** |
| 华为 Android | ✅（`uni-app` 应用） |
| 华为 Android（**uni-app x 应用**） | ❌ 官方明示"暂不支持"——本 App 属此类 |
| 其他 Android（小米/OPPO/vivo） | 走各自厂商通道，不保证 |

⇒ 测试时若华为 Android 机上角标不动，是官方限制；后端仍照常传 `badge`，无需特殊处理。

响应：

```json
{
  "errCode": 0,          // 401=签名不对 400=参数缺失 -1=某批次发送失败
  "errMsg": "ok",
  "data": {
    "total": 2,
    "batches": 1,
    "failedBatches": 0,
    "applied": { "titleLength": 2, "contentLength": 2, "payloadLength": 32,
                 "badge": 5, "category": {"harmony":"IM","huawei":"IM","vivo":"IM"} },
    "results": [ ... ]
  }
}
```

`applied` 回显实际下发的值（裁剪后的标题/正文长度、载荷长度、角标、分类），排查"文案被截断/角标没生效"时先看它。

### 3.3 失败处理

- 推送失败**绝不能阻塞消息主链路**（消息落库/WS 投递是主，离线推送是旁路）
- `errCode=401`：密钥不一致，属于部署问题，记录错误即可，不要重试轰击
- cid 失效（用户卸载/换机）：云函数会返回失败批次，后端可据此把该设备 `pushEnabled` 置 false

## 4. App 端已实现的能力（后端可依赖的边界）

| 能力 | 状态 |
|---|---|
| 取 cid 并随设备注册上报 | ✅ 已实现 |
| 通知点击 → 打开对应会话 | ✅ 已实现（读 `payload.convId/convType`，兼容旧的 `name/avatar`；无 `convId` 时只拉起 App） |
| 前台/后台 `receive` 事件 | ⬜ **刻意不处理**，前台由 WS 消息链路负责，后台由系统通知栏展示 |
| Android 13+ / 鸿蒙通知授权 | ✅ **首启协议弹窗点「同意」后**申请一次（`requestImNotifyPermission`，持久化标记 `im_notify_permission_asked`）。2026-10-30 起不再放登录成功后（避免「登录完再弹一次」的二次打扰）。鸿蒙首启的系统弹窗实际由 **uni-push SDK 自己弹**（比 JS onLaunch 更早，日志里没有 `[ImPush][hm]` 打点），我们这次调用通常只探测到「已授权」；Android 13+ 才是真正弹窗的时机 |
| iOS 通知授权 | ⚠️ 由 uni-push 模块申请，待真机确认 |
| 通知渠道路由（`setPushChannel`） | ⬜ 未做，厂商"自分类权益"开启后需补 |
| 前后台连接策略 | ✅ **`App.onHide` 一律断开 WS**（退后台 / 主动锁屏 / 自动锁屏，真机已验触发）：后端只认 `im:route` 判在线，连接留着就永远走 `skippedOnline`。回前台 `onShow` 强制重连 → `CONNECT_ACK`（重发设备注册 + 触发 HTTP `/sync` 补拉）→ 聊天页 `silentSyncLatest()` 与全局 `/sync` 双路把断连窗口的消息补齐，所以断连**不会丢消息**，只会把「后台期间的实时」换成「推送 + 回前台补拉」 |
| 华为/荣耀机型的系统代弹 | ⚠️ **App 无法控制**：EMUI/HarmonyOS 自建通知权限管理（`PermissionPolicyService`），在**每次冷启动**且该应用通知未授权时由 `system_server` 主动拉起 `REQUEST_PERMISSIONS_FOR_OTHER`，与我们的 `requestImNotifyPermission()` 无关（实测 API 31 机器上我们的代码第一行 `SDK_INT < 33` 就 return 了，日志里根本没有"发起申请"）。用户点一次「允许」后不再弹 |
| 桌面图标角标 | ✅ **端上不需要做**：由 `uniPush.sendMessage({badge})` 下发给厂商通道直接设置。uni-app x 没有 `uni.setBadgeNumber`，App 回前台也不会去清角标 —— 如需"点开后清零"，得后端在下一次推送时传新值，或后续接原生插件 |

## 5. 安全

- `SIGN_KEY`：**只**从 uniCloud 环境变量 `PUSH_SIGN_KEY` 读取，代码里不留任何兜底值
  （本仓 `github` remote 是公开镜像）。未配置环境变量时云函数 **fail-closed**，一律返回 401。
  部署顺序固定为「先在控制台配环境变量 → 再上传云函数」。
- 后端配置的 `X-Push-Sign` 必须与这个环境变量完全一致；**改完环境变量必须重新部署云函数**
  才生效（实测：只保存环境变量、不重新部署，新密钥仍然 401）。
- 传输必须 HTTPS，密钥走安全渠道交接，不要微信/邮件明文。
- 云端不落用户消息正文之外的内容：`payload` 只放会话标识与展示字段，不放消息体。

## 6. 排障

| 现象 | 排查 |
|---|---|
| 注册请求里没有 `pushToken` | App 未拿到 cid：查启动日志 `[ImPush] getPushClientId fail`；多为基座不含 uni-push 模块 |
| 后端调云函数返回 401 | `X-Push-Sign` 与云函数 `SIGN_KEY` 不一致（改过要重新部署云函数） |
| 云函数返回成功但收不到 | DCloud 后台厂商推送配置 / 设备通知权限（Android 13+ `POST_NOTIFICATIONS`、iOS 通知授权、鸿蒙授权） |
| 编译安装后**没登录**就弹「是否允许发送通知」 | 华为/荣耀机型是**系统代弹**，不是我们的代码：logcat 搜 `PermissionPolicyService: launch notification permission request dialog` + `REQUEST_PERMISSIONS_FOR_OTHER ... from uid 1000`（system_server 发起）。确认通知是否被禁：`adb shell cmd appops get <pkg> \| grep POST_NOTIFICATION`，`ignore` = 未授权，华为会在每次冷启动再弹；让用户点一次「允许」即可 |
| 退后台 / 锁屏后仍收不到（前台正常） | 后端按 `im:route` 判在线 ⇒ 只要 WS 没断就 `skippedOnline`。看 App 日志：退后台应有 `pauseKeepalive` + `onClose ... manual=false`，回前台应有 `reconnect by foreground` + `CONNECT_ACK`。**同一账号 PC 端在线也会让手机被判「在线」而不推**（后端判定粒度是 uid 不是 deviceId，属已知待办） |
| 云函数 `successed_offline`、logcat 里本应用**零痕迹** | 华为侧没拿到 push token。抓 logcat 搜 `HMSSDK_HmsInstanceId: TokenTask failed, ErrorCode:`：**6003 = 签名证书指纹与 AGC 登记的不一致**（`app_id` 打印在下一行 `HMSSDK_HmsClient`）。修法见 6.2 |
| logcat 里 `HMSSDK_AGCUtils: Get appId with AGConnectServicesConfig failed` | **干扰项，不是故障**：个推接华为走 manifest 的 `com.huawei.hms.client.appid`，DCloud 云打包与本地自定义基座都不注入 `agconnect-services.json`。该行永远出现在 6003 之后，是 token 失败后的降级路径 |

### 6.2 华为 6003（证书指纹不一致）

1. 先从**装到手机上的那个包**取指纹（不是 keystore、不是别的包）：

   ```bash
   export JAVA_HOME=/Applications/HBuilderX.app/Contents/HBuilderX/plugins/amazon-corretto
   $ANDROID_HOME/build-tools/36.0.0/apksigner verify --print-certs <apk> | grep -E "DN|SHA-"
   ```

2. AGC → 我的项目 → 项目设置 → 常规 → 应用信息 → **SHA-256 证书指纹**，与上一步的
   `certificate SHA-256 digest` 逐位一致（SHA-1 一并填上，不用带冒号也算不同值，按 AGC 提示格式填）。
   注意 debug 基座与正式包若用不同证书，两条指纹都要登记。
3. 手机上 **设置 → 应用 → 应用管理 → HMS Core（华为移动服务）→ 存储 → 清除数据**：
   HMS 会缓存上次校验的签名，不清就会一直报 6003。
4. 重开 App，logcat 里 `push.gettoken` 的 `errorCode` 应变成 0；此时个推才会把华为 token 与 cid 绑定，
   之后离线消息才可能经华为通道下发。

> cid 能拿到 ≠ 厂商通道通：`uni.getPushClientId()` 返回的是**个推 cid**，不依赖华为 token，
> 所以「注册成功、云函数 `successed_offline`、设备端零痕迹」这一组合是 6003 的典型指纹。
| 点击通知只拉起 App 不进会话 | `payload` 里缺 `convId`/`convType` |
| 鸿蒙只能前台收到 | 鸿蒙推送需带 push 能力的签名 Profile（调试 profile 已换，**release profile 发版前须在 AGC 重申**） |
| iOS 收不到 | DCloud 后台 APNs 证书（开发/生产要分开）；系统通知授权被拒后只能去设置手动开 |

### 6.1 联调日志对照表

探针开关：`utils/im/imPushClient.uts` 的 `IM_PUSH_DEBUG`，**默认 `false`**（日志里含完整 cid）；
排查时临时改 `true`、复现完改回来。`utils/im/imWsClient.uts` 的设备注册探针走既有的 `IM_WS_DEBUG`。
**统一走 `console.error`**——鸿蒙真机看不到 `console.log/warn`。
取 cid 失败、权限被拒这类真失败日志不受开关控制，始终打印。

按链路顺序看：

| # | 日志 | 含义 / 怎么判 |
|---|---|---|
| 1 | `[ImPush] sync start platform=android storageCid=...` | onLaunch 已进入取 cid 流程。`storageCid` 非空说明上次已取到过 |
| 2 | `[ImPush] getPushClientId ok cid=...` | ✅ 拿到 cid —— 把这个值给后端做手工 curl 联调 |
| 2' | `[ImPush] getPushClientId fail: ...` | 基座不含 uni-push / 未开通 / 厂商通道未配。**停在这里，后面都不用看** |
| 3 | `[ImPush] apply cid changed X → Y，loggedIn=true` | cid 变了会立刻补报一次 |
| 4 | `[ImPush] report result code=0000 msg=...` | ✅ 后端已落 `push_token`。code 非 0000（如 `IM_90001`）= 后端没存下 |
| 5 | `[ImPush] device register platform=android deviceId=... pushCid=...` | 每次 WS `CONNECT_ACK` 后的 UPSERT。`pushCid=(empty)` ⇒ 后端拿到 `pushEnabled=false`，**永远不会推** |
| 6 | `[ImPush] onPushMessage type=receive data={...}` | ✅ 推送**真的到达了本机**（厂商通道 + 通知授权都通）。前台刻意不处理，只留痕 |
| 7 | `[ImPush] onPushMessage type=click data={...}` | 用户点了通知，接下来看 payload 里有没有 `convId` |
| 8 | `[ImPush] nav attempt=0 pages=3 top=pages/...` → `nav → navigateTo /pages/message/chat?...` | 跳转决策；`attempt` 反复递增说明启动页/登录页还没走完 |
| 9 | `[ImPush] nav fail: ...` | `navigateTo` 被拒（多为冷启动时机），只记不重试 |
| — | 云函数日志 `[push-send] req {...}` / `[push-send] batch N errCode= 0` | uniCloud 控制台 → 云函数 `push-send` → 日志。**有 req = 后端确实调了**，没有 = 后端没调（或签名 401，此时打的是 `rejected: invalid sign`）。`req` 只记长度与 `convId`，不落消息正文 |

联调顺序建议（每步不过就别往下走）：

1. App 冷启动 → 看日志 1~5，拿到 cid 与 deviceId
2. uniCloud 控制台看有没有 `[push-send] req`（后端该有推送动作了）
3. 把 App **退到后台或杀掉**（用户在线时后端按设计不推）→ 让另一个账号发消息
4. 看系统通知栏；App 在前台时看日志 6；点通知看日志 7~8

### 6.3 华为真机闭环实测（2026-10-30，ABR-AL80 / Android 12 / EMUI 14.2）

全链路已通（App 切后台 → 另一个账号发消息 → 通知栏收到）。三处证据留档，便于下次快速判「到底断在哪」：

| 环节 | 证据 |
|---|---|
| 后端 → 云函数 | `[push-send] req {"cidCount":4,...}` + `[push-send] batch 4 errCode= 0` |
| 云函数 → DCloud | `batch res` 里 `successed_offline`（3 个 cid）。★另有 `appid_notmatch`：该 cid 不属于本 App（DCloud 账号下别的应用 / 历史脏数据），后端应据此置 `pushEnabled=false` |
| DCloud → 手机 | `adb logcat` 里 `NotificationService: enqueueNotificationInternal: pkg=com.nuwax.app channel=com.huawei.android.pushagent73735 importance=3`，`dumpsys` 里 `opPkg=com.huawei.android.pushagent` |

★**"收到了但没看见"**：华为会把同一 App 的多条推送归进一个 `ranker_group` 折叠成一张卡（并可能加「已置顶」），且组内只响一次：

```
muting noisy, suppressed due to isGroup
isNeedInterceptStart true, interceptionState:BACKGROUND   # 后台不弹横幅，只进通知栏
```

排查「通知栏有没有」用 `adb shell dumpsys notification --noredact | grep <pkg>`，别只看屏幕顶部有没有横幅。
通知权限开关同理：`adb shell cmd appops get <pkg> | grep POST_NOTIFICATION`，出现 `ignore` = 被关（华为机型会因此每次冷启动弹授权框），整行不存在 = 允许。
