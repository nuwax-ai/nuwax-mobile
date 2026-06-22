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
4. **支付结果由 H5 轮询**，客户端无需实现支付回调 Bridge（当前版本）

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

### 步骤 5：联调验收

Android、iOS 各至少一台真机，按序执行：

| # | 操作 | 通过标准 |
|---|------|----------|
| 1 | 打开「我的订阅」 | 页面正常，已登录 |
| 2 | 点击套餐 → 微信支付 | **有外跳**，唤起微信 App |
| 3 | 支付完成，返回 APP | 回到原 WebView，显示支付成功或处理中 |
| 4 | 点击套餐 → 支付宝 | **有外跳**，唤起支付宝 App |
| 5 | 取消支付，返回 APP | 回到原 WebView，显示取消或失败（非瞬间报错） |

**关键判断**：步骤 2/4 若 **完全没有外跳** 就提示「支付失败」，100% 是客户端跳转拦截问题。

---

## 三、客户端改造清单

```
□ WebView 开启 JavaScript / Cookie / localStorage
□ Android：shouldOverrideUrlLoading 处理支付 scheme
□ iOS：decidePolicyFor 处理支付 scheme
□ iOS：Info.plist 配置 LSApplicationQueriesSchemes
□ 放行 location.href 跳转（含 https 和 scheme）
□ 放行 form.submit 及 302 重定向链
□ 支付外跳后不销毁 WebView、不强制 reload
□ 未安装微信/支付宝时有 Toast 提示
□ Android + iOS 真机各完成联调验收 5 项
```

---

## 四、常见问题（客户端自查）

| 现象 | 客户端侧排查 |
|------|--------------|
| 选支付后立刻「支付失败」，无外跳 | 检查 `shouldOverrideUrlLoading` / `decidePolicyFor` 是否拦了 https 跳转或 form 提交 |
| 有收银台页但进不了微信/支付宝 | 检查 scheme 是否被当普通 URL 在 WebView 内加载（应外跳系统） |
| iOS 完全唤不起微信 | 检查 `LSApplicationQueriesSchemes` |
| 支付成功但 H5 显示失败 | 检查返回后 WebView 是否被销毁或 reload，Cookie 是否丢失 |

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
