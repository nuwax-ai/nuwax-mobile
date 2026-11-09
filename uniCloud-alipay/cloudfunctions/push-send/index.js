'use strict';

const crypto = require('crypto')

const APP_ID = '__UNI__8BF05E4'          // 本项目的 DCloud AppID
// 后端握手密钥：**只**从环境变量读（uniCloud 控制台 → 云函数 → 环境变量 PUSH_SIGN_KEY）。
// ★代码里绝不留兜底值：本仓库会推送到公开的 GitHub 镜像，硬编码密钥等于公开。
// 未配置环境变量时一律拒绝（fail-closed），部署顺序必须是「先配环境变量，再上传代码」。
const SIGN_KEY = process.env.PUSH_SIGN_KEY || ''
const BATCH_SIZE = 500                    // 单次最多 500 个 cid
// 官方长度上限（uni-push 2.0 服务端 sendMessage 入参说明）：超长会被厂商通道截断或拒绝
const MAX_TITLE = 19                      // 通知栏标题（官方：小于 20，留一格给省略号）
const MAX_CONTENT = 49                    // 通知栏内容（官方：小于 50）
const MAX_PAYLOAD = 800                   // 透传数据字符数
// 消息分类：★只有鸿蒙通道「必填」，不配会被认定为"营销类别"而限量推送。
// ★华为/小米等 Android 通道的 category 是「自分类权益」，必须先在厂商后台申请到该分类才能传，
//   未申请就传可能被拒或降级 —— 所以我们只默认给 harmony，其余通道留给后端按需显式覆盖。
const DEFAULT_CATEGORY = { harmony: 'IM' }

const uniPush = uniCloud.getPushManager({ appId: APP_ID })

// ==================== 厂商离线角标（Vendor Badge Adapter） ====================
//
// 职责边界（架构约定，改动前先读完）：
//   业务层只维护 `unreadCount`（= IM 未读总数），**不出现任何厂商字段名**。
//   由本层的 PushRouter（buildVendorBadgeOptions）+ 各 VendorBadgeAdapter 负责把
//   同一个数字翻译成各厂商 Push Payload 的角标字段。
//
// ★为什么需要这一层：`uni.setAppBadgeNumber()` 只能在 App 进程运行时执行。App 退后台
//   （进程被冻结）或进程被杀时，端上一行代码都不会跑 —— 那一刻桌面角标只能由厂商推送
//   通道在系统侧直接写入。所以「离线角标」必须由服务端塞进厂商 Payload。
//
// ★为什么一次可以带多个厂商：uni-push 的 `options.android` 直接映射到个推
//   `push_channel.android.ups.options`（HBuilderX 内置官方文档 uni-cloud-push/options.md），
//   里面按通道 key（"HW" / "XM" / ...）分组；个推只把当前设备所属通道的那份应用到该通道，
//   其余键忽略。官方 options.md 的示例本身就同时对 XM 和 HW 下发参数
//   ⇒ **服务端不需要知道设备品牌**（后端 UserDevice 也确实只有 platform，没有 brand）。
//
// ★为什么不用顶层 badge 解决 Android：官方 api.md 明确写了
//   `badge` 的平台特性 = 「ios、android-huawei、harmony-huawei
//   （注意：基于uni-app-x的应用在华为手机上暂不支持）」。
//   options 是「厂商文档支持的参数可直接使用」的直通口（api.md options 行），
//   所以华为走 options 下发原生 badge 字段，绕开 uni-app x 的限制 —— **必须真机验证**。
//
// 能力矩阵（2026-11 调研，来源见各 adapter 注释）：
//   华为 HW    ✅ 数字角标：/message/android/notification/badge/{class,set_num}
//   荣耀 HO    ⏳ 语法与华为不同（/android/notification/badge/{badgeClass,setNum}），
//                通道 key 未经本项目真机验证 —— 先 enabled:false，避免整批推送被厂商拒。
//   小米 XM    ❌ 无角标 API：MIUI 角标 = 通知栏条数，系统自动增减，无法指定数字。
//   OPPO OP    ❌ 仅红点（数字角标需厂商准入）。
//   vivo VV    ⚠️ 红点/数字取决于系统开关与 BADGE_ICON 权限，无法稳定指定数字。
//   iOS        ✅ 走顶层 `badge`（APNs aps.badge），不经 options。
//   鸿蒙       ✅ 走顶层 `badge`。
//
// ⇒ 厂商能做的走这里；做不到的（小米/OPPO/vivo）只能靠 App 运行时
//   setAppBadgeNumber 兜底，或后续接 Foreground Service 方案。

