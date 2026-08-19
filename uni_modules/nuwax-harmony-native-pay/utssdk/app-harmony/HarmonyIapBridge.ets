// Copyright Nuwax. All rights reserved.
//
// HarmonyIapBridge.ets
// nuwax-harmony-native-pay（HarmonyOS 华为 IAP Kit 桥）
//
// 鸿蒙端虚拟商品（订阅/充值）支付：IAP 环境检查、查询商品、拉起系统收银台、
// 查询未完成订单（补单）、确认发货。API 用法参照华为官方示例
// iapkit-sample-clientdemo-arkts（SubscriptionsPage / ConsumablesPage / JWSUtil）。
//
// 数据流约定：所有方法不抛错，返回结果 JSON 字符串（ok / code / message / needRecover /
// summary / orders），由 index.uts 解析后供业务层按字段消费；purchaseData 原文必须交
// 服务端验签（华为 Order 服务），前端仅解码 JWS payload 取 purchaseToken /
// purchaseOrderId 用于 finishPurchase（不验签）。
//
// AGC 前置（办理中，均不阻塞编译）：
//  - 开通商户服务、开启应用内购买服务、配置商品（productId 占位待替换）
//  - compatibleSdkVersion >= 14 无需公钥指纹 / client_id（本项目 target 6.0.0(20) 满足）

import { iap } from '@kit.IAPKit'
import { common } from '@kit.AbilityKit'
import { util } from '@kit.ArkTS'
import { BusinessError } from '@kit.BasicServicesKit'

const BASE64_PADDING_MOD: number = 4
const FINISH_STATUS_FINISHED: string = '1'

/** IAP purchaseData（JSON 字符串）顶层结构。 */
interface PurchaseDataRaw {
  jwsPurchaseOrder?: string
  jwsSubscriptionStatus?: string
}

/** JWS 解码后的订单 payload（官方 sample IapDataModel 同款）。 */
interface PurchaseOrderPayload {
  productId: string
  productType: string
  purchaseOrderId: string
  purchaseToken: string
  finishStatus?: string
}

/** 订阅状态 JWS 解码结构（订阅商品的订单在 lastSubscriptionStatus.lastPurchaseOrder）。 */
interface SubGroupStatusPayload {
  lastSubscriptionStatus?: SubscriptionStatusRaw
}

interface SubscriptionStatusRaw {
  lastPurchaseOrder?: PurchaseOrderPayload
}

/** 交付 UTS 层的购买摘要（ArkTS 严格模式：字段全部初始化，便于 JSON.stringify）。 */
class PurchaseSummary {
  purchaseData: string = ''
  productId: string = ''
  productType: string = ''
  purchaseOrderId: string = ''
  purchaseToken: string = ''
  finishStatus: string = ''
}

/** 交付 UTS 层的统一调用结果。 */
class IapCallResult {
  ok: boolean = false
  code: number = 0
  message: string = ''
  /** 官方建议：createPurchase 报 PRODUCT_OWNED / SYSTEM_ERROR 时需走未完成订单补单。 */
  needRecover: boolean = false
  summary: PurchaseSummary | null = null
  orders: PurchaseSummary[] = []
}

function toErrResult(err: BusinessError, needRecover: boolean): string {
  const r = new IapCallResult()
  r.code = err.code
  r.message = err.message
  r.needRecover = needRecover
  return JSON.stringify(r)
}

/** JWS payload 解码（base64url → utf-8）。不验签，验签由服务端完成。 */
function decodeJwsPayload(data: string): string {
  const parts: string[] = data.split('.')
  if (parts.length < 3) {
    return ''
  }
  let payload: string = parts[1].replace(new RegExp('-', 'g'), '+').replace(new RegExp('_', 'g'), '/')
  const pad: number = payload.length % BASE64_PADDING_MOD
  if (pad === 1) {
    return ''
  }
  if (pad > 1) {
    payload += new Array(BASE64_PADDING_MOD - pad + 1).join('=')
  }
  try {
    const decoder: util.TextDecoder = util.TextDecoder.create('utf-8', { ignoreBOM: true })
    const base64: util.Base64Helper = new util.Base64Helper()
    return decoder.decodeToString(base64.decodeSync(payload))
  } catch (_err) {
    return ''
  }
}

