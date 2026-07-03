# APP 客户端 WebView 支付接入指南

> **面向**：APP 原生客户端研发  
> **前提**：登录已打通，H5 订阅页已在 WebView 内正常打开  
> **背景说明**：见 [app-webview-pay-integration.md](./app-webview-pay-integration.md)

本文档只讲 **客户端应该如何改**，按接入顺序执行即可。

---

## 一、接入原则（请先读）

1. **我方 H5 不会调原生支付 SDK**，也不会自己拼 `weixin://` URL  
2. H5 只会做两件事：`location.href` 跳转，或 `form.submit()` 提交表单  
3. **客户端职责**：让上述跳转链路畅通，并在末端 scheme 出现时交给系统打开  
4. **支付结果由 H5 轮询**（读回跳 URL 的 `h5OrderId`，或 `visibilitychange`/`pageshow` 触发），客户端无需实现「支付成功/失败」的业务回调  
5. **但 iOS「支付完回到 APP」需要客户端额外处理**（见步骤 5），这是安心付网关的已知限制，与支付结果判定无关

---

## 二、接入步骤

### 步骤 1：确认 WebView 基础能力

在加载我方 H5 的 WebView 上确认：

| 配置项 | 要求 |
|--------|------|
| JavaScript | 已开启 |
| Cookie | 可用（登录态依赖） |
| localStorage | 可用（支付中状态依赖） |
| 混合内容 / HTTPS | 不拦截我方业务域名 |

---

### 步骤 2：实现 URL 跳转拦截（核心）

在 WebView 的 **每一次导航/重定向** 拦截点处理 URL，不要只在 `onPageStarted` 做一次判断。

#### Android（WebViewClient）

拦截位置：`shouldOverrideUrlLoading(WebView, WebResourceRequest)`

处理规则：

```
1. URL 以 weixin:// / weixinwap:// / alipays:// / alipay:// 开头
   → Intent.ACTION_VIEW 打开，return true（WebView 不再加载）

2. 其他 http(s) URL
   → return false，走 WebView 默认加载（含 form 提交后的 302）

3. 打开失败（未安装 App）
   → Toast 提示，return true
```

参考代码：

```java
@Override
public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
    String url = request.getUrl().toString();
    if (isPayScheme(url)) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            startActivity(intent);
        } catch (Exception e) {
            Toast.makeText(context, "请先安装微信或支付宝", Toast.LENGTH_SHORT).show();
        }
        return true;
    }
    return false;
}

private boolean isPayScheme(String url) {
    return url.startsWith("weixin://")
        || url.startsWith("weixinwap://")
        || url.startsWith("alipays://")
        || url.startsWith("alipay://");
}
```

> 注意：部分机型 form 提交走 POST + 302，scheme 出现在 **重定向链** 中，`shouldOverrideUrlLoading` 必须能接到每一次重定向后的 URL。

#### iOS（WKWebView）

拦截位置：`webView(_:decidePolicyFor:decisionHandler:)`

处理规则与 Android 一致：scheme → `UIApplication.shared.open` + `cancel`，其余 → `allow`。

参考代码：

```swift
func webView(_ webView: WKWebView,
             decidePolicyFor navigationAction: WKNavigationAction,
             decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = navigationAction.request.url else {
        decisionHandler(.allow)
        return
    }
    let scheme = url.scheme?.lowercased() ?? ""
    if ["weixin", "weixinwap", "alipays", "alipay"].contains(scheme) {
        if UIApplication.shared.canOpenURL(url) {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        } else {
            // Toast：请先安装微信或支付宝
        }
        decisionHandler(.cancel)
        return
    }
    decisionHandler(.allow)
}
```

**Info.plist 必配** `LSApplicationQueriesSchemes`：

```xml
<key>LSApplicationQueriesSchemes</key>
<array>
    <string>weixin</string>
    <string>weixinwap</string>
    <string>alipays</string>
    <string>alipay</string>
</array>
```

