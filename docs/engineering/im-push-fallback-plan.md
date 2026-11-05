# IM 推送 Fallback 实施计划（前端 / 后端 工作清单）

面向：nuwax-mobile 端上开发、nuwax-im 后端开发、uniCloud 云函数维护者。
前置阅读：[im-offline-push.md](im-offline-push.md)（现有 uni-push 2.0 链路）。

状态：**计划稿**（2026-11-04）。Phase 1 项目扫描已完成，本文是落地清单，不含代码。

---

## 0. 一句话目标

在**不替换、不影响现有 uni-push 2.0 厂商推送**的前提下，为「没有可用厂商通道的 Android 设备」
（首要目标：三星国行）新增一条 **Foreground Service + WebSocket + 本地通知** 的兜底通道，
推送走哪条路由**由服务端按设备能力决定**，端上不按 brand 写死业务逻辑。

---

## 1. 前置决策（未拍板前不要开工）

| # | 问题 | 影响 | 建议 |
|---|---|---|---|
| D1 | **小米通道是否真的已启用？** `manifest.json` 的 `app-android.distribute.modules["uni-push"]` 只声明了 `hms / oppo / vivo / honor`，**没有 xiaomi**。另见 [../../utils/appIconBadge.uts](../../utils/appIconBadge.uts) 头部注释：「小米通道待应用市场上架审核通过后再补」 | 决定 fallback 的覆盖面（小米是否也要走 WebSocket） | **倾向结论：小米暂未启用**。若确认，小米设备本期即归入 fallback 目标；上架后补通道再切回 vendor |
| D2 | **`foregroundServiceType` 选型** | `dataSync` 在 Android 15 起有 6 小时/24 小时限额，会硬性掐断 IM 长连接；`specialUse` 不受时限但需声明用途 | 建议 `specialUse`，并在 Android 15 真机验证 >6 小时存活 |
| D3 | **pushChannel 判定权归属** | 端上无法判断厂商通道是否真的可用（`getPushClientId` 返回的是个推 cid，与厂商 token 无关） | 采用三级模型：端上报候选能力 → 服务端按配置+回执判定 → 回执失败自动降级 |

---

## 2. 阻塞项（Blocking，必须先于端上 FGS 上线）

### B-00 服务端设备级 presence

