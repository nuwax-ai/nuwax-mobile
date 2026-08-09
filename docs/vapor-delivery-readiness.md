# Vapor（蒸汽模式）交付就绪评估与收尾记录

> 2026-08-10。配套权威文档 [`vapor-tech-debt.md`](./vapor-tech-debt.md)（Android 离线打包交接）、[`vapor-known-issues.md`](./vapor-known-issues.md)（踩坑归档）。本文聚焦"能不能交付 / 还剩什么"。

---

## 1. 结论：vapor 可交付（生产走云打包）

**决定性事实（用户 2026-08-10 实测）：DCloud 云打包能产出可正常启动的 vapor 包。**

这解除了 [`vapor-tech-debt.md` §8](./vapor-tech-debt.md) 的头号硬阻塞——「独立离线 vapor APK 卡启动屏」。§8 是 **path-a 死胡同**（`configure_app.py:1081 inject_vapor_runtime_into_app()` 注释停用；根因 = 离线 SDK 只有 VDM 版 aar、无 vapor-runtime aar 含 Android 资源）。**关键区分：§8 仅限「本机离线 SDK 自己组装 APK」，不挡生产发版**——生产上线走 DCloud 云打包即绕开（云端用与编译器匹配的运行时，无 offline SDK 的 aar 错配）。

旁证（非直接断言但一致）：
- 官方云打包文档 <https://doc.dcloud.net.cn/uni-app-x/tutorial/app-package.html> 对 vapor 无任何限制说明。
- 我们用的字节码模式（`vapor-render-target:"bytecode"`）无云打包限制；仅 iOS **机器码**云打包"暂不计划开放"（我们不用机器码）。
- 同类先例：WebView/Activity 泄漏在云打包不复现（`docs/handoff-chat-webview-leak-deadlock.md`），云打包行为系统性优于本机离线 SDK。

记忆：`vapor-delivery-cloud-packaging`。

---

## 2. 交付剩余项（app 侧可控，非阻塞）

| # | 项 | 归属 / 备注 |
|---|---|---|
| 1 | 正式签名上线 | 走 HBuilderX「发行 → App-Android-云打包」+ 正式证书。`scripts/android-esp/build_store_release.sh` 是**离线**路径（受 §8 阻塞），生产用不上，留作内测 |
| 2 | uni-stat 统计去留 | **待产品确认**（瘦身时已从 settings.gradle 剥离） |
| 3 | CSS 伪类残差 | 见本文 §3（本次已消 11 条，剩 21 条低优先级） |
| 4 | iOS vapor 基座 | **未开始**（本轮只 Android；需 Xcode 26.3 + 真机签名） |
| 5 | 鸿蒙 | 仅占位（`sdk/harmony/`、`scripts/harmony-esp/` 标注"官方 SDK 就绪后补"） |

> 本地离线 / 自定义基座联调仍受 §8 + WebView 泄漏影响——**仅影响调试，不影响线上**。

---

## 3. CSS 伪类残差处理记录（vapor styleIsolation 2.0）

vapor 运行时**整条丢弃**伪类选择器（`:last-child`/`:active`/`:hover`/`:focus-within`，非警告是真丢）。业务侧残差主要是 `:last-child`（列表最后一项去分隔线 / 去下边距）。`:active`/`:hover` 属可放弃的渐进增强，未处理。

### 3.1 转换范式（团队既有，本次沿用）

参照 `chat-conversation-component` 已建立的 `.msg-list-item--last`：
- **v-for 列表**：`v-for="(item, index) in LIST"` + `:class="index === LIST.length - 1 ? 'X--last' : ''"`，CSS `.X:last-child {…}` → `.X--last {…}`
- **静态行**：在最后一个静态元素上手动加 `class="… X--last"`，CSS 同上改名

特性：**失败优雅降级**——绑定写错最坏只是"最后一项仍多一条分隔线"（=当前现状），不破坏功能。

### 3.2 本次已转换（11 条，高频主列表 + 干净 v-for）

| 文件 | 规则 |
|---|---|
| `pages/terminal/terminal.uvue` | `.row-item`（deviceList） |
| `pages/agent-union-record/agent-union-record.uvue` | `.right-bar__item`（letters） |
| `subpackages/pages/system-messages/system-messages.uvue` | `.message-item` |
| `subpackages/pages/terminal/terminal-group-members.uvue` | `.row-item`（memberList） |
| `subpackages/pages/terminal/terminal-my-computer.uvue` | `.row-item`（filteredList） |
| `subpackages/pages/credit-records/credit-records.uvue` + `styles/index.scss` | `.filter-tab-item`、`.record-card` |
| `subpackages/pages/my-subscriptions/.../subscribed-{agents,credits,skills}.uvue` | `.agent-card` / `.credit-card` / `.skill-card` |
| `components/radio-list-drawer/radio-list-drawer.uvue` | `.radio-item`（rowList，已有 index） |