> **跳转链路细节（重要）**：从 form 提交到唤起微信/支付宝，WebView 会经历 **多次重定向**（网关收银台页 → 中间「清单」链接 → 末端 scheme）。微信 H5 支付真正的唤起链接是 `weixin://wap/pay?...`（不是裸 `weixin://`），支付宝为 `alipays://`。请确保：
> - `shouldOverrideUrlLoading` / `decidePolicyFor` 在**每一次**导航都能触发，不要只拦一次
> - scheme 判断用**前缀匹配**（`weixin://` 前缀已覆盖 `weixin://wap/pay?`），不要精确匹配
> - 中间的 https 收银台链接一律 `return false` / `.allow` 放行，**只**在末端 scheme 时外跳

---

### 步骤 3：不要拦截 H5 发起的支付跳转

以下行为 **必须放行**，不要在业务层白名单里拦掉：

| H5 行为 | 客户端处理 |
|---------|------------|
| `window.location.href = redirectUrl` | 允许 WebView 导航；若 redirectUrl 是 scheme，走步骤 2 |
| `form.submit()` 到支付网关 | 允许 POST 及后续 302 重定向 |
| 收银台 HTTPS 页面 | 建议 WebView 内打开（或按贵方安全策略外跳系统浏览器，需提前沟通） |

**不要做**：

- 全局拦截所有非业务域名跳转
- 拦截 `form.submit()` 触发的 POST 请求
- 在支付外跳时 `finish()` Activity / pop 掉 WebView 页面

> **第三方网关域名必须放行（最常见失败点）**：当前支付走 **安心付** 网关，表单会 POST 到 `insurance.axinfu.com`，收银台/回调还可能涉及其它 `*.axinfu.com` 域名。若客户端有「仅放行业务域名（santisaas / nuwax）」的白名单策略，**务必把 `*.axinfu.com` 一并放行**。否则 POST 被拦 → 收银台打不开 → 微信/支付宝永远唤不起（典型现象：点支付后页面停在「pay redirect」或白屏）。

---

### 步骤 4：支付返回后保持 WebView 存活

用户切到微信/支付宝再返回 APP 时：

| 要做 | 不要做 |
|------|--------|
| 保持 WebView 实例和当前 URL | 销毁 WebView |
| 保持 JS 可执行 | 强制 `reload()` 整页 |
| 保持 Cookie / localStorage | 清空 Web Storage |

我方 H5 会在 `visibilitychange` / `pageshow` 时自动轮询订单状态，**无需客户端回调支付结果**。

---

### 步骤 5：iOS 支付完成自动返回原 APP（安心付网关特有）

