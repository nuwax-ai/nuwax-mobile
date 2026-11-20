'use strict'

const { callTargetCids } = require('./device-routes')
const { prepareVoip, prepareVoipScene } = require('./voip')
const { authContext, deliveryTargets, maintainBinding, withEligibleBinding } = require('./push-bindings')
const { deliver, MAX_PAYLOAD } = require('./delivery')

const APP_ID = '__UNI__8BF05E4'
const ENVIRONMENT = 'test'

function parseBody(event) {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body
  const body = JSON.parse(raw)
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null
}

function withEnvelopeType(body) {
  const payload = body.payload
  if (body.type !== 'voip' || !payload || typeof payload !== 'object' || Array.isArray(payload) ||
      payload.type !== undefined) return body
  const looksLikeVoip = payload.scene === 'call' || payload.scene === 'meeting' ||
    payload.callId !== undefined || payload.calleeId !== undefined
  return looksLikeVoip ? { ...body, payload: { ...payload, type: 'voip' } } : body
}

exports.main = async (event, context) => {
  const env = process.env
  if (!env.PUSH_TEST_SPACE_ID || context?.SPACEINFO?.spaceId !== env.PUSH_TEST_SPACE_ID) {
    return { errCode: 503, errMsg: 'test push space unavailable' }
  }
  const sign = event?.headers?.['x-push-sign'] ?? event?.headers?.['X-Push-Sign']
  const operation = authContext(env, sign)
  if (!operation) return { errCode: 401, errMsg: 'invalid sign' }

  let body
  try {
    body = parseBody(event)
  } catch {
    return { errCode: 400, errMsg: 'invalid json body' }
  }
  if (!body) return { errCode: 400, errMsg: 'invalid request body' }
  if (body.environment !== undefined && body.environment !== ENVIRONMENT) {
    return { errCode: 403, errMsg: 'test environment required' }
  }

  try {
    if (body.action === 'registerBinding' || body.action === 'revokeBinding') {
      if (operation !== 'binding') return { errCode: 403, errMsg: 'binding credential required' }
      return await maintainBinding(uniCloud.database(), body, ENVIRONMENT)
    }
    if (operation !== 'send') return { errCode: 403, errMsg: 'send credential required' }
    if (env.PUSH_TEST_ENABLED !== '1') return { errCode: 503, errMsg: 'test push disabled' }

    body = withEnvelopeType(body)
    const ids = callTargetCids(body.push_clientid)
    if (!ids || !body.title || !body.content) {
      return { errCode: 400, errMsg: 'push_clientid and title/content required' }
    }
    const targets = deliveryTargets(body, ids)
    if (!targets) return { errCode: 400, errMsg: 'complete push device versions required' }

    const scene = prepareVoipScene(body)
    const voip = scene ? scene.call : prepareVoip(body)
    const error = scene?.error ?? voip?.error
    if (error) return { errCode: 400, errMsg: error }
    if (scene?.meeting && JSON.stringify({ ...scene.meeting, pushEnvironment: ENVIRONMENT }).length > MAX_PAYLOAD) {
      return { errCode: 400, errMsg: 'meeting invitation payload too large' }
    }

    const db = uniCloud.database()
    const manager = uniCloud.getPushManager({ appId: APP_ID })
    const results = []
    const concurrency = 8
    for (let offset = 0; offset < targets.length; offset += concurrency) {
      const chunk = targets.slice(offset, offset + concurrency)
      results.push(...await Promise.all(chunk.map(async target => {
        try {
          const result = await withEligibleBinding(db, target, ENVIRONMENT, body.recipientUserId, route =>
            deliver(manager, env, body, target, route, scene, voip))
          return { clientid: target.cid, ...result }
        } catch {
          console.error('[push-send-test] device delivery unavailable')
          return { clientid: target.cid, errCode: 503, errMsg: 'device delivery unavailable' }
        }
      })))
    }
    const failed = results.find(result => result.errCode !== 0)
    return {
      errCode: failed?.errCode ?? 0,
      errMsg: failed ? 'test push failed for some devices' : 'ok',
      data: { total: targets.length, results },
    }
  } catch {
    console.error('[push-send-test] binding store or UniPush unavailable')
    return { errCode: 503, errMsg: 'test push unavailable' }
  }
}
