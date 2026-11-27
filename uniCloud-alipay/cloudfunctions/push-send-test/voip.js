'use strict'

const { createHash } = require('crypto')

const MAX_CALL_TARGETS = 1000
const matches = (value, pattern) => typeof value === 'string' && pattern.exec(value)?.[0] === value
const locator = value => matches(value, /^[1-9][0-9]{0,18}$/) && BigInt(value) <= 9223372036854775807n
const isCallCid = value => matches(value, /^[A-Za-z0-9_-]{1,128}$/)

exports.callTargetCids = value => {
  const ids = Array.isArray(value) ? value : [value]
  if (ids.length < 1 || ids.length > MAX_CALL_TARGETS || !ids.every(isCallCid)) return null
  return [...new Set(ids)]
}

// Legacy invitation notices share the ordinary notification transport.
exports.prepareVoip = (body, now = Date.now()) => {
  const source = body.payload
  if (!source || source.type !== 'voip') return null
  if (!locator(source.convId) || !locator(source.msgId)) return { error: 'voip string convId/msgId required' }
  const payload = { type: 'voip', convId: source.convId, msgId: source.msgId }
  if (source.convType === 1) payload.convType = 1
  // Full display/identity fields can accompany a locator, but cannot contain credentials or URLs.
  for (const field of ['callId', 'calleeId']) {
    if (source[field] !== undefined) {
      if (!matches(source[field], /^[A-Za-z0-9_-]{1,128}$/)) return { error: `invalid voip ${field}` }
      payload[field] = source[field]
    }
  }
  // LiveKit room name for calls; the client needs it to join without another round trip.
  if (source.roomName !== undefined) {
    if (!matches(source.roomName, /^[A-Za-z0-9._-]{1,128}$/)) return { error: 'invalid voip roomName' }
    payload.roomName = source.roomName
  }
  if (source.mediaType !== undefined) {
    if (!['audio', 'video'].includes(source.mediaType)) return { error: 'invalid voip mediaType' }
    payload.mediaType = source.mediaType
  }
  // The IM envelope uses senderName. Keep older display-name fields as fallbacks.
  for (const value of [source.senderName, source.callerDisplayName, source.displayName]) {
    if (typeof value !== 'string') continue
    const name = value.trim()
    if (!name || name === source.callId) continue
    payload.displayName = Array.from(name).slice(0, 80).join('')
    break
  }
  let ttl = 60_000
  // The ringing window is either an explicit expiresAt or the IM sendTime + 60s.
  // Both are forwarded so the client can use its existing expiresAt check.
  let deadline = source.expiresAt
  if (Number.isSafeInteger(source.sendTime) && source.sendTime > 0) {
    payload.sendTime = source.sendTime
    if (deadline === undefined) deadline = source.sendTime + 60_000
  }
  if (deadline !== undefined) {
    if (!Number.isSafeInteger(deadline) || deadline <= 0) return { error: 'invalid voip expiresAt' }
    if (deadline <= now) return { expired: true }
    payload.expiresAt = deadline
    ttl = Math.min(ttl, deadline - now)
  }
  if (body.settings?.ttl !== undefined) {
    if (!Number.isSafeInteger(body.settings.ttl) || body.settings.ttl <= 0) return { error: 'invalid voip ttl' }
    ttl = Math.min(ttl, body.settings.ttl)
  }
  return { payload, settings: { ttl } }
}

function prepareCallInvitation(body, now) {
  const source = body.payload
  const hasDeadline = source != null &&
    (Object.prototype.hasOwnProperty.call(source, 'expiresAt') ||
      Object.prototype.hasOwnProperty.call(source, 'sendTime'))
  if (source?.type !== 'voip' || source.convType !== 1 ||
      !['callId', 'calleeId', 'mediaType'].every(field => Object.prototype.hasOwnProperty.call(source, field)) ||
      !hasDeadline) {
    return { error: 'complete single-chat invitation required' }
  }
  const invitation = exports.prepareVoip(body, now)
  if (invitation.error || invitation.expired) return invitation
  // prepareVoip writes expiresAt back after resolving sendTime, so validate the written value.
  if (!Number.isSafeInteger(invitation.payload.expiresAt) || invitation.payload.expiresAt > now + 65_000) {
    return { error: 'invalid invitation window' }
  }
  return invitation
}

/**
 * 会议响铃邀请：只走原生来电通道，用于「App 未打开/熄屏也要让用户感知」。
 * 与 meeting_invite 卡片消息分开：卡片消息走 IM，响铃邀请下发 type="voip"。
 * 响铃窗口限制在 60 秒内（现有 PushKit/CallKit 客户端校验上限 65 秒），
 * 超时后用户仍可在聊天里看到会议邀请卡片，不会错过入会记录。
 */