/** 本包桌面入口 Activity 全路径 —— aapt2 dump badging 实证（正式包与调试包一致，
 *  uni-app x 固定为 UniAppActivity）。
 *  ★华为 badge.class 必填且必须是 launcher activity，写错整条角标不生效（不报错）。 */
const HW_LAUNCHER_ACTIVITY = 'io.dcloud.uniapp.UniAppActivity'
/** 华为 set_num 取值 0~99（≥100 系统显示 99+；这里先夹到 99，避免厂商侧拒收）。 */
const VENDOR_BADGE_MAX = 99

/**
 * 【华为】HuaweiBadgeAdapter
 * 华为 Push Kit：AndroidConfig.Notification.Badge
 *   /message/android/notification/badge/class    必填，桌面入口 Activity 全路径
 *   /message/android/notification/badge/set_num  固定值 0~99
 *   /message/android/notification/badge/add_num  累加值 1~99
 * set_num 用真实未读总数 ⇒ 每条推送都把角标拉回服务端口径，丢推送也能自愈；
 * add_num 丢一条就永久偏小且无法自愈，不用。
 * 两者同时存在以 set_num 为准；都为空时华为默认 +1（不是我们要的语义）。
 * @param {number} unreadCount
 */
function buildHuaweiBadge(unreadCount) {
  return {
    '/message/android/notification/badge/class': HW_LAUNCHER_ACTIVITY,
    '/message/android/notification/badge/set_num': unreadCount
  }
}

/**
 * 【荣耀】HonorBadgeAdapter（未启用）
 * 荣耀 Magic UI 4.0+ 支持数字角标，字段路径与华为不同：
 *   /android/notification/badge/badgeClass  必填
 *   /android/notification/badge/setNum
 * ⚠️ 通道 key（推定为 "HO"）与字段名均未在本项目真机验证，贸然下发有整批被拒风险。
 */
function buildHonorBadge(unreadCount) {
  return {
    '/android/notification/badge/badgeClass': HW_LAUNCHER_ACTIVITY,
    '/android/notification/badge/setNum': unreadCount
  }
}
// 小米/OPPO/vivo 没有对应的 adapter：官方就没有「指定数字角标」的字段
// （见文件头能力矩阵），不写空实现，免得后人以为漏了。

/**
 * 适配器注册表：新增厂商只需在这里加一项。
 * channel = 个推 options.android 的通道 key（华为 "HW"，荣耀 "HO"…）。
 * enabled=false 的不参与下发（保留实现，待真机验证后打开）。
 * @type {{vendor:string, channel:string, enabled:boolean, build:(n:number)=>Object}[]}
 */
const VENDOR_BADGE_ADAPTERS = [
  { vendor: 'Huawei', channel: 'HW', enabled: true, build: buildHuaweiBadge },
  { vendor: 'Honor', channel: 'HO', enabled: false, build: buildHonorBadge }
]

/**
 * badge 入参归一：只接受绝对值（Number 或数字字符串）。
 * 官方 `badge` 支持 "+1"/"-1" 这类增量语义，但厂商 set_num 只吃固定值，
 * 增量在离线厂商通道里无法表达 ⇒ 返回 null（调用方保持原样只走顶层 badge）。
 */
function parseBadgeCount(badge) {
  if (badge === undefined || badge === null || badge === '') return null
  const s = String(badge).trim()
  if (!/^\d+$/.test(s)) return null
  const n = parseInt(s, 10)
  return isNaN(n) ? null : n
}

