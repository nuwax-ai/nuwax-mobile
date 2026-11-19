import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const latestEntry = resolve(import.meta.dirname, '../../uniCloud-alipay/cloudfunctions/push-send/index.js');
const backupEntry = resolve(import.meta.dirname, '../../backups/unicloud/push-send/v1.3.7/index.js');
const entries = [backupEntry, latestEntry] as const;
const { prepareVoip } = createRequire(latestEntry)('./voip');
// Golden send arguments/responses captured from merged feat-2026.11 baseline 32882b4 before the local VoIP patch.
const ordinaryFixtures = JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/push-send-ordinary.json'), 'utf8'));
const now = 1_793_000_000_000;
const locator = { type: 'voip', convId: '245475557381246976', msgId: '9223372036854775807' };
const notificationOnlyTransports = [
  ['android-honor', 'android'],
  ['android-xiaomi', 'android'],
  ['android-vivo', 'android'],
  ['android-oppo', 'android'],
  ['android-oppo-global', 'android'],
  ['android-meizu', 'android'],
  ['android-smartisan', 'android'],
  ['android-fcm', 'android'],
  ['harmony-huawei', 'harmonyos'],
] as const;

function load(entry = latestEntry, env: Record<string, string> = {}, routes: Record<string, unknown>[] = []) {
  const send = vi.fn().mockResolvedValue({ errCode: 0, data: { accepted: true } });
  const request = vi.fn().mockResolvedValue({ errCode: 0, data: { accepted: true } });
  const manager = { sendMessage: send, request };
  const query = {
    where: vi.fn((filter: { _id: string[] }) => {
      const selected = routes.filter(route => filter._id.includes(String(route._id)));
      return { field: () => ({ limit: () => ({ get: async () => ({ data: selected }) }) }) };
    }),
  };
  const collection = vi.fn(() => query);
  const database = vi.fn(() => ({ collection, command: { in: (ids: string[]) => ids } }));
  const module = { exports: {} as any };
  runInNewContext(readFileSync(entry, 'utf8'), { filename: entry, exports: module.exports, require: createRequire(entry), Buffer,
    process: { env: { PUSH_SIGN_KEY: 'fixture-only-sign', ...env } },
    uniCloud: { database, getPushManager: () => manager }, console: { log() {}, error() {} } });
  return { send, request, manager, database, collection, query,
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

  it('sends Huawei Android pure transmission only when enabled', async () => {
    const transport = 'android-huawei';
    const body = makeBody();
    const invitation = { ...body, callRoute: { cid, platform: 'android', transport }, settings: { ttl: 2000 }, options: { ios: { type: 'voip' } } };
    const disabled = load();
    expect((await disabled.call(invitation)).errCode).toBe(503);
    expect(disabled.request).not.toHaveBeenCalled();
    expect(disabled.send).not.toHaveBeenCalled();

    const { call, send, request, manager } = load(latestEntry, { NUWAX_VOIP_ANDROID_TRANSPORTS: transport });
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

  it.each(notificationOnlyTransports)('keeps %s unavailable for native calls on %s', async (transport, platform) => {
    const { call, send, request } = load(latestEntry, { NUWAX_VOIP_ANDROID_TRANSPORTS: transport });
    const result = await call({ ...makeBody(), callRoute: { cid, platform, transport } });
    expect(result).toEqual({ errCode: 400, errMsg: 'native call transport unavailable' });
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
    expect(args.options.ios.type).toBe('voip');
    expect(args.options.android.HW['/message/android/notification/channel_id']).toBe('VoipCall');
  });

  it('falls back to the ordinary VoIP notice when a scene=call native route is not enabled', async () => {
    const { call, send } = load();
    const body = makeBody();
    const result = await call({ ...body, type: 'voip',
      payload: { ...body.payload, calleeId: '10002', scene: 'call' } });
    expect(result.errCode).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].settings).not.toHaveProperty('strategy');
  });

  it('fails closed for mixed devices, wrong platform, invalid invites, missing configuration and wrong signed environment', async () => {
    const { call, send } = load(latestEntry, env);
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

describe('IM invitation scenes', () => {
  const envelope = { push_clientid: ['fixture-cid-1', 'fixture-cid-2'], title: '张三', content: '邀请你通话' };
  const callPayload = () => ({ ...locator, scene: 'call', convType: 1, callId: 'fixture-call', calleeId: '10002',
    mediaType: 'video', expiresAt: Date.now() + 30_000, senderName: '张三' });
  const meetingFields = { ...locator, scene: 'meeting', convType: 2, inviteId: 'fixture-invite', roomName: '123456789',
    title: '周会', mediaType: 'audio', senderName: '张三', silent: true, groupCall: true, passcode: '1234' };

  it('keeps the meeting on IM notifications even when the input has a VoIP category or route', async () => {
    const { call, send, database } = load(latestEntry, { NUWAX_VOIP_DEVICE_ROUTE_LOOKUP: '1' });
    const backup = load(backupEntry);
    const { scene, ...expected } = meetingFields;
    const request = {
      ...envelope, category: { harmony: 'VOIP', huawei: 'VOIP' }, callRoute: { transport: 'ios-voip' },
      payload: { ...meetingFields, expiresAt: 1, accessToken: 'fixture-extra' },
    };
    const result = await call(request);
    expect(result.errCode).toBe(0);
    const args = send.mock.calls[0][0];
    expect(args.payload).toEqual({ ...expected, type: 'meeting_invite' });
    expect(args.category).toEqual({ harmony: 'IM', huawei: 'IM' });
    expect(args).not.toHaveProperty('settings');
    expect(args).not.toHaveProperty('options');
    expect(database).not.toHaveBeenCalled();
    expect((await backup.call(request)).errCode).toBe(0);
    expect(backup.send.mock.calls[0][0]).toMatchObject({
      payload: { type: 'voip', scene: 'meeting' }, category: request.category,
    });
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
  const envelope = { push_clientid: ['fixture-cid-1', 'fixture-cid-2'], title: '张三', content: '邀请你通话' };
  const callFields = () => ({ convId: '245475557381246976', msgId: '245475557381246977', scene: 'call', convType: 1,
    callId: 'fixture-call', calleeId: '10002', mediaType: 'audio', roomName: 'im-90001-live', senderName: '张三' });
  const meetingFields = () => ({ convId: '245475557381246976', msgId: '245475557381246977', scene: 'meeting', convType: 2,
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
    expect(args.category).toEqual({ harmony: 'VOIP', huawei: 'VOIP' });
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

  it('keeps meeting invitations on IM classification without a VoIP channel', async () => {
    const { call, send } = load();
    await call({ ...envelope, type: 'voip', channelId: 'VoipCall',
      category: { harmony: 'VOIP', huawei: 'VOIP' }, payload: meetingFields() });
    const args = send.mock.calls[0][0];
    expect(args.payload.type).toBe('meeting_invite');
    expect(args.category).toEqual({ harmony: 'IM', huawei: 'IM' });
    expect(args).not.toHaveProperty('options');
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

  it('does not treat an IM wire type at the envelope level as a call envelope', async () => {
    const { call, send } = load();
    const payload = { convId: '123', convType: 1 };
    await call({ ...envelope, type: 'voip', payload });
    const args = send.mock.calls[0][0];
    expect(args.payload).toEqual(payload);
    expect(args.category).toEqual({ harmony: 'IM' });
    expect(args).not.toHaveProperty('settings');
    expect(args).not.toHaveProperty('options');
  });

  it('skips a scene=call invitation whose sendTime window has elapsed', async () => {
    const { call, send } = load();
    const result = await call({ ...envelope, type: 'voip', payload: { ...callFields(), sendTime: Date.now() - 61_000 } });
    expect(result.data.skipped).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('CID-based native call delivery', () => {
  const env = {
    NUWAX_VOIP_DEVICE_ROUTE_LOOKUP: '1',
    NUWAX_VOIP_ANDROID_TRANSPORTS: 'android-huawei,android-honor',
    NUWAX_VOIP_IOS_APNS_ENVIRONMENT: 'development',
  };
  const registrationId = 'cb67ff9e-54ee-44ef-a6c0-601fd536cdf5';
  const binding = { appId: '__UNI__8BF05E4', calleeId: '10002', active: true };
  const huaweiRoute = { ...binding, _id: 'huawei-cid', platform: 'android', transport: 'android-huawei' };
  const honorRoute = { ...binding, _id: 'honor-cid', platform: 'android', transport: 'android-honor' };
  const iosRoute = { ...binding, _id: 'ios-cid', platform: 'ios', transport: 'ios-voip', environment: 'development', registrationId };
  const makeCall = (cids: string[], mediaType = 'audio') => ({
    push_clientid: cids, title: '张三', content: '邀请你通话', request_id: 'fixture-batch-request',
    payload: { ...locator, scene: 'call', convType: 1, callId: 'fixture-call', calleeId: binding.calleeId,
      mediaType, expiresAt: Date.now() + 30_000, senderName: '张三' },
  });

  it.each(['audio', 'video'])('assembles %s routes from trusted CID records and falls back for an unregistered device', async mediaType => {
    const routes = [huaweiRoute, honorRoute, iosRoute];
    const { call, send, request: sendTransmission, collection, query } = load(latestEntry, env, routes);
    const backup = load(backupEntry, env, routes);
    const cids = ['huawei-cid', 'honor-cid', 'ios-cid', 'notice-cid'];
    const body = makeCall([...cids, 'huawei-cid'], mediaType);
    const request = { ...body, callRoute: { platform: 'android', transport: 'android-vivo', cid: 'attacker-cid' } };
    expect((await backup.call(request)).errCode).toBe(0);
    expect(backup.database).not.toHaveBeenCalled();
    expect(backup.send).toHaveBeenCalledOnce();
    expect(backup.send.mock.calls[0][0]).toMatchObject({ push_clientid: body.push_clientid, payload: body.payload });
    expect(backup.send.mock.calls[0][0]).not.toHaveProperty('settings');
    expect(backup.send.mock.calls[0][0]).not.toHaveProperty('options');
    const response = await call(request);
    expect(collection).toHaveBeenCalledOnce();
    expect(collection).toHaveBeenCalledWith('voip-device-routes');
    expect(query.where).toHaveBeenCalledWith({ _id: cids });
    expect(response).toMatchObject({ errCode: 0, data: { total: 4, results: cids.map((cid, i) => ({
      clientid: cid, errCode: 0, delivery: i === 0 || i === 2 ? 'native' : 'notification',
    })) } });
    expect(sendTransmission).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledTimes(3);
    const huawei = sendTransmission.mock.calls[0][0].requestData;
    expect(huawei).toMatchObject({ audience: { cid: ['huawei-cid'] }, settings: { strategy: { hw: 2 } } });
    expect(JSON.parse(huawei.push_channel.android.ups.transmission).payload).toMatchObject({
      callId: body.payload.callId, calleeId: binding.calleeId, mediaType, delivery: 'android-native',
    });
    const [honor, ios, notice] = send.mock.calls.map(([args]) => args);
    expect(honor.push_clientid).toEqual(['honor-cid']);
    expect(honor.settings).not.toHaveProperty('strategy');
    expect(ios).toMatchObject({ push_clientid: ['ios-cid'], settings: { strategy: { ios: 2 } },
      payload: { callId: body.payload.callId, mediaType, routeRegistrationId: registrationId }, options: { ios: { type: 'voip' } } });
    expect(JSON.parse(ios.options.ios.payload)).toEqual(ios.payload);
    expect(notice.push_clientid).toEqual(['notice-cid']);
    expect(notice.payload).not.toHaveProperty('delivery');
    expect(notice.request_id).not.toBe(body.request_id);
    const firstIds = [huawei.request_id, ...send.mock.calls.map(([args]) => args.request_id)];
    expect(new Set(firstIds).size).toBe(4);
    send.mockClear();
    sendTransmission.mockClear();
    await call(body);
    expect([sendTransmission.mock.calls[0][0].requestData.request_id, ...send.mock.calls.map(([args]) => args.request_id)]).toEqual(firstIds);
  });

  it.each(notificationOnlyTransports)('keeps %s reachable by ordinary notification for a verified registered CID', async (transport, platform) => {
    const { call, send, request } = load(latestEntry, { ...env, NUWAX_VOIP_ANDROID_TRANSPORTS: transport },
      [{ ...binding, _id: 'fixture-device-cid', platform, transport }]);
    expect(await call(makeCall(['fixture-device-cid']))).toMatchObject({ errCode: 0, data: { results: [
      { clientid: 'fixture-device-cid', delivery: 'notification' },
    ] } });
    expect(request).not.toHaveBeenCalled();
    expect(send.mock.calls[0][0].payload).not.toHaveProperty('delivery');
    expect(send.mock.calls[0][0].settings).not.toHaveProperty('strategy');
  });

  it('blocks withdrawn, cross-account and foreign-app bindings without sending those devices a fallback', async () => {
    const revoked = { ...huaweiRoute, _id: 'revoked-cid', active: false };
    const wrongAccount = { ...honorRoute, _id: 'rebound-cid', calleeId: '30004' };
    const wrongApp = { ...iosRoute, _id: 'foreign-cid', appId: '__UNI__OTHER' };
    const { call, send, request } = load(latestEntry, env, [revoked, wrongAccount, wrongApp, huaweiRoute]);
    const denied = [revoked._id, wrongAccount._id, wrongApp._id];
    expect(await call(makeCall([...denied, huaweiRoute._id]))).toMatchObject({
      errCode: 403, data: { results: [
        ...denied.map(clientid => ({ clientid, errCode: 403 })),
        { clientid: huaweiRoute._id, errCode: 0, delivery: 'native' },
      ] },
    });
    expect(send).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0].requestData.audience.cid).toEqual([huaweiRoute._id]);
  });

  it('does not let a supplied single-device route bypass CID reassignment checks', async () => {
    const { call, send, request } = load(latestEntry, env, [{ ...huaweiRoute, calleeId: '30004' }]);
    const cid = huaweiRoute._id;
    const result = await call({
      ...makeCall([cid]), push_clientid: cid,
      callRoute: { cid, platform: 'android', transport: 'android-huawei' },
    });
    expect(result).toMatchObject({ errCode: 403, data: { results: [{ clientid: cid, errCode: 403 }] } });
    expect(send).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('falls back for incomplete iOS registration or a disabled vendor and skips database access for stale or invalid calls', async () => {
    const { call, send, database } = load(latestEntry, { ...env, NUWAX_VOIP_ANDROID_TRANSPORTS: '' },
      [huaweiRoute, { ...iosRoute, registrationId: undefined }]);
    const invitation = makeCall(['huawei-cid', 'ios-cid']);
    expect((await call({ ...invitation, push_clientid: ['huawei-cid', 'invalid cid'] })).errCode).toBe(400);
    expect((await call({ ...invitation, payload: { ...invitation.payload, expiresAt: Date.now() - 1 } })).data.skipped).toBe(true);
    expect(database).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(await call(invitation)).toMatchObject({ errCode: 0, data: { results: [
      { clientid: 'huawei-cid', delivery: 'notification' },
      { clientid: 'ios-cid', delivery: 'notification' },
    ] } });
    expect(send.mock.calls.every(([args]) => !args.settings.strategy && !args.options)).toBe(true);
  });

  it('fails closed on a lookup error and reports a vendor error without a duplicate fallback', async () => {
    const { call, send, request: sendTransmission, database } = load(latestEntry, env, [huaweiRoute, honorRoute]);
    database.mockImplementationOnce(() => { throw new Error('fixture database down'); });
    const request = makeCall(['huawei-cid', 'honor-cid']);
    expect(await call(request)).toMatchObject({ errCode: 503 });
    expect(send).not.toHaveBeenCalled();
    expect(sendTransmission).not.toHaveBeenCalled();
    sendTransmission.mockResolvedValueOnce({ errCode: 20001 });
    expect(await call(request)).toMatchObject({ errCode: 20001, data: { results: [
      { clientid: 'huawei-cid', errCode: 20001, delivery: 'native' },
      { clientid: 'honor-cid', errCode: 0, delivery: 'notification' },
    ] } });
    expect(sendTransmission).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0].push_clientid).toEqual(['honor-cid']);
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
  it('preserves ordinary and legacy meeting behavior with lookup enabled, including signature and provider errors', async () => {
    const env = { NUWAX_VOIP_DEVICE_ROUTE_LOOKUP: '1' };
    for (const payload of [
      { type: 'message', convId: '123' },
      { type: 'meeting_invite', convId: '123', msgId: '456', inviteId: 'existing-meeting', roomName: '123456789', silent: true },
    ]) {
      const fixtures = entries.map(entry => load(entry, env));
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
    const [backup, latest] = entries.map(entry => load(entry, { NUWAX_VOIP_DEVICE_ROUTE_LOOKUP: '1' }));
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
