# App 外部唤起 / 深链接入方案（Android · iOS · HarmonyOS）

> **状态**：方案已锁定，可按本文实施。  
> **关联**：支付侧通用链接域名与 AASA 部署见 [app-native-pay-integration.md](./app-native-pay-integration.md)；WebView 支付回跳 Scheme 见 [app-webview-pay-client-integration.md](./app-webview-pay-client-integration.md)。

## 1. 目标

外部（浏览器、短信、二维码、其他 App、Web `shareLink`）能打开 Nuwax App，并直达业务页；未安装时落到 H5（`/m/`）或应用商店。

首批业务直达：**智能体详情 / 会话**（对齐现有 `jumpToAgentDetailPage`）。

## 2. 已锁定决策

| 项 | 决定 |
|---|---|
| HTTPS 通用链接域名 | **`link.nuwax.com`**（与支付文档一致，不另开域名） |
| 业务深链 path | **`/open/*`**（支付占用 `/wechat/*`，互不抢） |
| 业务自定义 Scheme | **`nuwax`** → `nuwax://...` |
| 支付回跳 Scheme | **`pay.nuwax.com`**（仅支付，见 WebView 支付文档；**禁止**当业务深链） |
| 应用标识 | Android `com.nuwax.app` / iOS `com.nuwax.app` / 鸿蒙 `com.nuwax.app` |
| 对外主推形态 | HTTPS（`https://link.nuwax.com/open/...`）；Scheme 作已装 App / 落地页兜底 |
| 未安装策略 | 落地页继续 H5（`agent.nuwax.com/m/...` 或对应环境），并引导商店 |
| 登录打断 | 未登录先暂存 `pendingDeepLink`，登录成功后再消费（对齐 `pendingOpenUiAction`） |

## 3. URI 约定

### 3.1 业务深链（本次）

```text
# HTTPS（对外主推）
https://link.nuwax.com/open/agent?id={agentId}
https://link.nuwax.com/open/agent?id={agentId}&conversationId={conversationId}

# Scheme（App↔App / 落地页二次跳）
nuwax://open/agent?id={agentId}
nuwax://open/agent?id={agentId}&conversationId={conversationId}
```

### 3.2 App 内路由映射

| Deep link | 目标页 |
|---|---|
| `/open/agent?id=&conversationId=` | `/subpackages/pages/agent-detail/agent-detail?id=&conversationId=` |

后续扩展在 `/open/{action}` 下追加，避免改 Scheme / 域名。

### 3.3 兼容现有 shareLink（不强制改后端）

现有形态示例：`https://agent.nuwax.com/agent/4042`、`https://testagent.xspaceagi.com/agent/4042`。

处理方式：Web / 落地页识别 `/agent/{id}` → 尝试打开

`https://link.nuwax.com/open/agent?id={id}`（或 `nuwax://open/agent?id=`）→ 失败则进 H5 `/m/`。

### 3.4 与支付路径分流（勿混用）

| 用途 | 形态 |
|---|---|
| 微信 OpenSDK / 支付 UL | `https://link.nuwax.com/wechat/...` |
| 业务唤起 | `https://link.nuwax.com/open/...` 或 `nuwax://open/...` |
| iOS 支付完成回 App | `pay.nuwax.com://...` |

App 解析时：先按 scheme / path 分流；`/wechat`、`pay.nuwax.com` 走支付逻辑，`/open`、`nuwax://` 走业务路由。

## 4. 三端配置

### 4.1 共用：域名侧（运维 / 后端一次部署）

在 `link.nuwax.com` 部署（要求：**公网 HTTPS、直接 HTTP 200、禁止重定向**）：

1. **AASA（iOS）**  
   `https://link.nuwax.com/.well-known/apple-app-site-association`  
   - `appID`：`{TeamID}.com.nuwax.app`  
   - `paths` 至少包含：`/wechat/*`、`/open/*`

2. **Digital Asset Links（Android）**  
   `https://link.nuwax.com/.well-known/assetlinks.json`  
   - `package_name`：`com.nuwax.app`  
   - `sha256_cert_fingerprints`：正式签名证书指纹（可含调试证书便于联调）

3. **落地页（可选但推荐）**  
   `https://link.nuwax.com/open/...`：已装由系统直开 App；未装展示引导 + 跳转 H5/商店。

> 支付文档中「创建并解析 link.nuwax.com / 部署 AASA」与本方案共用同一套；落地时 **AASA 需同时覆盖 `/wechat/*` 与 `/open/*`**。

### 4.2 Android

- `manifest` / 打包配置声明：
  - Custom Scheme：`nuwax`
  - App Links：`https` + host `link.nuwax.com` + pathPrefix `/open`
- 包名：`com.nuwax.app`（已有）
- 参数读取：`App.onShow` / `uni.getEnterOptionsSync()` 的 `appScheme`、`appLink`（热启动勿只靠 `onLaunch`）

### 4.3 iOS

- URL Types：新增 Scheme **`nuwax`**（与支付用的 `pay.nuwax.com` **并存**）
- Associated Domains：`applinks:link.nuwax.com`（支付文档已要求；业务复用）
- 出站白名单 `urlschemewhitelist`（微信/支付宝）保持不变，与入站 Scheme 无关
- 参数读取：同 Android，以 `onShow` 为主

### 4.4 HarmonyOS

