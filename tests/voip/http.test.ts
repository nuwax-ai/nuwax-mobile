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
    expect(app.devices.get('bob:b:pushKit:development').token).toBe('pk');
    expect(app.devices.get('bob:b:uniPush:development').token).toBe('cid2');
  });
});
