import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { getImPushEnvironment } from '@/constants/config.uts';
import { prepareTestPushCloud } from '../../scripts/prepare-test-push-cloud.mjs';

const temporary = mkdtempSync(join(tmpdir(), 'nuwax-test-push-'));
const cloud = prepareTestPushCloud(join(temporary, 'deploy'));
const entry = join(cloud, 'cloudfunctions/push-send-test/index.js');
afterAll(() => rmSync(temporary, { recursive: true, force: true }));

const testSpace = 'fixture-test-space';
const prodSpace = 'fixture-production-space';
const key = { prod: 'fixture-production', test: 'fixture-send', binding: 'fixture-binding' };
const config = { PUSH_TEST_SPACE_ID: testSpace, PUSH_SIGN_KEY: key.test,
  PUSH_TEST_BINDING_KEY: key.binding, PUSH_TEST_ENABLED: '1' };
const device = {
  deviceId: 'device-1', cid: 'provider-cid-1', userId: '1234',
  registrationId: 'cb67ff9e-54ee-44ef-a6c0-601fd536cdf5', platform: 'ios',
};
const nextRegistrationId = 'a4fd618f-48a9-407b-b51b-1875b078ab40';
const notice = {
  recipientUserId: device.userId, push_clientid: [device.cid],
  push_bindings: [{ cid: device.cid, deviceId: device.deviceId, registrationId: device.registrationId }],
  title: '女娲', content: '消息', badge: 2, request_id: 'fixture-request',
  payload: { type: 'message', convId: '4321' },
};
const meeting = {
  ...notice,
  type: 'voip',
  payload: { scene: 'meeting', convId: '4321', convType: 1, msgId: '5678',
    inviteId: 'meeting-1', roomName: 'room-1', title: '会议', senderName: '成员',
    mediaType: 'audio', silent: false, groupCall: false },
};
const revoke = { action: 'revokeBinding', deviceId: device.deviceId, userId: device.userId,
  previousRegistrationId: device.registrationId };
const register = { action: 'registerBinding', ...device };

function loadGateway(env: Record<string, string> = {}) {
  const rows = new Map<string, Record<string, any>>();
  const collection = {
    async add(row: Record<string, any>) {
      if (rows.has(row._id) || [...rows.values()].some(existing => existing.cid === row.cid)) {
        throw new Error('duplicate index');
      }
      rows.set(row._id, { ...row });
    },
    where(filter: Record<string, any>) {
      function matches(row?: Record<string, any>): boolean {
        return row != null && Object.entries(filter).every(([name, value]) => row[name] === value);
      }
      return {
        limit: () => ({ get: async () => {
          const row = rows.get(filter._id);
          return { data: row && matches(row) ? [{ ...row }] : [] };
        } }),
        async update(update: Record<string, any>) {
          const row = rows.get(filter._id);
          if (!row || !matches(row)) return { updated: 0 };
          if (update.cid != null && [...rows.values()].some(other => other !== row && other.cid === update.cid)) {
            throw new Error('duplicate index');
          }
          Object.assign(row, update);
          return { updated: 1 };
        },
      };
    },
  };
  const database = vi.fn(() => ({ collection: () => collection }));
  const send = vi.fn().mockResolvedValue({ errCode: 0 });
  const request = vi.fn().mockResolvedValue({ errCode: 0 });
  const details = vi.fn();
  const getPushManager = vi.fn(() => ({ sendMessage: send, request, getClientDetailByCid: details }));
  const exports: { main?: Function } = {};
  runInNewContext(readFileSync(entry, 'utf8'), {
    require: createRequire(entry), exports, Buffer, process: { env: { ...config, ...env } },
    uniCloud: { getPushManager, database }, console: { log() {}, error() {} },
  });
  function call(body: unknown, sign = key.test, space = testSpace) {
    return exports.main!({ headers: { 'x-push-sign': sign }, body: JSON.stringify(body) },
      { SPACEINFO: { spaceId: space } });
  }
  return { call, send, request, database, details, getPushManager };
}