- **P0**：Deep Linking（自定义 scheme `nuwax`），经 `harmony-configs/entry/src/main/module.json5` 的 skills 配置覆盖产物
- **P1**（基座成熟后）：App Linking，host `link.nuwax.com`，`pathStartWith` `/open`，`domainVerify: true`，AGC 后台认证同域
- 参数读取：`getEnterOptionsSync` / `onShow`（对齐 uni-app x 当前 HX 版本能力）

## 5. App 内处理流程

```text
外部打开 URL
  → App.onShow / getEnterOptionsSync
  → 取 appScheme | appLink（空则忽略）
  → 分流：
       /wechat 或 pay.nuwax.com → 支付回跳（现有逻辑）
       /open 或 nuwax://open → 业务深链
  → parse → DeepLinkAction（校验 action、必填参数）
  → 幂等：同一完整 URL 短时（如 3s）不重复跳转
  → 登录态？
       否 → savePendingDeepLink → 登录页
            （登录成功 / token 就绪后 consumePendingDeepLink）
       是 → navigate 到 agent-detail（复用 jumpToAgentDetailPage）
```

### 5.1 与现有冷启动登录的冲突

`App.uvue` 中 Android 冷启动未登录会 `reLaunch` 登录页。  
**必须先落盘 pending，再 reLaunch**，否则深链参数丢失。

建议实现：

- `utils/pendingDeepLink.uts`：storage + TTL（建议 10min，对齐 `pendingOpenUiAction`）
- `utils/deepLinkRouter.uts`：parse + 分流 + navigate
- `App.uvue`：`onLaunch` / `onShow` 统一入口调用 router

### 5.2 不在本文范围

- 微信/支付宝 **出站** 唤起（支付文档已覆盖）
- OpenUI / MCP Ask 等应用内能力（与系统深链无关）

## 6. Web / 落地页职责

| 场景 | 行为 |
|---|---|
| 用户打开 `https://link.nuwax.com/open/agent?...` | 已装：系统 UL/App Links 进 App；未装：本页引导 → H5 或商店 |
| 用户打开 `https://{apiHost}/agent/{id}` | 可选：跳转或 iframe 尝试 `link.nuwax.com/open/agent?id=`；失败保留 Web |
| 其他 App 调起 | 优先 `nuwax://open/...`；需可探测时再 fallback HTTPS |

环境：

- 生产 API / H5：`https://agent.nuwax.com`（H5 base `/m/`）
- 测试：`https://testagent.xspaceagi.com`
- 深链 HTTPS **固定**走 `link.nuwax.com`（不随 API host 变），避免多环境重复配 UL

## 7. 分期落地

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0** | 域名 + AASA（含 `/open/*`）+ assetlinks；manifest 配 `nuwax` + iOS Associated Domains；`pendingDeepLink` + `onShow` 解析；Android/iOS 真机 `nuwax://open/agent?id=` | 已装冷/热启动进会话页；未登录登录后仍进目标页 |
| **P1** | App Links / Universal Links 真机；落地页；shareLink 兼容跳转 | 点 `https://link.nuwax.com/open/agent?...` 直达 App |
| **P2** | 鸿蒙 Deep Linking → App Linking；更多 `/open/{action}` | 鸿蒙真机同 P0/P1 |

## 8. 实现清单（开发）

```
□ docs：本文为权威方案（本文）
□ 运维：link.nuwax.com DNS + HTTPS
□ 运维：AASA（/wechat/* + /open/*）+ assetlinks.json
□ manifest：Android/iOS schemes=nuwax；iOS Associated Domains
□ harmony-configs：skills 声明 nuwax（P0）
□ utils/pendingDeepLink.uts
□ utils/deepLinkRouter.uts（parse + 分流 + navigate）
□ App.uvue：onLaunch/onShow 接入；未登录先 pending 再 reLaunch
□ 登录成功路径：consumePendingDeepLink
□ （可选）link.nuwax.com/open 落地页
□ （可选）Web shareLink 页尝试唤起
□ 真机：Android / iOS Scheme 冷热启动；再验 UL
□ 真机：与支付回跳互不干扰（/wechat vs /open）
```

## 9. 联调用例

| # | 操作 | 通过标准 |
|---|---|---|
| 1 | 已登录，Safari/Chrome 打开 `nuwax://open/agent?id={有效 id}` | 进入对应 agent-detail |
| 2 | 已登录，后台再点同一链接 | 热启动仍进入目标页，不重复堆栈异常 |
| 3 | 未登录点链接 → 登录成功 | 进入原深链目标，而非仅停在首页 |
| 4 | 打开 `https://link.nuwax.com/open/agent?id=`（P1） | 已装进 App；未装见落地/H5 |
| 5 | 支付回跳 / 微信 UL 路径 | 行为与支付文档一致，不被业务 router 误吃 |

## 10. 明确不做 / 延后

- 不为业务深链新增第二套 HTTPS 域名  
- 不用 `pay.nuwax.com` 承载业务 path  
- 桌搭产品线暂不单独 `zhuoda://`（若未来需要，再评估多 scheme，默认仍 `nuwax`）  
- 鸿蒙 App Linking 不阻塞 Android/iOS P0  

---

**修订记录**

- 2026-08-14：综合支付文档中的 `link.nuwax.com` / AASA 约定，锁定业务 Scheme `nuwax` + path `/open/*`，形成可实施总方案。
