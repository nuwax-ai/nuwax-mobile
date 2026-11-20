'use strict';

const crypto = require('crypto')
const { callTargetCids, prepareVoip, prepareNativeVoip, prepareVoipScene, prepareMeetingRingInvitation } = require('./voip')

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
// 临时联调开关：设为 1 时输出推送正文、完整 payload 与目标 cid。
// 默认关闭，避免生产云函数日志长期留存用户私聊内容。
const DEBUG_MESSAGE_CONTENT = process.env.PUSH_DEBUG_MESSAGE_CONTENT === '1'
// 消息分类：★只有鸿蒙通道「必填」，不配会被认定为"营销类别"而限量推送。
// ★华为/小米等 Android 通道的 category 是「自分类权益」，必须先在厂商后台申请到该分类才能传，
//   未申请就传可能被拒或降级 —— 所以我们只默认给 harmony，其余通道留给后端按需显式覆盖。
const DEFAULT_CATEGORY = { harmony: 'IM' }
// 通知分类/渠道只看后端信封 type：
//   type="voip" → VOIP（华为需已申请自分类权益）+ 华为 VoipCall 渠道
//   其余（IM/未传）→ 保持原 IM 逻辑，不传 channelId
const CALL_CATEGORY = { harmony: 'VOIP', huawei: 'VOIP' }
// ★uni-push sendMessage 没有顶层 channelId 字段，Android 通知渠道只能走 options 厂商透传。
//   官方 options.md 明确给出的是华为 /message/android/notification/channel_id；
//   小米 /extra.channel_id 是「小米后台申请的通知类别 id」，与端上渠道名不是一回事，
//   未确认前不下发，避免整批被厂商拒。
const VOIP_CHANNEL = 'VoipCall'

/** 分类只看后端信封 type：voip → VOIP；其余保持 IM 原逻辑，避免破坏普通消息。 */
function notificationCategory(body) {
  if (body.type === 'voip') return CALL_CATEGORY
  return body.category && typeof body.category === 'object' ? body.category : DEFAULT_CATEGORY
}

/** 只有 voip 信封才下发 VoipCall 渠道；IM 消息不传 channelId。 */
function notificationChannel(body) {
  return body.type === 'voip' ? VOIP_CHANNEL : ''
}

/**
 * 新契约允许后端只传顶层 type="voip"，payload.type 由云函数回填。
 * ★只在 payload.type 缺失、顶层显式声明 voip，且 payload 带通话/会议标识时补。
 *   加了 scene/callId/calleeId 这一层是为了防止后端把「消息 wire type」放在顶层 type：
 *   一条 msgType=voip 的 IM 消息若被误回填，会走邀请通道并被重写 payload。
 *   IM 普通消息的 payload 只有 convId/convType，不会命中这个条件。
 */
function withEnvelopeType(body) {
  const payload = body.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return body
  if (payload.type !== undefined) return body
  if (body.type !== 'voip') return body
  const looksLikeVoip = payload.scene === 'call' || payload.scene === 'meeting' ||
    payload.callId !== undefined || payload.calleeId !== undefined
  if (!looksLikeVoip) return body
  return Object.assign({}, body, { payload: Object.assign({}, payload, { type: 'voip' }) })
}

/** 只有白名单渠道名才下发，避免调用方注入任意通知渠道。 */
function buildChannelOptions(channelId) {
  if (channelId !== VOIP_CHANNEL) return null
  return {
    android: {
      HW: { '/message/android/notification/channel_id': VOIP_CHANNEL }
    }
  }
}

/** 厂商角标 options 与通话渠道 options 必须合并，直接赋值会互相覆盖。 */
function mergeOptions(base, extra) {
  if (base == null) return extra
  if (extra == null) return base
  const out = Object.assign({}, base, extra)
  const android = Object.assign({}, base.android || {})
  for (const key of Object.keys(extra.android || {})) {
    android[key] = Object.assign({}, android[key] || {}, extra.android[key])
  }
  if (Object.keys(android).length) out.android = android
  out.ios = Object.assign({}, base.ios || {}, extra.ios || {})
  if (!Object.keys(out.ios).length) delete out.ios
  out.harmony = Object.assign({}, base.harmony || {}, extra.harmony || {})
  if (!Object.keys(out.harmony).length) delete out.harmony
  return out
}

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
//   鸿蒙       ✅ 顶层 `badge` 保留兼容，同时通过 options.harmony.HW 直传
//                Push Kit `/payload/notification/badge`，避免 uni-push 未映射顶层字段。
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
 * 【鸿蒙】HarmonyHuaweiBadgeAdapter
 * Huawei Push Kit HarmonyOS 通知角标字段：payload.notification.badge.setNum。
 * uni-push 厂商参数以 JSON Pointer 路径透传；使用固定值保证与服务端未读总数一致。
 * @param {number} unreadCount
 */
