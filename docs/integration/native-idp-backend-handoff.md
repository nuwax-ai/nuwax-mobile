# 原生 CAS/OAuth2：客户端已实现部分与后端协调清单

更新：2026-10-27。**微信/飞书专用 SDK 不接入本阶段。** 当前完成不依赖后端合同的客户端基础，功能开关关闭，无真实原生登录接口请求；H5 的 Cookie 登录继续独立提测。

## 当前代码及能力

| 部分 | 已实现内容 | 尚不能据此认定完成的事项 |
|---|---|---|
| [nativeAuthFlow.uts](../../utils/nativeAuthFlow.uts) | 单事务编排；prepare→浏览器→兑换→业务用户验证→提交；取消、过期、切域/换号、重复回调及迟到响应隔离 | 实际后端 prepare/exchange/verify 适配器未注册 |
| [nativeAuthProtocol.uts](../../utils/nativeAuthProtocol.uts) | 严格回调匹配、唯一参数、state 校验、返回路由约束、恢复记录校验、verifier 不进入 URL | 对实际服务器响应的字段映射和错误码适配 |
| [nuwax-native-auth](../../uni_modules/nuwax-native-auth/) | Android：系统浏览器、专用回调 Activity、SecureRandom、SHA-256、Keystore AES-GCM；iOS：ASWebAuthenticationSession、URL hook、SecRandom、CryptoKit、ThisDeviceOnly Keychain | 新基座/签名包的配置合并、真实设备往返、系统回调可靠性 |
| [nativeAuthRuntime.uts](../../utils/nativeAuthRuntime.uts) | App 启动/回前台读取结果；活跃事务期间补轮询；后台停轮询；会话变化取消；保存已验证 Token 后发事件；一次性完成信息覆盖登录页晚挂载 | 真实适配器响应与 UI 完成链路仍需联调 |
| [native-idp-login.uvue](../../components/native-idp-login/native-idp-login.uvue) | 独立原生登录页入口、协议确认、加载、取消、失败后恢复普通登录；完成后先设密码或回安全业务路由 | 仅登录页手动发起；弹窗登录不展示；不读取 H5 自动项 |
| [nativeAuth.uts](../../constants/nativeAuth.uts) | `NATIVE_AUTH_ENABLED=false`，`NATIVE_AUTH_PROVIDER_IDS=[]`，本地事务上限 5 分钟 | 后端明确允许的 provider ID 才能进入白名单；协议/包配置与后端验收完成前保持关闭 |

新插件仅使用系统能力，无第三方 SDK。Android 当前采用系统浏览器，未新增 AndroidX Auth Tab 依赖。当前回调模式仅支持下述私有 scheme；HTTPS App/Universal Link 是后续选择，不能仅改配置字符串就切换。

## 先请后端明确这五项

1. **路线与实际接口**：复用现有 `/api/oauth2/authorize` + `/api/oauth2/token`，还是已有/新增移动事务交接？请给方法、路径、参数位置及成功/失败示例。客户端不要求按内部类名新增接口。
2. **公共客户端与回调**：是否支持官方 App 无 `client_secret`、强制 PKCE S256？请给测试环境公开 `client_id`，登记下列客户端回调。
3. **业务会话**：最终 Token 能否用于现有 `/api/user/getLoginInfo`、业务 API、IM CONNECT/设备注册？若需要二次交换，请给实际接口，不能仅用 OAuth2 userinfo 成功说明兼容。
4. **首次关联与错误返回**：已绑定、自动关联、自动注册、人工绑定/注册、普通登录/设密码、取消/失败是否都保留该笔原生事务，最后返回 App？不能最后落回 PC 首页。
5. **平台能力与生命周期**：原生 provider/平台开关、事务与 code TTL、原子消费、兑换结果不确定时的重试规则、取消/过期、Token 期限及退出/刷新策略。

## 客户端回调及包配置

```text
客户端固定支持：com.nuwax.app.auth://oauth/callback
成功：          com.nuwax.app.auth://oauth/callback?code=<平台一次性码>&state=<原样返回appState>
失败：          com.nuwax.app.auth://oauth/callback?error=<稳定错误标识>&state=<appState>
可选：          error_description（仅解析并忽略，不显示或记录原文）
```

- 成功/错误互斥，`code/state/error` 不可重复；当前不接受额外 query、fragment 或其他 scheme/host/path。事务 ID 由客户端已保存的 prepare 结果承接，不需回调再传。
- code 必须是**平台交接授权码**，不是 CAS service ticket、外部 OAuth code、Cookie、pending token 或业务 Token。不得在回调 URL 中附带 Token、verifier 或密码。
- Android Manifest 与 iOS 插件 Info.plist 已声明该 scheme；这不代表新的签名安装包已生成或后端已登记。新插件需要重打匹配的自定义基座。
- Android 当前包名 `com.nuwax.app`，iOS Bundle ID `com.nuwax.app`；测试/正式签名及包名是否另有区分需打包方确认。原生桥不处理支付/微信的 URL，不复用支付回调地址。
- 当前 H5 `/api/auth/idp/authorize` 的 `redirect` 是本站相对路径，不能直接塞这个 App scheme。应通过获准的公共客户端回调或移动事务安全交接。
- 如果后端只允许 HTTPS 回调，请先明确；需要追加 App Link/Universal Link 原生实现与域名关联文件，不能假定现在已经支持。

## 后端到客户端适配器的字段映射