describe('mobile push environment isolation', () => {
  it('recognizes only the normalized HTTPS test origin', () => {
    expect(getImPushEnvironment('https://testagent.xspaceagi.com')).toBe('test');
    expect(getImPushEnvironment(' TestAgent.xspaceagi.com/ ')).toBe('test');
    for (const origin of [
      '', 'https://agent.nuwax.com', 'http://testagent.xspaceagi.com', 'https://testagent.xspaceagi.com:444',
      'https://testagent.xspaceagi.com.example.org', 'https://testagent.xspaceagi.com/other',
      'https://else.example.org?testagent.xspaceagi.com',
    ]) expect(getImPushEnvironment(origin)).toBe('production');
  });

  it('packages only the test function and its database schema', () => {
    expect(readdirSync(join(cloud, 'cloudfunctions'))).toEqual(['push-send-test']);
    expect(readdirSync(join(cloud, 'database'))).toEqual([
      'push-device-bindings.index.json', 'push-device-bindings.schema.json',
    ]);
  });

  it('blocks the wrong space, disabled sends, and shared or production credentials', async () => {
    const { call, database, getPushManager } = loadGateway();
    expect((await call(notice, key.test, prodSpace)).errCode).toBe(503);
    expect((await call(notice, key.prod)).errCode).toBe(401);
    expect((await call(notice, key.binding)).errCode).toBe(403);
    expect((await call(register)).errCode).toBe(403);
    expect((await call({ ...notice, environment: 'production' })).errCode).toBe(403);
    expect(database).not.toHaveBeenCalled();
    expect(getPushManager).not.toHaveBeenCalled();
    expect((await loadGateway({ PUSH_TEST_SPACE_ID: '' }).call(notice)).errCode).toBe(503);
    const paused = loadGateway({ PUSH_TEST_ENABLED: '0' });
    expect((await paused.call(notice)).errCode).toBe(503);
    expect(paused.database).not.toHaveBeenCalled();
    expect((await paused.call(register, key.binding)).errCode).toBe(0);
    expect((await loadGateway({ PUSH_TEST_BINDING_KEY: key.test }).call(notice)).errCode).toBe(401);
  });

  it('restricts notifications and badge updates to the current account, CID and generation', async () => {
    const { call, send } = loadGateway();
    expect((await call(notice)).errCode).toBe(403);
    expect((await call(register, key.binding)).errCode).toBe(0);
    expect((await call({ ...notice, recipientUserId: 'wrong-user' })).errCode).toBe(403);
    expect((await call({ ...notice, push_bindings: undefined })).errCode).toBe(400);
    expect((await call({ ...notice, push_clientid: [device.cid, 'other-cid'] })).errCode).toBe(400);
    expect(send).not.toHaveBeenCalled();

    expect((await call({ ...notice, payload: { ...notice.payload, pushEnvironment: 'production' } })).errCode).toBe(0);
    expect(send.mock.calls[0][0]).toMatchObject({
      badge: 2, category: { harmony: 'IM' }, payload: { pushEnvironment: 'test', type: 'message', badge: 2 },
      options: { android: { HW: { '/message/android/notification/badge/set_num': 2 } } },
    });
    const released = await call(revoke, key.binding);
    expect(released).toMatchObject({ errCode: 0, data: { active: false, environment: 'test' } });
    expect(await call(revoke, key.binding)).toEqual(released);
    expect((await call(notice)).errCode).toBe(403);
    expect((await call({ ...register, registrationId: nextRegistrationId,
      previousRegistrationId: device.registrationId }, key.binding)).errCode).toBe(409);
    expect((await call({ ...register, registrationId: nextRegistrationId,
      previousRegistrationId: released.data.registrationId }, key.binding)).errCode).toBe(0);
    expect((await call(notice)).errCode).toBe(403);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('uses separate binding stores and refuses to import a previous version on first registration', async () => {
    const previous = loadGateway();
    await previous.call(register, key.binding);
    const released = await previous.call(revoke, key.binding);
    const next = loadGateway();
    expect((await next.call({ ...register, previousRegistrationId: released.data.registrationId }, key.binding)).errCode).toBe(409);
    expect((await next.call(register, key.binding)).errCode).toBe(0);
    expect((await next.call({ ...register, deviceId: 'other-device' }, key.binding)).errCode).toBe(503);
    expect((await previous.call(notice)).errCode).toBe(403);
    expect((await next.call(notice)).errCode).toBe(0);
  });

  it('rejects stale targets individually and uses a stable request ID for the current device', async () => {
    const { call, send } = loadGateway();
    await call(register, key.binding);
    const mixed = { ...notice, push_clientid: ['unknown-cid', device.cid],
      push_bindings: [{ cid: 'unknown-cid', deviceId: 'unknown-device', registrationId: nextRegistrationId },
        ...notice.push_bindings] };
    expect(await call(mixed)).toMatchObject({ errCode: 403, data: { results: [
      { clientid: 'unknown-cid', errCode: 403 },
      { clientid: device.cid, errCode: 0, delivery: 'notification' },
    ] } });
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ push_clientid: [device.cid] }));
    await call(notice);
    expect(send.mock.calls[0][0].request_id).toBe(send.mock.calls[1][0].request_id);
  });

  it('acknowledges revoke only after the outgoing vendor submission finishes', async () => {
    const { call, send } = loadGateway();
    await call(register, key.binding);
    let finish!: (result: object) => void;
    send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const delivering = call(notice);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect((await call(revoke, key.binding)).errCode).toBe(409);
    finish({ errCode: 0 });
    expect((await delivering).errCode).toBe(0);
    expect((await call(revoke, key.binding)).errCode).toBe(0);
    expect((await call(notice)).errCode).toBe(403);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('uses the registered APNs environment and fills missing meeting callee ID from the verified binding', async () => {
    const { call, send } = loadGateway({ NUWAX_VOIP_TEST_IOS_APNS_ENVIRONMENTS: 'production',
      NUWAX_VOIP_TEST_MEETING_RING: '1' });
    await call({ ...register, transport: 'ios-voip', apnsEnvironment: 'production',
      voipRegistrationId: nextRegistrationId }, key.binding);
    const expiring = { ...meeting, callRoute: { transport: 'android-huawei' },
      payload: { ...meeting.payload, expiresAt: Date.now() + 30_000 } };
    expect(await call(expiring)).toMatchObject({ errCode: 0, data: { results: [
      { delivery: 'native', transport: 'ios-voip' },
    ] } });
    const args = send.mock.calls[0][0];
    expect(args.options.ios.type).toBe('voip');
    expect(JSON.parse(args.options.ios.payload)).toMatchObject({
      pushEnvironment: 'test', routeRegistrationId: nextRegistrationId, calleeId: device.userId,
    });
    expect((await call(meeting)).errCode).toBe(0);
    expect((await call({ ...expiring, payload: { ...expiring.payload, silent: true } })).errCode).toBe(0);
    for (const [notification] of send.mock.calls.slice(1)) {
      expect(notification).toMatchObject({ category: { harmony: 'VOIP', huawei: 'VOIP' },
        payload: { type: 'meeting_invite', pushEnvironment: 'test' },
        options: { android: { HW: { '/message/android/notification/channel_id': 'VoipCall' } } },
      });
      expect(notification.options).not.toHaveProperty('ios');
    }
  });

  it('selects Huawei from verified vendor details after CID rotation and stops sending after revoke', async () => {
    const { call, send, request, details } = loadGateway({ NUWAX_VOIP_TEST_ANDROID_TRANSPORTS: 'android-huawei' });
    details.mockImplementation(async (cid: string) => ({
      errCode: 0, data: { validCids: { [cid]: { phone_type: 1, phoneModel: 'hw', device_token: 'vendor-fixture' } } },
    }));
    const binding = { ...register, platform: 'android' };
    function invitation(cid: string, registrationId: string) {
      return {
        ...notice, type: 'voip', push_clientid: [cid], push_bindings: [{ cid, deviceId: device.deviceId, registrationId }],
        payload: { scene: 'call', convId: '4321', convType: 1, msgId: '5678', callId: 'locked-call',
          calleeId: device.userId, mediaType: 'audio', expiresAt: Date.now() + 30_000 },
      };
    }
    const original = invitation(device.cid, device.registrationId);
    expect((await call(binding, key.binding)).errCode).toBe(0);
    expect((await call(original, key.prod)).errCode).toBe(401);
    expect(details).not.toHaveBeenCalled();
    expect((await call(original)).data.results[0].transport).toBe('android-huawei');

    const cid = 'provider-cid-rotated';
    expect((await call({ ...binding, cid, registrationId: nextRegistrationId,
      previousRegistrationId: device.registrationId }, key.binding)).errCode).toBe(0);
    expect((await call(original)).errCode).toBe(403);
    const current = invitation(cid, nextRegistrationId);
    expect((await call(current)).data.results[0].transport).toBe('android-huawei');
    expect(details.mock.calls).toEqual([[device.cid], [cid]]);
    expect(send).not.toHaveBeenCalled();
    for (const [args] of request.mock.calls) {
      expect(args.requestData.push_channel.android.ups.options.HW).toMatchObject({
        '/message/android/urgency': 'HIGH', '/message/android/category': 'VOIP',
      });
      expect(JSON.parse(args.requestData.push_message.transmission).payload.pushEnvironment).toBe('test');
    }
    expect((await call({ ...revoke, previousRegistrationId: nextRegistrationId }, key.binding)).errCode).toBe(0);
    expect((await call(current)).errCode).toBe(403);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
