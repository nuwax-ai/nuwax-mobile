import { afterEach, describe, expect, it } from 'vitest';
import { createDevServer } from '../../scripts/voip-dev/server.mjs';
const apps: any[] = [];
afterEach(async () => { for (const app of apps.splice(0)) { app.dispose(); await new Promise<void>(r => app.server.close(() => r())); } });
async function fixture(roomService = { createRoom: async () => {}, deleteRoom: async () => {} }) {
  const app = createDevServer({ apiSecret: 'local-test-secret-at-least-32-characters', roomService }); apps.push(app);
  await new Promise<void>(r => app.server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  async function login(userId: string, device: string) {
    const { data } = await (await fetch(`${origin}/dev/login`, { method: 'POST', body: JSON.stringify({ userId }) })).json();
    return async (path: string, body?: any) => (await fetch(`${origin}/api/instant-message/calls${path}`, {
      method: body == null ? 'GET' : 'POST', headers: { Authorization: `Bearer ${data.accessToken}`, 'X-Call-Device-Id': device },
      ...(body == null ? {} : { body: JSON.stringify(body) }),
    })).json();
  }
  return { app, origin, login };
}
describe('development phone HTTP contract', () => {
  const apns = { provider: 'apns', channel: 'pushKit', platform: 'ios', deviceId: 'b', environment: 'development',
    bundleId: 'com.nuwax.app', token: '0001ff', registrationId: '00000000-0000-4000-8000-000000000001', previousRegistrationId: '', action: 'register' };
  it('acknowledges an APNs namespace without pretending to send, and preserves it across ordinary CID refresh', async () => {
    const { app, login } = await fixture(); const bob = await login('bob', 'b');
    expect((await bob('/devices', apns)).data).toEqual({ provider: 'apns', channel: 'pushKit', deviceId: 'b',
      environment: 'development', bundleId: 'com.nuwax.app', registrationId: apns.registrationId, registered: true, nativePush: false });
    await bob('/devices', { channel: 'uniPush', token: 'cid-updated', bundleId: 'com.nuwax.app', environment: 'development' });
    expect([...app.devices.values()].map((d: any) => d.token).sort()).toEqual(['0001ff', 'cid-updated']);
  });
  it('conditionally revokes old tokens and prevents late registration from reviving a revoked id', async () => {
    const { app, login } = await fixture(); const bob = await login('bob', 'b');
    await bob('/devices', apns);
    const next = { ...apns, token: '0002ff', registrationId: '00000000-0000-4000-8000-000000000002', previousRegistrationId: apns.registrationId };
    expect((await bob('/devices', next)).code).toBe('0000');
    await bob('/devices', { ...apns, action: 'revoke' });
    expect([...app.devices.values()][0].token).toBe(next.token);
    expect((await bob('/devices', apns)).code).toBe('CALL_PUSH_REGISTRATION_REVOKED');
    await bob('/devices', { ...next, action: 'revoke' });
    expect((await bob('/devices', next)).code).toBe('CALL_PUSH_REGISTRATION_REVOKED');
    expect(app.devices.size).toBe(0);
  });
  it('rejects stale compare-and-set updates and idempotency keys reused with another token', async () => {
    const { login } = await fixture(); const bob = await login('bob', 'b');
    await bob('/devices', apns);
    expect((await bob('/devices', { ...apns, token: '0002ff', action: 'revoke' })).code).toBe('CALL_PUSH_REGISTRATION_CONFLICT');
    expect((await bob('/devices', apns)).code).toBe('0000');
    expect((await bob('/devices', { ...apns, token: '0002ff' })).code).toBe('CALL_PUSH_REGISTRATION_CONFLICT');
    expect((await bob('/devices', { ...apns, registrationId: '00000000-0000-4000-8000-000000000003' })).code).toBe('CALL_PUSH_REGISTRATION_CONFLICT');
  });
  it('isolates APNs environments, bundles and accounts even when the physical device matches', async () => {
    const { app, login } = await fixture(); const bob = await login('bob', 'b'), alice = await login('alice', 'b');
    for (const request of [apns, { ...apns, environment: 'production' }, { ...apns, bundleId: 'com.nuwax.other' }]) await bob('/devices', request);
    await alice('/devices', apns);
    await bob('/devices', { ...apns, action: 'revoke' });
    expect(app.devices.size).toBe(3);
    expect([...app.devices.values()].filter((d: any) => d.userId === 'alice')).toHaveLength(1);
  });
  it('rejects malformed APNs registrations before modifying the store', async () => {
    const { app, login } = await fixture(); const bob = await login('bob', 'b');
    for (const extra of [{ deviceId: 'other-phone' }, { environment: '' }, { token: '0001ff\n' }, { token: '' },
      { registrationId: 'not-uuid' }, { previousRegistrationId: undefined }, { provider: 'other' }]) {
      expect((await bob('/devices', { ...apns, ...extra })).code).toBe('CALL_INVALID_ARGUMENT');
    }
    expect(app.devices.size).toBe(0);
  });
  it.each([true, false])('reports actual media service availability separately from call control (%s)', async reachable => {
    const { login } = await fixture({ createRoom: async () => {}, deleteRoom: async () => {}, listRooms: async () => {
      if (!reachable) throw new Error('fixture media unavailable');
      return [];
    } });
    const alice = await login('alice', 'device-test');
    expect((await alice('/diagnostics')).data).toEqual({ developmentOnly: true, controlReachable: true, mediaReachable: reachable, nativePush: false });
  });
  it('checks conversation membership and disallows RTC credentials before acceptance / on losing devices', async () => {
    const { login } = await fixture();
    const alice = await login('alice', 'a'), bob = await login('bob', 'b'), other = await login('bob', 'b2');
    expect((await bob('/capabilities?convId=demo-agent')).data.enabled).toBe(false);
    const call = (await alice('', { convId: 'demo-people', mediaType: 'audio', requestId: 'req' })).data;
    expect((await alice(`/${call.callId}/credentials`, {})).code).toBe('CALL_NOT_ACCEPTED');
    expect((await bob(`/${call.callId}/actions`, { action: 'accept', actionId: '1', answerMediaType: 'audio' })).data.state).toBe('connecting');
    expect((await other(`/${call.callId}/credentials`, {})).code).toBe('CALL_ANSWERED_ELSEWHERE');
    const credentials = (await alice(`/${call.callId}/credentials`, {})).data;
    const payload = JSON.parse(Buffer.from(credentials.participantToken.split('.')[1], 'base64url').toString());
    expect(payload.video).toMatchObject({ room: `voip-${call.callId}`, canPublishData: false, canPublishSources: ['microphone'] });
    expect(payload.exp - payload.nbf).toBeLessThanOrEqual(60);
  });
  it('rechecks termination after the asynchronous room operation', async () => {
    let release!: () => void;
    const { login } = await fixture({ createRoom: () => new Promise<void>(r => { release = r; }), deleteRoom: async () => {} });
    const alice = await login('alice', 'a'), bob = await login('bob', 'b');
    const call = (await alice('', { convId: 'demo-people', mediaType: 'audio', requestId: 'req' })).data;
    await bob(`/${call.callId}/actions`, { action: 'accept', actionId: '1', answerMediaType: 'audio' });
    const pending = alice(`/${call.callId}/credentials`, {});
    await new Promise<void>(resolve => { const poll = setInterval(() => { if (release) { clearInterval(poll); resolve(); } }, 1); });
    await bob(`/${call.callId}/actions`, { action: 'end', actionId: '2' }); release();
    expect((await pending).code).toBe('CALL_NOT_ACCEPTED');
  });
  it('keeps message cid and native call tokens in separate namespaces', async () => {
    const { app, login } = await fixture(); const bob = await login('bob', 'b');
    for (const [channel, token] of [['pushKit', 'pk'], ['uniPush', 'cid1'], ['uniPush', 'cid2']]) {
      expect((await bob('/devices', { channel, token, environment: 'development' })).code).toBe('0000');
    }
    expect([...app.devices.values()]).toEqual([
      expect.objectContaining({ channel: 'pushKit', token: 'pk', bundleId: '' }),
      expect.objectContaining({ channel: 'uniPush', token: 'cid2', bundleId: '' }),
    ]);
    await bob('/devices', { channel: 'pushKit', token: '', environment: 'development' });
    expect([...app.devices.values()]).toEqual([expect.objectContaining({ channel: 'uniPush', token: 'cid2' })]);
  });
  it('isolates package, push environment and vendor when updating or revoking a device', async () => {
    const { app, login } = await fixture();
    const bob = await login('bob', 'b');
    const base = { channel: 'pushKit', environment: 'development', bundleId: 'com.nuwax.app' };
    for (const registration of [
      { ...base, token: 'pk-app-dev' },
      { ...base, token: 'pk-other-app', bundleId: 'com.nuwax.other' },
      { ...base, token: 'pk-production', environment: 'production' },
      { ...base, token: 'vendor-xiaomi', channel: 'vendor', vendor: 'xiaomi' },
      { ...base, token: 'vendor-huawei', channel: 'vendor', vendor: 'huawei' },
    ]) {
      expect((await bob('/devices', registration)).code).toBe('0000');
    }
    await bob('/devices', { ...base, token: 'pk-refreshed' });
    expect(app.devices.size).toBe(5);
    for (let retry = 0; retry < 2; retry++) {
      expect((await bob('/devices', { ...base, token: '' })).data.registered).toBe(false);
    }
    expect([...app.devices.values()].map((device: any) => device.token).sort()).toEqual([
      'pk-other-app', 'pk-production', 'vendor-huawei', 'vendor-xiaomi',
    ]);
  });
  it('rejects malformed device namespaces before changing registrations', async () => {
    const { app, login } = await fixture();
    const bob = await login('bob', 'b');
    for (const registration of [
      { channel: 'uniPush', bundleId: 42 },
      { channel: 'vendor', bundleId: 'com.nuwax.app' },
    ]) {
      expect((await bob('/devices', { token: 'fixture', environment: 'development', ...registration })).code).toBe('CALL_INVALID_ARGUMENT');
    }
    expect(app.devices.size).toBe(0);
  });
});
