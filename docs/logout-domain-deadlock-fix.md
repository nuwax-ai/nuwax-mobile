# 覆盖安装保留企业域名导致退出登录死锁 修复说明

> 2026-08-15 修复。分支 `feat/nuwa-zhuoda-2026.07`。
> 触发场景：云打包 APK → 切换企业域名 → 直接覆盖重装 → App 无法使用且无法退出登录。

---

## 1. 现象

用户反馈链路：

1. 安装云打包 APK（生产包，默认域名 `agent.nuwax.com`）
2. 进入 App 后在登录页切换企业域名（如 `testagent.xspaceagi.com`）并登录使用
3. 之后**直接覆盖重装** APK（不卸载）
4. 重装后 App 处于坏状态：
   - 所有请求仍指向旧企业域名，一旦该域名不可达（企业测试域名失效 / 网络环境变化 / token 与域名不匹配），**全 App 无法使用**
   - 「我的」页点「退出登录」→ toast「**退出失败**」→ **永远退不出**，也没有任何入口能切回默认域名

真机复现（Redmi `8PNNT4TKHIJVU8RO`，包 `com.nuwax.app`，云打包 release APK `nuwa-zhuoda-release-20260814-2329.apk` 覆盖装保留旧数据后）：点退出登录稳定复现「退出失败」卡死，截图见修复验证章节。

---

## 2. 根因

三层叠加，缺一层都不会死锁：

### 2.1 数据层：覆盖安装保留 storage（入口）

Android 覆盖安装（同签名 `install -r`）不清应用数据。切换过的企业域名与登录态跨重装存活：

- 企业域名：storage key `NUWAX_API_BASE_URL`（`constants/config.uts`）
- token 及其归属域名标记：`ACCESS_TOKEN` / `ACCESS_TOKEN_ORIGIN`（`utils/authSession.uts`）

> 这是**设计行为**：企业用户升级 App 后仍需指向企业域名，`clearStoragePreservingApiBaseUrl()` 也在退出时特意保留它。因此**不能**用「版本变更时清域名」来修这个问题（会把企业用户踢回个人版）。

云打包 release APK 与本地 `make base-android` 出的包同签名（release keystore 走 `scripts/local-secrets.env`），`adb install -r` 可互装且保数据——这也是能完整复现该状态的原因。

### 2.2 表现层：为什么「无法使用」

重装后 App 仍指向旧企业域名。域名不可达时请求在网络层直接失败（`uni.request` 走 `fail`）；token 与域名不匹配时（`useRequest.uts` 的 `tokenMatchesOrigin` 判假）请求不带鉴权头，接口同样全挂。全 App 无可用功能。

### 2.3 死锁层：为什么「无法退出」（核心缺陷）

登录页是**唯一**能切回个人版默认域名的入口（`login.uvue` 的「切换个人版登录」→ `handlePersonalLogin` → `resetApiBaseUrl()`）。而到达登录页的两条路全部堵死：

1. **主动路径——退出登录**：原 `performLogout`（`pages/mine/mine.uvue`）只在 `apiLogout()` 返回成功码时才清本地态并 `reLaunch` 登录页：
   - 网络层失败 → `catch` 只弹「退出失败」，**本地 token / 缓存原封不动**
   - 返回非成功码 → 静默不动，连 toast 都没有
2. **被动路径——请求层自动踢**：`useRequest.uts` 收到 `USER_NO_LOGIN` / `REDIRECT_LOGIN` 才清态踢登录页，**前提是服务端有响应**。域名不可达时永远不会触发。

→ 用户被永久锁死在登录态里；因为数据跨重装存活，重装多少次都没用。

---

## 3. 修复方案

原则：**退出登录改为「本地优先」，服务端注销降级为 best-effort**——本地登录态的清理不再依赖服务端结果。域名通，则服务端 token 一并注销；域名不通，本地照样退出、照样回登录页，用户可切回个人版域名自救。

| 文件 | 改动 |
|---|---|
| `pages/mine/mine.uvue` `performLogout` | `apiLogout()` 失败仅 `console.error`，**无论成败**都清 token（`ACCESS_TOKEN`）、清业务缓存（`clearStoragePreservingApiBaseUrl()`，保留企业域名）、`reLaunch` 登录页；toast 统一「退出成功」（本地确实已退出） |
| `subpackages/pages/app-details/history-conversation-popup/history-conversation-popup.uvue` `handleLogout` | 同样的「仅成功才清理」缺陷，同步改为本地优先；顺带补上 APP-Android 分支原本缺失的登录页跳转（原代码 Android 上成功后清了 storage 却不跳转） |
| `servers/account.uts` `apiLogout` | 增加 `timeout: 6000`：uni.request 默认超时过长，域名不可达时不能让用户干等才能退出 |

已知取舍（接受）：

- 域名不通时服务端 token 未注销，存活至自然过期——安全影响可忽略，是解开死锁的必要代价
- 服务端可达但 token 已失效的边缘路径：请求层会先自动踢一次登录页，1s 后 `performLogout` 的 `reLaunch` 再进一次同页（登录页重载一次）。罕见且无损，不额外加状态位
- `Mobile.Header.logoutFailed` 文案键在代码中不再被引用，locale 四语文件暂留（其他线可能复用，不为此翻动 4 个文件）

---