> 安心付网关官方已声明：**iOS 客户端支付完成时无法自动跳转回 APP**，不额外处理的话用户支付完会落到 Safari 而非你们的 APP。以下「三件套」由 **iOS 客户端** 完成（H5 无法实现），方案来自网关官方推荐：[iOS WKWebView 实现 H5 跳转微信支付并返回原 APP](https://www.jianshu.com/p/28483a16c4d5)。

**前提**：向开通微信支付的同学要到 **H5 微信支付授权域名**（形如 `pay.nuwax.com`；二级域名前缀可自定义）。

1. **配置 URL Scheme**：`Info.plist → URL Types` 新增一项，Scheme 填上面的授权域名（如 `pay.nuwax.com`）。

2. **改写 `redirect_url`**：在 `decidePolicyFor` 中拦截收银台链路里**带 `redirect_url` 参数的「清单」链接**（它出现在 `weixin://wap/pay?` 之前），把 `redirect_url` 改写成 `pay.nuwax.com://原returnUrl`，使其与上一步的 Scheme 一致。改写后用 `load(_:)` 重新加载，并加标记避免重复改写。

3. **设置 Referer**：给 WebView 请求头加 `Referer: pay.nuwax.com://`（微信支付结束默认回调 Referer 地址，从而回到 APP）。

4. **接收回调**：在 `AppDelegate` 的 `application(_:open:options:)` 里匹配该 Scheme，发通知触发当前 WebView 刷新 / 重新轮询。

> 兜底：若暂不实现三件套，iOS 上需依赖用户**手动**点微信左上角返回原 APP，再由 H5 的 `visibilitychange`/`pageshow` 拉起轮询（要求步骤 4 的 WebView 存活）。体验较差，建议按上面实现自动返回。
>
> Android 一般无需额外处理，系统会自动回到 APP；如遇个别机型不返回，参考同样的 URL Scheme 思路。

### 步骤 6：联调验收

Android、iOS 各至少一台真机，按序执行：

| # | 操作 | 通过标准 |
|---|------|----------|
| 1 | 打开「我的订阅」 | 页面正常，已登录 |
| 2 | 点击套餐 → 微信支付 | **有外跳**，唤起微信 App |
| 3 | 支付完成，返回 APP | 回到原 WebView，显示支付成功或处理中 |
| 4 | 点击套餐 → 支付宝 | **有外跳**，唤起支付宝 App |
| 5 | 取消支付，返回 APP | 回到原 WebView，显示取消或失败（非瞬间报错） |

**关键判断**：
- 若点支付后**完全没有外跳、页面停在「pay redirect」或白屏** → 客户端拦截问题（多半是网关域名 `*.axinfu.com` 没放行，或 form POST / scheme 被拦）。
- 若**弹了 H5 的「支付失败」Toast** → 通常是接口 / 网络 / 登录态问题，**不是**客户端拦截（拦截不会产生这个 Toast）；看 Console 和 `/pay/h5-web` 响应的 `code` / `message`。

---

## 三、客户端改造清单

```
□ WebView 开启 JavaScript / Cookie / localStorage
□ Android：shouldOverrideUrlLoading 处理支付 scheme
□ iOS：decidePolicyFor 处理支付 scheme
□ iOS：Info.plist 配置 LSApplicationQueriesSchemes
□ 放行 location.href 跳转（含 https 和 scheme）
□ 放行 form.submit 及 302 重定向链
□ 放行第三方网关域名 `*.axinfu.com`（不要只白名单业务域名）
□ scheme 拦截用前缀匹配、认 `weixin://wap/pay?`，链路每次重定向都拦
□ 支付外跳后不销毁 WebView、不强制 reload
□ 未安装微信/支付宝时有 Toast 提示
□ iOS：实现支付完成自动返回原 APP（URL Scheme + redirect_url 改写 + Referer）
□ Android + iOS 真机各完成联调验收 5 项
```

---

## 四、常见问题（客户端自查）

| 现象 | 客户端侧排查 |
|------|--------------|
| 点支付后无外跳，页面停在「pay redirect」/白屏 | 第三方网关域名 `*.axinfu.com` 被域名白名单拦截（**最常见**）；抓包看 form POST 到 `insurance.axinfu.com` 是否真的发出 |
| 有收银台页但进不了微信/支付宝 | scheme 没被拦截外跳，或被当普通 URL 在 WebView 内加载；确认拦截逻辑认 `weixin://wap/pay?` |
| iOS 完全唤不起微信 | 检查 `LSApplicationQueriesSchemes` 是否含 `weixin` |
| iOS 支付完回到 Safari 而非 APP | 未实现步骤 5 的自动返回三件套（安心付网关已知限制） |
| 弹「支付失败」Toast（H5 文案） | 多为接口 / 网络 / 登录态问题，**非**客户端拦截；看 Console 与 `/pay/h5-web` 响应的 `code` / `message` |
| 支付成功但 H5 显示失败 | 返回后 WebView 被销毁或 reload、Cookie 丢失，H5 轮询未拉起 |

---

## 五、联调失败请提供

请抓取并发我方：

1. 被拦截或失败的 **完整 URL**（含 scheme）
2. WebView **Console 报错**截图
3. 支付接口响应（如能抓包）：`invokeType`、`redirectUrl`
4. 机型 + 系统版本 + WebView 内核（系统 WebView / X5 等）

---

## 六、相关文档

- [APP WebView 支付接入说明](./app-webview-pay-integration.md) — H5 支付流程与背景说明
- [安心付 · 网页跳转支付 /gateway_web](https://s.apifox.cn/ba15f216-093d-4f4e-8e1d-1b162bda4ff5/doc-3296425) — 安心付网关接口文档（外部链接）
- [iOS WKWebView 实现 H5 跳转微信支付并返回原 APP](https://www.jianshu.com/p/28483a16c4d5) — 安心付网关官方推荐的 iOS 返回原 APP 方案（外部链接）
