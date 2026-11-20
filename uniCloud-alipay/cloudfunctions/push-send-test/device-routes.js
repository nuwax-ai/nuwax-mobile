'use strict'

const COLLECTION = 'voip-device-routes'
const MAX_TARGETS = 1000
const cidPattern = /^[A-Za-z0-9_-]{1,128}$/

function isCallCid(cid) {
  return typeof cid === 'string' && cidPattern.exec(cid)?.[0] === cid
}

function callTargetCids(value) {
  const ids = Array.isArray(value) ? value : [value]
  if (ids.length < 1 || ids.length > MAX_TARGETS || !ids.every(isCallCid)) return null
  return [...new Set(ids)]
}

async function loadDeviceRoutes(db, cids) {
  const { data } = await db.collection(COLLECTION)
    .where({ _id: db.command.in(cids) })
    .field({ appId: true, calleeId: true, active: true, platform: true, transport: true, environment: true, registrationId: true })
    .limit(cids.length)
    .get()
  if (!Array.isArray(data)) throw new Error('invalid device route response')
  return new Map(data.map(device => [device._id, device]))
}

function routeForCid(device, cid) {
  const { platform, transport, environment, registrationId } = device
  return { cid, platform, transport, environment, registrationId }
}

module.exports = { callTargetCids, isCallCid, loadDeviceRoutes, routeForCid }