内部类型见 [nativeAuth.uts](../../types/interfaces/nativeAuth.uts)。下表是客户端内部调用合同，**不是已上线 HTTP API 说明**；已有接口可通过适配器转换字段名、参数位置及日期格式。

| 调用 | 输入/输出 | 后端需给出的合同 |
|---|---|---|
| `prepare(request)` | 输入 `requestId/origin/providerId/callbackUrl/state/codeChallenge/codeChallengeMethod=S256`；没有 verifier | 获取可信授权启动 URL 的方式；客户端/租户/provider/回调与 challenge 的绑定方式 |
| prepare 结果 | `authorizeUrl/serverTransactionId/expiresAt` | URL 是当前业务 origin 下的 HTTPS 入口，无 fragment/明文 verifier；`expiresAt` 由适配器转为毫秒时间戳，不能超过客户端上限 |
| `exchange(request)` | 输入原事务的 `requestId/origin/providerId/callbackUrl/serverTransactionId` 与本次 `code/codeVerifier` | 实际兑换端点、Content-Type、鉴权、客户端 ID 和 PKCE 校验；origin 不能由回调覆盖 |
| exchange 结果 | `token/expiresAt/resetPass` | Token 必须是业务会话；过期时间为可转换的明确值；`resetPass` 取 0/1；若有二次交换由适配器完成 |
| `verify(origin, token)` | 用候选 Token 验证，返回有效平台 userId 字符串 | 复用业务 getLoginInfo 的 Bearer 验证，不先写全局会话；成功码及 ID 字段映射 |

公共客户端路线的 prepare 可以仅在适配器内构造已有授权 URL；如无服务端 prepare 响应，客户端本地的等待期限不能被当作服务器 code TTL。业务 origin 来自用户当前选择的服务端；后端仍应根据 HTTP host、已登记客户端与租户绑定来验证，不能信任请求体随意声明的 origin。

平台向外部 IdP 发起授权的 state/PKCE，与 App 到平台交接的 appState/PKCE 是两层，必须分别校验。当前客户端的 verifier 由安全随机生成，仅保存在系统安全存储，并在兑换请求中发送。

## 首次关联、取消及会话策略

- N1 优先复用后端网页中间页；事务保持在认证浏览器中，人工注册/绑定和普通登录完成后再交付同一平台 code。若需要返回原生表单继续 pending，需另给经过确认的续接合同。
- 客户端取消会作废本地事务、清理安全存储；Android 无法强制关闭外部浏览器。后端应说明取消接口（如有）或超时清理与旧 code 隔离规则；当前未猜测或调用取消端点。
- 进程重建只恢复安全存储中尚处于 `authorizing` 的有效事务；`preparing/exchanging/verifying` 中断时拒绝自动重放并要求重试，避免兑换结果不确定。
- 候选 Token 必须先验证业务用户，成功后才调用现有 `saveAccessToken()`，触发 IM 会话就绪。普通业务 Token 的保存沿用现有 App 机制；新插件安全存储只保存短期事务及回调，不额外保存刷新凭证。
- 本阶段不实现 refresh token 轮换、CAS SLO、账号设置中的绑定/解绑 UI。它们需要明确服务端合同后分阶段接入，不影响本次 H5 验证。

## 后端回复模板与开启前检查

```text
选定路线：现有公共客户端 / 现有移动事务 / 需补移动事务
适用环境和版本：
公开 client_id、登记回调及支持的 provider/平台：
prepare 对应方式：方法/路径、鉴权、输入、返回和期限
exchange 对应方式：方法/路径、鉴权、输入、成功/失败/重复/过期示例
业务 Token 兼容性：getLoginInfo、业务接口、IM、设备注册
首次关联与普通登录续接：各分支返回示例
取消、结果不确定时的重试、过期/刷新/退出规则：
未决事项及可联调时间：
```

开启前仍需：实现并注册正式后端适配器 → 确认 provider/平台能力并配置原生 ID 白名单 → 联调已接入的登录/设密码/业务导航 → 重打基座并检查回调声明 → Android/iOS 真机分别验证 → 最后打开本地功能开关。不能仅把 `NATIVE_AUTH_ENABLED` 改成 true 就宣称已可登录。

## 本地验证与未验证边界

- 原生编排/协议、安全导航与既有 H5 登录专项及 iOS 构建兼容测试共 97 项通过；当前原生工作区的 HBuilderX H5 回归编译通过。
- iOS 原生 Swift 桥及 HBuilderX 生成的 UTS 插件 Swift 包装/URL Hook 一起通过了 iOS Simulator SDK 的 `swiftc -typecheck`，并独立编译/链接为 arm64 模拟器动态库（使用当前 DCloud 框架）。原链接错误已定位为 HBuilderX 生成的过时 `-ld64`，仓库内编译进程兼容层已使认证插件通过 HBuilderX 链接；使用 `pnpm hx:ios:compile`，完整 77 页业务工程已编译通过；同时处理了生成 Pods 的过低目标，并将编译堆上限设为可配置的 8GB。使用方式和边界见 [iOS 编译说明](../engineering/ios-hbuilderx-linker-compat.md)。签名安装包和真实认证回调未验证。
- Android HBuilderX 编译验证使用本原生工作区的显式 `UNI_INPUT_DIR`，避免 CLI 同名项目匹配到 H5 提测主检出；编译通过不等于包内 Manifest 已生效或真实浏览器往返通过。
- 没有请求真实原生登录接口、修改平台配置、安装新包或操作用户账号。H5 提测分支保持原样，原生工作单独保存。