/**
 * PushRouter：业务 unreadCount → 各厂商 options.android。
 * @param {number|string} badge 服务端算出的未读总数
 * @returns {Object|null} 如 { android: { HW: {...} } }；null = 本次不下发厂商角标
 */
function buildVendorBadgeOptions(badge) {
  const raw = parseBadgeCount(badge)
  if (raw === null) return null
  const unreadCount = Math.max(0, Math.min(raw, VENDOR_BADGE_MAX))
  const android = {}
  for (const adapter of VENDOR_BADGE_ADAPTERS) {
    if (!adapter.enabled) continue
    android[adapter.channel] = adapter.build(unreadCount)
  }
  return Object.keys(android).length ? { android } : null
}

// 简单签名校验：后端在 header 里带 X-Push-Sign
function verifySign(event) {
  // 环境变量缺失：fail-closed（否则空密钥 + 空 header 会被判为相等）
  if (!SIGN_KEY) {
    console.error('[push-send] PUSH_SIGN_KEY 未配置，拒绝所有请求')
    return false
  }
  const headers = event.headers || {}
  const sign = headers['x-push-sign'] || headers['X-Push-Sign'] || ''
  if (!sign) return false
  const a = Buffer.from(sign)
  const b = Buffer.from(SIGN_KEY)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** 按码点截断（中文/emoji 不会被切成半个字符），超长补省略号。 */
function clip(value, max) {
  const s = value == null ? '' : String(value).trim()
  const chars = Array.from(s)
  if (chars.length <= max) return s
  return chars.slice(0, max - 1).join('') + '…'
}

/**
 * payload 长度保护：官方上限 800 字符，且要求用 Object 格式（否则离线厂商通道取不到值）。
 * 超长时只保留跳转必需字段（convId/convType）——name/avatar 端上本来就会自己拉，
 * 塞进 payload 既挤占额度，又可能让厂商通道丢弃整段透传数据。
 */
function normalizePayload(payload) {
  const src = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
  if (JSON.stringify(src).length <= MAX_PAYLOAD) return src
  const slim = {}
  if (src.convId !== undefined && src.convId !== null) slim.convId = src.convId
  if (src.convType !== undefined && src.convType !== null) slim.convType = src.convType
  return slim
}

/**
 * 把未读总数塞进 payload。
 * ★为什么必须这么做：iOS 退后台但进程仍存活时（本项目 UIBackgroundModes 含 audio），
 *   个推长连接不断 ⇒ 服务端判定「在线」，推送以**在线透传**回调到 JS，**不走 APNs**，
 *   顶层 badge 在这一刻不生效（桌面角标不动；Android 走厂商通道所以正常）。
 *   端上只能从 payload 里拿数字自己调 setAppBadgeNumber 补设，见
 *   utils/im/imPushClient.uts → showLocalNoticeForReceive。
 * ★payload 上限 800 字符，超了宁可不加：透传被截断/丢弃比少个角标严重得多。
 */
function attachBadgeToPayload(payload, badge) {
  const n = parseBadgeCount(badge)
  if (n === null) return payload
  const out = Object.assign({}, payload)
  out.badge = n
  return JSON.stringify(out).length <= MAX_PAYLOAD ? out : payload
}

exports.main = async (event) => {
  if (!verifySign(event)) {
    console.error('[push-send] rejected: invalid sign')
    return { errCode: 401, errMsg: 'invalid sign' }
  }

  let body = {}
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : (event.body || '{}')
    body = JSON.parse(raw)
  } catch (e) {
    return { errCode: 400, errMsg: 'invalid json body' }
  }

  const ids = Array.isArray(body.push_clientid) ? body.push_clientid : [body.push_clientid]
  if (!ids.length || !ids[0]) return { errCode: 400, errMsg: 'push_clientid required' }
  if (!body.title || !body.content) return { errCode: 400, errMsg: 'title/content required' }

  // 长度限制：厂商通道会静默截断甚至拒绝，这里先按官方上限裁好（按码点裁，不切坏 emoji）
  const title = clip(body.title, MAX_TITLE)
  const content = clip(body.content, MAX_CONTENT)
  // 先裁剪再塞角标：normalizePayload 超长时只保留 convId/convType，会把 badge 一起丢掉
  const payload = attachBadgeToPayload(normalizePayload(body.payload), body.badge)
  const category = body.category && typeof body.category === 'object' ? body.category : DEFAULT_CATEGORY
  // 厂商离线角标参数（App 进程不在时唯一能改桌面角标的途径）
  const vendorBadgeOptions = buildVendorBadgeOptions(body.badge)

  // 运维日志：证明「后端确实调了云函数」，并回显本次下发的关键参数
  // （uniCloud 控制台 → 云函数 push-send → 日志）。
  // ★不落文案与 payload 明文：云端日志多人可查，消息内容属于用户隐私。
  //   要核对"文案被截断/角标没生效"，看响应里的 applied 回显即可。
  console.log('[push-send] req', JSON.stringify({
    cidCount: ids.length,
    cidSample: ids.slice(0, 2),
    titleLength: title.length,
    contentLength: content.length,
    convId: payload && payload.convId ? payload.convId : null,
    convType: payload && payload.convType ? payload.convType : null,
    payloadLength: JSON.stringify(payload || {}).length,
    badge: body.badge === undefined ? null : body.badge,
    force_notification: body.force_notification !== false,
    request_id: body.request_id || null
  }))

  const results = []
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE)
    const args = {
      push_clientid: chunk,
      title: title,
      content: content,
      payload: payload,
      force_notification: body.force_notification !== false,
      category: category,
      request_id: body.request_id || undefined
    }
    // ★角标：Number 或 String（"+1"/"-1"/绝对值）。同一批 cid 只能共用一个值，
    //   因此调用方必须保证一批 = 同一个接收者的设备（见 docs/engineering/im-offline-push.md）。
    //   顶层 badge 只吃 iOS（APNs aps.badge）与鸿蒙通道；华为等 Android 厂商通道
    //   不认它（官方标注「基于 uni-app-x 的应用在华为手机上暂不支持」）⇒ 见下面的 options。
    if (body.badge !== undefined && body.badge !== null && body.badge !== '') {
      args.badge = body.badge
    }
    // ★Android 厂商离线角标：华为走 Push Kit 原生字段，系统侧直接写桌面图标，
    //   全程不依赖 App 进程（验收场景 C：进程被杀仍要显示数字）。
    if (vendorBadgeOptions != null) {
      args.options = vendorBadgeOptions
    }
    try {
      const res = await uniPush.sendMessage(args)
      console.log('[push-send] batch', chunk.length, 'errCode=', res && res.errCode, res && res.errMsg)
      // errCode=0 只代表 DCloud 受理，不代表送达；完整结果里可能有按端的任务 id / 失败明细
      console.log('[push-send] batch res', JSON.stringify(res))
      results.push(res)
    } catch (err) {
      console.error('[push-send] batch threw:', (err && err.message) || String(err))
      results.push({ errCode: -1, errMsg: (err && err.message) || String(err), push_clientid: chunk })
    }
  }

  const failed = results.filter(r => r && r.errCode)
  return {
    errCode: failed.length ? failed[0].errCode : 0,
    errMsg: failed.length ? failed[0].errMsg : 'ok',
    data: {
      total: ids.length,
      batches: results.length,
      failedBatches: failed.length,
      // 回显裁剪后的实际下发值，便于排查"文案被截断/角标没生效"
      applied: {
        titleLength: Array.from(title).length,
        contentLength: Array.from(content).length,
        payloadLength: JSON.stringify(payload).length,
        badge: body.badge === undefined ? null : body.badge,
        // 厂商角标实际下发值（华为 set_num 等）：排查「后台收推送但桌面没数字」时先看这里
        vendorBadge: vendorBadgeOptions,
        category: category
      },
      results
    }
  }
}
