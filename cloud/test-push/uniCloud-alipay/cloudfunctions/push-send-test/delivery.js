'use strict'

const { createHash } = require('crypto')
const { prepareVoip, prepareNativeVoip, prepareMeetingRingInvitation } = require('./voip')

const MAX_PAYLOAD = 800
const PUSH_ENVIRONMENT = 'test'
const HUAWEI_VOIP_CHANNEL = 'VoipCall'
const HUAWEI_CALL_OPTIONS = {
  HW: { '/message/android/urgency': 'HIGH', '/message/android/category': 'VOIP' },
}

function clip(value, limit) {
  const chars = Array.from(String(value).trim())
  return chars.length <= limit ? chars.join('') : chars.slice(0, limit - 1).join('') + '…'
}

function requestId(kind, target, id) {
  return createHash('sha256').update(JSON.stringify([
    PUSH_ENVIRONMENT, kind, target.cid, target.registrationId, id,
  ])).digest('hex').slice(0, 32)
}

function tagged(payload) {
  return { ...payload, pushEnvironment: PUSH_ENVIRONMENT }
}

function ordinaryPayload(source, badge) {
  const payload = tagged(source && typeof source === 'object' && !Array.isArray(source) ? source : {})
  const slim = tagged({})
  if (typeof payload.convId === 'string' && /^\d{1,19}$/.test(payload.convId)) slim.convId = payload.convId
  if (Number.isInteger(payload.convType)) slim.convType = payload.convType
  const bounded = JSON.stringify(payload).length <= MAX_PAYLOAD ? payload : slim
  if (badge === null) return bounded
  const withBadge = { ...bounded, badge }
  return JSON.stringify(withBadge).length <= MAX_PAYLOAD ? withBadge : bounded
}

function providerNotice(body) {
  const category = body.type === 'voip'
    ? { harmony: 'VOIP', huawei: 'VOIP' } : body.category ?? { harmony: 'IM' }
  return { title: clip(body.title, 19), content: clip(body.content, 49), category, force_notification: false }
}

function noticeOptions(body, badge) {
  const options = {}
  const huawei = {}
  if (badge !== null) {
    const unread = Math.min(badge, 99)
    huawei['/message/android/notification/badge/class'] = 'io.dcloud.uniapp.UniAppActivity'
    huawei['/message/android/notification/badge/set_num'] = unread
    options.harmony = { HW: { '/payload/notification/badge': { setNum: unread } } }
  }
  if (body.type === 'voip') {
    huawei['/message/android/notification/channel_id'] = HUAWEI_VOIP_CHANNEL
  }
  if (Object.keys(huawei).length) options.android = { HW: huawei }
  return Object.keys(options).length ? { options } : {}
}

async function resolveRoute(manager, env, route) {
  if (route.platform === 'ios' && route.transport === 'ios-voip') {
    return (env.NUWAX_VOIP_TEST_IOS_APNS_ENVIRONMENTS || '').split(',').includes(route.environment) ? route : null
  }
  if (route.platform !== 'android' ||
      !(env.NUWAX_VOIP_TEST_ANDROID_TRANSPORTS || '').split(',').includes('android-huawei')) return null

  const detail = await manager.getClientDetailByCid(route.cid)
  const validCids = detail?.data?.validCids
  if (detail?.errCode !== 0 || !validCids || typeof validCids !== 'object' || Array.isArray(validCids)) {
    throw new Error('invalid UniPush device detail response')
  }
  const device = Object.prototype.hasOwnProperty.call(validCids, route.cid) ? validCids[route.cid] : null
  return device?.phone_type === 1 && device.phoneModel === 'hw' &&
    typeof device.device_token === 'string' && device.device_token.trim()
    ? { ...route, transport: 'android-huawei' } : null
}

function taskReceipts(result, cid) {
  if (!result?.data || typeof result.data !== 'object') return []
  return Object.entries(result.data).filter(([id, targets]) =>
    /^[A-Za-z0-9_-]{10,128}$/.test(id) && id !== cid && targets &&
    Object.prototype.hasOwnProperty.call(targets, cid)
  ).map(([taskId, targets]) => ({
    taskId,
    status: typeof targets[cid] === 'string' && /^[A-Za-z0-9_-]{1,50}$/.test(targets[cid])
      ? targets[cid] : 'unknown',
  }))
}

async function sendNative(manager, body, target, route, native) {
  const payload = tagged(native.payload)
  const id = requestId(route.transport, target, native.requestId)
  let result
  if (route.transport === 'android-huawei') {
    const transmission = JSON.stringify({ unipush_version: '2.0', payload })
    const ups = { transmission }
    if (payload.scene !== 'meeting') ups.options = HUAWEI_CALL_OPTIONS
    result = await manager.request({
      method: 'POST',
      module: '/push/single/cid',
      requestData: {
        request_id: id, audience: { cid: [target.cid] }, settings: native.settings,
        push_message: { transmission }, push_channel: { android: { ups } },
      },
    })
  } else {
    const options = {
      ...noticeOptions(body, null).options,
      ios: { ...native.options.ios, payload: JSON.stringify(payload) },
    }
    result = await manager.sendMessage({
      ...providerNotice(body), push_clientid: [target.cid], payload,
      settings: native.settings, request_id: id, options,
    })
  }
  return { errCode: result?.errCode ?? 503, delivery: 'native', transport: route.transport,
    requestId: id, tasks: taskReceipts(result, target.cid) }
}

async function deliver(manager, env, body, target, binding, scene, initialVoip) {
  const now = Date.now()
  const source = body.payload
  const ringMeeting = scene?.meeting && source.silent !== true && env.NUWAX_VOIP_TEST_MEETING_RING === '1'
  const voip = scene?.call
    ? prepareVoip({ ...body, payload: { ...source, displayName: source.senderName ?? source.displayName } }, now)
    : initialVoip
  if (voip?.expired) return { errCode: 0, skipped: true }
  if (scene?.call || ringMeeting) {
    // The route and any missing meeting recipient come from the verified binding.
    const invitation = { ...body, push_clientid: target.cid, payload: {
      ...source, calleeId: body.recipientUserId,
    } }
    // Incomplete or expired meeting metadata still delivers the ordinary meeting card.
    const candidate = ringMeeting ? prepareMeetingRingInvitation(invitation, now) : voip
    if (!candidate?.error && !candidate?.expired) {
      const route = await resolveRoute(manager, env, binding)
      const native = route ? prepareNativeVoip({ ...invitation, callRoute: route }, now) : null
      if (native?.payload) return await sendNative(manager, body, target, route, native)
    }
  }

  const rawBadge = body.badge
  const badge = (typeof rawBadge === 'number' || typeof rawBadge === 'string') && /^\d+$/.test(String(rawBadge).trim())
    ? Number(rawBadge) : null
  const idSource = body.request_id || voip?.payload?.callId || scene?.meeting?.inviteId
  const id = idSource ? requestId('notification', target, idSource) : undefined
  const result = await manager.sendMessage({
    ...providerNotice(body),
    push_clientid: [target.cid],
    payload: ordinaryPayload(voip?.payload ?? scene?.meeting ?? source, badge),
    request_id: id,
    ...(rawBadge !== undefined && rawBadge !== null && rawBadge !== '' ? { badge: rawBadge } : {}),
    ...(voip?.settings ? { settings: voip.settings } : {}),
    ...noticeOptions(body, badge),
  })
  return { errCode: result?.errCode ?? 503, delivery: 'notification', requestId: id,
    tasks: taskReceipts(result, target.cid) }
}

module.exports = { deliver, MAX_PAYLOAD }
