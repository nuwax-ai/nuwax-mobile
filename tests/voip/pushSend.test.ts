import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const directory = resolve(import.meta.dirname, '../../uniCloud-alipay/cloudfunctions/push-send');
const require = createRequire(`${directory}/index.js`);
const { prepareVoip } = require('./voip');
const source = readFileSync(`${directory}/index.js`, 'utf8');
// Golden send arguments/responses captured from merged feat-2026.11 baseline 32882b4 before the local VoIP patch.
const ordinaryFixtures = JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/push-send-ordinary.json'), 'utf8'));
const now = 1_793_000_000_000;
const locator = { type: 'voip', convId: '245475557381246976', msgId: '9223372036854775807' };

function load(code = source, env: Record<string, string> = {}) {
  const send = vi.fn().mockResolvedValue({ errCode: 0, data: { accepted: true } });
  const module = { exports: {} as any };
  runInNewContext(code, { exports: module.exports, require, Buffer,
    process: { env: { PUSH_SIGN_KEY: 'fixture-only-sign', ...env } },
    uniCloud: { getPushManager: () => ({ sendMessage: send }) }, console: { log() {}, error() {} } });
  return { send, call: (body: any, sign = 'fixture-only-sign') => module.exports.main({ headers: { 'x-push-sign': sign }, body: JSON.stringify(body) }) };
}

