'use strict'

// Ordinary UniPush invitation notices only. This is not an APNs PushKit sender.
// Keep isolated from chat notification normalization and vendor badge behavior.
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
