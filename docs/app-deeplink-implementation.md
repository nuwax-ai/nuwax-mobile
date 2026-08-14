# App 外部唤起 / 深链 — 开发实施计划

> **关系**：本文是 [app-deeplink-integration.md](./app-deeplink-integration.md)（已锁定的**设计/决策方案**）的**开发实施细化**。设计文档讲「做什么、用什么 URI」，本文讲「具体改哪些文件、配哪些字段、怎么验」。
>
> **分支**：`feat/nuwa-zhuoda-2026.07-deeplink`（从 `feat/nuwa-zhuoda-2026.07` 派生，携带在写的支付/深链文档）。
> **范围**：P0 = 自定义 Scheme `nuwax://open/agent`（Android / iOS 真机）；P1 = HTTPS Universal Links / App Links；P2 = 鸿蒙。

---

## 0. 方案校验结论（评估）

对照代码库与 DCloud 官方文档逐条核对设计文档的假设，结论：**方案整体可实施，决策方向正确**，但有若干处需在开发时校正。

### 已核实为真（可直接照做）

| 设计文档假设 | 校验结果 |
|---|---|
| 复用 `jumpToAgentDetailPage` 跳 agent-detail | ✅ 存在：`utils/commonBusiness.uts:86`，签名 `jumpToAgentDetailPage(agentId, conversationId?, agentType?, title?)`，已支持 `conversationId`。目标页 `/subpackages/pages/agent-detail/agent-detail?id=&conversationId=` 与设计一致 |
| 对齐 `pendingOpenUiAction` 的 storage+TTL 暂存模式 | ✅ `utils/pendingOpenUiAction.uts` 是现成模板（PREFIX key、`createdAt`、TTL 10min、consume 即删、幂等）|
| 冷启动未登录会 `reLaunch` 登录页，深链参数会丢 | ✅ `App.uvue:82-89`，Android 冷启动 `onLaunch` 内读 `ACCESS_TOKEN`，空则 `reLaunch` 登录页。**必须先落盘 pending 再 reLaunch**，设计 §5.1 的担忧成立 |
| 运行时用 `onShow` / `getEnterOptionsSync` 读 `appScheme`/`appLink` | ✅ uni-app x 提供：`App.onLaunch/onShow(options)` 与 `uni.getLaunchOptionsSync()`/`uni.getEnterOptionsSync()`，返回结构含 **`appScheme: string`** 与 **`appLink: string`**（[官方 launch API](https://doc.dcloud.net.cn/uni-app-x/api/launch.html)）|
| iOS 入站 scheme ≠ `urlschemewhitelist`（后者是出站白名单） | ✅ 现有 `app-ios.urlschemewhitelist` = `[alipays,alipay,weixin,weixinwap]` 是**出站**查询白名单（LSApplicationQueriesSchemes），与入站 scheme 注册是两件事，设计 §4.3 区分正确 |
| 支付文档与本方案共用 `link.nuwax.com` + AASA | ✅ `docs/app-native-pay-integration.md:58-64,71-72` 已锚定同域、AASA 覆盖 `/wechat/* + /open/*`，两文档互引一致 |

### 需校正 / 风险（开发时注意）

1. **「支付回跳现有逻辑」实为未实现**。
   全仓搜索 `appScheme|appLink|getLaunchOptionsSync|getEnterOptionsSync|handleOpenURL|continueUserActivity` —— **App 端目前零入站 scheme 处理**。`bootstrapAppNativePay`（`subpackages/utils/appNativePay.uts`）只注册**出站**桥（拉起微信小程序 / openURL 支付宝），不读入站。因此设计 §5「分流 → /wechat 或 pay.nuwax.com → 支付回跳（现有逻辑）」**不成立**。
   → **校正**：深链 router 对 `/wechat`、`pay.nuwax.com` 只做**显式放行/忽略**（不路由、不报错），等支付线后续接入入站时再对接。不要写成「交给现有支付逻辑」。

2. **Android manifest 字段是 `urlSchemes`（数组），不是旧版 `schemes` 字符串**。
   uni-app x（HX 4.71+，本机 5.15）配置字段为 `app-android.distribute.urlSchemes: string[]`（[官方 manifest-android](https://doc.dcloud.net.cn/uni-app-x/collocation/manifest-android.html)），如 `["nuwax"]`。设计 §4.2 只写「manifest 声明 Custom Scheme: nuwax」，需明确用此字段。

3. **iOS 入站 scheme + Associated Domains 不在 manifest.json 源码里**。
   uni-app x 的 iOS URL Types / 关联域走 **HBuilderX 可视化「iOS App 配置」或原生 Info.plist/entitlements**，没有 manifest JSON 字段（[官方 manifest-ios](https://doc.dcloud.net.cn/uni-app-x/collocation/manifest-ios.html)）。设计 §4.3 隐含的「manifest 配 iOS scheme」需改为 HBuilderX 配置 / 云打包参数。

4. **HTTPS App Links（Android）不在 manifest 字段内**。
   官方 manifest-android 文档**未提供** HTTPS App Links 配置，需走原生 `AndroidManifest.xml` intent-filter（`android:autoVerify="true"`、host `link.nuwax.com`、pathPrefix `/open`），经 `nativeResources/android/` 或云打包注入。**这是 P1**，不阻塞 P0 Scheme。

5. **新增 scheme 是原生/打包级改动 → 必须重打自定义基座才能真机验证**。
   按 [[custom-base-rebuild-rule]]：改业务 uvue/uts 不用重打，但 **scheme 注册改的是 AndroidManifest.xml / Info.plist，属原生配置**，`--playground custom` 热推 www 不会更新已装基座的 manifest。P0 真机验证需 `make app-resource` → `make base-android`（+ iOS）→ 重装。标准基座测试可走官方 `https://uniappx.dcloud.net.cn/scheme.html`，但本 App 用自定义基座（含支付/ESP 原生模块）。

6. **~~`App.onShow` 是统一的 consume 入口，无需改任何登录页~~（已校正，见修订记录 2026-08-14 代码评审修复）**。
   原假设「登录后一定回前台触发 `App.onShow`」**不成立**：登录流程是在**前台**通过 `redirectTo`→`reLaunch` 落地首页完成的，全程 App 未离开前台，**不会再触发 `onShow`**，pending 深链可能永远不被消费。
   → **校正**：`deepLinkRouter` 新增 `resumeDeepLinkAfterLogin()`，在**三条登录成功路径**（`login.uvue`、`login-form.uvue` ×2、`login-weixin.uvue`）`redirectTo` 之后各显式调一次（`// #ifdef APP-ANDROID || APP-IOS`）。三处都走同一个 `redirectTo`（仅这 3 个登录文件用它），故接入点收敛。`onShow` 仍保留（覆盖「已登录 + 后台点链接回前台」路径），两者靠 consume 即删 + 短时窗口去重不重复跳转。

7. **隐私合规（合规弹窗）不阻塞深链读取，但约束敏感 API**。
   uni-app x 隐私政策弹窗是 `onLaunch` 内 `openDialogPage` 的**非阻塞**弹层，不影响 `appScheme` 读取（[合规文档](https://doc.dcloud.net.cn/uni-app-x/tutorial/compliance.html)）。当前 `App.uvue` 未挂全局合规弹窗（仅 `login-weixin` 有勾选协议），P0 无冲突；但深链目标若用到相机/定位/设备信息等，需先 `uni.getPrivacySetting()` —— 暂不涉及（agent-detail 无敏感 API），记为后续注意点。

8. **`harmony-configs/` 目录当前不存在**。
   设计 §4.4 引用的 `harmony-configs/entry/src/main/module.json5` 需新建。鸿蒙 P0 在该文件 `module.abilities[].skills[].uris[]` 加 `{ "scheme": "nuwax" }`。**P0 主力是 Android/iOS，鸿蒙可与 P2 合并**，不阻塞。

---

## 1. P0 实施清单（自定义 Scheme）

### 1.1 配置：三端注册 `nuwax` scheme

**Android** — `manifest.json` → `app-android.distribute` 增加：

```jsonc
"app-android": {
  "distribute": {
    "packagename": "com.nuwax.app",
    "urlSchemes": ["nuwax"],          // ← 新增（数组）。标准基座默认只含 "uniappx"
    // ... 其余 modules/icons/splashScreens 不动
  }
}
```

**iOS** — 不动 `manifest.json` 源码；在 HBuilderX：
- 打开 `manifest.json` → **App iOS 配置** → URL Types / Schemes，新增 Scheme `nuwax`（与支付用的 `pay.nuwax.com` 并存）。
- 出站白名单 `urlschemewhitelist`（alipay/weixin）**保持不变**。
- Associated Domains `applinks:link.nuwax.com`：支付文档已要求，此处复用，确认已勾上即可（**Universal Links 是 P1，但关联域可一并配上**）。

**HarmonyOS**（P0 可与 P2 合并）— 新建 `harmony-configs/entry/src/main/module.json5`，在 ability 的 `skills` 中声明：

```json5
{
  "module": {
    "abilities": [
      {
        // ... 现有 ability 配置
        "skills": [
          { "actions": ["action.system.home"], "uris": [{ "scheme": "nuwax" }] }
        ]
      }
    ]
  }
}
```

### 1.2 新增 `utils/pendingDeepLink.uts`

照搬 [`utils/pendingOpenUiAction.uts`](../utils/pendingOpenUiAction.uts) 的 storage+TTL 骨架：

- key：`"pendingDeepLink:latest"`；TTL：**10 min**（对齐 `pendingOpenUiAction`）。
- `savePendingDeepLink(url: string)`：存 `{ url, createdAt }`。
- `consumePendingDeepLink(): string`：读 + 校验 TTL + **删 key**（幂等）；过期/空返回 `""`。
- `peekPendingDeepLink(): string`：只读不删（用于调试 / 判断是否需要消费）。

> UTS 字符串/UTSJSONObject 写法与 `pendingOpenUiAction.uts` 完全一致，直接复用其 `parsePendingPayload`/`takeValidMessage` 风格。

### 1.3 新增 `utils/deepLinkRouter.uts`

职责：**解析 + 分流 + 跳转**。核心导出：

```uts
// 解析 URL → 结构化动作；非法/不支持返回 null
export type DeepLinkAction = {
  kind: "agent" | "unknown",
  agentId: number,
  conversationId: number | null,
  raw: string,
}

// 1) 从 appScheme/appLink 提取业务 URL（非业务返回 ""）
//    规则：scheme=="nuwax"  或  host=="link.nuwax.com" 且 path 以 "/open" 开头 → 业务
export function extractBusinessUrl(appScheme: string, appLink: string): string

// 2) parse URL → DeepLinkAction（手动解析：UTS 无全局 URL 对象）
//    nuwax://open/agent?id=1&conversationId=2   → host/path="open/agent"
//    https://link.nuwax.com/open/agent?id=1     → host=link.nuwax.com path=/open/agent
//    仅识别 action=="agent"；其余 action 归 unknown（后续扩展在 /open/{action} 加分支）
export function parseDeepLink(url: string): DeepLinkAction | null

// 3) 已登录时消费并跳转（复用 jumpToAgentDetailPage）；返回是否处理
export function navigateDeepLink(action: DeepLinkAction): boolean

// 4) 顶层入口：分流。/wechat、pay.nuwax.com → 显式忽略（不报错，留给支付线）
export function handleDeepLink(appScheme: string, appLink: string): void
```

**实现要点**：
- `extractBusinessUrl`：先判 `appLink`（HTTPS，UL/App Links），再判 `appScheme`（自定义 scheme）。
- `pay.nuwax.com`（scheme 形态）或 path 含 `/wechat` → `handleDeepLink` 直接 return（**忽略**，见校正 1）。
- query 解析：手动 `split("?")[1]` → `split("&")` → `key=value`，id/conversationId 用 `parseInt`（注意 `readRawField` 教训不适用——这里是自己 parse 字符串，不读 UTS class）。
- `navigateDeepLink` 内部 `await jumpToAgentDetailPage(agentId, conversationId)`（默认 `agentType="ChatBot"`；深链暂不带 agentType，沿用默认）。

### 1.4 改 `App.uvue`（统一入口）

**onLaunch**（在现有 `ACCESS_TOKEN` 判断**之前**插入）：

```uts
// #ifdef APP-ANDROID || APP-IOS
// 先捕获深链再决定是否 reLaunch 登录页 —— reLaunch 会丢 launch options
const launch = uni.getLaunchOptionsSync();
handleDeepLink(`${launch.appScheme ?? ""}`, `${launch.appLink ?? ""}`);
// handleDeepLink 内部：业务深链 → savePendingDeepLink；非业务 → 忽略
// #endif
// ↓ 现有 token 判断保持不动
const accessTokenRaw = uni.getStorageSync(ACCESS_TOKEN);
...
```

> onLaunch **不消费**（此时首页/登录页可能尚未挂载稳定），只**落盘 pending**。

**onShow**（新增深链消费逻辑，置于现有逻辑之后）：

```uts
onShow: function (options: OnShowOptions) {
  // ... 现有 setAppInBackground / SSE / 轮询 / 徽标 ...
  // #ifdef APP-ANDROID || APP-IOS
  // 1) 热启动新深链：先入 pending（覆盖最新）
  handleDeepLink(`${options.appScheme ?? ""}`, `${options.appLink ?? ""}`);
  // 2) 已登录 → 消费 pending 并跳转（幂等：consume 即删 + 3s 同 URL 去重）
  const token = `${uni.getStorageSync(ACCESS_TOKEN) ?? ""}`.trim();
  if (token.length > 0) {
    consumeAndNavigateIfPending(); // 内部 consumePendingDeepLink → parseDeepLink → navigateDeepLink，带 3s 去重
  }
  // #endif
}
```

**幂等去重**（在 `deepLinkRouter` 内用模块级变量记上次 navigate 的 `raw + 时间戳`，3s 内同 URL 不重复跳，对齐设计 §5「同一完整 URL 短时不重复」）。

> 这样冷启动已登录、冷启动未登录→登录、热启动三条路径**全部在 `App.onShow` 收口**，登录页零改动。

### 1.5 重打基座 + 真机验证（P0 必须）

scheme 是原生配置，热推 www 不更新 manifest：

```bash
make app-resource                 # 重新生成本地资源（含新 manifest）
make base-android                 # → unpackage/debug/android_debug.apk
# iOS 真机：make base-ios-device（需证书）；模拟器：make base-ios-simulator
# 或拉现成：pnpm base:fetch（若已发布含本改动的基座）
adb install -r unpackage/debug/android_debug.apk
```

**联调用例（设计 §9，P0 子集）**：

| # | 操作 | 通过标准 |
|---|---|---|
| 1 | 已登录，浏览器/adb `am start` 打 `nuwax://open/agent?id={有效id}` | 进 agent-detail |
| 2 | 已登录后台再点同一链接 | 热启动仍进目标页，栈不异常 |
| 3 | 未登录点链接 → 登录成功 | 登录后进目标页（App.onShow 消费 pending），不停在首页 |
| 4 | `nuwax://open/agent?id=&conversationId=` | 进会话页（带 conversationId） |
| 5 | `adb shell am start -W -a android.intent.action.VIEW -d "nuwax://open/agent?id=1" com.nuwax.app` | 直接拉起 |

> adb 唤起：`nuwax://` 可用 `am start` 直接打；HTTPS UL（P1）需真浏览器点击。

---

## 2. P1（HTTPS Universal Links / App Links）

- **后端/运维**：`link.nuwax.com` DNS+HTTPS；AASA（iOS，`paths` 含 `/open/*`）；assetlinks.json（Android，正式签名 SHA256 指纹）。**AASA 必须与支付 `/wechat/*` 一并覆盖**（支付文档已要求）。
- **iOS**：Universal Links 经 `applinks:link.nuwax.com`（关联域已在 P0 配上）+ AASA 命中即生效，无需额外 App 改动；`appLink` 字段自动带回 `https://link.nuwax.com/open/agent?...`。
- **Android**：原生 `AndroidManifest.xml` 加 `<intent-filter android:autoVerify="true">`（host `link.nuwax.com`、pathPrefix `/open`），经 `nativeResources/android/` 或云打包注入；`appLink` 自动带回 HTTPS URL。
- **落地页**（可选推荐）：`link.nuwax.com/open/...` 未装时引导 H5（`agent.nuwax.com/m/`）/商店。
- **shareLink 兼容**：Web 识别 `/agent/{id}` → 尝试跳 `link.nuwax.com/open/agent?id=` → 失败留 Web。
- **验证**：浏览器点 `https://link.nuwax.com/open/agent?id=` 已装直达 App。

---

## 3. P2（鸿蒙）

- P0 的 `module.json5` skills（自定义 scheme `nuwax`）先上。
- App Linking：host `link.nuwax.com`、`pathStartWith /open`、`domainVerify: true`，AGC 后台认证同域。
- 验证：鸿蒙真机同 P0/P1。

---

## 4. 文件改动总览

| 文件 | 动作 | 阶段 |
|---|---|---|
| `manifest.json` | `app-android.distribute.urlSchemes = ["nuwax"]` | P0 |
| `manifest.json`（HBuilderX 视图） | iOS URL Types 新增 `nuwax` scheme；确认 `applinks:link.nuwax.com` | P0 |
| `utils/pendingDeepLink.uts` | **新建**（仿 `pendingOpenUiAction.uts`） | P0 |
| `utils/deepLinkRouter.uts` | **新建**（parse + 分流 + navigate） | P0 |
| `App.uvue` | `onLaunch` 捕获→落盘；`onShow` 捕获+消费跳转 | P0 |
| `login.uvue` / `login-form.uvue` / `login-weixin.uvue` | 登录成功 `redirectTo` 后调 `resumeDeepLinkAfterLogin()`（APP 条件编译） | P0（评审修复） |
| `harmony-configs/entry/src/main/module.json5` | **新建** skills `nuwax` | P0/P2 |
| 原生 `AndroidManifest.xml`（intent-filter autoVerify） | App Links | P1 |
| `link.nuwax.com` AASA / assetlinks / 落地页 | 运维/后端 | P1 |
| `docs/app-deeplink-integration.md` | 把「支付回跳现有逻辑」措辞改为「支付线后续接入，router 仅放行」（校正 1） | P0 文档 |

---

## 5. 实现顺序（建议 PR 拆分）

1. **PR-1（P0 业务代码）**：`pendingDeepLink.uts` + `deepLinkRouter.uts` + `App.uvue` 接入。可用单测/日志验证 parse 正确性，不依赖基座。
2. **PR-2（P0 配置+基座）**：`manifest.json` urlSchemes + iOS scheme + 重打基座 + 真机联调用例 1-5。
3. **PR-3（P1）**：HTTPS UL/App Links（原生 manifest + AASA/assetlinks 部署 + 落地页）。
4. **PR-4（P2）**：鸿蒙。

---

**参考文档**
- 设计/决策方案：[app-deeplink-integration.md](./app-deeplink-integration.md)
- 支付（同域复用）：[app-native-pay-integration.md](./app-native-pay-integration.md)、[app-webview-pay-client-integration.md](./app-webview-pay-client-integration.md)
- DCloud：[manifest-android](https://doc.dcloud.net.cn/uni-app-x/collocation/manifest-android.html) · [manifest-ios](https://doc.dcloud.net.cn/uni-app-x/collocation/manifest-ios.html) · [launch API](https://doc.dcloud.net.cn/uni-app-x/api/launch.html) · [合规](https://doc.dcloud.net.cn/uni-app-x/tutorial/compliance.html)

---

## 修订记录

### 2026-08-14：PR-2 Android 真机联调结果

**环境**：Redmi 24094RAD4C（8PNNT4TKHIJVU8RO），本地 5.23 离线 SDK 自定义基座（`make app-resource` + `make base-android`）。

**已验证 ✅**

| 项 | 结果 |
|---|---|
| `manifest.json` `app-android.distribute.urlSchemes:["nuwax"]` | 工具链接受并写入生成资源 manifest |
| 基座 APK scheme 注册 | uniappx 模块清单含 `<data android:scheme="nuwax">`（DEFAULT+BROWSABLE），经 configure_app.py 的 `hellouniappx→nuwax` 硬编码改名 + 清单合并进 APK |
| **冷启动深链全链路** | `am start -d "nuwax://open/agent?id=4042"` → onLaunch 捕获（`appScheme=nuwax://open/agent?id=4042`）→ pending 落盘 → onShow 消费 → **进入 agent-detail(4042)**（截图确认「智能机器人」详情页）|
| 幂等 | 冷启动后 resume 的 `getEnterOptionsSync` 回空，不重复捕获/跳转；onShow 重读同 URL 被去重 |
| `getLaunchOptionsSync`/`getEnterOptionsSync` 在 5.23 基座 | **可用**（try/catch 兜底从未触发）|
| 支付分流 | `/wechat`、`pay.nuwax.com` 显式忽略逻辑在 extractBusinessUrl（未真机触发，链路无干扰）|

**已知限制 ⚠️**

1. **热启动新深链在 5.23 基座不生效**：App 已在运行时再发 VIEW intent，系统把 intent 投给 `UniLaunchProxyActivity`（`am start` WaitTime≈40ms，仅 resume），但 5.23 运行时**不把新 intent 写入 enter options**（onShow 读到空）。5.24 文档明确 `getEnterOptionsSync` 返回「本次启动时」的值 → **升级 5.24 基座后预期自愈**；若不自愈，再试 `App.onShow(options)` 参数路径。
2. **HX 5.24（编译器） vs 基座/SDK 5.23 版本错配**：`cli launch --playground custom` 热推被拒（「请重新制作自定义调试基座后运行」）；S3 最新基座与离线 SDK 均为 5.23（无 5.24）。**需维护者发布 5.24 SDK/基座，或本机降级 HX 到 5.23**。当前验证用「改业务代码 → 重打本地基座 → adb install」绕过（每次约 5 分钟）。
3. **调试基座优先加载外部存储的旧资源（大坑）**：基座运行时优先读 `/storage/emulated/0/Android/data/com.nuwax.app/apps/__UNI__8BF05E4/www/`（HX 上次热推的副本），**覆盖 APK 内嵌资源**。本机该目录停在 8-13 的旧代码，导致新基座装上后仍跑旧逻辑（现象：日志行号对不上、新日志全无）。**排查法**：看 readfileutil 日志确认实际加载路径；**修复**：把外部目录改名/删除让基座回退 APK 内嵌资源。判断运行的是哪份代码：console 栈行号 vs 源文件、grep `[DeepLink]` 标记。
4. 未登录 pending 流（登录后进目标页）：需真机短信登录，留作人工用例。

**iOS（待办）**：scheme 注册走 HBuilderX 可视化（manifest.json 源码无字段），需在 HX「App iOS 配置 → URL Types」加 `nuwax` 后重出 iOS 基座（真机另需证书）。

### 2026-08-14：代码评审修复（PR-1 复盘）

对 `utils/deepLinkRouter.uts` / `utils/pendingDeepLink.uts` / `App.uvue` 做评审后，落地以下修复（均为纯业务 uts/uvue 改动，**不需重打基座**，HX 热推即可验）：

| # | 级别 | 问题 | 修复 |
|---|---|---|---|
| 1 | 高 | 登录成功未必再触发 `App.onShow`（前台 `reLaunch` 落地），pending 可能永不消费 | 新增 `resumeDeepLinkAfterLogin()`，在三条登录成功路径 `redirectTo` 后显式调用（APP 条件编译）。详见校正项 6 |
| 2 | 高 | `lastHandledUrl` 永久去重 → 同进程内同一深链**永远无法二次唤起** | 改为 `lastHandledUrl + lastHandledAt` **短时窗口去重**（`DEDUP_WINDOW_MS=3000`）：只挡冷启动 `onLaunch+onShow` 双触发 / resume 回吐旧值，窗口外允许再次唤起 |
| 3 | 中 | HTTPS host 用 `indexOf` 子串匹配 → `https://evil.com/link.nuwax.com/open/...` 可绕过 | 抽 `extractHttpsHost()` 做 **host 精确等于** `link.nuwax.com`，再按 path `/open`（业务）`/wechat`（支付忽略）分流 |
| 4 | 中 | `appLink.length>0` 提前返回：出现无关 appLink 时会吞掉有效 appScheme | 拆 `extractFromHttpsLink` / `extractFromScheme`，appLink 非业务时**回退**再看 appScheme |
| 5 | 低 | query 值未 `decodeURIComponent` | `parseQuery` 值统一 `decodeUri()`（try/catch 保底原值） |

**仍未做（有意保留）**

- **热启动新深链在 5.23 基座不生效**（已知平台限制，见上「已知限制 1」）：等 5.24 SDK/基座。短时窗口去重不影响该结论。
- **单测**：`extractBusinessUrl` / `parseDeepLink` 是纯函数，已具备可测性；单测用例（含混淆 host、encode query、fallthrough）待补 `pages/test-*` 或独立测试位。
- **`navigateDeepLink` 仍复用 `jumpToAgentDetailPage`**（保留未来 agentType 分支能力），未内联 `navigateTo` 的 fail 回调；深链目前只 `/open/agent`（ChatBot），失败概率低，暂不加。
