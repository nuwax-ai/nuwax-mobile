'use strict'

const { createHash } = require('crypto')

// Legacy invitation notices share the ordinary notification transport.
exports.prepareVoip = (body, now = Date.now()) => {
  const source = body.payload
  if (!source || source.type !== 'voip') return null
  const matches = (value, pattern) => typeof value === 'string' && pattern.exec(value)?.[0] === value
  const locator = value => matches(value, /^[1-9][0-9]{0,18}$/)
    && BigInt(value) <= 9223372036854775807n
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

const strategies = { 'ios-voip': 'ios', 'android-huawei': 'hw', 'android-honor': 'ho' }
const registrationId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/

// One authenticated IM route per request. No caller-controlled vendor options or broadcast target.
exports.prepareNativeVoip = (body, now = Date.now()) => {
  if (!Object.prototype.hasOwnProperty.call(body, 'callRoute')) return null
  const route = body.callRoute
  if (!route || typeof route.transport !== 'string' || !Object.prototype.hasOwnProperty.call(strategies, route.transport)) return { error: 'unsupported call route' }
  const ios = route.transport === 'ios-voip'
  if (route.platform !== (ios ? 'ios' : 'android') ||
      typeof route.cid !== 'string' || !route.cid || route.cid.length > 128 || /[^A-Za-z0-9_-]/.test(route.cid) ||
      body.push_clientid !== route.cid) return { error: 'one matching call device is required' }
  if (ios && (!['development', 'production'].includes(route.environment) ||
      typeof route.registrationId !== 'string' || route.registrationId.length !== 36 || !registrationId.test(route.registrationId))) {
    return { error: 'signed environment and current iOS route registration are required' }
  }
  const source = body.payload
  if (source?.type !== 'voip' || source.convType !== 1 ||
      !['callId', 'calleeId', 'mediaType', 'expiresAt'].every(field => Object.prototype.hasOwnProperty.call(source, field))) {
    return { error: 'complete single-chat invitation required' }
  }
  const invitation = exports.prepareVoip(body, now)
  if (invitation.error || invitation.expired) return invitation
  if (invitation.payload.expiresAt > now + 65_000) return { error: 'invalid invitation window' }
  const payload = ios
    ? { ...invitation.payload, routeRegistrationId: route.registrationId }
    : { ...invitation.payload, delivery: 'android-native' }
  const requestId = createHash('sha256')
    .update(JSON.stringify([route.transport, route.cid, ios ? route.registrationId : '', payload.callId]))
    .digest('hex').slice(0, 32)
  return {
    payload, requestId,
    settings: { ttl: Math.min(5_000, invitation.settings.ttl), strategy: { [strategies[route.transport]]: 2 } },
    ...(ios ? { options: { ios: { type: 'voip', payload: JSON.stringify(payload) } } } : {})
  }
}
