# iOS 审核 1.0.3(103) 被拒应对材料（2026-09）

> 提交 ID：`1a251433-1b62-4c91-a263-86c6b66ef5f2`（2026-08-27 提交，2026-09-09 Apple 最终回复）
> App Store Connect 路径：App Store Connect → 女娲Nuwax → 分发 → App 审核 → iOS 提交

## 一、被拒条款与本仓对策

| 条款 | 内容 | 对策 | 落点 |
|---|---|---|---|
| 2.1.0 性能：App 完整性 | 首轮要求补提审材料（录屏、设备清单、演示账号等） | 按「三、提审材料清单」补齐 App Review Information | ASC 操作，非代码 |
| 4.7.0 / 4.7.4 设计：小程序、聊天机器人、插件 | 要求提供 App 内非内嵌软件（聊天机器人/智能体）的**索引**（名称、开发者、URL），且今后每个版本都要附在 Review Notes | 按「二、智能体索引」生成清单，回复 Resolution Center 并附 Review Notes | ASC 操作 + 每版维护 |
| 5.1.1(ii) 隐私：权限用途说明 | 相机、相册 purpose string 过于笼统 | 已重写 manifest 权限文案（见「四」） | `manifest.json`（app-ios / app-plus 两处同步） |
| 2.1(b) 商业模式问询 | 疑似含付费数字内容，要求回答 5 个商业模式问题 | iOS 端已完全移除订阅/付费 UI（见「五」），按「六」口径回复 | 代码已改 + 回复草稿 |

## 二、智能体索引（4.7.4 要求，每次提审都要更新）

Apple 要求提供 App 内**非内嵌**游戏/软件（对本 App 即平台上的智能体/chatbot）的索引，用于确认符合 4.7。索引放两处：

1. 回复 Resolution Center 时作为附件/正文；
2. **今后每个版本**提审时附在 App Review Information → Notes（Apple 明确要求）。

表格模板（从平台管理后台导出当前在线智能体后填写）：

| # | 智能体名称 | 开发者/提供方 | 访问 URL | 类型 | 说明 |
|---|---|---|---|---|---|
| 1 | （例）旅行规划助手 | XX 团队 / 用户昵称 | `https://<平台域名>/agent/<id>` | AI chatbot | 由平台用户/官方创建的 AI 对话智能体，非独立 App |

英文口径（可直接贴 Review Notes）：

> **Index of non-embedded software (AI agents/chatbots) accessible in the app**
> The app is a mobile client of the Nuwax AI-agent platform. The "software" accessible in the app consists of AI chatbots ("agents") created on the web platform. They are not standalone apps, mini programs, or executable code; each agent is a server-side conversational AI configuration (prompt + model + tools) rendered as chat. An up-to-date index (name / creator / URL) is attached below/attached to this submission. All agents run server-side; nothing is downloaded or executed on the device.

注意：索引必须与提审版本线上一致，重新提审前重新导出一次。

## 三、提审材料清单（2.1 首轮要求，App Review Information 补齐）

- [ ] 真机录屏（冷启动 → 登录 → 对话生成 → 语音/拍照/相册权限按需弹窗 → 历史会话 → 个人中心无付费入口），90~120s，脚本沿用 `~/Downloads/ios-appstore.md` 第二节
- [ ] 测试设备清单（机型 + iOS 版本）
- [ ] 演示账号（App Store Connect 登录凭据栏），保证审核期间有效
- [ ] App 功能说明与目标用户
- [ ] 外部服务清单（认证服务、AI 模型服务、对象存储等）
- [ ] 地区差异说明（或确认全球一致）
- [ ] 智能体索引（见第二节）

## 四、权限文案（5.1.1(ii)，已改 `manifest.json`）

`app-ios.distribute.privacyDescription` 与 `app-plus.distribute.ios.privacyDescription` 已同步更新（注意：重打包基座/云打包后生效）：

| Key | 新文案 |
|---|---|
| NSCameraUsageDescription | 相机仅用于您主动拍摄照片或扫描设备二维码时使用，例如：在 AI 对话中点击「拍照」拍摄设备现场照片并发送给 AI 助手识别分析，或在智能硬件配网时扫描设备机身上的二维码。App 不会在后台启动相机，也不会未经您操作拍摄任何内容。 |
| NSPhotoLibraryUsageDescription | 相册仅用于您主动选择图片时访问，例如：在 AI 对话中点击「相册」选择一张设备报错截图发送给 AI 助手分析，或在「账号管理」中选择照片作为头像。App 不会自动扫描或上传您相册中的其他照片。 |
| NSPhotoLibraryAddUsageDescription | 仅当您主动保存图片时，App 才会将图片写入您的相册，例如：长按 AI 生成的图表并点击「保存到相册」。App 不会在您未操作时向相册写入任何内容。 |
| NSMicrophoneUsageDescription | 麦克风仅用于您主动使用语音输入时录制音频，例如：在 AI 对话中点击麦克风按钮说话，App 将语音转为文字或发送给 AI 助手处理。App 不会在后台或您未主动录音时使用麦克风。 |