> ⚠️ 本次改动**未在 vapor 下编译验证**（本机 `_diff` checkout 为 vdom/5.15，无 HBuilderX-Alpha 5.23）。请在 vapor 机 `pnpm uni:build` 或自定义基座走查确认。

### 3.3 剩余待处理（21 条，按处理方式分类）

**A. 静态行（手动给最后一个元素加 `--last` 类，~9 条）**

| 文件:行 | 规则 |
|---|---|
| `pages/mine/mine.uvue:512` | `.row-item`（静态菜单行，最后一项=退出登录行） |
| `subpackages/pages/about-me/about-me.uvue:261` | `.profile-row`（静态资料行） |
| `subpackages/pages/provision/provision-wifi/provision-wifi.uvue:566` | `.form__field`（静态表单字段） |
| `subpackages/pages/terminal/terminal-my-computer.uvue:159` | `.filter-btn`（3 个静态筛选按钮，最后=offline） |
| `subpackages/components/chat-input-phone/.../home-manual-component-bar.uvue:151` | `.manual-box`（静态手动项） |
| `subpackages/pages/chat-conversation-component/components/more-info/more-info.uvue:252` | `.stat-item`（静态统计项） |
| `components/agent-component/agent-component.uvue:241` | `.stat-item`（静态） |
| `components/page-card/page-card.uvue:163` | `.stat-item`（静态） |
| `components/credits-breakdown/credits-breakdown.uvue:106` | `.credits-item` |

**B. v-for 列表（加 index + `:class`，~5 条）**

| 文件:行 | 规则 | v-for |
|---|---|---|
| `subpackages/pages/terminal/components/terminal-device-settings/*.scss:281` | `.swipe-wrap` | `monitorContentList`（已有 index） |
| `subpackages/pages/my-subscriptions/components/plan-cards/plan-cards.scss:52` | `.plan-card` | `plan in plans` |
| `components/diff-list-view/diff-list-view.uvue:257` | `.accordion-item` | 核对 v-for |
| `components/segmented-control/segmented-control.uvue:126` | `.segment-item` | 核对 v-for |
| `subpackages/pages/chat-conversation-component/components/agent-subscription-modal/*.scss:208` | `.limit-item` | 核对 v-for |
| `subpackages/pages/my-subscriptions/components/purchase-modal/purchase-modal.scss:41` | `.package-card` | 核对 v-for |

**C. 函数式 v-for（length 判断会重复调用函数，需缓存长度或换写法，1 条）**

| 文件:行 | 规则 | v-for |
|---|---|---|
| `subpackages/pages/my-subscriptions/components/plan-cards/plan-cards.scss:201` | `.benefit-item` | `(item,index) in getBaseBenefits(plan)` —— 勿在 `:class` 里再调一次 `getBaseBenefits(plan).length`，改在 script 算好或用 `computed` |

**D. 静态+v-for 混合（需按渲染结构判断"最后"，2 条）**

| 文件:行 | 规则 |
|---|---|
| `subpackages/pages/terminal/components/terminal-device-settings/*.scss:18` | `.row-item`（静态设置行 + pushChannelList v-for 混排） |
| `subpackages/pages/terminal/components/event-emoji-bind/*.scss:27` | `.row-item` |

**E. 团队已明确接受 drop（保留，2 条）**

| 文件:行 | 规则 | 说明 |
|---|---|---|
| `subpackages/components/chat-input-phone/chat-input-phone.uvue:1988` | `.waveform-bar` | 代码注释标注 vapor 下接受 drop（`margin-right:0`，微调） |
| `subpackages/components/chat-input-phone/chat-input-phone.uvue:2195` | `.extra-box` | 同上 |

**F. 条件渲染行（1 条）**

| 文件:行 | 规则 |
|---|---|
| `subpackages/pages/my-subscriptions/.../subscribed-skills.uvue:329` | `.skill-row`（多个 `v-if` 条件行，"最后"随数据变） |

---

## 4. 关键约束速查（易踩）

- 生产发版 = 云打包；`build_store_release.sh`（离线）受 §8 阻塞，仅供内测。
- 本机 `_diff` checkout = vdom/5.15；vapor 编译/真机在 `nuwax-mobile` checkout（HX-Alpha 5.23）。改 vapor 业务码后在 vapor 机验证。
- vapor 下 `:last-child`/`:active`/`:hover`/`:focus-within` 整条丢弃；修法见 §3.1。
- vapor 下 reactive 数组元素属性改了不触发重渲染 → 用 `splice` 整体替换（见 `vapor-tech-debt.md` §9.3b）。