function buildHarmonyHuaweiBadge(unreadCount) {
  return {
    '/payload/notification/badge': {
      setNum: unreadCount
    }
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
 * PushRouter：业务 unreadCount → Android / HarmonyOS 厂商参数。
 * @param {number|string} badge 服务端算出的未读总数
 * @returns {Object|null} 如 { android: { HW: {...} }, harmony: { HW: {...} } }；null = 本次不下发厂商角标
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
  return {
    android,
    harmony: {
      HW: buildHarmonyHuaweiBadge(unreadCount)
    }
  }
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

function callTransportEnabled(route) {
  return route.transport === 'ios-voip'
    ? process.env.NUWAX_VOIP_IOS_APNS_ENVIRONMENT === route.environment
    : (process.env.NUWAX_VOIP_ANDROID_TRANSPORTS || '').split(',').includes(route.transport)
}

async function sendNativeVoip(body, route, nativeVoip, invocationId) {
  const android = route.platform === 'android'
  if (android && typeof uniPush.request !== 'function') {
    return { errCode: 503, errMsg: 'UniPush transmission adapter unavailable', data: { requestId: nativeVoip.requestId } }
  }
  try {
    let result
    if (android) {
      const transmission = JSON.stringify({ unipush_version: '2.0', payload: nativeVoip.payload })
      // sendMessage builds ups.notification even when force_notification is false.
      result = await uniPush.request({
        method: 'POST',
        module: '/push/single/cid',
        requestData: {
          request_id: nativeVoip.requestId,
          audience: { cid: [route.cid] },
          settings: nativeVoip.settings,
          push_message: { transmission },
          push_channel: { android: { ups: { transmission } } }
        }
      })
    } else {
      const nativeOptions = mergeOptions(nativeVoip.options, buildChannelOptions(notificationChannel(body)))
      result = await uniPush.sendMessage({
        push_clientid: [route.cid],
        title: clip(body.title, MAX_TITLE),
        content: clip(body.content, MAX_CONTENT),
        payload: nativeVoip.payload,
        settings: nativeVoip.settings,
        category: notificationCategory(body),
        force_notification: false,
        request_id: nativeVoip.requestId,
        ...(nativeOptions ? { options: nativeOptions } : {})
      })
    }
    const errCode = result?.errCode ?? -1
    const details = result?.data && typeof result.data === 'object'
      ? Object.entries(result.data).filter(([key, value]) =>
        /^[A-Za-z0-9_-]{10,128}$/.test(key) && key !== route.cid &&
        value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, route.cid))
      : []
    const tasks = details.map(([taskId, targets]) => {
      const status = targets[route.cid]
      return { taskId, status: typeof status === 'string' && /^[A-Za-z0-9_-]{1,50}$/.test(status) ? status : 'unknown' }
    })
    console.log('[push-send] call transport', JSON.stringify({
      invocationId, transport: route.transport, cid: route.cid, callId: nativeVoip.payload.callId,
      requestId: nativeVoip.requestId, errCode,
    }))
    return { errCode, data: { requestId: nativeVoip.requestId, tasks } }
  } catch {
    console.error('[push-send] call transport failed', JSON.stringify({ invocationId, cid: route.cid, requestId: nativeVoip.requestId }))
    return { errCode: -1, data: { requestId: nativeVoip.requestId } }
  }
}

// ==================== 请求体检日志（排查「一次通话收到多条推送」） ====================
//
// ★排查口径：后端每次调用 = 一次独立的推送意图。所以日志必须让「同一条推送被调了几次」
//   一眼可数 —— 每个请求打一行 `[push-send] in` 摘要，收尾再打一行 `[push-send] done` 耗时。
//   ★摘要常开、且不含用户文案：cid 数/去重后数量、信封字段、通话/会议定位字段、路由与耗时
//     已经足够定性「云函数发了多次」还是「后端触发了多次」。
//   ★完整信封（含 title/content 原文与 payload 全文）由环境变量 PUSH_DEBUG_REQUEST=1 打开，
//     只在需要逐字段比对时临时开启，避免生产日志长期留存用户私聊内容。签名头永不打印。
const DEBUG_REQUEST = process.env.PUSH_DEBUG_REQUEST === '1'
const CID_LOG_LIMIT = 20            // 摘要里最多列出的 cid（足以看出重复/多设备）
const TEXT_HASH_LEN = 8             // 文案指纹长度：比对「是不是同一条」而不落原文

/** 文案指纹：同一 title+content ⇒ 同一指纹。日志不留原文也能判定两次推送是否同一条。 */
function textFingerprint(title, content) {
  return crypto.createHash('sha256')
    .update(`${title == null ? '' : String(title)}\u0000${content == null ? '' : String(content)}`)
    .digest('hex').slice(0, TEXT_HASH_LEN)
}

/**
 * 后端信封摘要。字段顺序固定，日志里一眼能对齐。
 * ★duplicateCids > 0 是硬信号：一次请求里带了重复 cid ⇒ 普通通道会下发多次（见 ids 归一）。
 */
function describeEnvelope(body, event, rawBodyLength) {
  const payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload) ? body.payload : null
  const rawIds = Array.isArray(body.push_clientid) ? body.push_clientid : [body.push_clientid]
  const cids = rawIds.filter(v => typeof v === 'string' && v.length > 0)
  const route = body.callRoute && typeof body.callRoute === 'object' ? body.callRoute : null
  const pick = field => (payload && payload[field] !== undefined ? payload[field] : undefined)
  return {
    httpMethod: event.httpMethod ?? event.method ?? null,
    path: event.path ?? null,
    bodyBytes: rawBodyLength,
    // 信封骨架（区分 IM 普通消息 / 来电呼叫 / 会议邀请与响铃意图）
    type: body.type ?? null,
    scene: body.scene ?? pick('scene') ?? null,
    payloadType: pick('type') ?? null,
    requestId: body.request_id ?? null,
    forceNotification: body.force_notification ?? null,
    category: body.category ?? null,
    badge: body.badge ?? null,
    // 目标设备：这三个数就是判断「一次调用扇出几台设备」的直接依据
    cidCount: rawIds.length,
    distinctCids: new Set(cids).size,
    duplicateCids: rawIds.length - new Set(cids).size,
    cidsSample: cids.slice(0, CID_LOG_LIMIT),
    // 业务定位字段（雪花号一律是字符串，原样打印才不丢精度）
    convId: pick('convId') ?? null,
    convType: pick('convType') ?? null,
    msgId: pick('msgId') ?? null,
    callId: pick('callId') ?? null,
    inviteId: pick('inviteId') ?? null,
    calleeId: pick('calleeId') ?? null,
    mediaType: pick('mediaType') ?? null,
    silent: pick('silent') ?? null,
    groupCall: pick('groupCall') ?? null,
    expiresAt: pick('expiresAt') ?? null,
    sendTime: pick('sendTime') ?? null,
    // 定向路由（后端逐设备投递时才带）
    callRoute: route == null ? null : {
      cid: route.cid ?? null,
      platform: route.platform ?? null,
      transport: route.transport ?? null,
      environment: route.environment ?? null,
      hasRegistrationId: typeof route.registrationId === 'string' && route.registrationId.length > 0,
    },
    // 文案只留长度与指纹；要正文就开 PUSH_DEBUG_REQUEST
    titleLength: body.title == null ? 0 : Array.from(String(body.title)).length,
    contentLength: body.content == null ? 0 : Array.from(String(body.content)).length,
    textFingerprint: textFingerprint(body.title, body.content),
  }
}