function prepareMeetingRingInvitation(body, now = Date.now()) {
  const source = body.payload
  const callId = source?.callId ?? source?.inviteId
  // The prepared payload uses displayName; the IM envelope uses senderName.
  const senderName = source?.senderName ?? source?.displayName
  if (source?.type !== 'voip' || source.scene !== 'meeting' ||
      !matches(callId, /^[A-Za-z0-9_-]{1,128}$/) ||
      !locator(source.convId) || !locator(source.msgId) ||
      !locator(source.calleeId) ||
      !matches(source.inviteId, /^[A-Za-z0-9._-]{1,128}$/) ||
      !matches(source.roomName, /^[A-Za-z0-9._-]{1,128}$/) ||
      typeof source.title !== 'string' || !source.title.trim() ||
      typeof senderName !== 'string' || !senderName.trim() ||
      !['audio', 'video'].includes(source.mediaType)) {
    return { error: 'complete meeting invitation required' }
  }
  const payload = {
    type: 'voip',
    scene: 'meeting',
    callId,
    convId: source.convId,
    msgId: source.msgId,
    calleeId: source.calleeId,
    inviteId: source.inviteId,
    roomName: source.roomName,
    title: Array.from(source.title.trim()).slice(0, 80).join(''),
    mediaType: source.mediaType,
    displayName: Array.from(senderName.trim()).slice(0, 80).join(''),
    groupCall: source.groupCall === true,
  }
  if (Number.isInteger(source.convType) && source.convType >= 1) payload.convType = source.convType
  if (source.passcode !== undefined) {
    if (!matches(source.passcode, /^[0-9]{4,6}$/)) return { error: 'invalid meeting passcode' }
    payload.passcode = source.passcode
  }
  let deadline = source.expiresAt
  if (Number.isSafeInteger(source.sendTime) && source.sendTime > 0) {
    payload.sendTime = source.sendTime
    if (deadline === undefined) deadline = source.sendTime + 60_000
  }
  if (deadline === undefined || !Number.isSafeInteger(deadline) || deadline <= 0) {
    return { error: 'invalid meeting expiresAt' }
  }
  if (deadline <= now) return { expired: true }
  // Keep the native check (expiresAt must not exceed sendTime + 60s) satisfied even
  // when the invitation message was stored a few seconds before the push.
  const cap = payload.sendTime !== undefined
    ? Math.min(now + 60_000, payload.sendTime + 60_000)
    : now + 60_000
  payload.expiresAt = Math.min(deadline, cap)
  if (payload.expiresAt <= now) return { expired: true }
  return { payload, settings: { ttl: Math.min(60_000, payload.expiresAt - now) } }
}

exports.prepareMeetingRingInvitation = prepareMeetingRingInvitation

// The IM envelope uses one type for both scenes; keep the existing client wire types.
exports.prepareVoipScene = (body, now = Date.now()) => {
  const source = body.payload
  if (source?.type !== 'voip' || !Object.prototype.hasOwnProperty.call(source, 'scene')) return null
  if (source.scene === 'call') {
    if (!locator(source.calleeId)) return { error: 'voip string calleeId required' }
    return { call: prepareCallInvitation(body, now) }
  }
  if (source.scene !== 'meeting') return { error: 'invalid voip scene' }
  if (!locator(source.convId) || !locator(source.msgId) ||
      !Number.isInteger(source.convType) || source.convType < 1 ||
      !matches(source.inviteId, /^[A-Za-z0-9._-]{1,128}$/) || !matches(source.roomName, /^[A-Za-z0-9._-]{1,128}$/)) {
    return { error: 'invalid meeting invitation locator' }
  }
  if (typeof source.title !== 'string' || !source.title.trim() ||
      typeof source.senderName !== 'string' || !source.senderName.trim() ||
      !['audio', 'video'].includes(source.mediaType) ||
      typeof source.silent !== 'boolean' || typeof source.groupCall !== 'boolean' ||
      (source.passcode !== undefined && !matches(source.passcode, /^[0-9]{4,6}$/))) {
    return { error: 'invalid meeting invitation fields' }
  }
  const meeting = { type: 'meeting_invite' }
  for (const field of ['convId', 'convType', 'msgId', 'inviteId', 'roomName', 'title', 'mediaType', 'senderName', 'silent', 'groupCall', 'passcode']) {
    if (source[field] !== undefined) meeting[field] = source[field]
  }
  return { meeting }
}

