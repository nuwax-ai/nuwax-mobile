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
  const payload = normalizePayload(body.payload)
  const category = body.category && typeof body.category === 'object' ? body.category : DEFAULT_CATEGORY

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
    if (body.badge !== undefined && body.badge !== null && body.badge !== '') {
      args.badge = body.badge
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
        category: category
      },
      results
    }
  }
}
