'use strict';

const crypto = require('crypto')

const APP_ID = '__UNI__8BF05E4'          // 本项目的 DCloud AppID
// 后端握手密钥：**只**从环境变量读（uniCloud 控制台 → 云函数 → 环境变量 PUSH_SIGN_KEY）。
// ★代码里绝不留兜底值：本仓库会推送到公开的 GitHub 镜像，硬编码密钥等于公开。
// 未配置环境变量时一律拒绝（fail-closed），部署顺序必须是「先配环境变量，再上传代码」。
const SIGN_KEY = process.env.PUSH_SIGN_KEY || ''
const BATCH_SIZE = 500                    // 单次最多 500 个 cid

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

exports.main = async (event) => {
  if (!verifySign(event)) {
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

  const results = []
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE)
    try {
      const res = await uniPush.sendMessage({
        push_clientid: chunk,
        title: body.title,
        content: body.content,
        payload: body.payload || {},
        force_notification: body.force_notification !== false,
        request_id: body.request_id || undefined
      })
      results.push(res)
    } catch (err) {
      results.push({ errCode: -1, errMsg: (err && err.message) || String(err), push_clientid: chunk })
    }
  }

  const failed = results.filter(r => r && r.errCode)
  return {
    errCode: failed.length ? failed[0].errCode : 0,
    errMsg: failed.length ? failed[0].errMsg : 'ok',
    data: { total: ids.length, batches: results.length, failedBatches: failed.length, results }
  }
}
