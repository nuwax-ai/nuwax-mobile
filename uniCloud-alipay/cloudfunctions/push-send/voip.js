'use strict'

const { createHash } = require('crypto')
const { isCallCid } = require('./device-routes')

const matches = (value, pattern) => typeof value === 'string' && pattern.exec(value)?.[0] === value
const locator = value => matches(value, /^[1-9][0-9]{0,18}$/) && BigInt(value) <= 9223372036854775807n

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
  // senderName is the IM envelope name; displayName is the legacy alias.
  const displayName = source.displayName ?? source.senderName
  if (typeof displayName === 'string') payload.displayName = Array.from(displayName.trim()).slice(0, 80).join('')
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
      !locator(source.convId) || !locator(source.msgId) || !locator(source.calleeId) ||
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
    calleeId: source.calleeId,
    convId: source.convId,
    msgId: source.msgId,
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
  payload.expiresAt = Math.min(deadline, now + 60_000)
  return { payload, settings: { ttl: Math.min(60_000, payload.expiresAt - now) } }
}

exports.prepareMeetingRingInvitation = prepareMeetingRingInvitation

// The IM envelope uses one type for both scenes; keep the existing client wire types.
exports.prepareVoipScene = (body, now = Date.now()) => {
  const source = body.payload
  if (source?.type !== 'voip' || !Object.prototype.hasOwnProperty.call(source, 'scene')) return null
  if (source.scene === 'call') {
    if (!locator(source.calleeId)) return { error: 'voip string calleeId required' }
    const payload = { ...source, displayName: source.senderName ?? source.displayName }
    return { call: prepareCallInvitation({ ...body, payload }, now) }
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

// Mobile vendor keys from the provider's REST v2 settings.strategy table.
const strategies = {
  'ios-voip': 'ios',
  'android-huawei': 'hw',
  'android-honor': 'ho',
  'android-xiaomi': 'xm',
  'android-vivo': 'vv',
  // Includes OnePlus and realme devices registered with domestic OPPO PUSH.
  'android-oppo': 'op',
  'android-oppo-global': 'opg',
  'android-meizu': 'mz',
  'android-smartisan': 'st',
  'harmony-huawei': 'hoshw',
  // Samsung devices with Google Play services can register for FCM, a separate transport.
  'android-fcm': null,
}
// The UniPush UPS pure-transmission request is documented for Huawei Android.
const nativeStrategies = new Set(['ios', 'hw'])
const registrationId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/

// One authenticated IM route per request. No caller-controlled vendor options or broadcast target.
exports.prepareNativeVoip = (body, now = Date.now()) => {
  if (!Object.prototype.hasOwnProperty.call(body, 'callRoute')) return null
  const route = body.callRoute
  if (!route || typeof route.transport !== 'string' || !Object.prototype.hasOwnProperty.call(strategies, route.transport)) return { error: 'unsupported call route' }
  const strategy = strategies[route.transport]
  if (!nativeStrategies.has(strategy)) return { error: 'native call transport unavailable' }
  const ios = strategy === 'ios'
  if (route.platform !== (ios ? 'ios' : 'android') ||
      !isCallCid(route.cid) || body.push_clientid !== route.cid) return { error: 'one matching call device is required' }
  if (ios && (!['development', 'production'].includes(route.environment) ||
      typeof route.registrationId !== 'string' || route.registrationId.length !== 36 || !registrationId.test(route.registrationId))) {
    return { error: 'signed environment and current iOS route registration are required' }
  }
  const invitation = body.payload?.scene === 'meeting'
    ? prepareMeetingRingInvitation(body, now)
    : prepareCallInvitation(body, now)
  if (invitation.error || invitation.expired) return invitation
  const payload = ios
    ? { ...invitation.payload, routeRegistrationId: route.registrationId }
    : { ...invitation.payload, delivery: 'android-native' }
  const requestId = createHash('sha256')
    .update(JSON.stringify([route.transport, route.cid, ios ? route.registrationId : '', payload.callId]))
    .digest('hex').slice(0, 32)
  return {
    payload, requestId,
    settings: { ttl: Math.min(5_000, invitation.settings.ttl), strategy: { [strategy]: 2 } },
    ...(ios ? { options: { ios: { type: 'voip', payload: JSON.stringify(payload) } } } : {})
  }
}
