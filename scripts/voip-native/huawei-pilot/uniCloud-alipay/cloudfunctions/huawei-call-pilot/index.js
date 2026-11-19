'use strict'

const { createHash, timingSafeEqual } = require('node:crypto')

const APP_ID = '__UNI__8BF05E4'
const positiveLong = value => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value)
  && BigInt(value) <= 9223372036854775807n
const reject = (errCode, errMsg) => ({ errCode, errMsg })

function sameSecret(actual, expected) {
  if (typeof actual !== 'string') return false
  const supplied = Buffer.from(actual)
  const required = Buffer.from(expected)
  return supplied.length === required.length && timingSafeEqual(supplied, required)
}

exports.main = async (event = {}) => {
  const { PILOT_SIGN, PILOT_CID, PILOT_CALLEE_ID } = process.env
  if (!/^[a-f0-9]{32}$/i.test(PILOT_CID || '') || !positiveLong(PILOT_CALLEE_ID) || !PILOT_SIGN || PILOT_SIGN.length < 32) {
    return reject(503, 'test device binding incomplete')
  }
  const headers = event.headers || {}
  if (!sameSecret(headers['x-push-sign'] ?? headers['X-Push-Sign'], PILOT_SIGN)) return reject(401, 'invalid test signature')
  if (event.httpMethod && event.httpMethod !== 'POST') return reject(405, 'POST required')
  let body
  try {
    body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body)
  } catch {
    return reject(400, 'invalid body')
  }
  const route = body?.callRoute
  if (route?.transport !== 'android-huawei' || route.platform !== 'android'
      || route.cid !== PILOT_CID || body.push_clientid !== PILOT_CID) return reject(403, 'not the test device')
  const invite = body.payload
  if (invite?.calleeId !== PILOT_CALLEE_ID) return reject(403, 'not the test account')
  if (invite.type !== 'voip' || invite.convType !== 1 || invite.mediaType !== 'audio'
      || !positiveLong(invite.convId) || !positiveLong(invite.msgId)
      || typeof invite.callId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(invite.callId)
      || !Number.isSafeInteger(invite.expiresAt)) return reject(400, 'single-chat audio invitation required')
  const remaining = invite.expiresAt - Date.now()
  if (remaining <= 0) return { errCode: 0, data: { skipped: true } }
  if (remaining > 65000) return reject(400, 'invalid call expiry')

  const { convId, msgId, callId, calleeId, mediaType, expiresAt } = invite
  const transmission = JSON.stringify({
    unipush_version: '2.0',
    payload: { type: 'voip', convType: 1, delivery: 'android-native', convId, msgId, callId, calleeId, mediaType, expiresAt }
  })
  const requestId = createHash('sha256').update(JSON.stringify(['huawei-call-pilot', PILOT_CID, convId, callId])).digest('hex').slice(0, 32)
  try {
    // DCloud 1.2.0 sends options.android below ups.options; the vendor transmission belongs directly under ups.
    // Use the DCloud manager's fixed single-CID request in this isolated pilot. It owns the space's credentials.
    const manager = uniCloud.getPushManager({ appId: APP_ID })
    if (typeof manager.request !== 'function') return reject(503, 'DCloud request adapter unavailable')
    const result = await manager.request({
      method: 'POST', module: '/push/single/cid',
      requestData: {
        request_id: requestId, audience: { cid: [PILOT_CID] },
        settings: { ttl: Math.min(5000, remaining), strategy: { hw: 2 } },
        push_message: { transmission },
        push_channel: { android: { ups: { transmission } } }
      }
    })
    if (result?.errCode !== 0) {
      const code = String(result?.errCode ?? 'unknown')
      const providerCode = /^[a-zA-Z0-9_-]{1,64}$/.test(code) ? code : 'unknown'
      console.warn('[huawei-call-pilot] rejected', callId, requestId, providerCode)
      return { errCode: 502, data: { requestId, providerCode } }
    }
    const entries = Object.entries(result.data || {})
    const [taskId, targets] = entries[0] || []
    const status = targets?.[PILOT_CID]
    if (entries.length !== 1 || !/^[A-Za-z0-9_-]{10,128}$/.test(taskId || '')
        || taskId === PILOT_CID || typeof status !== 'string' || !/^[A-Za-z0-9_-]{1,50}$/.test(status)) {
      return { errCode: 502, errMsg: 'missing device receipt', data: { requestId } }
    }
    console.info('[huawei-call-pilot] device receipt', callId, requestId, taskId, status)
    return { errCode: status.startsWith('successed_') ? 0 : 502, data: { requestId, tasks: [{ taskId, status }] } }
  } catch {
    return { errCode: 502, errMsg: 'DCloud send failed', data: { requestId } }
  }
}
