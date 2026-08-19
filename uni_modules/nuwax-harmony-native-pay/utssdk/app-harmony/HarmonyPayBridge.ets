// Copyright Nuwax. All rights reserved.
//
// HarmonyPayBridge.ets
// nuwax-harmony-native-pay（HarmonyOS ArkTS 桥）
//
// 与 Android 端 nuwax-android-native-pay 语义对齐：
//  - launchAnxinfuMiniProgram：微信 OpenSDK 拉起安心付小程序（拉起后结果由服务端
//    settlement-status 轮询判定，不依赖 WXApiEventHandler.onResp 回调）。
//  - openPayUrl：http(s) 收银台用 openLink 路由到浏览器；自定义 scheme（alipays:// 等）
//    用隐式 Want 启动，语义对等 Android 的 Intent.ACTION_VIEW。
//
// 混编约定（同 esp-provisioning / stream-pcm-player）：index.uts import 本文件
// （uts 依赖 ets，ets 不引用 uts），context 由 UTS 层经 UTSHarmony.getUIAbilityContext() 传入。

import { WXAPIFactory, LaunchMiniProgramReq, WXApi } from '@tencent/wechat_open_sdk'
import { common, Want } from '@kit.AbilityKit'

// 占位：微信开放平台鸿蒙平台信息（包名 com.nuwax.apphm）办理中，配置下发后如有差异仅改此处。
// 注意：构建时 HBuilderX 还会从 manifest 可视化的 uni-oauth/uni-share「微信 appid」自动注入
// entry module.json5 的 WX_APPID metadata（launcher 逻辑，覆盖手写值）；变更 AppID 时两处需同步。
const WECHAT_OPEN_APP_ID = 'wxe2a12018505241ba'

let wxApi: WXApi | null = null

function getWxApi(context: common.UIAbilityContext): WXApi {
  if (wxApi === null) {
    wxApi = WXAPIFactory.createWXAPI(WECHAT_OPEN_APP_ID, context)
  }
  return wxApi!
}

export class HarmonyPayBridge {
  /** 拉起安心付微信小程序；失败抛错（未安装微信 / 微信拒绝请求）。 */
  async launchAnxinfuMiniProgram(context: common.UIAbilityContext, userName: string, path: string): Promise<void> {
    const api = getWxApi(context)
    if (!api.isWXAppInstalled()) {
      throw new Error('WeChat is not installed')
    }
    const request = new LaunchMiniProgramReq()
    request.userName = userName
    request.path = path
    request.miniprogramType = 0
    // SDK 声明 sendReq 返回 boolean | Promise<boolean>，归一成 Promise 后判定。
    const ok = await Promise.resolve(api.sendReq(context, request))
    if (!ok) {
      throw new Error('WeChat rejected the mini-program launch request')
    }
  }

  /**
   * 打开支付宝收银台 URL；失败抛错（无应用可处理该链接）。
   * openLink(appLinkingOnly:false) 官方语义：https 先按 App Linking 匹配，无匹配
   * 降级 Deep Linking（自定义 scheme，如 alipays://），仍无匹配则用浏览器打开——
   * 覆盖收银台全部形态；openLink 抛错时自定义 scheme 再走隐式 Want 兜底。
   */
  async openPayUrl(context: common.UIAbilityContext, url: string): Promise<void> {
    const lower: string = url.toLowerCase()
    const isCustomScheme: boolean = !lower.startsWith('http://') && !lower.startsWith('https://')
    try {
      await context.openLink(url, { appLinkingOnly: false })
      return
    } catch (err) {
      if (!isCustomScheme) {
        // arkts-limited-throw：catch 参数为 unknown，须断言为 Error 再抛。
        throw err as Error
      }
      const want: Want = {
        action: 'ohos.want.action.viewData',
        uri: url
      }
      await context.startAbility(want)
    }
  }
}
