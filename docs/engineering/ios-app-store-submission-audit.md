# iOS App Store 提审就绪审计

> 审计日期：2026-08-17
> 依据：DCloud 官方文档 [iOS 上架指南](https://uniapp.dcloud.net.cn/tutorial/ios-app-store.html)、[iOS 隐私清单](https://uniapp.dcloud.net.cn/tutorial/app-ios-privacyinfo.html)，对照本仓代码逐项核查。
> 结论：**存在 2 个代码侧阻断级合规缺口 + 1 个打包路线坑**，处理后其余为材料准备。配套清单见 [pre-release-checklist.md](./pre-release-checklist.md)。

## 总览

| 级别 | 项 | 审核条款 / 错误码 | 状态 |
|---|---|---|---|
| 🔴 阻断 | 积分/订阅在 iOS 走微信/支付宝 | 3.1.1 / 3.1.2（数字商品须 IAP） | ✅ 已处理（2026-08-17 方案 A，条件编译屏蔽） |
| 🔴 阻断 | 缺「删除账号」入口 | 5.1.1(v) | ⏳ 后端确认已有 API，等接口契约后接 UI |
| 🔴 阻断 | 隐私清单 / Info.plist | ITMS-91053 / 权限崩溃 | ✅ 打包路线定为**云打包**；已建 `nativeResources/ios/PrivacyInfo.xcprivacy`，manifest 权限描述云打包直接生效 |
| 🔴 阻断 | 中国区上架需 ICP 备案 | App Store 中国区政策 | ✅ 已确认：蜀ICP备20012194号-11A |
| 🟡 缺陷 | iOS 退出登录后不跳转登录页 | —（审核员可感知） | ✅ 已修复（mine + history-conversation-popup 两处补 `APP-IOS`） |
| 🟡 确认 | 微信分享 Universal Link / AASA | 分享回调失效 | ⏳ 待线上验证（profile 已含 associated-domains，云打包已通过） |
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

- [x] 方案 A（快，**已实施 2026-08-17**）：iOS 端条件编译屏蔽积分/订阅购买入口，保留查看（订单/订阅状态只读）；实物订单不动。**入口清单（按产品确认口径）**：
  - 「我的」tab：
    - 「我的订阅」菜单项整个隐藏 → `pages/mine/mine.uvue`（模板层 `#ifndef APP-IOS`）
    - 「我的订单」菜单项整个隐藏（2026-08-17 三轮：iOS 全端无订单/支付链路，与备案备注「不含支付」对齐）→ 同上
    - 积分卡「增购」按钮隐藏 → `components/credits-breakdown/credits-breakdown.uvue`（模板 + emit 双保险；mine.uvue 的 `handleAddPurchase` 同步条件编译）
  - 应用详情页侧栏（`subpackages/pages/app-details/history-conversation-popup/`）：
    - 积分区「增购」action 隐藏（总积分仍展示）、跳转 my-subscriptions 的 `handleGoSubscriptions` 不编译
    - 「立即订阅」按钮隐藏（`app-details.uvue` 的 agent-subscription-modal 仅由此触发，源头已断）
  - 会话详情（chat-conversation-component）：
    - more-popup「我的订阅」菜单项 iOS 隐藏（`payEntryBlocked` + 弹窗高度联动）
    - `AgentDetailService.uts` `handleCheckSubscriptionLimit` iOS 不自动弹订阅（支付/会议订阅）弹窗、不禁用输入框（避免无支付渠道时用户被锁死在会话中，超额由后端错误提示）
  - 终端 tab（三轮新增）：硬件购买列表（产品购买卡，`pages/terminal/terminal.uvue`）iOS 整体隐藏，`desk-buddy-order-modal` 失去触发入口
  - 防御层：`subpackages/pages/my-subscriptions/my-subscriptions.uvue` onLoad 强制 `hidePlans = true`（即使有残留路径进入也只显示订阅状态，无购买卡片）；`order-card.uvue` 「去支付」限 `DESK_BUDDY`（入口已隐藏，纯防御保留）
  - ~~保留 desk-buddy 实物订单~~（三轮推翻：iOS 全端无支付，与备案备注「不含支付功能」完全一致；实物购买待备案变更后再放开）
- [ ] 方案 B（长）：接入 Apple IAP（消耗型积分 + 自动续订订阅），后端增加 IAP 收据校验与发货（后续版本再议）

### 2. 缺「删除账号」功能 —— Guideline 5.1.1(v)

**现状**：`servers/account.uts` 全文仅有登录/登出/改密接口，无注销 API；「我的」页只有「退出登录」（`pages/mine/mine.uvue` `handleLogout`）。

**要求**：App 支持账号注册（手机号/邮箱验证码注册），就必须提供**应用内可发现**的删除账号入口。跳转小程序、客服工单、仅邮件申请均不合格。

**进展（2026-08-17）**：后端确认已有注销 API，接口契约待提供，到货后接 UI。

**处理方案**：

- [x] 后端提供注销 API（已确认存在，**等契约文档**）
- [ ] 「我的」→ 设置/账号与安全 → 删除账号，入口层级不超过两级（含二次确认 + 注销后果提示）
- [ ] 注销文案与隐私政策 `https://nuwax.com/privacy.html` 对齐

### 3. 隐私清单 / Info.plist（打包路线：**已定为云打包**）

**决定（2026-08-17）**：iOS 提审走 **HBuilderX 云打包**（profile `NuwaxAppProfileDistribution` 已含 associated-domains，打包通过）。云打包下：

- [x] manifest.json:177 的 `app-plus.distribute.ios.privacyDescription`（7 条权限描述）**直接生效**，无需手动改 Info.plist
- [x] 已创建 `nativeResources/ios/PrivacyInfo.xcprivacy`（随云打包提交，HX 4.13+ 支持）：
  - `NSPrivacyTracking=false`、无跟踪域名
  - 采集声明：手机号 / 邮箱 / 用户 ID / 用户内容（对话） / 购买记录（均 AppFunctionality、linked、非跟踪）
  - required-reason API：UserDefaults（CA92.1）、FileTimestamp（C617.1）
  - ⚠️ 口径需与 App Store Connect「App 隐私」标签保持一致；后续接 IAP/推送/统计须同步更新
- [x] 权限面核查：全仓无定位 / 本地网络 / 语音识别调用，现有 7 条描述已覆盖（若未来启用 ESP SoftAP 配网，需补 `NSLocalNetworkUsageDescription` + `NSBonjourServiceTypes`）
- [ ] （可选加固）自研 UTS 插件（esp-provisioning / uni-math 等）在 `utssdk/app-ios` 内置各自 PrivacyInfo——云打包会自动合并；当前被拒风险低，可观察首轮审核结果再补

> 离线打包路线（UniAppXDemo 空 `<dict/>` 隐私清单 + Info.plist 缺权限描述）**已弃用**，仅调试基座继续用本地打包，与提审无关。

### 4. 中国大陆区上架需 ICP 备案（✅ 已确认 2026-08-17）

- App 备案号：**蜀ICP备20012194号-11A**（蜀 = 四川，`-11A` 后缀 = App 备案形态）
- App Store Connect → App 信息 → 「ICP 备案号」字段填写此号（中国区发行必填，填写后苹果会向工信部核验，通常数分钟~1 天生效）
- 注意：提审包的 bundle id `com.nuwax.app` 须与备案登记的 App 名称/包名一致，不一致会被驳回

---

## 🟡 功能缺陷与待确认

### 5. iOS 退出登录后不跳转（✅ 已修复 2026-08-17）

`performLogout` 的 `reLaunch` 缺 `APP-IOS` 分支。已在两处补齐 `// #ifdef APP-IOS` → `uni.reLaunch({ url: "/subpackages/pages/login/login" })`：

- `pages/mine/mine.uvue`
- `subpackages/pages/app-details/history-conversation-popup/history-conversation-popup.uvue`（同款 logout 逻辑，一并修复）

> 备注：`performLogout` 同样没有 `APP-HARMONY` 分支（鸿蒙 App 退出后同样不跳转），本次未动，鸿蒙上线前需补。

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
- [x] 打包路线决策：**云打包**（2026-08-17 定；隐私清单 `nativeResources/ios/PrivacyInfo.xcprivacy` 随包提交，权限描述走 manifest）

## 建议处理顺序

1. ~~代码侧小改：iOS 支付入口屏蔽（方案 A）+ logout 补 APP-IOS 分支~~ ✅ 2026-08-17 完成
2. ~~打包路线定夺~~ ✅ 已定云打包，`nativeResources/ios/PrivacyInfo.xcprivacy` 已就位
3. ⏳ 注销 API 契约到货 → 接「我的」页删除账号入口
4. ⏳ ICP 备案确认（决定发行区域）
5. ⏳ 云打包出新包 → 真机回归（支付入口不可见 / logout 跳转 / 语音扫码权限）
6. 提审前最后过一遍 [pre-release-checklist.md](./pre-release-checklist.md) 清调试残留

## 变更记录

- **2026-08-17（夜间崩溃攻关，未解，已隔离）**：iOS 26.6 高频闪退（BFL/FrameState IPC 内存损坏族，12+ 次）。**已证伪**：grace 延时退出（150/300ms + 防重入加固后仍崩）、enablePageCache 页面缓存、H5 内容参与（空白页 webview 亦崩，待横幅复核）。**已确认**：与 agent-detail 无强绑定（未进会话亦可崩）；**S3 基座与云打包包均缺 `unimoduleNuwaxUniMath`（ratex）框架** → iOS 公式渲染必走 uni-ai-x proxy 隐藏 webview（native 解不了 SVG 亦回落 proxy），proxy webview 为全 App 级嫌疑源（7 月老包同族崩互证）。⚠️ **ratex 三方 lib 只在离线 SDK，云打包永远带不了 → 云打包提审包自带此崩溃基因，除非转本地离线打包（手动补隐私清单，方案见第 3 节）或 DCloud 修 WebKit 竞态**。明日：①HX 运行会话收有效 ips（新二进制 UUID）定位 BFL 所属 webview；②发 DCloud 工单；③候选修复：离线打包含 ratex / proxy 总闸实验（`uni-ai-x/sdk/proxy-web.uts`）/ webview 常驻收敛。首页 TEMP-BUILD-TAG 横幅保留至问题关闭。
- **2026-08-17（三轮，对齐备案口径）**：iOS「我的订单」菜单项整个隐藏；终端 tab 硬件购买列表（产品购买卡）隐藏 —— iOS 全端无支付/订单链路，落实备案备注「不含支付功能」A 方案。`NuwaxApp(Dev).08172016` 云打包经 JS 标记验证为**二轮前旧包**（含 `setStorageSync("SUB_BACK_URL"`），仅一轮改动，不可用于回归/提审。
- **2026-08-17（二轮，按产品细化口径）**：「我的订阅」菜单项整个隐藏（mine）；订单卡「去支付」限 `bizType == DESK_BUDDY`；应用详情侧栏增购 action + 立即订阅按钮隐藏；确认「会议订阅弹窗」= 会话详情 agent-subscription-modal（一轮已挡自动弹出与入口）。
- **2026-08-17（一轮）**：方案 A 实施（5 处支付入口条件编译）+ logout 两处补 `APP-IOS` + 新增 `nativeResources/ios/PrivacyInfo.xcprivacy` + 打包路线定云打包。云打包 profile 侧 associated-domains 已修复（Identifiers 开能力 + regenerate profile）。

> 关联文档：[pre-release-checklist.md](./pre-release-checklist.md) · [ios-esp-provisioning-local-base.md](./ios-esp-provisioning-local-base.md) · [local-custom-base-maintenance.md](./local-custom-base-maintenance.md)
