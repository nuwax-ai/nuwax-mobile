# App 原生支付接入说明（Android / iOS / HarmonyOS）

> 新方案入口：`POST /api/bill/order/pay/app-native`。旧的 `/pay/h5-web` WebView 跳转方案不再用于原生 App。

## 已接入的前端流程

1. App 创建订阅或积分订单时使用 `payMode=app`。
2. 用户选择微信或支付宝后，请求 `/api/bill/order/pay/app-native`。
3. 微信：从 `weixin://dl/business/...` 的 `query=` 参数中提取 Base64 原文，通过原生桥拉起固定小程序：
   - `userName`: `gh_cd6acad9a40d`
   - `path`: `ipay/main?{query原文}`
   - `miniprogramType`: `0`
4. 支付宝：通过原生桥打开后端返回的 `redirectUrl`。
5. 无论客户端回调内容是什么，业务结果均以 `/api/bill/order/settlement-status` 为准；当前每 2 秒轮询一次，最多 60 次。

代码入口：

- `subpackages/utils/paymentUtils.uts`
- `subpackages/servers/subscription.uts`
- `subpackages/types/interfaces/subscription.uts`

## 原生桥契约

Android、iOS、HarmonyOS 宿主需实现 `AppNativePayBridge`，并在支付前调用 `registerAppNativePayBridge` 注入：

```ts
interface AppNativePayBridge {
  launchAnxinfuMiniProgram(options: UTSJSONObject): Promise<any>;
  openPayUrl(url: string): Promise<any>;
}
```

`launchAnxinfuMiniProgram` 必须使用微信 OpenSDK 的 `WXLaunchMiniProgram` 能力，不能把 `weixin://dl/business` 当普通 URL 打开，也不能调用 `uni.requestPayment`。

## 各端原生要求

| 平台 | 微信 | 支付宝 |
|---|---|---|
| Android | `WXLaunchMiniProgram.Req` / `wx.miniapp.launchMiniProgram` | 系统打开 `redirectUrl` |
| iOS | `WXLaunchMiniProgramReq`，并配置 Universal Links | 系统打开 `redirectUrl` |
| HarmonyOS | `@tencent/wechat_open_sdk` 的拉起小程序能力 | 系统打开 `redirectUrl` |

## Android 已实现

- 移动应用 AppID：`wxbdaaa9ecab166aee`。
- UTS 插件：`uni_modules/nuwax-android-native-pay`，在 `libs` 中携带 `wechat-sdk-android-6.8.34.aar`，供本地编译和云端打包使用。
- 微信：注册 OpenSDK 后使用 `WXLaunchMiniProgram.Req` 拉起安心付小程序，不使用微信官方 App 支付 `PayReq`。
- 支付宝：使用 Android `ACTION_VIEW` Intent 打开服务端返回的收银台 URL。
- `App.uvue` 启动时注册 Android `AppNativePayBridge`；支付完成后沿用服务端结算状态轮询。

插件包含 Android 三方依赖，必须使用自定义基座或云端打包进行编译、安装和真机验证；标准基座不携带微信 OpenSDK。

三端都需要在微信开放平台登记“移动应用”。这里所需的移动应用 AppID 不是支付小程序 AppID `wx98a5c8f239de55f8`。

## 待提供的打包配置

- 微信开放平台移动应用 AppID。
- iOS Universal Links：`https://link.nuwax.com/wechat/`。
- iOS Associated Domains：`applinks:link.nuwax.com`。
- AASA 文件：`https://link.nuwax.com/.well-known/apple-app-site-association`（公网 HTTPS、直接返回 200、不可重定向）。
- Android 包名与签名、iOS Bundle ID、HarmonyOS bundleName 已在微信开放平台登记并审核通过。
- manifest 中启用对应微信 OpenSDK 模块。

> **同域复用**：`link.nuwax.com` 同时承载业务外部唤起（`/open/*`）。AASA / assetlinks 部署时须一并覆盖业务 path。权威说明见 [app-deeplink-integration.md](./app-deeplink-integration.md)。

真实资质数据不应写入公开文档；建议通过私有打包配置注入。

## TODO：原生支付上线前确认

- [ ] 创建并解析 `link.nuwax.com`，确认公网 HTTPS 可访问。
- [ ] 部署 `https://link.nuwax.com/.well-known/apple-app-site-association`，确认直接返回 HTTP 200 且没有重定向。
- [ ] 确认 AASA 使用真实的 Apple Team ID 和 iOS Bundle ID，并覆盖 `/wechat/*` 与 `/open/*`（业务深链，见 deeplink 文档）。
- [x] 配置 Android 微信开放平台移动应用 AppID：`wxbdaaa9ecab166aee`。
- [ ] 确认 Android 包名与签名、iOS Bundle ID 与 Universal Links、HarmonyOS bundleName 均已登记并审核通过。
- [ ] 将真实 AppID 和 Universal Links 写入私有打包配置及 `manifest.json`。
- [x] 实现并注册 Android `AppNativePayBridge`。
- [ ] 实现并注册 iOS、HarmonyOS 的 `AppNativePayBridge`。
- [ ] 使用三端真机分别验证微信支付、支付宝支付、取消支付和支付完成后的结算轮询。