现网在线判定是 **uid 级**：`im:route` 里有没有这个 uid，有就 `skippedOnline` 放弃离线推送。
证据：[im-offline-push.md](im-offline-push.md) §6 排障表；[../../utils/im/imWsClient.uts:260-269](../../utils/im/imWsClient.uts#L260-L269) 注释。

**为什么阻塞**：三星设备的 FGS 一旦常驻 WS，该 uid 永久在线 ⇒
同账号那台华为手机、以及该账号的 PC 端，厂商推送会被连带掐掉。

要求：

- [ ] `im:route` 路由结构从 `uid → field` 改为 `uid → { deviceId → field }`（或新增设备级在线表）
- [ ] `OfflinePushConsumer` 的在线判定改为**按 deviceId**，而不是按 uid
- [ ] 保留 uid 级判定的读取能力（页面级/兼容用途），但推送路由不得再用它
- [ ] 回归：同一账号「华为手机 + PC」同时在线时，手机后台仍能收厂商推送
- [ ] 回归：现有全部厂商推送场景零变化

> 这一条不做，Phase 8 之后的所有端上工作都是在"改坏线上"。

---

## 3. 后端清单（nuwax-im Java + uniCloud）

### 3.1 数据与契约

- [ ] **B-01** `im_user_device` 扩字段（Flyway/Liquibase 迁移，全部 nullable，兼容旧行）
  - `brand`、`model`、`manufacturer`
  - `push_channel`（枚举：`vendor` / `websocket` / `fcm` / `none`）
  - `vendor`（枚举：`huawei` / `honor` / `xiaomi` / `oppo` / `vivo` / `meizu` / `none`）
  - `vendor_token`（预留，当前 uni-push 不暴露厂商 token，先空）
  - `fallback_enabled`（布尔，与现有 `push_enabled` 区分：前者=允许走 WS 兜底，后者=是否下发推送）
  - `last_seen_at`、`last_ws_connected_at`
  - `vendor_degraded_at`（被判定降级的时间，用于冷却策略 B-11）
- [ ] **B-02** 设备注册接口扩容：`POST /api/instant-message/devices`
  - 新增可选字段：`brand` / `model` / `manufacturer` / `sdkVersion` / `pushChannelCandidate` / `fallbackEnabled`
  - **旧客户端不传这些字段时，行为必须与现在完全一致**（按 `vendor` 处理，按 cid 推）
  - 服务端校验并落库；非法值忽略，不要 400（避免把端上注册打断，注册失败=该设备永远收不到推送）
- [ ] **B-03** 注册时服务端判定 `push_channel`，并在响应里**回带**给端上
  - 判定输入：自身厂商配置矩阵 + 客户端上报的 brand/model + 该设备历史推送回执
  - 端上据此决定是否启动 FGS（端上不自己猜）
  - 响应示例：`{ pushChannel: "websocket", vendor: "none", fallbackEnabled: true }`
- [ ] **B-04** 查询接口：`GET /api/instant-message/devices/{deviceId}` → 当前 `pushChannel`
  - 供端上冷启动、回前台、配置变更时校正；也可直接复用 B-03 的响应，二选一

### 3.2 路由与投递

- [ ] **B-05** `PushRouter.sendImPush(userId, message)`
  ```text
  for device in 该用户的全部设备:
      switch device.pushChannel:
          vendor    → sendUniPush(device)      // 现有云函数链路，参数结构不变
          websocket → sendWebSocket(device)    // 新
          fcm       → sendFCM(device)          // 预留，本期可不实现
          none      → continue
  ```
  - 严禁 `if (userId 在线) skip all`；必须逐设备判
- [ ] **B-06** `WebSocketChannel implements OfflinePushChannel`
  - **复用现有协议**，不新建 `/ws/im` 端点：
    向该 `deviceId` 的活跃连接投递 `MSG_RECV(3002)`，body 与在线投递一致
  - `supports()` 返回 ANDROID；`configured()` 判断网关可用
  - 设备无活跃 WS 连接时：不视为"已送达"，落回 `vendor`（若该设备 vendor 可用）或丢弃并记录
- [ ] **B-07** 投递过滤（沿用现有规则，逐条确认已覆盖）
  - 自己发的消息、已读消息、免打扰会话、已撤回/已删除
- [ ] **B-08** 节流合并：同一会话 5~10s 内多条只投最后一条（通知风暴防护）
- [ ] **B-09** `badge` 口径：取该接收者 `GET /api/instant-message/unread-total` 的 `total`
  - **已排除免打扰会话，不要再减 `dndTotal`**
  - 一次调用只能一个接收者（`badge` 是单值，多用户拼批会串号）
- [ ] **B-10** unreadCount 随消息下发
  - WS 投递帧里带 `unreadCount`（与在线链路一致即可，若已有则无需新增）
  - 厂商推送的 `badge` 字段 = 同一口径

### 3.3 回执与降级

- [ ] **B-11** 降级纠偏：云函数返回 `failed` / `appid_notmatch` 时
  - 该设备 `push_enabled=false`（现有建议已有），并按策略置 `push_channel=websocket` + 记 `vendor_degraded_at`
  - **冷却策略待定（D3 相关）**：永久降级 vs N 天后重试厂商通道。建议"永久降级 + 用户重装/换机自然重试"
- [ ] **B-12** 幂等：消息投递带 `request_id`（云函数已有该字段，10~32 位，重复会导致消息丢失，需后端保证唯一）

### 3.4 云函数侧（uniCloud-alipay）

- [ ] **B-13** `push-send` **不改**参数结构（保护现有链路）
  - 可选增强：返回里补充分通道明细，便于 B-11 判定
- [ ] **B-14** 确认 `PUSH_SIGN_KEY` 环境变量与后端 `X-Push-Sign` 一致
  - ⚠️ 改环境变量后**必须重新部署云函数**才生效（实测结论）

### 3.5 运维与文档

- [ ] **B-15** 监控指标：各通道投递成功率、降级设备数、`skippedOnline` 次数
- [ ] **B-16** 修正 [im-offline-push.md](im-offline-push.md) §2.1（"后端没有任何代码调 push-send"）——该段已过期，
      同文档 §6.3 已记录 2026-10-30 华为真机闭环，后端确实调了云函数

---

## 4. 前端清单（uni-app x / Android）

### 4.1 第一段：纯上报（可立即开工，不依赖后端 B-00）

- [ ] **F-01** 新增 `utils/push/pushCapability.uts`
  - `uni.getDeviceInfo()` 取 `deviceBrand` / `deviceModel` / `osName` / `osVersion`
  - 结合 `manifest.json` 已启用的通道，产出**候选**能力：
    ```text
    { vendorCandidates: ["huawei"], fallbackCandidate: true, cid: "...", notifyPermission: "granted" }
    ```
  - 注意：这只是候选，**不是**最终 `pushChannel`
- [ ] **F-02** 扩展设备注册请求体（[../../servers/im.uts:197-220](../../servers/im.uts#L197-L220) 的 `registerImDeviceNow`）
  - 新增 `brand` / `model` / `manufacturer` / `sdkVersion`
  - 现有 7 个字段语义**一字不改**
  - 服务端拒绝新字段时不影响注册（新旧兼容期容错）
- [ ] **F-03** 单测：`pushCapability` 的品牌→候选映射为纯函数，可脱机测

### 4.2 第二段：UTS 插件 + Kotlin 服务（依赖 B-00 / B-03）

#### 插件骨架

- [ ] **F-04** 新建 `uni_modules/nuwax-push-fallback/`
  ```text
  utssdk/
    interface.uts                        # 全部导出类型
    app-android/
      index.uts                          # 薄桥，只做转发
      config.json                        # minSdkVersion: 26
      AndroidManifest.xml                # service / 权限 / receiver 声明
      src/com/nuwax/push/
        NuwaxPushService.kt
        PushSocket.kt
        PushNotificationCenter.kt
        PushStateStore.kt
  ```
  - 参考范式：[../../uni_modules/nuwax-image-viewer](../../uni_modules/nuwax-image-viewer)、
    [../../uni_modules/nuwax-esp-provisioning](../../uni_modules/nuwax-esp-provisioning)
    （两者都已在用 `src/**/*.kt` + 插件自带清单合并）
- [ ] **F-05** 清单声明
  - `<uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>`
  - `FOREGROUND_SERVICE_SPECIAL_USE`（或 `_DATA_SYNC`，取决于 D2）
  - `<service android:name=".NuwaxPushService" android:foregroundServiceType="specialUse" android:exported="false"/>`
  - `POST_NOTIFICATIONS` 已在根 [../../AndroidManifest.xml](../../AndroidManifest.xml) 声明，勿重复
- [ ] **F-06** UTS 桥 API（全部具名 export，异步导出加 `@UTSJS.keepAlive`）
  ```text
  startService(config) / stopService()
  connect(config) / disconnect() / getConnectionState()
  updateToken(token) / updateUser(userId) / updateUnreadCount(count) / setBadgeCount(count)
  onMessage(cb) / onConnectionStateChange(cb) / onError(cb)
  ```
  - **UTS 层不存业务状态**，状态全在 Kotlin Service

#### Kotlin 服务

- [ ] **F-07** `NuwaxPushService`
  - `START_STICKY` + `onStartCommand` 幂等（防重复启动）
  - 创建两个通知渠道：常驻低优先级 / IM 高优先级（**不能混成一条**）
  - 运行期读 `applicationInfo.targetSdkVersion` 分流
    （生产云打包基座实测 targetSdk=32，本地自定义基座 36，见 [../../pages/message/chat.uvue:12877](../../pages/message/chat.uvue#L12877)、
    [../../scripts/local-base-env.sh:73-74](../../scripts/local-base-env.sh#L73-L74)）
- [ ] **F-08** `PushSocket`
  - 状态机：`DISCONNECTED / CONNECTING / CONNECTED / RECONNECTING / STOPPED`
  - 复用现有 IM 协议子集（[../../utils/im/imProtocol.uts](../../utils/im/imProtocol.uts)）：
    - 出站：`CONNECT(1000)`、`PING(2000)`、`MSG_RECV_ACK(3003)`
    - 入站：`CONNECT_ACK(1001)`、`CONNECT_REJECT(1002)`、`PONG(2001)`、`MSG_RECV(3002)`、`CONV_UNREAD(6001)`、`KICK(9000)`
  - 心跳间隔读 `CONNECT_ACK.body.heartbeatInterval`（clamp 5~300s），**不要硬编码**
  - 退避 `1s→2s→4s→8s→16s→30s`，**加 jitter**，上限 60s
  - 网络变化：`ConnectivityManager.NetworkCallback` 主动重连
  - 重连成功后触发一次 HTTP `/sync` 补齐断连窗口消息
- [ ] **F-09** `PushNotificationCenter`
  - 通知点击 `PendingIntent` 必须带 `conversationId` / `messageId` / `convType`
  - 去重：最近 N 条 `messageId` LRU，防 WS + 厂商推送重复弹
  - 角标：`Notification.setNumber(unreadCount)`（launcher 支持与否不可控，尽力而为）
- [ ] **F-10** `PushStateStore`（SharedPreferences）
  - 存 `token` / `userId` / `deviceId` / `wsUrl`，进程重启后恢复连接
  - **不落敏感信息到通知**，日志禁打完整 token

### 4.3 App 跨层协同

- [ ] **F-11** 登录接线：`IM_SESSION_READY`（[../../App.uvue:168-174](../../App.uvue#L168-L174)）
  - 先拿服务端回带的 `pushChannel`
  - `vendor` → 只跑现有 uni-push（**不启 FGS**）
  - `websocket` → `startService()` + 前台时仍由 JS WS 承担，退后台再切换
- [ ] **F-12** 登出接线：`IM_SESSION_CLEARED`（[../../App.uvue:159-167](../../App.uvue#L159-L167)）
  - 顺序与现有 `unregisterImDeviceSafe()` 一致：**先注销设备，再停服务**
  - 禁止登出后 WS 仍保持连接
- [ ] **F-13** 前后台交接（单向协议 + generation 版本号）
  ```text
  App 前台 : JS WS = connected,  FGS WS = stopped
  App 后台 : JS WS = stopped,    FGS WS = connected
  ```
  - `onHide` → 先关 JS WS（现有 `pauseImWsKeepalive()`），再 `startService()`
  - `onShow` → 先 `stopService()`，再 `reconnectImWsOnForeground()`
  - 每次交接带 `generation`，过期事件直接丢弃（现网 `imWsClient.generation` 同思路）
- [ ] **F-14** Token / 域名变更
  - 现有无 refreshToken，**token 变更 = 重新登录**（[../../utils/authSession.uts:69-80](../../utils/authSession.uts#L69-L80)）
  - 企业域名切换会 `invalidateImSession()`（[../../constants/config.uts:113](../../constants/config.uts#L113)）⇒ 必须 `stopService()` 后按新域名重建
- [ ] **F-15** 工作商业版闸门
  - 未授权时**不启 FGS**（对齐 [../../utils/im/imWsClient.uts:342-345](../../utils/im/imWsClient.uts#L342-L345) 的 `isWorkCommercialBlockedSync()`）

### 4.4 权限与体验

- [ ] **F-16** 通知权限（Android 13+）
  - 复用现有判据 [../../utils/im/imPushClient.uts:357-365](../../utils/im/imPushClient.uts#L357-L365)
    （已处理华为/荣耀在 Android 12 基线上的反移植）
  - **被拒时 FGS 仍可运行**，但常驻通知与 IM 通知均不可见 ⇒ 必须在设置页明确区分
    "后台连接已开启" 与 "通知权限未开启"
- [ ] **F-17** 后台优化引导（**非强制**，不做默认必选）
  - 检测 `isIgnoringBatteryOptimizations`，仅提示 + 跳系统设置
  - 不要默认申请 `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`
- [ ] **F-18** 角标
  - 回前台可用 `uni.setAppBadgeNumber(num)`（HBuilderX 4.25+ 已支持，见内置类型定义
    `uni-push/utssdk/interface.d.ts:428`）校正图标角标
  - ⚠️ [im-offline-push.md](im-offline-push.md) §4 里"uni-app x 没有 setBadgeNumber"的说法**已过期**
  - 是否保留待真机验证后决定（三星国行 ROM 显示规则不可控）

### 4.5 日志与测试

- [ ] **F-19** 统一日志前缀：`[PushFallback]` / `[PushService]` / `[PushSocket]` / `[PushNotification]`
  - 记录：service start/stop、socket connecting/connected/disconnected/reconnect、network changed、
    message received/ack、notification created/clicked、token updated、unread updated
  - **禁止输出完整 token**；Release 关闭 debug 日志
- [ ] **F-20** 单测（现有 `tests/im/` 有先例）
  - 退避曲线含 jitter、去重 LRU、品牌→候选映射
- [ ] **F-21** 构建与发版
  - 原生插件改动**必须重打自定义基座**（[local-custom-base-maintenance.md](local-custom-base-maintenance.md)）
  - 更新 [pre-release-checklist.md](pre-release-checklist.md)：新增 FGS 相关检查项

---

## 5. 明确不改动清单（实施时防误伤）

| 对象 | 处理 |
|---|---|
| `utils/im/imPushClient.uts` 整文件 | **零改动**（cid 获取、点击跳转、通知权限全部保留） |
| `uniCloud-alipay/cloudfunctions/push-send/index.js` | 参数结构零改动 |
| `manifest.json` 的 `uni-push` 段 | 零改动（除非 D1 确认要补小米） |
| iOS / 鸿蒙 推送逻辑 | 零改动（鸿蒙走 Push Kit，iOS 走 APNs） |
| H5 / 微信小程序 | 零改动（不参与 fallback） |
| 现有 `IM_SESSION_*` 事件语义 | 零改动（只新增监听，不修改发事件方） |

---

## 6. 依赖顺序与里程碑

```text
B-00 设备级 presence ─┐
                      ├─► B-01~B-09 路由与投递 ─► B-11 降级纠偏
B-03 pushChannel 判定 ─┘                              │
                                                       ▼
F-01~F-03 纯上报（可立即开工，不依赖上面任一项）      Phase 8 联调
                                                       │
F-04~F-10 UTS 插件 + Kotlin 服务（依赖 B-03 的判定语义）┘
F-11~F-15 App 接线（依赖 F-04~F-10）
F-16~F-21 权限 / 日志 / 构建（贯穿）
```

里程碑：

| 里程碑 | 内容 | 通过标准 |
|---|---|---|
| M1 | B-00 + B-01~B-04 + F-01~F-03 | 现网厂商推送**零回归**；多设备不再互相压掉 |
| M2 | F-04~F-07 | 自定义基座能打出、能装、FGS 后台存活 >30 分钟（targetSdk 32 与 36 都验） |
| M3 | F-08~F-10 + B-05~B-06 | 三星真机断网/切网/重连全部走通 |
| M4 | F-11~F-18 + B-07~B-12 | 前后台交接无重复投递；通知点击进对会话 |
| M5 | 全量测试矩阵 | 见下节 |

---

## 7. 验收测试矩阵

设备：华为 / 荣耀 / 小米 / OPPO / vivo / 三星国行 / 其他 Android

场景：

- [ ] App 前台
- [ ] App 后台 30 分钟
- [ ] 锁屏 30 分钟
- [ ] 灭屏
- [ ] 从最近任务划掉
- [ ] Wi-Fi → 移动网络
- [ ] 移动网络 → Wi-Fi
- [ ] 完全断网 → 恢复
- [ ] Service 被系统杀掉后重建
- [ ] 手机重启（**本期不实现开机自启**，只需验证"不启动"不出错）
- [ ] 通知权限关闭
- [ ] 电池优化（默认 / 已忽略）
- [ ] 登录
- [ ] 退出登录
- [ ] Token 更新（= 重新登录）
- [ ] 企业域名切换
- [ ] 工作商业版未授权

每项记录：Expected / Actual / Result。

**必须额外跑的对照项**：

- [ ] targetSdk=32 生产包 与 targetSdk=36 自定义基座**分别跑一遍**
- [ ] 同一账号「三星 + 华为 + PC」三端同时在线
- [ ] `adb shell dumpsys notification --noredact | grep <pkg>` 核对通知**真的进栏**
      （华为会把多条折叠成一张卡，只看横幅会误判为"没收到"）

---

## 8. 技术边界（对产品口径）

必须对产品明确，不要承诺"100% 离线推送"：

1. **用户强制停止 App** 后，Android 不保证任何后台组件可恢复 ⇒ 该设备彻底失联直到用户手动打开。
2. 从最近任务划掉：`START_STICKY` 在多数国产 ROM 上被杀且不重启。
3. 厂商省电策略（三星中国 ROM 尤其激进）可能杀掉 FGS。
4. Android 图标数字角标是否显示，取决于 Launcher / ROM / 通知渠道 / 通知权限 / 系统版本，**不可承诺**。
5. Fallback 通道的时效性弱于厂商推送：依赖常驻进程，持续耗电，且受上述限制。
6. 现有能力对比：厂商推送（华为/荣耀/OPPO/vivo）在 App 被杀后仍可送达；fallback 不能。
