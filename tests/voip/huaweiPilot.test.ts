import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const fn = resolve(import.meta.dirname, '../../scripts/voip-native/huawei-pilot/uniCloud-alipay/cloudfunctions/huawei-call-pilot/index.js')
const source = readFileSync(fn, 'utf8')
const require = createRequire(fn)
const cid = 'abcdef0123456789abcdef0123456789'
const sign = 'only-used-by-local-tests-0123456789'
const env = { PILOT_CID: cid, PILOT_CALLEE_ID: '30', PILOT_SIGN: sign }
const taskId = 'test-task-id-012'
const receipt = { errCode: 0, data: { [taskId]: { [cid]: 'successed_offline' } } }
const route = { cid, transport: 'android-huawei', platform: 'android' }
function invitation() {
  return { type: 'voip', convType: 1, convId: '50', msgId: '9223372036854775807', callId: 'call-1',
    calleeId: '30', mediaType: 'audio', expiresAt: Date.now() + 30000 }
}
function event(payload = invitation(), overrides = {}) {
  return { headers: { 'X-Push-Sign': sign }, httpMethod: 'POST',
    body: JSON.stringify({ push_clientid: cid, callRoute: route, payload, title: 'Title', content: 'Content', ...overrides }) }
}
function load(config = env, manager: any = { request: vi.fn().mockResolvedValue(receipt) }) {
  const getPushManager = vi.fn(() => manager)
  const scope = { require, Buffer, console, exports: {} as any, process: { env: config }, uniCloud: { getPushManager } }
  runInNewContext(source, scope)
  return { invoke: scope.exports.main, manager, getPushManager }
}

describe('isolated Huawei call delivery', () => {
  it('sends one device a native invitation through the offline vendor transmission template', async () => {
    const { invoke, manager, getPushManager } = load()
    const input = event()
    const response = await invoke(input)
    expect(response.errCode).toBe(0)
    expect(response.data.tasks).toEqual([{ taskId, status: 'successed_offline' }])
    expect(getPushManager).toHaveBeenCalledWith({ appId: '__UNI__8BF05E4' })
    const [out] = manager.request.mock.calls[0]
    expect([out.method, out.module]).toEqual(['POST', '/push/single/cid'])
    expect(out.requestData.audience).toEqual({ cid: [cid] })
    expect(out.requestData.settings).toEqual({ ttl: 5000, strategy: { hw: 2 } })
    const encoded = out.requestData.push_message.transmission
    expect(out.requestData.push_channel).toEqual({ android: { ups: { transmission: encoded } } })
    expect(JSON.parse(encoded).payload).toEqual({ ...JSON.parse(input.body).payload, delivery: 'android-native' })
    const repeated = await invoke(input)
    expect(repeated.data.requestId).toBe(response.data.requestId)
  })

  it.each([
    ['incorrect signature', () => ({ ...event(), headers: { 'x-push-sign': 'wrong' } })],
    ['different CID', () => event(invitation(), { push_clientid: 'other' })],
    ['CID list', () => event(invitation(), { push_clientid: [cid, 'other'] })],
    ['different route', () => event(invitation(), { callRoute: { ...route, cid: 'other' } })],
    ['other platform', () => event(invitation(), { callRoute: { ...route, transport: 'ios-voip' } })],
    ['other account', () => event({ ...invitation(), calleeId: '31' })],
    ['group', () => event({ ...invitation(), convType: 2 })],
    ['video', () => event({ ...invitation(), mediaType: 'video' })],
    ['invalid locator', () => event({ ...invitation(), msgId: '9223372036854775808' })],
    ['future expiry', () => event({ ...invitation(), expiresAt: Date.now() + 66000 })],
  ] as const)('rejects %s before getting a push manager', async (_, prepare) => {
    const { invoke, getPushManager } = load()
    expect((await invoke(prepare())).errCode).toBeGreaterThanOrEqual(400)
    expect(getPushManager).not.toHaveBeenCalled()
  })

  it('skips stale invitations and fails closed on absent credentials, provider error or uncorrelated receipt', async () => {
    const { invoke, getPushManager } = load()
    expect((await invoke(event({ ...invitation(), expiresAt: Date.now() - 1 }))).data.skipped).toBe(true)
    expect(getPushManager).not.toHaveBeenCalled()
    expect((await load({ ...env, PILOT_CID: '' }).invoke(event())).errCode).toBe(503)
    expect((await load(env, {}).invoke(event())).errCode).toBe(503)
    for (const result of [{ errCode: 'uni-cloud-push-error-2005' }, { errCode: 0, data: {} },
      { errCode: 0, data: { [taskId]: { [cid]: 'failed' } } }]) {
      expect((await load(env, { request: vi.fn().mockResolvedValue(result) }).invoke(event())).errCode).toBe(502)
    }
  })
})
