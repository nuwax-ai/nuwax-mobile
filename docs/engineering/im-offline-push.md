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
    "convType": 1,
    "name": "张三",
    "avatar": "https://..."
  },
  "force_notification": true,
  "request_id": "可选，用于幂等"
}
```

字段说明：

| 字段 | 必填 | 说明 |
|---|---|---|
| `push_clientid` | ✅ | 单个字符串或数组；云函数内部按 500 个一批自动分包 |
| `title` | ✅ | 通知标题（单聊=发送者名，群聊=群名） |
| `content` | ✅ | 通知正文（摘要） |
| `payload` | ⬜ | **点击跳转依据**，原样透传到客户端 `onPushMessage` 的 `res.data` |
| `force_notification` | ⬜ | 默认 true：离线时由系统通知栏展示 |
| `request_id` | ⬜ | 幂等键 |

`payload` 约定（App 端 [utils/im/imPushClient.uts](../../utils/im/imPushClient.uts) 读取）：

- `convId`：**必须**，没有则点击只拉起 App 不进会话
- `convType`：1 单聊 / 2 群聊 / 4 团队，缺省按 1
- `name`、`avatar`：可选，用于会话页首帧标题与头像（缺省时页面自己拉）

响应：

```json
{
  "errCode": 0,          // 401=签名不对 400=参数缺失 -1=某批次发送失败
  "errMsg": "ok",
  "data": { "total": 2, "batches": 1, "failedBatches": 0, "results": [ ... ] }
}
```

### 3.3 失败处理

- 推送失败**绝不能阻塞消息主链路**（消息落库/WS 投递是主，离线推送是旁路）
- `errCode=401`：密钥不一致，属于部署问题，记录错误即可，不要重试轰击
- cid 失效（用户卸载/换机）：云函数会返回失败批次，后端可据此把该设备 `pushEnabled` 置 false

## 4. App 端已实现的能力（后端可依赖的边界）

| 能力 | 状态 |
|---|---|
| 取 cid 并随设备注册上报 | ✅ 已实现 |
| 通知点击 → 打开对应会话 | ✅ 已实现（读 `payload.convId/convType/name/avatar`；无 `convId` 时只拉起 App） |
| 前台/后台 `receive` 事件 | ⬜ **刻意不处理**，前台由 WS 消息链路负责，后台由系统通知栏展示 |
| Android 13+ / 鸿蒙通知授权 | ✅ 启动时主动申请 |
| iOS 通知授权 | ⚠️ 由 uni-push 模块申请，待真机确认 |
| 通知渠道路由（`setPushChannel`） | ⬜ 未做，厂商"自分类权益"开启后需补 |
| 推送角标数字 | ⬜ 未做，如需要后端在 payload 里带，端上另做适配 |

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
| 点击通知只拉起 App 不进会话 | `payload` 里缺 `convId`/`convType` |
| 鸿蒙只能前台收到 | 鸿蒙推送需带 push 能力的签名 Profile（调试 profile 已换，**release profile 发版前须在 AGC 重申**） |
| iOS 收不到 | DCloud 后台 APNs 证书（开发/生产要分开）；系统通知授权被拒后只能去设置手动开 |
