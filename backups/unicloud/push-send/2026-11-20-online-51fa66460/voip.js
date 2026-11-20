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
  if (source.mediaType !== undefined) {
    if (!['audio', 'video'].includes(source.mediaType)) return { error: 'invalid voip mediaType' }
    payload.mediaType = source.mediaType
  }
  if (typeof source.displayName === 'string') payload.displayName = Array.from(source.displayName.trim()).slice(0, 80).join('')
  let ttl = 60_000
  if (source.expiresAt !== undefined) {
    if (!Number.isSafeInteger(source.expiresAt) || source.expiresAt <= 0) return { error: 'invalid voip expiresAt' }
    if (source.expiresAt <= now) return { expired: true }
    payload.expiresAt = source.expiresAt
    ttl = Math.min(ttl, source.expiresAt - now)
  }
  if (body.settings?.ttl !== undefined) {
    if (!Number.isSafeInteger(body.settings.ttl) || body.settings.ttl <= 0) return { error: 'invalid voip ttl' }
    ttl = Math.min(ttl, body.settings.ttl)
  }
  return { payload, settings: { ttl } }
}

function prepareCallInvitation(body, now) {
  const source = body.payload
  if (source?.type !== 'voip' || source.convType !== 1 ||
      !['callId', 'calleeId', 'mediaType', 'expiresAt'].every(field => Object.prototype.hasOwnProperty.call(source, field))) {
    return { error: 'complete single-chat invitation required' }
  }
  const invitation = exports.prepareVoip(body, now)
  if (invitation.error || invitation.expired) return invitation
  if (invitation.payload.expiresAt > now + 65_000) return { error: 'invalid invitation window' }
  return invitation
}

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
const registrationId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/

// One authenticated IM route per request. No caller-controlled vendor options or broadcast target.
exports.prepareNativeVoip = (body, now = Date.now()) => {
  if (!Object.prototype.hasOwnProperty.call(body, 'callRoute')) return null
  const route = body.callRoute
  if (!route || typeof route.transport !== 'string' || !Object.prototype.hasOwnProperty.call(strategies, route.transport)) return { error: 'unsupported call route' }
  const strategy = strategies[route.transport]
  // FCM and HarmonyOS need dedicated delivery paths before they can be used for calls.
  if (strategy === null || strategy === 'hoshw') return { error: 'native call transport unavailable' }
  const ios = strategy === 'ios'
  if (route.platform !== (ios ? 'ios' : 'android') ||
      !isCallCid(route.cid) || body.push_clientid !== route.cid) return { error: 'one matching call device is required' }
  if (ios && (!['development', 'production'].includes(route.environment) ||
      typeof route.registrationId !== 'string' || route.registrationId.length !== 36 || !registrationId.test(route.registrationId))) {
    return { error: 'signed environment and current iOS route registration are required' }
  }
  const invitation = prepareCallInvitation(body, now)
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
