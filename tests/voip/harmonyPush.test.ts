import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const token = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('BuildProfile', () => ({ default: { DEBUG: true } }));
vi.mock('@kit.AbilityKit', () => ({ bundleManager: {
  BundleFlag: { GET_BUNDLE_INFO_DEFAULT: 0 },
  getBundleInfoForSelfSync: () => ({ name: 'com.nuwax.app' }),
} }));
vi.mock('@kit.NetworkKit', () => ({ http: {} }));
vi.mock('@kit.ArkTS', () => ({ util: { TextEncoder: class {
  encodeInto(value: string) { return new TextEncoder().encode(value); }
} } }));
vi.mock('@kit.AssetStoreKit', () => ({ asset: {
  Tag: {}, Accessibility: {}, ConflictResolution: {}, SyncType: {},
  addSync: vi.fn(), removeSync: vi.fn(),
} }));
vi.mock('@kit.PushKit', () => ({ pushService: { getToken: token.get } }));
vi.mock('@kit.CallServiceKit', () => ({ voipCall: { on: vi.fn() } }));
vi.mock('@kit.BackgroundTasksKit', () => ({ backgroundTaskManager: {} }));
vi.mock('@kit.ImageKit', () => ({ image: {} }));
vi.mock('@kit.AudioKit', () => ({ audio: {} }));
vi.mock('@kit.ArkWeb', () => ({ webview: {} }));

import { VoipBridge } from '../../uni_modules/nuwax-voip/utssdk/app-harmony/VoipBridge.ets';

function session(userId: string) {
  return {
    userId, scope: userId, deviceId: 'fixture-device', accessToken: `fixture-${userId}`,
    apiBaseUrl: 'http://development.example', development: true, qaAccepted: false, callLabel: 'fixture',
  };
}

beforeEach(() => {
  token.get.mockReset();
  vi.spyOn(VoipBridge, 'startStream').mockImplementation(() => {});
  vi.spyOn(VoipBridge, 'finish').mockImplementation(() => {});
  vi.spyOn(VoipBridge, 'request').mockResolvedValue({} as any);
  VoipBridge.reset();
});
afterEach(() => { VoipBridge.reset(); vi.restoreAllMocks(); });

describe('Harmony push registration lifetime', () => {
  it('registers the actual bundle and explicit environment', async () => {
    token.get.mockResolvedValue('current-push-token');
    VoipBridge.initialize(session('alice'));
    await vi.waitFor(() => expect(VoipBridge.request).toHaveBeenCalledOnce());
    const [path, body] = vi.mocked(VoipBridge.request).mock.calls[0];
    expect(path).toBe('/devices');
    expect(JSON.parse(body!)).toEqual({
      channel: 'harmonyPush', token: 'current-push-token', bundleId: 'com.nuwax.app', environment: 'development',
    });
  });

  it('uses the configured push environment for a formal account in an internal build', async () => {
    token.get.mockResolvedValue('current-push-token');
    VoipBridge.initialize({ ...session('alice'), apiBaseUrl: 'https://platform.example',
      development: false, qaAccepted: true, pushEnvironment: 'development' });
    await vi.waitFor(() => expect(VoipBridge.request).toHaveBeenCalledOnce());
    const [, body] = vi.mocked(VoipBridge.request).mock.calls[0];
    expect(JSON.parse(body!).environment).toBe('development');
  });

  it.each([false, true])('drops a token resolved after logout (replacement account %s)', async replacement => {
    let resolve!: (value: string) => void;
    const previous = new Promise<string>(complete => { resolve = complete; });
    token.get.mockReturnValueOnce(previous).mockResolvedValue('new-account-token');
    VoipBridge.initialize(session('alice'));
    VoipBridge.reset();
    if (replacement) VoipBridge.initialize(session('bob'));
    resolve('old-account-token');
    await previous;
    const registrations = vi.mocked(VoipBridge.request).mock.calls.map(([, body]) => JSON.parse(body!));
    expect(registrations.map(body => body.token)).toEqual(replacement ? ['new-account-token'] : []);
  });
});