async function handle(event, invocationId) {
  if (!verifySign(event)) {
    console.error('[push-send] rejected: invalid sign')
    return { errCode: 401, errMsg: 'invalid sign' }
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '{}')
  let body = {}
  try {
    body = JSON.parse(rawBody)
  } catch (e) {
    console.error('[push-send] invalid json body', JSON.stringify({ invocationId, bodyBytes: rawBody.length }))
    return { errCode: 400, errMsg: 'invalid json body' }
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return { errCode: 400, errMsg: 'invalid request body' }
  // 顶层 type="voip" 是通话/会议的显式声明；payload.type 缺失时由云函数回填。
  body = withEnvelopeType(body)
  // ★每个请求一行摘要：数 `[push-send] in` 的行数 = 后端/网关实际调了几次。
  try {
    console.log('[push-send] in', JSON.stringify({ invocationId, ...describeEnvelope(body, event, rawBody.length) }))
    if (DEBUG_REQUEST) {
      // 完整信封原文（不含签名头）：对照字段口径时用，排查完请关掉开关。
      console.log('[push-send] in raw', JSON.stringify({ invocationId, body }))
    }
  } catch (e) {
    // 日志异常绝不能影响投递
    console.error('[push-send] in log failed', invocationId)
  }
  const scene = prepareVoipScene(body)
  if (scene?.error) return { errCode: 400, errMsg: scene.error }
  if (scene?.meeting && JSON.stringify(scene.meeting).length > MAX_PAYLOAD) {
    return { errCode: 400, errMsg: 'meeting invitation payload too large' }
  }
  // 会议响铃：走原生来电通道（PushKit / 全屏 Intent / 前台服务），让熄屏和进程被杀时
  // 也能亮屏、响铃并出现来电卡片。测试空间不再用环境变量总闸，也不以 callRoute 是否存在
  // 作为决策条件：后端给了路由就原生投递，没给就回退普通通知。
  const meetingRequested = scene?.meeting != null &&
    body.payload?.silent !== true
  // 响铃字段不完整/已过期时回退普通 IM 通知，不能整条 400——否则用户连会议卡片都收不到。
  const ringAttempt = meetingRequested ? prepareMeetingRingInvitation(body) : null
  const meetingRinging = ringAttempt != null && ringAttempt.error == null && ringAttempt.expired !== true
  const strictCids = scene?.call != null || meetingRinging
  // 会议响铃排查：只记决策相关的布尔与会议定位字段，不落邀请正文或用户身份。
  if (scene?.meeting != null) {
    console.log('[push-send] meeting decision', JSON.stringify({
      hasCallRoute: body.callRoute != null,
      silent: body.payload?.silent === true,
      inviteId: body.payload?.inviteId ?? null,
      roomName: body.payload?.roomName ?? null,
      mediaType: body.payload?.mediaType ?? null,
      convType: body.payload?.convType ?? null,
      hasCallId: typeof body.payload?.callId === 'string',
      hasCalleeId: typeof body.payload?.calleeId === 'string',
      hasExpiresAt: Number.isSafeInteger(body.payload?.expiresAt),
      hasSendTime: Number.isSafeInteger(body.payload?.sendTime),
      ringRequested: meetingRequested,
      ringError: ringAttempt?.error ?? null,
      ringExpired: ringAttempt?.expired === true,
      meetingRinging
    }))
  }
  const nativeAttempt = scene?.meeting && !meetingRinging ? null : prepareNativeVoip(body)
  const nativeVoip = nativeAttempt?.error && strictCids ? null : nativeAttempt
  if (nativeVoip) {
    if (nativeVoip.error) return { errCode: 400, errMsg: nativeVoip.error }
    if (nativeVoip.expired) return { errCode: 0, data: { skipped: true } }
    if (!body.title || !body.content) return { errCode: 400, errMsg: 'title/content required' }
    const route = body.callRoute
    if (!callTransportEnabled(route)) {
      // 定向原生请求（无 scene/call）仍 fail-closed；通话/会议回退普通通知。
      if (!strictCids) return { errCode: 503, errMsg: 'call transport unavailable' }
    } else {
      return sendNativeVoip(body, route, nativeVoip, invocationId)
    }
  }

  const ids = strictCids
    ? callTargetCids(body.push_clientid)
    : Array.isArray(body.push_clientid) ? body.push_clientid : [body.push_clientid]
  if (!ids?.length || !ids[0]) return { errCode: 400, errMsg: 'push_clientid required' }
  if (!body.title || !body.content) return { errCode: 400, errMsg: 'title/content required' }

  const voip = scene ? scene.call : prepareVoip(body)
  if (voip && voip.error) return { errCode: 400, errMsg: voip.error }
  if (voip && voip.expired) return { errCode: 0, errMsg: 'expired invitation skipped', data: { skipped: true, batches: 0 } }

  return sendOrdinaryPush(body, ids, voip, scene?.meeting, invocationId)
}

/**
 * 入口：给每次调用挂一个 invocationId 并记录耗时。
 * ★耗时是排查「后端重试」的关键：后端调云函数的超时默认 3s，超过就会被判可重试失败
 *   并进补推队列（30s 起指数退避，最多 12 次）⇒ 端上就会收到同一条推送多次。
 *   所以 `[push-send] done ... ms=` 若接近或超过 3000，先怀疑超时重试，而不是云函数重发。
 */
exports.main = async (event) => {
  const invocationId = crypto.randomBytes(4).toString('hex')
  const startedAt = Date.now()
  let code = 'threw'
  try {
    const result = await handle(event, invocationId)
    code = result && typeof result === 'object' ? (result.errCode ?? null) : 'invalid'
    return result
  } finally {
    console.log('[push-send] done', JSON.stringify({
      invocationId,
      errCode: code,
      ms: Date.now() - startedAt,
    }))
  }
}

async function sendOrdinaryPush(body, ids, voip, meeting, invocationId) {
  // 长度限制：厂商通道会静默截断甚至拒绝，这里先按官方上限裁好（按码点裁，不切坏 emoji）
  const title = clip(body.title, MAX_TITLE)
  const content = clip(body.content, MAX_CONTENT)
  // 先裁剪再塞角标：normalizePayload 超长时只保留 convId/convType，会把 badge 一起丢掉
  const payload = attachBadgeToPayload(voip?.payload ?? meeting ?? normalizePayload(body.payload), body.badge)
  // 分类只看信封 type：voip → VOIP；IM 消息保持后端传入/默认值不变。
  const category = notificationCategory(body)
  const privateInvitation = voip || payload.type === 'meeting_invite'
  // 厂商离线角标参数（App 进程不在时唯一能改桌面角标的途径）
  const vendorBadgeOptions = buildVendorBadgeOptions(body.badge)
  // 只有 voip 信封才下发 VoipCall 渠道；IM 消息不传 channelId。
  const channelOptions = buildChannelOptions(notificationChannel(body))
  const sendOptions = mergeOptions(vendorBadgeOptions, channelOptions)

  // 运维日志：证明「后端确实调了云函数」，并回显本次下发的关键参数
  // （uniCloud 控制台 → 云函数 push-send → 日志）。
  // ★不落文案与 payload 明文：云端日志多人可查，消息内容属于用户隐私。
  //   要核对"文案被截断/角标没生效"，看响应里的 applied 回显即可。
  console.log('[push-send] req', JSON.stringify({
    invocationId,
    cidCount: ids.length,
    cidSample: privateInvitation ? undefined : ids.slice(0, 2),
    titleLength: title.length,
    contentLength: content.length,
    convId: privateInvitation ? undefined : (payload && payload.convId ? payload.convId : null),
    convType: payload && payload.convType ? payload.convType : null,
    payloadLength: JSON.stringify(payload || {}).length,
    badge: body.badge === undefined ? null : body.badge,
    // 保留 feat-2026.11 的在线通知策略，展示由客户端前后台状态决定。
    force_notification: false,
    // ★幂等键照打：回退路径的 request_id 是云函数按 (cid, callId) 派生的哈希，
    //   排查「后端重试是否被厂商去重」时必须能对上这个值。
    requestId: body.request_id || null,
    ...(voip ? { kind: 'voip', ttl: voip.settings.ttl } : {})
  }))
  if (DEBUG_MESSAGE_CONTENT && !privateInvitation) {
    console.log('[push-send] message detail', JSON.stringify({
      push_clientid: ids,
      title,
      content,
      payload,
      badge: body.badge === undefined ? null : body.badge,
      category,
      force_notification: false,
      request_id: body.request_id || null
    }))
  }

  const results = []
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE)
    const args = {
      push_clientid: chunk,
      title: title,
      content: content,
      payload: payload,
      force_notification: false,
      category: category,
      request_id: body.request_id || undefined
    }
    // Ringing invites must not use the SDK's one-hour default retention.
    // Forward only the validated TTL; vendor capabilities/options need separate approval.
    if (voip) args.settings = voip.settings
    // ★角标：Number 或 String（"+1"/"-1"/绝对值）。同一批 cid 只能共用一个值，
    //   因此调用方必须保证一批 = 同一个接收者的设备（见 docs/engineering/im-offline-push.md）。
    //   顶层 badge 只吃 iOS（APNs aps.badge）与鸿蒙通道；华为等 Android 厂商通道
    //   不认它（官方标注「基于 uni-app-x 的应用在华为手机上暂不支持」）⇒ 见下面的 options。
    if (body.badge !== undefined && body.badge !== null && body.badge !== '') {
      args.badge = body.badge
    }
    // ★Android 厂商离线角标：华为走 Push Kit 原生字段，系统侧直接写桌面图标，
    //   全程不依赖 App 进程（验收场景 C：进程被杀仍要显示数字）。
    //   通话的 VoipCall 渠道已合并进同一份 options，避免覆盖角标字段。
    if (sendOptions != null) {
      args.options = sendOptions
    }
    try {
      const res = await uniPush.sendMessage(args)
      console.log('[push-send] batch', JSON.stringify({ invocationId, cids: chunk.length, errCode: res && res.errCode, errMsg: res && res.errMsg }))
      // errCode=0 只代表 DCloud 受理，不代表送达；完整结果里可能有按端的任务 id / 失败明细
      if (!privateInvitation) console.log('[push-send] batch res', JSON.stringify({ invocationId, res }))
      results.push(res)
    } catch (err) {
      console.error('[push-send] batch threw:', JSON.stringify({ invocationId, message: (err && err.message) || String(err) }))
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