describe('native call delivery', () => {
  const cid = 'fixture-target-cid';
  const registrationId = 'cb67ff9e-54ee-44ef-a6c0-601fd536cdf5';
  const env = { NUWAX_VOIP_IOS_APNS_ENVIRONMENT: 'development', NUWAX_VOIP_ANDROID_TRANSPORTS: 'android-huawei,android-honor' };
  const makeBody = (expiresAt = Date.now() + 45_000) => ({
    push_clientid: cid, title: 'Nuwax', content: 'call',
    callRoute: { cid, platform: 'ios', transport: 'ios-voip', environment: 'development', registrationId },
    payload: { ...locator, callId: 'same-call', calleeId: 'bob', convType: 1, mediaType: 'audio', expiresAt },
  });

  it('sends the real iOS VoIP options to one device and returns only its provider task status', async () => {
    const { call, send } = load(source, env);
    const body = makeBody();
    send.mockResolvedValueOnce({ errCode: 0, data: { 'task-fixture-123': { [cid]: 'successed_offline', 'other-cid': 'successed_online' } } });
    const result = await call({ ...body, payload: { ...body.payload, token: 'secret' }, badge: 12, options: { ios: { type: 'notify' } } });
    const args = send.mock.calls[0][0];
    expect(args).toMatchObject({ push_clientid: [cid], settings: { ttl: 5000, strategy: { ios: 2 } }, options: { ios: { type: 'voip' } } });
    expect(JSON.parse(args.options.ios.payload)).toEqual({ ...body.payload, routeRegistrationId: registrationId });
    expect(args).not.toHaveProperty('badge');
    expect(result.data).toEqual({ requestId: args.request_id, tasks: [{ taskId: 'task-fixture-123', status: 'successed_offline' }] });
    await call(body);
    expect(send.mock.calls[1][0].request_id).toBe(args.request_id);
    await call({ ...body, callRoute: { ...body.callRoute, registrationId: '2872678e-3315-4a30-b20f-12200b5f74ed' } });
    expect(send.mock.calls[2][0].request_id).not.toBe(args.request_id);
  });

  it.each([
    ['android-huawei', 'hw'],
    ['android-honor', 'ho'],
    ['android-xiaomi', 'xm'],
    ['android-vivo', 'vv'],
    ['android-oppo', 'op'],
    ['android-oppo-global', 'opg'],
    ['android-meizu', 'mz'],
    ['android-smartisan', 'st'],
  ])('routes %s to its vendor only when enabled', async (transport, key) => {
    const body = makeBody();
    const request = { ...body, callRoute: { cid, platform: 'android', transport }, settings: { ttl: 2000 }, options: { ios: { type: 'voip' } } };
    const disabled = load();
    expect((await disabled.call(request)).errCode).toBe(503);
    expect(disabled.send).not.toHaveBeenCalled();

    const { call, send } = load(source, { NUWAX_VOIP_ANDROID_TRANSPORTS: transport });
    expect((await call(request)).errCode).toBe(0);
    expect(send.mock.calls[0][0]).toMatchObject({
      settings: { ttl: 2000, strategy: { [key]: 2 } },
      payload: { ...body.payload, delivery: 'android-native' },
    });
    expect(send.mock.calls[0][0]).not.toHaveProperty('options');
  });

  it.each([
    ['harmony-huawei', 'harmonyos'],
    ['harmony-huawei', 'android'],
    ['android-fcm', 'android'],
  ])('keeps %s unavailable for native calls on %s', async (transport, platform) => {
    const { call, send } = load(source, { NUWAX_VOIP_ANDROID_TRANSPORTS: transport });
    const result = await call({ ...makeBody(), callRoute: { cid, platform, transport } });
    expect(result).toEqual({ errCode: 400, errMsg: 'native call transport unavailable' });
    expect(send).not.toHaveBeenCalled();
  });

  it('fails closed for mixed devices, wrong platform, invalid invites, missing configuration and wrong signed environment', async () => {
    const { call, send } = load(source, env);
    const body = makeBody();
    expect((await call(body, 'bad-sign')).errCode).toBe(401);
    expect((await call({ ...body, push_clientid: [cid, 'other'] })).errCode).toBe(400);
    expect((await call({ ...body, callRoute: { ...body.callRoute, platform: 'android' } })).errCode).toBe(400);
    expect((await call({ ...body, payload: { ...body.payload, callId: undefined } })).errCode).toBe(400);
    expect((await call(makeBody(Date.now() + 70_000))).errCode).toBe(400);
    expect((await call(makeBody(Date.now() - 100))).data.skipped).toBe(true);
    expect((await call({ ...body, callRoute: { ...body.callRoute, environment: 'production' } })).errCode).toBe(503);
    expect((await load().call(body)).errCode).toBe(503);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('VoIP UniPush notice isolation', () => {
  it('keeps locators even when untrusted display/extra data exceeds the payload budget', () => {
    const prepared = prepareVoip({ payload: { ...locator, displayName: '名字'.repeat(2000), accessToken: 'must-not-forward', url: 'must-not-forward' } }, now);
    expect(prepared.payload).toMatchObject(locator);
    expect(prepared.payload.displayName.length).toBe(80);
    expect(prepared.payload).not.toHaveProperty('accessToken');
    expect(prepared.payload).not.toHaveProperty('url');
    expect(JSON.stringify(prepared.payload).length).toBeLessThan(800);
  });
  it('bounds TTL by both the ringing deadline and explicit shorter retention', () => {
    expect(prepareVoip({ payload: locator }, now).settings.ttl).toBe(60_000);
    expect(prepareVoip({ payload: { ...locator, expiresAt: now + 5000 }, settings: { ttl: 2000, strategy: { default: 99 } } }, now).settings).toEqual({ ttl: 2000 });
    expect(prepareVoip({ payload: { ...locator, expiresAt: now - 1 } }, now)).toEqual({ expired: true });
    expect(prepareVoip({ payload: locator, settings: { ttl: 3_600_000 } }, now).settings.ttl).toBe(60_000);
  });
  it('rejects numeric/invalid int64 locators and invalid deadlines', () => {
    for (const convId of [245475557381246976, '9223372036854775808', '../1', '0', '1\n']) {
      expect(prepareVoip({ payload: { ...locator, convId } }, now).error).toBeTruthy();
    }
    expect(prepareVoip({ payload: locator, settings: { ttl: -1 } }, now).error).toBeTruthy();
    expect(prepareVoip({ payload: { ...locator, expiresAt: 'later' } }, now).error).toBeTruthy();
    expect(prepareVoip({ payload: { ...locator, callId: 'call\n' } }, now).error).toBeTruthy();
  });
  it('uses the same authentication and never sends expired or malformed invitations', async () => {
    const { call, send } = load();
    const body = { push_clientid: 'fixture-cid', title: 'Nuwax', content: 'call', payload: locator };
    expect((await call(body, 'wrong')).errCode).toBe(401);
    expect((await call({ ...body, payload: { ...locator, expiresAt: 1 } })).data.skipped).toBe(true);
    expect((await call({ ...body, payload: { ...locator, msgId: 123 } })).errCode).toBe(400);
    expect(send).not.toHaveBeenCalled();
    expect((await call({ ...body, options: { ios: { type: 'voip' } } })).errCode).toBe(0);
    expect(send.mock.calls[0][0]).toMatchObject({ payload: locator, settings: { ttl: 60000 } });
    expect(send.mock.calls[0][0]).not.toHaveProperty('options');
  });
});

describe('ordinary production notifications remain compatible', () => {
  it.each(ordinaryFixtures)('preserves existing send arguments and response: $label', async fixture => {
    const { call, send } = load();
    expect(await call(fixture.body)).toEqual(fixture.result);
    expect(send.mock.calls.map(([args]) => JSON.parse(JSON.stringify(args)))).toEqual(fixture.calls);
  });
  it('retains the updated foreground notification policy and Harmony badge for messages and calls', async () => {
    for (const payload of [{ type: 'message', convId: '123' }, locator]) {
      const { call, send } = load();
      await call({ push_clientid: 'cid-fixture', title: 'Nuwax', content: 'fixture', payload, badge: 120, force_notification: true });
      expect(send.mock.calls[0][0]).toMatchObject({ force_notification: false,
        options: { harmony: { HW: { '/payload/notification/badge': { setNum: 99 } } } } });
    }
  });
  it('still batches ordinary notices in groups of 500', async () => {
    const { call, send } = load();
    await call({ push_clientid: Array.from({ length: 501 }, (_, i) => `cid-${i}`), title: 'Nuwax', content: 'message' });
    expect(send.mock.calls.map(([args]) => args.push_clientid.length)).toEqual([500, 1]);
    expect(send.mock.calls[0][0]).not.toHaveProperty('settings');
  });
});
