# APP WebView 支付接入说明

> 面向：APP 客户端研发同学  
> 场景：在 APP 内置 WebView 中打开我方 H5「我的订阅」并完成支付  
> 前提：**登录已打通**，本次仅需处理 WebView 支付外跳能力  
> **客户端接入实操**：见 [app-webview-pay-client-integration.md](./app-webview-pay-client-integration.md)

---

## 一、背景

我方订阅支付在 **H5 页面** 发起，流程为：

1. 用户点击「订阅套餐」
2. H5 创建订单，调用 `POST /api/bill/order/pay/h5-web`
3. 根据后端返回的 `invokeType`，H5 执行对应跳转（见下节）
4. 用户支付完成或取消后返回 WebView，H5 **自动轮询** 订单状态并提示结果

当前 **不走 APP 原生支付 SDK**，完全依赖 WebView 能否正确处理支付跳转链路。

### H5 侧实际支持的唤起方式

我方 H5 **没有** 单独的 scheme 唤起逻辑（前端代码中不存在 `weixin://`、`alipay://` 等拼接或 `invokeType === "SCHEME"` 分支），仅支持后端返回的三种 `invokeType`：

| invokeType | H5 行为 |
|------------|---------|
| `REDIRECT_URL` | `window.location.href = redirectUrl` |
| `FORM_HTML` | 插入表单并 `form.submit()` |
| `QRCODE_FALLBACK` | 展示支付二维码（移动端较少触发） |

**scheme 如何出现**：上述跳转后，由支付网关或后端返回的 `redirectUrl` **间接** 产生，例如：

- `REDIRECT_URL` 的 `redirectUrl` 本身可能是 `weixin://...` / `alipays://...`
- `FORM_HTML` 提交后，支付网关通过 **302 重定向** 跳转到 scheme

因此 scheme 唤起依赖 **WebView 对跳转链路的放行**，而非 H5 JS 主动调原生。

---

## 二、客户端必做修改

### 1. 放行支付 scheme 外跳（跳转链路末端可能出现）

支付流程的 **末端** 可能落到以下 scheme，需在 WebView 跳转拦截处识别并 **交给系统打开**（不要在 WebView 内加载）：

| Scheme | 用途 |
|--------|------|
| `weixin://` | 微信支付 |
| `weixinwap://` | 微信支付 |
| `alipays://` | 支付宝 |
| `alipay://` | 支付宝 |

- **Android**：`shouldOverrideUrlLoading` 中 `Intent.ACTION_VIEW` 打开
- **iOS**：`decidePolicyFor` 中 `UIApplication.open` 打开，并 `decisionHandler(.cancel)`

未安装对应 App 时，请 Toast 提示用户，避免静默失败。

### 2. 不拦截 H5 发起的支付跳转（必做）

H5 仅通过以下两种方式发起支付，请勿拦截：

- `REDIRECT_URL`：`window.location.href = redirectUrl`（redirectUrl 可能是 https 或 scheme）
- `FORM_HTML`：隐藏表单 `form.submit()` 及后续 **302 重定向**（重定向目标可能是收银台页或 scheme）

### 3. 支付返回后保留 WebView

用户从微信/支付宝返回后：

- **不要** 销毁 WebView 或 `finish` 当前页面
- 保持页面可继续执行 JavaScript（H5 会监听 `visibilitychange` 轮询支付结果）

### 4. 开启基础 Web 能力

- JavaScript 已开启
- Cookie、localStorage 可用（H5 用于登录态及支付中状态标识）

### 5. iOS 额外配置

在 `Info.plist` 的 `LSApplicationQueriesSchemes` 中添加：

```
weixin
weixinwap
alipays
alipay
```

---

## 三、联调验收

| 步骤 | 预期 |
|------|------|
| 打开「我的订阅」 | 页面正常（登录态有效） |
| 点击套餐 → 选微信支付 | 成功唤起微信 App |
| 支付完成/取消后返回 | 回到 WebView，页面显示支付结果（成功/失败/取消） |
| 选支付宝重复上述流程 | 成功唤起支付宝 App，返回后结果正常 |

**注意**：若选支付方式后 **未外跳** 即提示「支付失败」，多为 `REDIRECT_URL` / `form.submit` 或其后续 302、scheme 跳转被 WebView 拦截。

---

## 四、常见失败对照

| 现象 | 可能原因 |
|------|----------|
| 选支付后立即「支付失败」，无外跳 | `REDIRECT_URL` / `form.submit` / 302 / scheme 跳转被 WebView 拦截 |
| 能支付，返回后仍失败 | WebView 被销毁、Cookie 丢失、页面被强制重载 |
| iOS 无法唤起微信/支付宝 | 未配置 `LSApplicationQueriesSchemes` |

---

## 五、联调失败时请提供

便于我方排查，请提供以下信息（任选）：

- WebView 控制台 Console 报错
- 被拦截的外跳 URL（scheme 或完整链接）
- 接口 `POST /api/bill/order/pay/h5-web` 响应中的 `code`、`message`、`invokeType`、`redirectUrl`

---

## 六、相关文档

- [APP 客户端 WebView 支付接入指南](./app-webview-pay-client-integration.md) — **客户端研发按步骤接入、含 Android/iOS 示例代码**

---

## 七、修改清单（一页纸）

```
□ 不拦截 H5 的 REDIRECT_URL（location.href）和 FORM_HTML（form.submit）
□ 不拦截 form 提交后的 302 重定向链
□ 对跳转链路末端出现的 weixin:// / alipays:// / alipay:// 等 scheme，用系统打开
□ 支付外跳后不销毁 WebView
□ Cookie、localStorage、JavaScript 正常
□ iOS 配置 LSApplicationQueriesSchemes
□ 按「联调验收」完成 Android + iOS 各至少一台设备测试
```
