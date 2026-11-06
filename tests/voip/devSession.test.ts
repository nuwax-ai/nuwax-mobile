import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ allowed: true, consent: true, storage: new Map<string, unknown>(), requests: [] as any[] }));
vi.mock('../../utils/voip/development.uts', () => ({ isVoipDevelopmentBuild: () => state.allowed }));
vi.mock('../../utils/appPrivacyConsent.uts', () => ({ hasAppPrivacyConsent: () => state.consent }));
vi.mock('../../constants/config.uts', () => ({ getApiBaseUrl: () => 'https://platform.example', normalizeApiBaseUrl: (url: string) => url.trim() }));
vi.mock('../../servers/im.uts', () => ({ getImDeviceId: () => 'test-device' }));
import { loginVoipDev, setVoipDevSession, readVoipDevSession, probeVoipDevServer, voipSessionConfig } from '../../servers/voip.uts';
beforeEach(() => {
  state.allowed = true; state.consent = true; state.storage.clear(); state.requests = [];
  vi.stubGlobal('UTSJSONObject', class { constructor(value = {}) { Object.assign(this, value); } });
  vi.stubGlobal('uni', {
    getStorageSync: (key: string) => state.storage.get(key),
    setStorageSync: (key: string, value: unknown) => state.storage.set(key, value),
    removeStorageSync: (key: string) => state.storage.delete(key),
    request: (request: any) => state.requests.push(request),
  });
  setVoipDevSession(null);
});
afterEach(() => vi.unstubAllGlobals());
function complete(index: number, userId: string) {
  state.requests[index].success({ statusCode: 200, data: { code: '0000', data: { userId, accessToken: `${userId}-fixture-token` } } });
}
describe('explicit device-test session', () => {
  it('logout discards a late development login response', async () => {
    const pending = loginVoipDev('http://test-service:7890', 'alice');
    setVoipDevSession(null); complete(0, 'alice');
    await expect(pending).rejects.toThrow('CALL_SESSION_CHANGED');
    expect(readVoipDevSession()).toBeNull();
  });
  it('an earlier identity cannot overwrite a later successful login', async () => {
    const first = loginVoipDev('http://test-service:7890', 'alice');
    const second = loginVoipDev('http://test-service:7890', 'bob');
    complete(1, 'bob'); await second; complete(0, 'alice');
    await expect(first).rejects.toThrow('CALL_SESSION_CHANGED');
    expect(readVoipDevSession()?.userId).toBe('bob');
  });
  it('a stored development session cannot enable an ordinary release build', async () => {
    setVoipDevSession({ enabled: true, apiBaseUrl: 'http://test-service:7890', userId: 'alice', accessToken: 'fixture' });
    state.allowed = false;
    expect(readVoipDevSession()).toBeNull();
    await expect(loginVoipDev('http://test-service:7890', 'alice')).rejects.toThrow('CALL_FORBIDDEN');
    expect(state.requests).toHaveLength(0);
  });
  it('health and login never forward a platform bearer, then use only the test credential', async () => {
    state.storage.set('ACCESS_TOKEN', 'platform-fixture-token');
    const health = probeVoipDevServer('http://test-service:7890');
    state.requests[0].success({ statusCode: 200, data: { code: '0000', data: { developmentOnly: true } } });
    await health;
    const login = loginVoipDev('http://test-service:7890', 'alice'); complete(1, 'alice'); await login;
    expect(state.requests.every(request => request.header == null)).toBe(true);
    expect(voipSessionConfig().accessToken).toBe('alice-fixture-token');
    expect(state.storage.get('ACCESS_TOKEN')).toBe('platform-fixture-token');
  });
  it('health check rejects empty or unrelated responses instead of hanging', async () => {
    const pending = probeVoipDevServer('http://test-service:7890');
    state.requests[0].success({ statusCode: 200, data: null });
    await expect(pending).rejects.toThrow('CALL_INVALID_RESPONSE');
  });
});