/** 从 purchaseData 提取购买摘要：优先 jwsPurchaseOrder，订阅商品回退订阅状态 JWS。 */
function extractPurchaseSummary(purchaseData: string): PurchaseSummary | null {
  let raw: PurchaseDataRaw
  try {
    raw = JSON.parse(purchaseData) as PurchaseDataRaw
  } catch (_err) {
    return null
  }
  let order: PurchaseOrderPayload | null = null
  if (raw.jwsPurchaseOrder) {
    const decoded: string = decodeJwsPayload(raw.jwsPurchaseOrder)
    if (decoded.length > 0) {
      try {
        order = JSON.parse(decoded) as PurchaseOrderPayload
      } catch (_err) {
        order = null
      }
    }
  }
  if (order === null && raw.jwsSubscriptionStatus) {
    const decoded: string = decodeJwsPayload(raw.jwsSubscriptionStatus)
    if (decoded.length > 0) {
      try {
        const sub: SubGroupStatusPayload = JSON.parse(decoded) as SubGroupStatusPayload
        order = sub.lastSubscriptionStatus?.lastPurchaseOrder ?? null
      } catch (_err) {
        order = null
      }
    }
  }
  if (order === null) {
    return null
  }
  const summary: PurchaseSummary = new PurchaseSummary()
  summary.purchaseData = purchaseData
  summary.productId = order.productId ?? ''
  summary.productType = order.productType ?? ''
  summary.purchaseOrderId = order.purchaseOrderId ?? ''
  summary.purchaseToken = order.purchaseToken ?? ''
  summary.finishStatus = order.finishStatus ?? ''
  return summary
}

export class HarmonyIapBridge {
  /** IAP 环境检查（华为账号登录态 / 服务可用）。 */
  async queryEnvironment(context: common.UIAbilityContext): Promise<string> {
    const r: IapCallResult = new IapCallResult()
    try {
      await iap.queryEnvironmentStatus(context)
      r.ok = true
    } catch (err) {
      const e: BusinessError = err as BusinessError
      r.code = e.code
      r.message = e.message
    }
    return JSON.stringify(r)
  }

  /** 查询 AGC 配置的商品信息，成功时 orders 字段携带商品数组。 */
  async queryProducts(context: common.UIAbilityContext, productType: number, productIds: string[]): Promise<string> {
    const r: IapCallResult = new IapCallResult()
    try {
      const param: iap.QueryProductsParameter = {
        productType: productType as iap.ProductType,
        productIds: productIds,
      }
      const products = await iap.queryProducts(context, param)
      r.ok = true
      // 复用 orders 字段承载商品列表（iap.Product 数组），业务层按需读取。
      r.message = JSON.stringify(products)
    } catch (err) {
      const e: BusinessError = err as BusinessError
      r.code = e.code
      r.message = e.message
    }
    return JSON.stringify(r)
  }

  /** 拉起 IAP 系统收银台；成功时 summary 携带购买摘要（含 purchaseData 原文）。 */
  async createPurchase(context: common.UIAbilityContext, productId: string, productType: number): Promise<string> {
    const r: IapCallResult = new IapCallResult()
    try {
      const param: iap.PurchaseParameter = {
        productId: productId,
        productType: productType as iap.ProductType,
      }
      const result = await iap.createPurchase(context, param)
      const summary: PurchaseSummary | null = extractPurchaseSummary(result.purchaseData)
      if (summary === null) {
        r.message = 'iap purchaseData decode failed'
        return JSON.stringify(r)
      }
      r.ok = true
      r.summary = summary
    } catch (err) {
      const e: BusinessError = err as BusinessError
      r.code = e.code
      r.message = e.message
      r.needRecover = e.code === iap.IAPErrorCode.PRODUCT_OWNED || e.code === iap.IAPErrorCode.SYSTEM_ERROR
    }
    return JSON.stringify(r)
  }

  /** 查询购买记录；queryUnfinished=true 查未完成订单（补单），orders 仅含待发货确认项。 */
  async queryPurchases(context: common.UIAbilityContext, productType: number, queryUnfinished: boolean): Promise<string> {
    const r: IapCallResult = new IapCallResult()
    try {
      const param: iap.QueryPurchasesParameter = {
        productType: productType as iap.ProductType,
        queryType: queryUnfinished ? iap.PurchaseQueryType.UNFINISHED : iap.PurchaseQueryType.CURRENT_ENTITLEMENT,
      }
      const res = await iap.queryPurchases(context, param)
      const dataList: string[] = res.purchaseDataList ?? []
      for (let i: number = 0; i < dataList.length; i++) {
        const s: PurchaseSummary | null = extractPurchaseSummary(dataList[i])
        if (s !== null && s.finishStatus !== FINISH_STATUS_FINISHED) {
          r.orders.push(s)
        }
      }
      r.ok = true
    } catch (err) {
      const e: BusinessError = err as BusinessError
      r.code = e.code
      r.message = e.message
    }
    return JSON.stringify(r)
  }

  /** 确认发货（finishStatus → FINISHED）。未确认的订单可经 queryPurchases(UNFINISHED) 补单。 */
  async finishPurchase(context: common.UIAbilityContext, productType: number, purchaseToken: string, purchaseOrderId: string): Promise<string> {
    const r: IapCallResult = new IapCallResult()
    try {
      const param: iap.FinishPurchaseParameter = {
        productType: productType,
        purchaseToken: purchaseToken,
        purchaseOrderId: purchaseOrderId,
      }
      await iap.finishPurchase(context, param)
      r.ok = true
    } catch (err) {
      const e: BusinessError = err as BusinessError
      r.code = e.code
      r.message = e.message
    }
    return JSON.stringify(r)
  }
}
