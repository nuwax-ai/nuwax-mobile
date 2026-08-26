# nuwax-harmony-native-pay

鸿蒙端原生支付桥，与 `nuwax-android-native-pay` 接口同构，供
`subpackages/utils/paymentUtils.uts` 在 `#ifdef APP-HARMONY` 下直接调用。

| 能力 | 实现 |
|------|------|
| 支付宝 | `context.startAbility({action:'ohos.want.action.viewData', uri})`，`alipays://` 与 `https://` 均可 |
| 微信小程序 | 鸿蒙版微信开放 SDK（ohpm `@tencent/wechat_open_sdk`）`LaunchMiniProgramReq` |

## SDK 签名（已对照 1.0.21 的 .d.ets 核对）

- `WXAPIFactory.createWXAPI(appId: string, context?: common.UIAbilityContext): WXApi`
  ——鸿蒙侧没有 `registerApp`
- `LaunchMiniProgramReq` 字段为 `userName` / `path` / `miniprogramType`（**小写 p**，
  `number`，0-正式 1-开发 2-体验）/ `extraData`，SDK 里没有 `MiniProgramType` 枚举
- `sendReq(context, req)` 返回 `SendReqResultWrap = boolean | Promise<boolean>`，
  两种都要处理（插件内用 `typeof` 收敛）
- **不要调用 `isWXAppInstalled()`**：内部是 `bundleManager.canOpenLink("weixin://")`，
  entry 模块未声明 `querySchemes` 时会失败并误报“未安装”，把正常支付挡掉

## 待核对项（首次真机联调前必做）

1. **开放平台注册**：需在微信开放平台已有移动应用（AppID `wxe2a12018505241ba`）下
   新增 HarmonyOS 平台，填写 `bundleName = com.nuwax.apphm`（见 manifest.json
   `app-harmony.distribute`）与 AppGallery Connect 的应用标识（appIdentifier）。
   未注册通过时 `sendReq` 会被微信拒绝。

## scheme 兜底（开放平台注册未就绪时先跑通链路）

1. 注释掉 `utssdk/app-harmony/index.uts` 顶部的 `@tencent/wechat_open_sdk` import
   与 `getWxApi()` / `launchAnxinfuMiniProgramNative()` 两处实现；
2. 删掉 `utssdk/app-harmony/config.json` 里的 `dependencies`；
3. 在 `subpackages/utils/paymentUtils.uts` 的 `#ifdef APP-HARMONY` import 块里
   取消 `launchAnxinfuMiniProgramBySchemeNative` 那行的注释，并把同文件
   `launchAnxinfuMiniProgram()` 里 `#ifdef APP-HARMONY` 分支的
   `launchAnxinfuMiniProgramHarmony(userName, path)` 换成
   `launchAnxinfuMiniProgramBySchemeHarmony(options.getString("redirectUrl") ?? "")`。

兜底走的是网关返回的 `weixin://dl/business/?appid=...&path=...&query=<base64>`，
不依赖开放平台注册，代价是拉起失败时拿不到微信侧明确错误码。

## 为什么没有 module.json5

uni_modules 插件在鸿蒙侧编译成 HAR，其 `module.json5` 只接受 HAR 白名单字段
（`requestPermissions`、`dependencies`、`abilities` 等）；`querySchemes` 是 HAP
级配置，写进插件会在 `default@PreBuild` 阶段 schema 校验失败（00303038）。

本插件用 `startAbility` 隐式 want 拉起外部应用，不调用 `canOpenLink`，因此不需要
`querySchemes`。若将来要做「未安装微信/支付宝」的预检测，把 `querySchemes` 加到
entry 模块（项目根目录 `harmony-configs/entry/src/main/module.json5`），不要加回本插件。

## ohpm 版本对齐

`@tencent/wechat_open_sdk` 固定为 `1.0.15`，与鸿蒙工程里 DCloud 官方
`@uni_modules/uni-share-weixin` 声明的版本一致，避免 oh_modules 出现两份
SDK 导致 WXApi 实例不一致。改版本时请同步核对该插件的依赖声明。
