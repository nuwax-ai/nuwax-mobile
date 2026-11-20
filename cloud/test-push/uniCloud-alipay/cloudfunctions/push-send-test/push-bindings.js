'use strict'

const { randomUUID, timingSafeEqual } = require('crypto')
const { isCallCid, routeForCid } = require('./device-routes')

const COLLECTION = 'push-device-bindings'
// The deployed gateway must time out before a send lease can expire.
const SEND_LEASE_MS = 120_000
const idPattern = /^[A-Za-z0-9_.-]{1,128}$/
const versionPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
const platforms = new Set(['android', 'ios', 'harmonyos'])

function matches(value, pattern) {
  return typeof value === 'string' && pattern.exec(value)?.[0] === value
}

function equalSecret(received, expected) {
  if (typeof received !== 'string' || !received || !expected) return false
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function authContext(env, sign) {
  const send = env.PUSH_SIGN_KEY
  const binding = env.PUSH_TEST_BINDING_KEY
  if (!send || !binding || send === binding) return null
  if (equalSecret(sign, send)) return 'send'
  return equalSecret(sign, binding) ? 'binding' : null
}

function response(errCode, errMsg) {
  return { errCode, errMsg }
}

function bindingResponse(row) {
  return { errCode: 0, data: { registrationId: row.registrationId, active: row.active, environment: row.environment } }
}

async function lookup(collection, deviceId) {
  const { data } = await collection.where({ _id: deviceId }).limit(1).get()
  if (!Array.isArray(data)) throw new Error('invalid binding lookup response')
  return data[0]
}

function currentRevision(row) {
  return { _id: row._id, revision: row.revision }
}

async function replace(collection, row, fields) {
  const result = await collection.where(currentRevision(row)).update({ ...fields, revision: randomUUID() })
  return result.updated === 1
}

function registrationFields(body, environment) {
  if (!isCallCid(body.cid) || !platforms.has(body.platform) ||
      !matches(body.registrationId, versionPattern)) return null
  if (body.transport != null && !matches(body.transport, idPattern)) return null
  if (body.transport === 'ios-voip') {
    if (body.platform !== 'ios' || !['development', 'production'].includes(body.apnsEnvironment) ||
        (environment === 'production' && body.apnsEnvironment !== 'production') ||
        !matches(body.voipRegistrationId, versionPattern)) return null
  }
  return {
    active: true,
    cid: body.cid,
    userId: body.userId,
    environment,
    platform: body.platform,
    transport: body.transport ?? '',
    apnsEnvironment: body.transport === 'ios-voip' ? body.apnsEnvironment : '',
    voipRegistrationId: body.transport === 'ios-voip' ? body.voipRegistrationId : '',
    registrationId: body.registrationId,
    revokedRegistrationId: '',
  }
}

async function maintainBinding(db, body, environment) {
  const { deviceId, userId, previousRegistrationId = '' } = body
  if (!matches(deviceId, idPattern) || !matches(userId, idPattern) ||
      (previousRegistrationId !== '' && !matches(previousRegistrationId, versionPattern))) {
    return response(400, 'invalid push device binding')
  }
  const collection = db.collection(COLLECTION)
  const current = await lookup(collection, deviceId)
  if (body.action === 'revokeBinding') {
    if (!current || current.environment !== environment || current.userId !== userId ||
        !previousRegistrationId) return response(409, 'push device binding changed')
    if (!current.active && current.revokedRegistrationId === previousRegistrationId) return bindingResponse(current)
    if (!current.active || current.registrationId !== previousRegistrationId ||
        current.dispatchUntil > Date.now()) return response(409, 'push device binding changed or busy')
    const revoked = {
      active: false,
      environment,
      registrationId: randomUUID(),
      revokedRegistrationId: previousRegistrationId,
    }
    return await replace(collection, current, revoked)
      ? bindingResponse(revoked) : response(409, 'push device binding changed or busy')
  }

  if (body.action !== 'registerBinding') return response(400, 'invalid binding action')
  const fields = registrationFields(body, environment)
  if (!fields) return response(400, 'invalid push device route')
  if (!current) {
    if (previousRegistrationId) return response(409, 'push device binding changed')
    await collection.add({ _id: deviceId, ...fields, revision: randomUUID(), dispatchUntil: 0 })
    return bindingResponse(fields)
  }
  const sameOwner = current.environment === environment && current.userId === userId
  const sameRoute = ['cid', 'platform', 'transport', 'apnsEnvironment', 'voipRegistrationId']
    .every(key => current[key] === fields[key])
  if (current.active && sameOwner && sameRoute &&
      (current.registrationId === previousRegistrationId || current.registrationId === fields.registrationId)) {
    return bindingResponse(current)
  }
  if (current.registrationId !== previousRegistrationId || current.dispatchUntil > Date.now() ||
      (current.active && !sameOwner) || fields.registrationId === current.registrationId ||
      fields.registrationId === current.revokedRegistrationId) {
    return response(409, 'push device binding changed or busy')
  }
  return await replace(collection, current, { ...fields, dispatchId: '', dispatchUntil: 0 })
    ? bindingResponse(fields) : response(409, 'push device binding changed or busy')
}

function deliveryTargets(body, ids) {
  if (!matches(body.recipientUserId, idPattern) ||
      (body.payload?.calleeId != null && body.payload.calleeId !== body.recipientUserId) ||
      !Array.isArray(body.push_bindings) || body.push_bindings.length !== ids.length) return null
  const byCid = new Map()
  const deviceIds = new Set()
  for (const target of body.push_bindings) {
    if (!target || !isCallCid(target.cid) || !matches(target.deviceId, idPattern) ||
        !matches(target.registrationId, versionPattern) || byCid.has(target.cid) ||
        deviceIds.has(target.deviceId)) return null
    byCid.set(target.cid, target)
    deviceIds.add(target.deviceId)
  }
  return ids.every(cid => byCid.has(cid)) ? ids.map(cid => byCid.get(cid)) : null
}

async function withEligibleBinding(db, target, environment, userId, send) {
  const collection = db.collection(COLLECTION)
  const row = await lookup(collection, target.deviceId)
  if (!row?.active || row.environment !== environment || row.userId !== userId ||
      row.cid !== target.cid || row.registrationId !== target.registrationId) {
    return response(403, 'push device binding unavailable for recipient')
  }
  // A revoke can complete only after this submission releases its lease.
  const now = Date.now()
  const dispatchId = randomUUID()
  if (row.dispatchUntil > now ||
      !await replace(collection, row, { dispatchId, dispatchUntil: now + SEND_LEASE_MS })) {
    return response(503, 'push device binding busy')
  }
  try {
    const route = routeForCid({
      platform: row.platform, transport: row.transport,
      environment: row.apnsEnvironment, registrationId: row.voipRegistrationId,
    }, target.cid)
    return await send(route)
  } finally {
    try {
      await collection.where({ _id: target.deviceId, dispatchId }).update({
        dispatchId: '', dispatchUntil: 0, revision: randomUUID(),
      })
    } catch {
      console.error('[push-send-test] device lease release failed')
    }
  }
}

module.exports = { authContext, deliveryTargets, maintainBinding, withEligibleBinding }