// Getui brand codes and the UniPush strategies exercised in this test space.
const callTransports = new Map([
  ['ios-voip', { platform: 'ios', strategy: 'ios' }],
  // Domestic Android devices without a vendor channel (for example Samsung) use
  // the existing Getui TCP connection. The IM service capability-gates this
  // route so older clients keep their ordinary notification behavior.
  ['android-getui', { platform: 'android', transmission: true }],
  ['android-huawei', { platform: 'android', brand: 'hw', strategy: 'hw' }],
  ['android-honor', { platform: 'android', brand: 'ho' }],
  ['android-xiaomi', { platform: 'android', brand: 'xm' }],
  ['android-vivo', { platform: 'android', brand: 'vv', strategy: 'vv' }],
  // Includes OnePlus and realme devices registered with domestic OPPO PUSH.
  ['android-oppo', { platform: 'android', brand: 'op' }],
  ['android-oppo-global', { platform: 'android', brand: 'opg' }],
  ['android-meizu', { platform: 'android', brand: 'mz' }],
  ['android-smartisan', { platform: 'android', brand: 'st' }],
  // Samsung devices with Google Play services can register for FCM, a separate transport.
  ['android-fcm', { platform: 'android', brand: 'fcm' }],
  ['harmony-huawei', { platform: 'harmonyos', strategy: 'hoshw' }],
])
const androidTransportByBrand = new Map(
  [...callTransports].filter(([, config]) => config.platform === 'android')
    .map(([transport, config]) => [config.brand, transport])
)
const registrationId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/

function validIosRegistration(registration) {
  return ['development', 'production'].includes(registration?.environment) &&
    matches(registration?.registrationId, registrationId)
}

exports.iosCallRouteForCid = (cid, registrations, environment) => {
  if (!isCallCid(cid) || !registrations || typeof registrations !== 'object' ||
      Array.isArray(registrations) || !Object.prototype.hasOwnProperty.call(registrations, cid)) return null
  const registration = registrations[cid]
  const route = { cid, platform: 'ios', transport: 'ios-voip',
    environment, registrationId: registration?.registrationId }
  return validIosRegistration(route) ? route : null
}

exports.androidCallRouteForCid = (cid, brand, phoneType) => {
  // Some older registry entries omit phone_type. A reported platform takes precedence over brand.
  if (phoneType != null && phoneType !== 1 && phoneType !== '1') return null
  const transport = androidTransportByBrand.get(brand)
  return transport ? { cid, platform: 'android', transport } : null
}

// One authenticated IM route per request. No caller-controlled vendor options or broadcast target.
exports.prepareNativeVoip = (body, now = Date.now()) => {
  if (!Object.prototype.hasOwnProperty.call(body, 'callRoute')) return null
  const route = body.callRoute
  const transport = callTransports.get(route?.transport)
  if (!transport) return { error: 'unsupported call route' }
  const { platform, strategy, transmission } = transport
  const ios = platform === 'ios'
  const harmony = platform === 'harmonyos'
  const target = !ios && Array.isArray(body.push_clientid) && body.push_clientid.length === 1
    ? body.push_clientid[0] : body.push_clientid
  if (route.platform !== platform || !isCallCid(route.cid) || target !== route.cid) {
    return { error: 'one matching call device is required' }
  }
  if (ios && !validIosRegistration(route)) {
    return { error: 'signed environment and current iOS route registration are required' }
  }
  if (harmony && (body.payload?.scene === 'meeting' || !locator(body.payload?.calleeId))) {
    return { error: 'Harmony native push requires a single-chat call' }
  }
  const invitation = body.payload?.scene === 'meeting'
    ? prepareMeetingRingInvitation(body, now)
    : prepareCallInvitation(body, now)
  if (invitation.error || invitation.expired) return invitation
  if (!strategy && !transmission) return { notificationOnly: true }
  const payload = { ...invitation.payload }
  if (ios) payload.routeRegistrationId = route.registrationId
  if (platform === 'android') payload.delivery = 'android-native'
  // Harmony retrieves the authorized room through IM after waking.
  if (harmony) delete payload.roomName
  const requestId = createHash('sha256')
    .update(JSON.stringify([route.transport, route.cid, ios ? route.registrationId : '', payload.callId]))
    .digest('hex').slice(0, 32)
  const ttl = harmony || transmission
    ? invitation.settings.ttl
    : Math.min(5_000, invitation.settings.ttl)
  const settings = strategy ? { ttl, strategy: { [strategy]: 2 } } : { ttl }
  if (strategy === 'vv') {
    // Test-space probe via UniPush. Vendor receipt and SDK callback are verified separately.
    const seconds = Math.floor(ttl / 1000)
    if (seconds < 1) return { expired: true }
    const callPayload = { ...payload, scene: payload.scene ?? 'call', pushEnvironment: 'test' }
    const options = { android: { VV: {
      '/header/message-type': 3,
      '/message/extraData': JSON.stringify(callPayload),
      '/options/ttl': seconds,
      '/options/appMessageId': requestId,
    } } }
    return { payload: callPayload, requestId, settings, options }
  }
  return { payload, requestId, settings,
    ...(ios ? { options: { ios: { type: 'voip', payload: JSON.stringify(payload) } } } : {}) }
}
