import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const latestEntry = resolve(import.meta.dirname, '../../uniCloud-alipay/cloudfunctions/push-send-test/index.js');
const backupEntry = resolve(import.meta.dirname, '../../backups/unicloud/push-send/v1.3.7/index.js');
const entries = [backupEntry, latestEntry] as const;
const { prepareVoip } = createRequire(latestEntry)('./voip');
// Golden send arguments/responses captured from merged feat-2026.11 baseline 32882b4 before the local VoIP patch.
const ordinaryFixtures = JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/push-send-ordinary.json'), 'utf8'));
const now = 1_793_000_000_000;
const locator = { type: 'voip', convId: '245475557381246976', msgId: '9223372036854775807' };
const notificationOnlyTransports = [
  ['android-honor', 'ho'],
  ['android-xiaomi', 'xm'],
  ['android-oppo', 'op'],
  ['android-oppo-global', 'opg'],
  ['android-meizu', 'mz'],
  ['android-smartisan', 'st'],
  ['android-fcm', 'fcm'],
] as const;

function load(entry = latestEntry, env: Record<string, string> = {}) {
  const send = vi.fn().mockResolvedValue({ errCode: 0, data: { accepted: true } });
  const request = vi.fn().mockResolvedValue({ errCode: 0, data: { accepted: true } });
  const manager = { sendMessage: send, request };
  const database = vi.fn(() => { throw new Error('push delivery should not query a database'); });
  const log = vi.fn();
  const module = { exports: {} as any };
  runInNewContext(readFileSync(entry, 'utf8'), { filename: entry, exports: module.exports, require: createRequire(entry), Buffer,
    process: { env: { PUSH_SIGN_KEY: 'fixture-only-sign', ...env } },
    uniCloud: { database, getPushManager: () => manager }, console: { log, error() {} } });
  return { send, request, manager, database, log,
    call: (body: any, sign = 'fixture-only-sign') => module.exports.main({ headers: { 'x-push-sign': sign }, body: JSON.stringify(body) }) };
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

  it('uses each iOS registration from the IM batch and keeps other recipients on their existing routes', async () => {
    const { call, send } = load();
    const nextRegistrationId = '2872678e-3315-4a30-b20f-12200b5f74ed';
    const { callRoute, ...body } = makeBody();
    const iosVoip = {
      [cid]: { registrationId },
      'second-ios': { registrationId: nextRegistrationId },
      'invalid-ios': { registrationId: 'not-a-version' },
      'outside-batch': { registrationId },
    };
    const result = await call({
      ...body, push_clientid: [cid, 'second-ios', 'android-cid', 'invalid-ios', cid],
      payload: { ...body.payload, scene: 'call', calleeId: '1234', iosVoip },
    });
    expect(result.errCode).toBe(0);
    expect(send).toHaveBeenCalledTimes(3);
    expect(result.data.results.slice(0, 2)).toMatchObject([
      { cid, transport: 'ios-voip' }, { cid: 'second-ios', transport: 'ios-voip' },
    ]);
    for (const [index, expected] of [registrationId, nextRegistrationId].entries()) {
      const args = send.mock.calls[index][0];
      expect(JSON.parse(args.options.ios.payload)).toMatchObject({ routeRegistrationId: expected, calleeId: '1234' });
      expect(args.payload).not.toHaveProperty('iosVoip');
    }
    expect(send.mock.calls[2][0].push_clientid).toEqual(['android-cid', 'invalid-ios']);
    expect(send.mock.calls[2][0].payload).not.toHaveProperty('iosVoip');
  });

  it('sends the real iOS VoIP options to one device and returns only its provider task status', async () => {
    const { call, send } = load(latestEntry, env);
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

  it('sends Huawei Android pure transmission for a verified route', async () => {
    const transport = 'android-huawei';
    const body = makeBody();
    const invitation = { ...body, callRoute: { cid, platform: 'android', transport }, settings: { ttl: 2000 }, options: { ios: { type: 'voip' } } };

    const { call, send, request, manager } = load();
    expect((await call(invitation)).errCode).toBe(0);
    expect(send).not.toHaveBeenCalled();
    const args = request.mock.calls[0][0];
    expect(args).toMatchObject({
      method: 'POST', module: '/push/single/cid',
      requestData: { audience: { cid: [cid] }, settings: { ttl: 2000, strategy: { hw: 2 } } },
    });
    const transmission = args.requestData.push_message.transmission;
    expect(args.requestData.push_channel).toEqual({ android: { ups: { transmission } } });
    expect(JSON.parse(transmission)).toEqual({ unipush_version: '2.0', payload: { ...body.payload, delivery: 'android-native' } });

    Object.assign(manager, { request: undefined });
    expect(await call(invitation)).toMatchObject({ errCode: 503, errMsg: 'UniPush transmission adapter unavailable' });
    expect(send).not.toHaveBeenCalled();
  });

  it('sends a capability-gated Android Getui transmission without a vendor strategy', async () => {
    const body = makeBody(Date.now() + 45_000);
    const { call, send, request } = load();
    expect((await call({
      ...body, push_clientid: [cid],
      callRoute: { cid, platform: 'android', transport: 'android-getui' },
    })).errCode).toBe(0);

    expect(request).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
    const args = send.mock.calls[0][0];
    expect(args).toMatchObject({
      push_clientid: [cid], force_notification: false,
      payload: { callId: 'same-call', delivery: 'android-native' },
    });
    expect(args.settings.ttl).toBeGreaterThan(5_000);
    expect(args.settings.ttl).toBeLessThanOrEqual(45_000);
    expect(args.settings).not.toHaveProperty('strategy');
  });

  it('sends one Huawei HarmonyOS VoIP request through the dedicated vendor channel', async () => {
    const { call, send, request } = load();
    const { payload, ...body } = makeBody();
    const invitation = { ...body, push_clientid: [cid],
      callRoute: { cid, platform: 'harmonyos', transport: 'harmony-huawei' },
      payload: { ...payload, scene: 'call', calleeId: '10002', roomName: 'call-same-call', token: 'omitted' },
      options: { ios: { type: 'voip' } }, settings: { ttl: 30000 },
    };
    expect((await call(invitation)).errCode).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnce();
    const args = request.mock.calls[0][0];
    expect(args).toMatchObject({
      method: 'POST', module: '/push/single/cid',
      requestData: { audience: { cid: [cid] }, settings: { ttl: 30000, strategy: { hoshw: 2 } } },
    });
    const channel = args.requestData.push_channel.harmony.custom.HW;
    expect(channel.type).toBe('voip_call');
    expect(JSON.parse(JSON.parse(channel.payload).extraData)).toEqual({ ...payload, calleeId: '10002' });
    expect(Object.keys(args.requestData.push_channel)).toEqual(['harmony']);
    await call({ ...invitation, push_clientid: cid });
    expect(request.mock.calls[1][0].requestData.request_id).toBe(args.requestData.request_id);
  });

  it('rejects malformed HarmonyOS routes and skips expired calls without falling back to a notification', async () => {
    const { call, send, request } = load();
    const { payload, ...body } = makeBody();
    const route = { cid, platform: 'harmonyos', transport: 'harmony-huawei' };
    const invitation = { ...body, callRoute: route, payload: { ...payload, scene: 'call', calleeId: '10002' } };
    expect((await call({ ...invitation, push_clientid: [cid, 'other-cid'] })).errCode).toBe(400);
    expect((await call({ ...invitation, callRoute: { ...route, platform: 'android' } })).errCode).toBe(400);
    expect(await call({ ...invitation, payload: { ...invitation.payload, expiresAt: Date.now() - 1 } }))
      .toEqual({ errCode: 0, data: { skipped: true } });
    expect(request).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it.each(notificationOnlyTransports)('delivers an explicit %s route by notification', async (transport) => {
    const { call, send, request } = load();
    const body = makeBody();
    const callRoute = { cid, platform: 'android', transport };
    expect((await call({ ...body, push_clientid: [cid], callRoute })).errCode).toBe(0);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toMatchObject({ push_clientid: [cid], payload: body.payload });
    expect(send.mock.calls[0][0].payload).not.toHaveProperty('delivery');
    expect(send.mock.calls[0][0].settings).not.toHaveProperty('strategy');
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects a notification-only route for a different target and skips expired invitations', async () => {
    const { call, send, request } = load();
    const callRoute = { cid, platform: 'android', transport: 'android-honor' };
    expect(await call({ ...makeBody(), push_clientid: [cid, 'other-cid'], callRoute }))
      .toEqual({ errCode: 400, errMsg: 'one matching call device is required' });
    expect(await call({ ...makeBody(Date.now() - 1), callRoute }))
      .toEqual({ errCode: 0, data: { skipped: true } });
    expect(send).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('accepts a scene=call envelope on a verified native route', async () => {
    const { call, send } = load(latestEntry, env);
    const body = makeBody();
    const result = await call({ ...body, type: 'voip', channelId: 'VoipCall',
      payload: { ...body.payload, calleeId: '10002', scene: 'call' } });
    expect(result.errCode).toBe(0);
    const args = send.mock.calls[0][0];
    expect(args.settings.strategy).toEqual({ ios: 2 });
    expect(args.category).toEqual({ harmony: 'VOIP', huawei: 'VOIP' });
    expect(args.options.ios.type).toBe('voip');
    expect(args.options.android.HW['/message/android/notification/channel_id']).toBe('VoipCall');
  });

  it('delivers a caller name in the PushKit payload even if senderName is blank', async () => {
    const { call, send } = load(latestEntry, env);
    const body = makeBody();
    const payload = { ...body.payload, calleeId: '10002', scene: 'call',
      senderName: ' ', callerDisplayName: ' Alice ', displayName: body.payload.callId };
    expect((await call({ ...body, type: 'voip', payload })).errCode).toBe(0);
    const delivered = JSON.parse(send.mock.calls[0][0].options.ios.payload);
    expect(delivered).toMatchObject({ callId: body.payload.callId, displayName: 'Alice' });
  });

  it('fails closed for mixed devices, wrong platform and invalid invites', async () => {
    const { call, send } = load(latestEntry, env);
    const body = makeBody();
    expect((await call(body, 'bad-sign')).errCode).toBe(401);
    expect((await call({ ...body, push_clientid: [cid, 'other'] })).errCode).toBe(400);
    expect((await call({ ...body, callRoute: { ...body.callRoute, platform: 'android' } })).errCode).toBe(400);
    expect((await call({ ...body, payload: { ...body.payload, callId: undefined } })).errCode).toBe(400);
    expect((await call(makeBody(Date.now() + 70_000))).errCode).toBe(400);
    expect((await call(makeBody(Date.now() - 100))).data.skipped).toBe(true);
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

describe('IM invitation scenes', () => {
  const envelope = { push_clientid: ['fixture-cid-1', 'fixture-cid-2'], title: '张三', content: '邀请你通话', type: 'voip' };
  const callPayload = () => ({ ...locator, scene: 'call', convType: 1, callId: 'fixture-call', calleeId: '10002',
    mediaType: 'video', expiresAt: Date.now() + 30_000, senderName: '张三' });
  const meetingFields = { ...locator, scene: 'meeting', convType: 2, inviteId: 'fixture-invite', roomName: '123456789',
    title: '周会', mediaType: 'audio', senderName: '张三', silent: true, groupCall: true, passcode: '1234' };

  it('keeps a meeting with an IM envelope on the IM category', async () => {
    const { call, send, database } = load();
    const { scene, ...expected } = meetingFields;
    const request = {
      ...envelope, type: 'im',
      payload: { ...meetingFields, expiresAt: 1, accessToken: 'fixture-extra' },
    };
    const result = await call(request);
    expect(result.errCode).toBe(0);
    const args = send.mock.calls[0][0];
    expect(args.payload).toEqual({ ...expected, type: 'meeting_invite' });
    expect(args.category).toEqual({ harmony: 'IM', huawei: 'IM', vivo: 'IM' });
    expect(args).not.toHaveProperty('settings');
    expect(args).not.toHaveProperty('options');
    expect(database).not.toHaveBeenCalled();
  });

  it('passes the call deadline and recipient through the ordinary fallback pending a verified route', async () => {
    const { call, send } = load(latestEntry, { NUWAX_VOIP_ANDROID_TRANSPORTS: 'android-huawei' });
    const payload = callPayload();
    expect((await call({ ...envelope, payload })).errCode).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    const args = send.mock.calls[0][0];
    const { scene, senderName, ...fields } = payload;
    expect(args).toMatchObject({ push_clientid: envelope.push_clientid, payload: { ...fields, displayName: senderName } });
    expect(args.payload).not.toHaveProperty('delivery');
    expect(args.settings).not.toHaveProperty('strategy');
    expect(args.settings.ttl).toBeLessThanOrEqual(30_000);
  });

  it('rejects unknown scenes and incomplete calls and skips expired calls before sending', async () => {
    const { call, send } = load();
    const backup = load(backupEntry);
    for (const changes of [{ scene: 'unknown' }, { convType: 2 }, { calleeId: undefined }, { expiresAt: undefined }]) {
      const request = { ...envelope, payload: { ...callPayload(), ...changes } };
      expect((await backup.call(request)).errCode).toBe(0);
      expect((await call(request)).errCode).toBe(400);
    }
    const expired = { ...envelope, payload: { ...callPayload(), expiresAt: Date.now() - 1 } };
    expect((await backup.call(expired)).errCode).toBe(0);
    expect(backup.send).toHaveBeenCalledTimes(5);
    expect((await call(expired)).data.skipped).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('envelope type and scene-driven notification config', () => {
  const envelope = { push_clientid: ['fixture-cid-1', 'fixture-cid-2'], title: '张三', content: '邀请你通话', type: 'voip' };
  const callFields = () => ({ convId: '245475557381246976', msgId: '245475557381246977', scene: 'call', convType: 1,
    callId: 'fixture-call', calleeId: '10002', mediaType: 'audio', roomName: 'im-90001-live', senderName: '张三' });
  const meetingFields = () => ({ convId: '245475557381246976', msgId: '245475557381246977', type: 'voip', scene: 'meeting', convType: 2,
    inviteId: 'mi-fixture', roomName: '123456789', title: '周会', mediaType: 'video', senderName: '张三',
    silent: false, groupCall: false });

  it('backfills payload.type from the envelope type and resolves the sendTime window', async () => {
    const { call, send } = load();
    const sendTime = Date.now() - 5_000;
    const { scene, senderName, ...expected } = callFields();
    const result = await call({ ...envelope, type: 'voip', channelId: 'VoipCall', payload: { ...callFields(), sendTime } });
    expect(result.errCode).toBe(0);
    const args = send.mock.calls[0][0];
    expect(args.payload).toEqual({ ...expected, type: 'voip', displayName: '张三', sendTime, expiresAt: sendTime + 60_000 });
    expect(args.category).toEqual({ harmony: 'VOIP', huawei: 'VOIP', vivo: 'IM' });
    expect(args.options.android.HW['/message/android/notification/channel_id']).toBe('VoipCall');
    expect(args.settings.ttl).toBeLessThanOrEqual(60_000);
  });

  it('merges the VoipCall channel with vendor badge options instead of overwriting them', async () => {
    const { call, send } = load();
    await call({ ...envelope, type: 'voip', channelId: 'VoipCall', badge: 120,
      payload: { ...callFields(), expiresAt: Date.now() + 30_000 } });
    const hardware = send.mock.calls[0][0].options.android.HW;
    expect(hardware).toMatchObject({
      '/message/android/notification/badge/class': 'io.dcloud.uniapp.UniAppActivity',
      '/message/android/notification/badge/set_num': 99,
      '/message/android/notification/channel_id': 'VoipCall',
    });
    expect(send.mock.calls[0][0].options.harmony.HW['/payload/notification/badge']).toEqual({ setNum: 99 });
  });

  it('keeps a meeting with an IM envelope on the IM category', async () => {
    const { call, send } = load();
    await call({ ...envelope, type: 'im', category: { harmony: 'IM', huawei: 'IM' }, payload: meetingFields() });
    const args = send.mock.calls[0][0];
    expect(args.payload.type).toBe('meeting_invite');
    expect(args.category).toEqual({ harmony: 'IM', huawei: 'IM', vivo: 'IM' });
    expect(args).not.toHaveProperty('options');
  });

  it('adds the vivo IM category for a chat sent without an envelope type', async () => {
    const { call, send } = load();
    const payload = { convId: '123', msgId: '456', convType: 1, type: 'text' };
    await call({ push_clientid: 'fixture-cid', payload, title: '张三', content: '你好', category: { harmony: 'IM', huawei: 'IM' } });
    expect(send.mock.calls[0][0].category).toEqual({ harmony: 'IM', huawei: 'IM', vivo: 'IM' });
  });

  it('leaves ordinary IM message envelopes untouched by the VoIP channel and type fields', async () => {
    const { call, send } = load();
    const payload = { convId: '123', convType: 2, type: 'text' };
    await call({ ...envelope, type: 'message', channelId: 'VoipCall', category: { harmony: 'IM' }, payload });
    const args = send.mock.calls[0][0];
    expect(args.payload).toEqual(payload);
    expect(args.category).toEqual({ harmony: 'IM' });
    expect(args).not.toHaveProperty('options');
    expect(args).not.toHaveProperty('settings');
  });

  it('forces the VOIP category without adding a call channel when the scene is absent', async () => {
    const { call, send } = load();
    const payload = { convId: '123', convType: 1 };
    await call({ ...envelope, type: 'voip', category: { harmony: 'IM', huawei: 'IM' }, payload });
    const args = send.mock.calls[0][0];
    expect(args.payload).toEqual(payload);
    expect(args.category).toEqual({ harmony: 'VOIP', huawei: 'VOIP' });
    expect(args).not.toHaveProperty('settings');
    expect(args).not.toHaveProperty('options');
  });

  it('forces the IM category from the envelope type even when the input category is VOIP', async () => {
    const { call, send } = load();
    const payload = { convId: '123', convType: 1 };
    await call({ ...envelope, type: 'im', category: { harmony: 'VOIP', huawei: 'VOIP' }, payload });
    const args = send.mock.calls[0][0];
    expect(args.payload).toEqual(payload);
    expect(args.category).toEqual({ harmony: 'IM', huawei: 'IM', vivo: 'IM' });
    expect(args).not.toHaveProperty('options');
    expect(args).not.toHaveProperty('settings');
  });

  it('skips a scene=call invitation whose sendTime window has elapsed', async () => {
    const { call, send } = load();
    const result = await call({ ...envelope, type: 'voip', payload: { ...callFields(), sendTime: Date.now() - 61_000 } });
    expect(result.data.skipped).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('meeting ringing delivery', () => {
  const ringPayload = () => ({ ...locator, scene: 'meeting', convType: 1, inviteId: 'mi-ring', roomName: '123456789',
    title: '周会', mediaType: 'video', senderName: '张三', silent: false, groupCall: true,
    callId: 'mi-ring', calleeId: '10002', expiresAt: Date.now() + 30_000 });
  const envelope = { title: '张三', content: '会议邀请：周会', type: 'voip' };
  const registrationId = 'cb67ff9e-54ee-44ef-a6c0-601fd536cdf5';
  const ringEnv = { NUWAX_VOIP_MEETING_RING: '1' };

  it('keeps meetings on the ordinary channel while the ringing switch is off', async () => {
    const { call, send } = load();
    await call({ ...envelope, push_clientid: 'fixture-cid', payload: ringPayload() });
    const args = send.mock.calls[0][0];
    expect(args.payload.type).toBe('meeting_invite');
    expect(args.category).toEqual({ harmony: 'VOIP', huawei: 'VOIP' });
    expect(args).not.toHaveProperty('settings');
    expect(args).not.toHaveProperty('options');
  });

  it('rings through the iOS VoIP route without adding the Android VoipCall channel', async () => {
    const cid = 'fixture-target-cid';
    const { call, send } = load(latestEntry, { ...ringEnv, NUWAX_VOIP_IOS_APNS_ENVIRONMENT: 'development' });
    const result = await call({
      ...envelope, push_clientid: cid, channelId: 'VoipCall',
      callRoute: { cid, platform: 'ios', transport: 'ios-voip', environment: 'development', registrationId },
      payload: ringPayload(),
    });
    expect(result.errCode).toBe(0);
    const args = send.mock.calls[0][0];
    expect(args.settings).toMatchObject({ ttl: 5000, strategy: { ios: 2 } });
    expect(args.category).toEqual({ harmony: 'VOIP', huawei: 'VOIP' });
    expect(args.options.ios.type).toBe('voip');
    expect(args.options).not.toHaveProperty('android');
    const pushed = JSON.parse(args.options.ios.payload);
    expect(pushed).toMatchObject({ type: 'voip', scene: 'meeting', callId: 'mi-ring', calleeId: '10002',
      inviteId: 'mi-ring', roomName: '123456789', title: '周会', mediaType: 'video', displayName: '张三' });
    expect(pushed.expiresAt).toBeLessThanOrEqual(Date.now() + 61_000);
  });

  it('rings a meeting from IM registration metadata and preserves silent meetings', async () => {
    const cid = 'fixture-ios';
    const { call, send } = load();
    const payload = { ...ringPayload(), iosVoip: { [cid]: { registrationId } } };
    await call({ ...envelope, push_clientid: [cid], payload });
    expect(send.mock.calls[0][0]).toMatchObject({
      options: { ios: { type: 'voip' } }, payload: { scene: 'meeting', routeRegistrationId: registrationId },
    });
    await call({ ...envelope, push_clientid: [cid], payload: { ...payload, silent: true } });
    expect(send.mock.calls[1][0].payload).toMatchObject({ type: 'meeting_invite', silent: true });
    expect(send.mock.calls[1][0].payload).not.toHaveProperty('iosVoip');
    expect(send.mock.calls[1][0].options?.ios?.type).not.toBe('voip');
  });

  it('rings a meeting through the capability-gated Android Getui route', async () => {
    const cid = 'fixture-samsung';
    const loaded = load(latestEntry, ringEnv);
    loaded.manager.getClientDetailByCid = vi.fn().mockResolvedValue({
      errCode: 0,
      data: { validCids: { [cid]: { device_token: '', brand: 'samsung', phone_type: 1 } } },
    });
    const { call, send, request, manager } = loaded;
    const result = await call({
      ...envelope, push_clientid: [cid],
      payload: { ...ringPayload(), androidGetui: [cid] },
    });

    expect(result.data.results).toMatchObject([
      { cid, delivery: 'native', transport: 'android-getui', errCode: 0 },
    ]);
    expect(manager.getClientDetailByCid).toHaveBeenCalledWith(cid);
    expect(request).not.toHaveBeenCalled();
    const args = send.mock.calls[0][0];
    expect(args.force_notification).toBe(false);
    expect(args.settings.ttl).toBeGreaterThan(5_000);
    expect(args.settings).not.toHaveProperty('strategy');
    expect(args.payload).toMatchObject({
      type: 'voip', scene: 'meeting', callId: 'mi-ring', delivery: 'android-native',
    });
    expect(args.payload).not.toHaveProperty('androidGetui');
  });

  it('clamps a long meeting deadline to the 60 second ringing window', async () => {
    const { call, send } = load(latestEntry, { ...ringEnv, NUWAX_VOIP_IOS_APNS_ENVIRONMENT: 'development' });
    const cid = 'fixture-target-cid';
    await call({
      ...envelope, push_clientid: cid,
      callRoute: { cid, platform: 'ios', transport: 'ios-voip', environment: 'development', registrationId },
      payload: { ...ringPayload(), expiresAt: Date.now() + 300_000 },
    });
    const pushed = JSON.parse(send.mock.calls[0][0].options.ios.payload);
    expect(pushed.expiresAt).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it('sends an ordinary meeting card without a route', async () => {
    const { call, send, request, database } = load(latestEntry, ringEnv);
    const cids = ['fixture-first-cid', 'fixture-second-cid'];
    expect((await call({ ...envelope, push_clientid: cids, payload: ringPayload() })).errCode).toBe(0);
    expect(request).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toMatchObject({ push_clientid: cids, payload: { type: 'meeting_invite' } });
    expect(send.mock.calls[0][0]).not.toHaveProperty('settings');
    expect(database).not.toHaveBeenCalled();
  });

  it('rings a meeting through an explicit Huawei route without a database', async () => {
    const cid = 'fixture-meeting-cid';
    const { call, send, request, database } = load(latestEntry, {
      ...ringEnv, NUWAX_VOIP_ANDROID_TRANSPORTS: 'android-huawei',
    });
    const result = await call({
      ...envelope, push_clientid: cid,
      callRoute: { cid, platform: 'android', transport: 'android-huawei' },
      payload: ringPayload(),
    });
    expect(result.errCode).toBe(0);
    const [{ requestData }] = request.mock.calls[0];
    expect(requestData.audience.cid).toEqual([cid]);
    expect(JSON.parse(requestData.push_message.transmission).payload).toMatchObject({
      type: 'voip', scene: 'meeting', calleeId: '10002', delivery: 'android-native',
    });
    expect(send).not.toHaveBeenCalled();
    expect(database).not.toHaveBeenCalled();
  });

  it.each([{ silent: true }, { calleeId: undefined }])('falls back for meetings that cannot ring: %j', async overrides => {
    const { call, send, request } = load(latestEntry, { ...ringEnv, NUWAX_VOIP_ANDROID_TRANSPORTS: 'android-huawei' });
    const cid = 'meeting-recipient';
    const result = await call({
      ...envelope, push_clientid: cid,
      callRoute: { cid, platform: 'android', transport: 'android-huawei' },
      payload: { ...ringPayload(), ...overrides },
    });
    expect(result.errCode).toBe(0);
    expect(request).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toMatchObject({ push_clientid: [cid], payload: { type: 'meeting_invite' } });
    expect(send.mock.calls[0][0]).not.toHaveProperty('settings');
  });
});

describe('VoIP CID validation without a route lookup', () => {
  const makeCall = (cids: string[], mediaType = 'audio') => ({
    push_clientid: cids, title: '张三', content: '邀请你通话', request_id: 'fixture-batch-request',
    payload: { ...locator, scene: 'call', convType: 1, callId: 'fixture-call', calleeId: '10002',
      mediaType, expiresAt: Date.now() + 30_000, senderName: '张三' },
  });

  it.each(['audio', 'video'])('validates and deduplicates %s targets and sends one ordinary batch', async mediaType => {
    const { call, send, request, database } = load();
    const cids = ['first-test-cid', 'second-test-cid'];
    const body = makeCall([...cids, cids[0]], mediaType);
    expect((await call(body)).errCode).toBe(0);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toMatchObject({
      push_clientid: cids, request_id: body.request_id,
      payload: { callId: body.payload.callId, calleeId: body.payload.calleeId, mediaType },
    });
    expect(request).not.toHaveBeenCalled();
    expect(database).not.toHaveBeenCalled();
  });

  it('skips invalid targets and expired calls before invoking UniPush', async () => {
    const { call, send, request, database } = load();
    const body = makeCall(['fixture-target-cid']);
    expect((await call({ ...body, push_clientid: ['invalid cid'] })).errCode).toBe(400);
    expect(await call({ ...body, payload: { ...body.payload, expiresAt: Date.now() - 1 } })).toMatchObject({
      errCode: 0, data: { skipped: true },
    });
    expect(send).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(database).not.toHaveBeenCalled();
  });

  it('reports an explicit native route provider error without sending a duplicate notification', async () => {
    const cid = 'fixture-target-cid';
    const { call, send, request, database } = load(latestEntry, { NUWAX_VOIP_ANDROID_TRANSPORTS: 'android-huawei' });
    request.mockResolvedValueOnce({ errCode: 20001 });
    expect((await call({
      ...makeCall([cid]), push_clientid: cid,
      callRoute: { cid, platform: 'android', transport: 'android-huawei' },
    })).errCode).toBe(20001);
    expect(request).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    expect(database).not.toHaveBeenCalled();
  });
});

describe('automatic vendor route resolution', () => {
  const makeCall = (cid: string) => ({
    push_clientid: cid, title: '张三', content: '邀请你通话',
    payload: { ...locator, scene: 'call', convType: 1, callId: 'auto-route-call', calleeId: '10002',
      mediaType: 'audio', expiresAt: Date.now() + 30_000, senderName: '张三' },
  });
  const withRegistry = (loadable: ReturnType<typeof load>, entries: Record<string, unknown>) => {
    loadable.manager.getClientDetailByCid = vi.fn()
      .mockResolvedValue({ errCode: 0, data: { validCids: entries } });
    return loadable;
  };

  it.each(notificationOnlyTransports)('resolves %s from the registry and delivers one notification', async (transport, brand) => {
    const cid = 'vendor-registry-cid';
    const { call, send, request, log } = withRegistry(load(), {
      [cid]: { device_token: 'vendor-token', brand: brand.toUpperCase(), phone_type: 1 },
    });
    const result = await call(makeCall(cid));
    const [, routeLog] = log.mock.calls.find(([event]) => event === '[push-send] call route auto')!;
    expect(JSON.parse(routeLog)).toMatchObject({ brand, transport });
    expect(result.data.results).toEqual([{ delivery: 'notification', errCode: 0, cids: [cid] }]);
    expect(send).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
  });

  it.each(['call', 'meeting'])('uses the UniPush vivo call options for a ringing %s', async scene => {
    const cid = 'vivo-cid';
    const { call, send, request } = withRegistry(load(), { [cid]: { brand: 'VV', device_token: 'vendor-registration' } });
    const base = makeCall(cid);
    const payload = scene === 'call' ? base.payload : { ...base.payload, scene, convType: 2,
      inviteId: 'qa-meeting', roomName: 'qa-room', title: '测试会议', silent: false, groupCall: true };
    const body = { ...base, type: 'voip', push_clientid: [cid], payload };
    const auto = await call(body);
    expect(auto.data.results).toMatchObject([{ cid, transport: 'android-vivo', delivery: 'native', errCode: 0 }]);
    const args = send.mock.calls[0][0];
    expect(args.push_clientid).toEqual([cid]);
    expect(args.settings).toEqual({ ttl: 5000, strategy: { vv: 2 } });
    expect(args.options.android.VV).toEqual({ '/header/message-type': 3, '/message/extraData': JSON.stringify(args.payload),
      '/options/ttl': 5, '/options/appMessageId': args.request_id });
    expect(args.payload).toMatchObject({ scene, type: 'voip', delivery: 'android-native', pushEnvironment: 'test' });
    expect(args).not.toHaveProperty('category');
    expect(JSON.stringify(args)).not.toContain('vendor-registration');
    await call({ ...body, callRoute: { cid, transport: 'android-vivo', platform: 'android' } });
    expect(send.mock.calls[1][0].request_id).toBe(args.request_id);
    expect(request).not.toHaveBeenCalled();
  });

  it('propagates a vivo submission failure without sending an IM duplicate', async () => {
    const cid = 'vivo-cid';
    const { call, send } = withRegistry(load(), { [cid]: { brand: 'vv', device_token: 'token' } });
    send.mockResolvedValueOnce({ errCode: 10097 });
    expect((await call(makeCall(cid))).errCode).toBe(10097);
    expect(send).toHaveBeenCalledOnce();
  });

  it('skips a vivo call with less than one second left on either routing path', async () => {
    const cid = 'vivo-cid';
    const { call, send } = withRegistry(load(), { [cid]: { brand: 'vv', device_token: 'token' } });
    const body = { ...makeCall(cid), settings: { ttl: 500 } };
    expect((await call(body)).data.results).toMatchObject([{ cid, skipped: true }]);
    expect((await call({ ...body, callRoute: { cid, transport: 'android-vivo', platform: 'android' } })).data.skipped).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('routes one Huawei-registered cid through the native transmission channel', async () => {
    const cid = 'huawei-registry-cid';
    const { call, send, request, manager } = withRegistry(load(), {
      [cid]: { device_token: 'vendor-token', brand: 'hw', phone_type: 1 },
    });
    expect((await call(makeCall(cid))).errCode).toBe(0);
    expect(manager.getClientDetailByCid).toHaveBeenCalledWith(cid);
    const [{ requestData }] = request.mock.calls[0];
    expect(requestData.audience.cid).toEqual([cid]);
    expect(requestData.settings).toMatchObject({ strategy: { hw: 2 } });
    expect(JSON.parse(requestData.push_message.transmission).payload).toMatchObject({
      delivery: 'android-native', callId: 'auto-route-call',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('normalizes the IM single-cid array before the native route consistency check', async () => {
    // 测试 IM 的 UniPushChannel.buildBody 用 putArray("push_clientid")，单目标也是 [cid]。
    // 自动路由命中后必须归一为字符串，否则 prepareNativeVoip 的
    // body.push_clientid !== route.cid 会拒掉并静默回退普通通知。
    const cid = 'huawei-array-target-cid';
    const { call, send, request, manager } = withRegistry(load(), {
      [cid]: { device_token: 'vendor-token', brand: 'hw', phone_type: 1 },
    });
    expect((await call({ ...makeCall(cid), push_clientid: [cid] })).errCode).toBe(0);
    expect(manager.getClientDetailByCid).toHaveBeenCalledWith(cid);
    expect(request).toHaveBeenCalledOnce();
    const [{ requestData }] = request.mock.calls[0];
    expect(requestData.audience.cid).toEqual([cid]);
    expect(JSON.parse(requestData.push_message.transmission).payload).toMatchObject({
      delivery: 'android-native', callId: 'auto-route-call',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('routes by brand even when the registry phone model is empty', async () => {
    // 2026-11-20 华为真机实测：hasVendorToken=true、phoneModel=""。机型字段不可作判据。
    const cid = 'empty-model-huawei-cid';
    const { call, send, request } = withRegistry(load(), {
      [cid]: { device_token: 'vendor-token', brand: 'hw', phoneModel: '' },
    });
    expect((await call(makeCall(cid))).errCode).toBe(0);
    expect(request).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    const [{ requestData }] = request.mock.calls[0];
    expect(JSON.parse(requestData.push_message.transmission).payload).toMatchObject({ delivery: 'android-native' });
  });

  it.each([[7, 'hoshw'], ['7', 'HW']])('routes only single-chat calls to Harmony (%s, %s)', async (phoneType, brand) => {
    const cid = 'harmony-registry-cid';
    const { call, send, request } = withRegistry(load(), {
      [cid]: { device_token: 'vendor-token', brand, phone_type: phoneType },
    });
    const body = makeCall(cid);
    const result = await call({ ...body, push_clientid: [cid] });
    expect(result.data.results).toMatchObject([{ cid, transport: 'harmony-huawei', delivery: 'native', errCode: 0 }]);
    expect(request.mock.calls[0][0].requestData.push_channel).toMatchObject({
      harmony: { custom: { HW: { type: 'voip_call' } } },
    });
    expect(send).not.toHaveBeenCalled();

    await call({ ...body, payload: { ...body.payload, scene: 'meeting', convType: 2,
      inviteId: 'qa-meeting', roomName: 'qa-room', title: '测试会议', silent: false, groupCall: true } });
    expect(request).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
  });

  it.each([
    ['no vendor token', { device_token: '', brand: 'hw', phone_type: 1 }],
    ['no vivo vendor token', { device_token: ' ', brand: 'vv', phone_type: 1 }],
    ['unknown brand', { device_token: 'vendor-token', brand: 'unknown', phone_type: 1 }],
    ['HarmonyOS without a vendor token', { device_token: '', brand: 'hw', phone_type: 7 }],
    ['missing registry entry', undefined],
  ])('keeps the ordinary notification when the registry says %s', async (_name, entry) => {
    const cid = 'registry-cid';
    const { call, send, request, manager } = withRegistry(load(), entry ? { [cid]: entry } : {});
    expect((await call(makeCall(cid))).errCode).toBe(0);
    expect(manager.getClientDetailByCid).toHaveBeenCalledWith(cid);
    expect(request).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toMatchObject({ push_clientid: [cid], payload: { callId: 'auto-route-call' } });
  });

  it('uses Android Getui only for CIDs explicitly marked by the IM service', async () => {
    const cid = 'samsung-getui-cid';
    const { call, send, request } = withRegistry(load(), {
      [cid]: { device_token: '', brand: 'samsung', phone_type: 1 },
    });
    const body = makeCall(cid);
    const result = await call({
      ...body, push_clientid: [cid],
      payload: { ...body.payload, androidGetui: [cid] },
    });

    expect(result.data.results).toMatchObject([
      { cid, delivery: 'native', transport: 'android-getui', errCode: 0 },
    ]);
    expect(request).not.toHaveBeenCalled();
    const args = send.mock.calls[0][0];
    expect(args).toMatchObject({
      push_clientid: [cid], force_notification: false,
      payload: { callId: 'auto-route-call', delivery: 'android-native' },
    });
    expect(args.payload).not.toHaveProperty('androidGetui');
    expect(args.settings).not.toHaveProperty('strategy');
  });

  it('keeps a vendor route ahead of the Android Getui fallback', async () => {
    const cid = 'vendor-first-cid';
    const { call, send, request } = withRegistry(load(), {
      [cid]: { device_token: 'vendor-token', brand: 'hw', phone_type: 1 },
    });
    const body = makeCall(cid);
    await call({
      ...body, push_clientid: [cid],
      payload: { ...body.payload, androidGetui: [cid] },
    });

    expect(request).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    expect(request.mock.calls[0][0].requestData.settings.strategy).toEqual({ hw: 2 });
  });

  it('never blocks delivery when the registry lookup fails', async () => {
    const cid = 'registry-outage-cid';
    const { call, send, request, manager } = load();
    manager.getClientDetailByCid = vi.fn().mockRejectedValue(new Error('registry down'));
    expect((await call(makeCall(cid))).errCode).toBe(0);
    expect(manager.getClientDetailByCid).toHaveBeenCalledWith(cid);
    expect(request).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
  });

  it('resolves a multi-cid fan-out per device', async () => {
    const { call, send, request, manager } = withRegistry(load(), {
      'fanout-a': { device_token: 'vendor-token', brand: 'hw', phone_type: 1 },
    });
    const result = await call({ ...makeCall('fanout-a'), push_clientid: ['fanout-a', 'fanout-b'] });
    expect(result.errCode).toBe(0);
    expect(manager.getClientDetailByCid).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0].push_clientid).toEqual(['fanout-b']);
    expect(result.data.results).toMatchObject([
      { cid: 'fanout-a', delivery: 'native' },
      { delivery: 'notification', cids: ['fanout-b'] },
    ]);
  });

  it('prefers an explicit callRoute over auto resolution', async () => {
    const cid = 'explicit-route-cid';
    const { call, send, request, manager } = withRegistry(load(), {
      [cid]: { device_token: 'vendor-token', brand: 'hw', phone_type: 1 },
    });
    expect((await call({
      ...makeCall(cid), callRoute: { cid, platform: 'ios', transport: 'ios-voip', environment: 'development', registrationId: 'cb67ff9e-54ee-44ef-a6c0-601fd536cdf5' },
    })).errCode).toBe(0);
    expect(manager.getClientDetailByCid).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0].settings).toMatchObject({ strategy: { ios: 2 } });
  });
});

describe('ordinary production notifications remain compatible', () => {
  it.each(ordinaryFixtures)('matches the rollback backup and expected output: $label', async fixture => {
    for (const entry of entries) {
      const { call, send } = load(entry);
      expect(await call(fixture.body)).toEqual(fixture.result);
      expect(send.mock.calls.map(([args]) => JSON.parse(JSON.stringify(args)))).toEqual(fixture.calls);
    }
  });
  it('preserves ordinary and legacy meeting behavior, including signature and provider errors', async () => {
    for (const payload of [
      { type: 'message', convId: '123' },
      { type: 'meeting_invite', convId: '123', msgId: '456', inviteId: 'existing-meeting', roomName: '123456789', silent: true },
    ]) {
      const fixtures = entries.map(entry => load(entry));
      const body = { push_clientid: 'cid-fixture', title: 'Nuwax', content: 'fixture', payload };
      for (const fixture of fixtures) {
        expect(await fixture.call(body, 'wrong-sign')).toEqual({ errCode: 401, errMsg: 'invalid sign' });
        expect(fixture.send).not.toHaveBeenCalled();
        fixture.send.mockResolvedValueOnce({ errCode: 20001, errMsg: 'test device unavailable' });
      }
      const [backup, latest] = await Promise.all(fixtures.map(fixture => fixture.call(body)));
      expect(backup.errCode).toBe(20001);
      expect(latest).toEqual(backup);
      expect(fixtures[1].send.mock.calls).toEqual(fixtures[0].send.mock.calls);
      expect(fixtures[1].database).not.toHaveBeenCalled();
    }
  });
  it('keeps legacy call locators in the ordinary path with a 60-second TTL in the latest version', async () => {
    const body = { push_clientid: 'fixture-cid', title: 'Nuwax', content: 'call', payload: { ...locator, convType: 1 } };
    const [backup, latest] = entries.map(entry => load(entry));
    expect((await backup.call(body)).errCode).toBe(0);
    expect((await latest.call(body)).errCode).toBe(0);
    const backupArgs = backup.send.mock.calls[0][0];
    expect(backupArgs).not.toHaveProperty('settings');
    expect(latest.send.mock.calls[0][0]).toEqual({ ...backupArgs, settings: { ttl: 60_000 } });
    expect(latest.database).not.toHaveBeenCalled();
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
    const body = { push_clientid: Array.from({ length: 501 }, (_, i) => `cid-${i}`), title: 'Nuwax', content: 'message' };
    const [backup, latest] = entries.map(entry => load(entry));
    const [backupResult, latestResult] = await Promise.all([backup.call(body), latest.call(body)]);
    expect(latestResult).toEqual(backupResult);
    expect(latest.send.mock.calls).toEqual(backup.send.mock.calls);
    expect(latest.send.mock.calls.map(([args]) => args.push_clientid.length)).toEqual([500, 1]);
    expect(latest.send.mock.calls[0][0]).not.toHaveProperty('settings');
  });
});