## 4. 修复验证

### 4.1 真机端到端（Redmi，坏状态完整复现后验证）

1. 云打包 release APK 覆盖安装（保留死域名 + 登录态数据）→ 修复前：点退出登录 → 「退出失败」卡死（`/tmp/nuwa-step3.png`，会话内证据）
2. 安装修复后的本地基座包（`make app-resource` → `make base-android`，`unpackage/debug/android_debug.apk`）→ 同坏状态下点退出登录 → toast「**退出成功**」→ **顺利回到登录页**（`/tmp/nuwa-fix3.png`）
3. 登录页点「切换个人版登录」→ toast「已切换为个人版」→ 域名恢复默认 `agent.nuwax.com`、按钮变回「企业版登录」、默认域名租户配置拉取成功 → **用户完全自救**（`/tmp/nuwa-fix5.png`）

### 4.2 编译与入包确认

- `make app-resource` 全量编译通过（40 页面）
- `make base-android`（离线 SDK + UTS→Kotlin 完整链路）`BUILD SUCCESSFUL`
- 修复字符串（`服务端注销失败，继续本地退出`）确认存在于 APK `classes2.dex`

> **构建注意（本次踩坑）**：`make base-android` **不会**重新生成业务资源，只打包现成的 `unpackage/resources/app-android`。改了 `.uvue/.uts` 后必须先 `make app-resource`（确认 `resources/app-android` 的 mtime 是新的）再 `make base-android`，否则会静默打出不含改动的旧包。

---

## 5. 连带修复：鉴权错误码跳转登录的缺口

复查请求层「鉴权错误码 → 跳转登录」逻辑（`servers/useRequest.uts`）时发现并一并处理：

### 5.1 REDIRECT_LOGIN(4011) 完整 URL 分支：APP 端清态不跳转

原逻辑：`4011` + message 为完整 URL 时，H5 走 `window.location.href`、小程序走 `handleExternalLink`，**APP 端没有任何分支**——token 与缓存已清、页面不动，用户停留在已清态页面上（与本次死锁同族的「清了却没跳」死角）。

修复：APP 端补 `uni.reLaunch` 回**原生登录页**（APP 不是网页，不打开 H5 登录 URL），行为对齐 `4010` 分支。

### 5.2 登录跳转豁免清单扩充

豁免（不参与踢登录页、不清态、直接 resolve 交给调用方自行处理）的接口由 batch 扩充为：

- `/api/notify/event/collect/batch`（事件上报，原有）
- `/api/i18n/lang/list`（**新增**：多语言列表，登录页挂载即调）
- `/api/tenant/config`（**新增**：租户配置信息，登录页挂载与企业域名验证即调）

后两者若参与踢登录页，会在登录页自身形成「挂载 → 请求返回鉴权码 → 踢登录页 → 再挂载」的**重定向循环**——5.1 修复落地后该循环从理论风险变成实际可能，必须一并豁免。

### 5.3 已知限制（记录不修）

- **HTTP 状态码层 401 不识别**：跳转逻辑只读响应体 JSON 的 `code`（4010/4011）。若网关直接回 HTTP 401 且响应体不是约定 JSON，走静默 resolve。当前后端约定 body 带 code，未踩到；属对网关行为的隐性依赖
- **上传链路无踢逻辑**：`audioUploader.uts` 走 `uni.uploadFile` 不经过 `request()`，鉴权码只弹错误 toast（其 `REDIRECT_LOGIN` 死导入已顺手清理）

### 5.4 验证情况（如实记录）

- 编译验证：`make app-resource` 全量编译通过；`make base-android`（UTS→Kotlin 完整链路）`BUILD SUCCESSFUL`
- 入包验证：豁免接口字符串 `/api/i18n/lang/list` 确认存在于 APK `classes2.dex`；4011 的 APP 分支代码经 `#ifdef APP` 条件编译进 app-android 产物（uni-app x 编译机制保证），与长期在用的 4010 踢登录分支同构
- **端到端未能完成**：本机环境无法给 App 提供一个可达的 mock 后端——
  - `adb reverse` + `http://127.0.0.1:8899`：设备**浏览器可通**，但 uni-app x 的 `uni.request` 网络栈连 127.0.0.1 不通（真机 + 模拟器均验证，原因未深究，release 包无请求日志）
  - 模拟器 `10.0.2.2`（宿主别名）：不通
  - 真机直连 Mac 局域网 IP（192.168.32.42:8899，mock 监听 0.0.0.0、防火墙关闭）：手机与 Mac 跨网段（31.x/32.x）无路由，不通
- 遗留环境坑（供后来者）：**想用 adb reverse + 127.0.0.1 调试 App 端接口在本仓不可行**，uni.request 走不通 loopback；需 mock 后端时请保证手机与 mock 主机同网段

## 6. 发布与存量用户

- **发版**：需重新云打包（或 `make android-release`）才对线上用户生效；本地 `unpackage/debug/android_debug.apk` 仅验证用
- **存量已中招用户**（拿到新包前）：系统设置 → 应用 → 女娲Nuwax → 「清除数据」，或卸载后重装，即可立即恢复（覆盖安装无效，数据一直在）
- 新包上线后：中招用户覆盖安装 → 退出登录（必定成功）→ 登录页「切换个人版登录」→ 恢复默认域名
