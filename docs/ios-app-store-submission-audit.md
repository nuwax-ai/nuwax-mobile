# iOS App Store 提审就绪审计

> 审计日期：2026-08-17
> 依据：DCloud 官方文档 [iOS 上架指南](https://uniapp.dcloud.net.cn/tutorial/ios-app-store.html)、[iOS 隐私清单](https://uniapp.dcloud.net.cn/tutorial/app-ios-privacyinfo.html)，对照本仓代码逐项核查。
> 结论：**存在 2 个代码侧阻断级合规缺口 + 1 个打包路线坑**，处理后其余为材料准备。配套清单见 [pre-release-checklist.md](./pre-release-checklist.md)。

## 总览

| 级别 | 项 | 审核条款 / 错误码 | 状态 |
|---|---|---|---|
| 🔴 阻断 | 积分/订阅在 iOS 走微信/支付宝 | 3.1.1 / 3.1.2（数字商品须 IAP） | 未处理 |
| 🔴 阻断 | 缺「删除账号」入口 | 5.1.1(v) | 未处理（需后端 API） |
| 🔴 阻断 | 离线打包隐私清单/Info.plist 为空 | ITMS-91053 / 权限崩溃 | 未处理（仅影响离线路线） |
| 🔴 阻断 | 中国区上架需 ICP 备案 | App Store 中国区政策 | 待确认备案状态 |
| 🟡 缺陷 | iOS 退出登录后不跳转登录页 | —（审核员可感知） | 未处理 |
| 🟡 确认 | 微信分享 Universal Link / AASA | 分享回调失效 | 待线上验证 |
| 🟢 就绪 | 权限描述 / 隐私政策 / 图标等 | — | 见下文清单 |

---

## 🔴 阻断级

### 1. 积分 / 订阅购买在 iOS 走微信/支付宝 —— Guideline 3.1.1

**现状**：

- `subpackages/utils/appNativePay.uts:26`（`#ifdef APP-IOS`）：iOS 通过 `UIApplication.open` 唤起 `weixin://`、支付宝 `alipays://`/收银台链接
- `subpackages/utils/paymentUtils.uts:85`：微信支付走**安心付小程序**拉起（`launchAnxinfuMiniProgram`），iOS 由 `appNativePayBridge` 承接
- 购买入口无任何 `APP-IOS` 屏蔽：
  - 「我的」页增购积分：`pages/mine/mine.uvue:338`（`handleAddPurchase`）
  - 订阅套餐：`subpackages/pages/my-subscriptions/hooks/useSubscriptionPurchase.uts`
  - Agent 订阅弹窗：`subpackages/pages/chat-conversation-component/components/agent-subscription-modal/`

**问题**：积分（AI 用量消耗品）与订阅均为**数字商品**，Apple 要求使用 IAP；跳小程序 / 外部收银台完成数字商品支付属于 3.1.1（必须 IAP）与 3.1.2（反引导外部购买）的典型拒审场景。

**例外（可保留微信/支付宝）**：`pages/terminal/components/desk-buddy-order-modal.uvue` 为**实物设备下单**（含收货人姓名 / 收货地址表单），适用 3.1.5(a) 实体商品例外。

**处理方案（二选一）**：

- [ ] 方案 A（快）：iOS 端条件编译屏蔽积分/订阅购买入口（增购积分按钮、订阅套餐页购买按钮、agent 订阅弹窗），保留查看（订单/订阅状态只读）；实物订单不动
- [ ] 方案 B（长）：接入 Apple IAP（消耗型积分 + 自动续订订阅），后端增加 IAP 收据校验与发货

### 2. 缺「删除账号」功能 —— Guideline 5.1.1(v)

**现状**：`servers/account.uts` 全文仅有登录/登出/改密接口，无注销 API；「我的」页只有「退出登录」（`pages/mine/mine.uvue` `handleLogout`）。

**要求**：App 支持账号注册（手机号/邮箱验证码注册），就必须提供**应用内可发现**的删除账号入口。跳转小程序、客服工单、仅邮件申请均不合格。

**处理方案**：

- [ ] 后端提供注销 API（如 `/api/user/delete`，含二次确认 + 冷静期逻辑由后端定）
- [ ] 「我的」→ 设置/账号与安全 → 删除账号，入口层级不超过两级
- [ ] 注销文案与隐私政策 `https://nuwax.com/privacy.html` 对齐

### 3. 离线打包路线：隐私清单与 Info.plist 为空

**现状**：

- 项目根**无** `nativeResources/ios/PrivacyInfo.xcprivacy`
- 本仓 iOS 走本地离线打包（ESP 配网等 UTS 插件本地注入），而离线工程模板 `UniAppXDemo/UniAppXDemo/PrivacyInfo.xcprivacy` 是**空 `<dict/>`**
- 离线模板 `Info.plist` 中**没有**本 App 的 NSMicrophone/Camera/Bluetooth 等权限描述（仅 demo 默认的 NFC/推送项）
- manifest.json:177 的 `app-plus.distribute.ios.privacyDescription` **只对云打包生效**，离线工程需手动同步
- `uni_modules/` 下全部自研 UTS 插件（`nuwax-esp-provisioning`、`nuwax-uni-math` 等）均未内置 PrivacyInfo.xcprivacy（`utssdk/app-ios` 目录）

**后果**：

- 提审包缺 required-reason API 声明（UserDefaults 等）→ 上传 App Store Connect 时 **ITMS-91053 直接拒收**
- 缺权限描述 → 审核员一点语音输入 / 扫码 / BLE 配网即闪退

**处理方案（若走离线打包）**：

- [ ] 在离线工程补 `PrivacyInfo.xcprivacy`：`NSPrivacyAccessedAPITypes` 至少声明 UserDefaults（CA92.1）、FileTimestamp（C617.1 等按实际情况）；`NSPrivacyTracking=false`
- [ ] 离线工程 `Info.plist` 同步 manifest 中的 7 条权限描述 + `UIBackgroundModes=audio`
- [ ] 自研 UTS 插件按文档在 `utssdk/app-ios` 内置各自隐私清单（云打包会自动合并）
- [ ] 若改走**云打包**（HX 5.15）：DCloud 按 manifest 自动生成 App 级隐私清单，ESP 插件以 uni_modules 源码参与云编译——可绕开本项大部分手工工作

### 4. 中国大陆区上架需 ICP 备案

- 2023-10 起 App Store 中国区强制要求填写 ICP 备案号，无备案只能上非中国区店面
- [ ] 确认 `nuwax.com` 主备案 + App 作为服务形式列入备案（App 备案，非仅网站备案）；未完成前提审选择除中国大陆外的发行区域

---

## 🟡 功能缺陷与待确认

### 5. iOS 退出登录后不跳转

`pages/mine/mine.uvue` `performLogout` 的 `reLaunch` 仅有三个条件编译分支：`H5 || WEB`、`APP-ANDROID`、`MP-WEIXIN`，**缺 `APP-IOS`**。iOS 上退出后仅弹 toast、停留在原页。

- [ ] 补 `// #ifdef APP-IOS` 分支 `uni.reLaunch({ url: "/subpackages/pages/login/login" })`（审核员几乎必测登出）

### 6. 微信分享 Universal Link

manifest.json:111 配置 `universalLink: https://link.nuwax.com/wechat/`。

- [ ] 验证 `https://link.nuwax.com/.well-known/apple-app-site-association` 可访问，且 JSON 含 `com.nuwax.app` + 正确 teamID + path `/wechat/*`
- [ ] 微信开放平台后台 iOS 应用信息（bundle id / universal link）一致

---

## 🟢 已就绪项

| 项 | 状态 |
|---|---|
| 隐私政策 URL | `https://nuwax.com/privacy.html` 已接入登录协议勾选（`components/agreement-checkbox`，四语言 i18n 均有） |
| iOS 权限描述 | manifest 已配麦克风/相机/相册（读+写）/蓝牙（Always+Peripheral）7 条中文描述（云打包生效） |
| 登录方式 | App 端仅手机/邮箱 + 验证码/密码（微信登录仅存在于 `login-weixin.uvue`，MP-WEIXIN 专属路由），不触发 4.8 Sign in with Apple 要求 |
| IDFA / 广告 | 无广告模块，uniStatistics 已关闭，无跟踪域名 |
| UIWebView | uni-app x 全 WKWebView，无废弃 API 风险 |
| 热更新 | 未使用 wgt 热更 / uni.downloadFile 更新逻辑 |
| 4.3a 套壳 | 自研业务无模板痕迹；DCloud 文档明确 uni-app x 框架本身不触发 4.3a |
| 图标 | `static/app-icon/launcher-1024.png` 已配 appstore 图标 |
| 生产 API | `https://agent.nuwax.com`（NODE_ENV=production），无明文 http 业务接口 |

---

## 📋 提审前材料清单

- [ ] iOS **发布证书** + **App Store 描述文件**（bundle id `com.nuwax.app`；与调试基座的开发证书/开发 profile 区分，勿混用）
- [ ] App Review 备注：**测试账号** —— 当前登录链路 = 阿里云验证码 + 手机短信/邮箱验证码，审核员收不到国内短信会直接拒。提供固定账号 + 万能验证码，或后端对指定账号白名单跳过验证码
- [ ] App Store Connect「App 隐私」标签如实勾选：电话号码、邮箱、用户内容（聊天记录/AI 对话）、购买记录、设备标识符等，与隐私政策口径一致
- [ ] 截图 / 预览（6.7" 必须，可选 6.5"/iPad 按发行设备）、关键词、描述、分级问卷（AI 聊天内容注意分级勾选）
- [ ] 版权信息 / 技术支持 URL
- [ ] 打包路线决策：**云打包**（隐私清单自动生成，推荐首次提审用）vs **离线打包**（需先完成第 3 项）

## 建议处理顺序

1. 代码侧小改：iOS 支付入口屏蔽（方案 A）+ logout 补 APP-IOS 分支
2. 后端排期：注销 API + 审核测试账号
3. 打包路线定夺 → 云打包直接走 / 离线打包先补隐私清单与 Info.plist
4. ICP 备案确认（决定发行区域）
5. 最后过一遍 [pre-release-checklist.md](./pre-release-checklist.md) 清调试残留

> 关联文档：[pre-release-checklist.md](./pre-release-checklist.md) · [ios-esp-provisioning-local-base.md](./ios-esp-provisioning-local-base.md) · [local-custom-base-maintenance.md](./local-custom-base-maintenance.md)