回复 Resolution Center 可附英文版（要点）：each string states the specific feature, a concrete user example, and an explicit commitment that the resource is only used on the user's active action, never in background。

## 五、iOS 付费面收敛（2.1(b) / 3.1.1，代码已改）

延续既有「iOS 上架版无应用内购买渠道」口径，本次补全后 iOS 构建中：

- 智能体卡片（首页最近使用 / 全部列表 / 搜索 / 我的发布）不再显示「付费 / 已订阅」标签：
  - `pages/index/home-content/home-content.uvue`（scroll-view 分支）
  - `components/agent-component/agent-component.uvue`
  - `components/recent-used-agent-item/recent-used-agent-item.uvue`
- 订阅套餐弹窗（含 ¥ 价格）不再挂载、不再自动弹出：
  - `subpackages/pages/chat-conversation-component/chat-conversation-component.uvue`
  - `subpackages/pages/app-details/app-details.uvue`
  - `subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts`（3 处自动弹窗全部 `#ifndef APP-IOS`；iOS 显式置 false）
- 原本已隐藏（本次未动）：我的页订阅/订单入口、终端页硬件购买卡、更多菜单「我的订阅」、历史会话抽屉订阅按钮。
- 行为变化说明：iOS 上未订阅付费智能体不再弹订阅引导、超额也不再禁用输入框，超额限制由服务端返回错误提示兜底（与既有第三处收敛的注释口径一致）。

## 六、2.1(b) 商业模式五问回复草稿（中英）

> 发到 Resolution Center 前请与商务/罗东确认数字与口径。

**中文**：

1. 谁会使用付费内容/服务？——本 App 面向 Nuwax AI 智能体平台的注册用户。付费能力（智能体订阅、算力套餐）面向在网页端创建/管理智能体的创作者与企业用户；移动端主要满足已授权用户的随时对话与设备管理。
2. 在哪里购买？——所有订阅与套餐均在网页端（`https://<平台域名>`）完成购买与续费，App 内（尤其 iOS 端）不提供任何购买入口、价格展示或支付链接。
3. 已购内容在 App 内可访问什么？——用户在网页端购买后，可在 App 内无限制使用对应智能体与算力；App 仅同步展示服务端返回的权益状态，不销售、不解锁任何内容。
4. 哪些未走 IAP 的付费功能在 App 内解锁？——无。iOS App 内不存在任何付费解锁行为：不展示价格、不展示订阅标签、不提供购买/跳转入口；付费完全发生在 App 外的网页端，App 只消费其结果。
5. 如何获得账号？是否付费注册？——账号在网页端注册（支持手机号/邮箱验证码），注册免费；App 端仅提供登录（无注册入口）。

**English**:

1. **Who uses the paid content?** The app serves registered users of the Nuwax AI-agent platform. Paid plans (agent subscriptions / compute credits) target creators and enterprise users who build and manage agents on the web platform; the mobile app mainly serves authorized users for on-the-go conversations and device management.
2. **Where can users purchase?** All subscriptions and plans are purchased and renewed on our website only. The app — in particular the iOS build — contains no purchase entry, no price display, and no payment links.
3. **What previously purchased content is accessible in the app?** After purchasing on the website, users can use the corresponding agents/credits in the app without restriction. The app only reflects entitlement status returned by our server.
4. **What paid content is unlocked in the app without IAP?** None. The iOS app does not display prices or subscription tags, and offers no purchase or external-checkout entry. All payments happen outside the app on the website; the app only consumes the result.
5. **How do users obtain an account? Is there a fee?** Accounts are registered (free of charge) on the website via phone/email verification code. The app provides sign-in only; there is no in-app registration.

## 七、重新提审步骤

1. 确认本分支代码合入提审分支，云打包/本地出包新版本（版本号 ≥ 1.0.3(103) 可复用 1.0.4(104)）。
2. ASC 更新 App Review Information：演示账号、录屏（附件上传或 Notes 链接）、Notes 附「四」英文权限说明 + 「二」智能体索引。
3. Resolution Center 逐条回复：4.7.4（附索引）、5.1.1(ii)（附新文案说明 + 新构建已更新）、2.1(b)（「六」草稿）。
4. 重新提交审核。
