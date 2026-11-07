import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  commands: [] as any[],
  events: [] as any[],
  sequence: 0,
  capabilities: vi.fn(),
  permissions: vi.fn(),
  create: vi.fn(),
  claimAudio: vi.fn(),
}));

vi.mock('vue', () => ({ ref: (value: unknown) => ({ value }) }));
vi.mock('../../servers/voip.uts', () => ({
  apiCallCapabilities: fake.capabilities,
  apiCreateCall: fake.create,
  apiCallSnapshot: vi.fn(),
  cancelCreatedVoipCall: vi.fn(),
  readVoipDevSession: () => ({ enabled: true }),
  setVoipDevSession: vi.fn(),
  voipSessionConfig: () => ({
    apiBaseUrl: 'http://development.example', accessToken: 'fixture',
    userId: 'alice', deviceId: 'a1', development: true,
  }),
}));
vi.mock('../../servers/im.uts', () => ({ apiImWhoami: vi.fn() }));
vi.mock('../../utils/apiResponse.uts', () => ({ apiResData: vi.fn() }));
vi.mock('../../utils/common.uts', () => ({ generateUUID: () => `fixture-${++fake.sequence}` }));
vi.mock('../../utils/im/imSessionScope.uts', () => ({ getImSessionStamp: () => 'fixture-session' }));
vi.mock('../../utils/appPrivacyConsent.uts', () => ({ hasAppPrivacyConsent: () => true }));
vi.mock('../../utils/appLifecycle.uts', () => ({ isAppInBackground: () => false }));
vi.mock('../../uni_modules/nuwax-voip/utssdk/web/index.uts', () => ({
  executeVoip: (raw: string) => fake.commands.push(JSON.parse(raw)),
  drainVoipEvents: () => JSON.stringify(fake.events.splice(0)),
  ensureVoipPermissions: fake.permissions,
}));
vi.mock('../../features/voip/audioFocus.uts', () => ({ claimVoipAudio: fake.claimAudio, releaseVoipAudio: vi.fn() }));
vi.mock('../../utils/voice/stopAllSpeechPlayback.uts', () => ({ stopAllSpeechPlayback: vi.fn() }));
vi.mock('../../utils/i18n.uts', () => ({ t: (key: string) => key }));

import { clearVoipSession, getVoipSnapshot, startVoipCall } from '../../features/voip/callManager.uts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('UTSJSONObject', class {});
  vi.stubGlobal('getCurrentPages', () => [{ route: 'subpackages/pages/voip-dev/voip-dev' }]);
  vi.stubGlobal('uni', {
    showToast: vi.fn(),
    navigateTo: (options: any) => options.complete(),
  });
  clearVoipSession();
  fake.commands = []; fake.events = [];
  fake.capabilities.mockReset().mockResolvedValue({ enabled: true, audio: true, video: true });
  fake.permissions.mockReset().mockResolvedValue(true);
  fake.create.mockReset().mockRejectedValue(new Error('UNEXPECTED_CREATE'));
  fake.claimAudio.mockClear();
});

afterEach(() => { clearVoipSession(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function deliverIncoming() {
  const initialized = fake.commands.find(command => command.op === 'initialize');
  fake.events.push({ type: 'snapshot', scope: initialized.scope, snapshot: {
    callId: 'incoming', convId: 'chat', version: 1, state: 'ringing',
    callerId: 'bob', calleeId: 'alice', callerDeviceId: 'b1', mediaType: 'audio',
    expiresAt: Date.now() + 45_000,
  } });
  await vi.advanceTimersByTimeAsync(100);
  expect(getVoipSnapshot()?.callId).toBe('incoming');
}

describe('outgoing call races', () => {
  it('creates and watches a call after capability and permission checks', async () => {
    fake.create.mockResolvedValue({
      callId: 'outgoing', convId: 'chat', version: 1, state: 'ringing',
      callerId: 'alice', calleeId: 'bob', callerDeviceId: 'a1', mediaType: 'audio',
      expiresAt: Date.now() + 45_000,
    });
    await startVoipCall('chat', 'audio');
    expect(fake.permissions).toHaveBeenCalledWith('audio');
    expect(fake.create).toHaveBeenCalledOnce();
    expect(fake.commands).toContainEqual(expect.objectContaining({ op: 'watch', snapshot: expect.objectContaining({ callId: 'outgoing' }) }));
    expect(getVoipSnapshot()?.callId).toBe('outgoing');
  });

  it('drops a capability response after logout before requesting permissions or audio', async () => {
    const capability = deferred<any>();
    fake.capabilities.mockReturnValue(capability.promise);
    const pending = startVoipCall('chat', 'audio');
    await vi.waitFor(() => expect(fake.capabilities).toHaveBeenCalled());
    clearVoipSession();
    capability.resolve({ enabled: true, audio: true });
    await pending;
    expect(fake.permissions).not.toHaveBeenCalled();
    expect(fake.claimAudio).not.toHaveBeenCalled();
    expect(fake.create).not.toHaveBeenCalled();
  });

  it('shows an incoming call that arrives while capabilities are pending', async () => {
    const capability = deferred<any>();
    fake.capabilities.mockReturnValue(capability.promise);
    const pending = startVoipCall('chat', 'video');
    await vi.waitFor(() => expect(fake.capabilities).toHaveBeenCalled());
    await deliverIncoming();
    capability.resolve({ enabled: true, video: true });
    await pending;
    expect(fake.permissions).not.toHaveBeenCalled();
    expect(fake.create).not.toHaveBeenCalled();
    expect(getVoipSnapshot()?.callId).toBe('incoming');
  });

  it('keeps an incoming call that arrives during a permission prompt', async () => {
    const permission = deferred<boolean>();
    fake.permissions.mockReturnValue(permission.promise);
    const pending = startVoipCall('chat', 'video');
    await vi.waitFor(() => expect(fake.permissions).toHaveBeenCalled());
    await deliverIncoming();
    permission.resolve(true);
    await pending;
    expect(fake.create).not.toHaveBeenCalled();
    expect(getVoipSnapshot()?.callId).toBe('incoming');
  });
});
