import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  commands: [] as any[],
  events: [] as any[],
  sequence: 0,
  nativeFails: false,
  capabilities: vi.fn(),
  permissions: vi.fn(),
  create: vi.fn(),
  snapshot: vi.fn(),
  claimAudio: vi.fn(),
  settings: vi.fn(),
  background: false,
  token: 'fixture',
}));

vi.mock('vue', () => ({ ref: (value: unknown) => ({ value }) }));
vi.mock('../../servers/voip.uts', () => ({
  apiCallCapabilities: fake.capabilities,
  apiCreateCall: fake.create,
  apiCallSnapshot: fake.snapshot,
  cancelCreatedVoipCall: vi.fn(),
  readVoipDevSession: () => ({ enabled: true }),
  setVoipDevSession: vi.fn(),
  voipSessionConfig: () => ({
    apiBaseUrl: 'http://development.example', accessToken: fake.token,
    userId: 'alice', deviceId: 'a1', development: true,
  }),
}));
vi.mock('../../servers/im.uts', () => ({ apiImWhoami: vi.fn() }));
vi.mock('../../utils/apiResponse.uts', () => ({ apiResData: vi.fn() }));
vi.mock('../../utils/common.uts', () => ({ generateUUID: () => `fixture-${++fake.sequence}` }));
vi.mock('../../utils/im/imSessionScope.uts', () => ({ getImSessionStamp: () => 'fixture-session' }));
vi.mock('../../utils/appPrivacyConsent.uts', () => ({ hasAppPrivacyConsent: () => true }));
vi.mock('../../utils/appLifecycle.uts', () => ({ isAppInBackground: () => fake.background }));
vi.mock('../../utils/meeting/meetingInviteNavigation.uts', () => ({
  openMeetingInvite: vi.fn(), clearMeetingInviteNavigation: vi.fn(), flushMeetingInviteNavigation: vi.fn(),
}));
vi.mock('../../uni_modules/nuwax-voip/utssdk/web/index.uts', () => ({
  executeVoip: (raw: string) => {
    if (fake.nativeFails) throw new Error("uts plugin unavailable");
    fake.commands.push(JSON.parse(raw));
  },
  drainVoipEvents: () => JSON.stringify(fake.events.splice(0)),
  ensureVoipPermissions: fake.permissions,
  openVoipAppSettings: fake.settings,
}));
vi.mock('../../features/voip/audioFocus.uts', () => ({ claimVoipAudio: fake.claimAudio, releaseVoipAudio: vi.fn() }));
vi.mock('../../utils/voice/stopAllSpeechPlayback.uts', () => ({ stopAllSpeechPlayback: vi.fn() }));
vi.mock('../../utils/i18n.uts', () => ({ t: (key: string) => key }));

import { bootstrapVoip, clearVoipSession, getVoipSnapshot, handleVoipInvitation, startVoipCall, answerVoipCall, endVoipCall, restoreVoipCall, voipError, voipHistory, voipAudioRoute, voipAudioRoutes, voipAudioRoutePending, voipAudioInterrupted, voipPermissionPending, voipPushRegistration, voipRemoteVideo, voipCameraSwitching, voipSpeaker, setVoipBackground } from '../../features/voip/callManager.uts';

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
    showModal: vi.fn(),
    navigateTo: (options: any) => options.complete(),
  });
  clearVoipSession();
  fake.nativeFails = false;
  fake.commands = []; fake.events = []; fake.token = 'fixture'; fake.background = false;
  fake.capabilities.mockReset().mockResolvedValue({ enabled: true, audio: true, video: true });
  fake.permissions.mockReset().mockResolvedValue(true);
  fake.create.mockReset().mockRejectedValue(new Error('UNEXPECTED_CREATE'));
  fake.snapshot.mockReset().mockRejectedValue(new Error('UNEXPECTED_SNAPSHOT'));
  fake.claimAudio.mockClear();
  fake.settings.mockClear();
});

afterEach(() => { clearVoipSession(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('ordinary notification invitation', () => {
  function ringingSnapshot() {
    return { callId: 'incoming', convId: 'chat', version: 1, state: 'ringing',
      callerId: 'bob', calleeId: 'alice', callerDeviceId: 'b1', mediaType: 'audio',
      expiresAt: Date.now() + 60_000 };
  }

  it('restores a valid notification and ignores one already past its own deadline', async () => {
    fake.snapshot.mockResolvedValue(ringingSnapshot());
    await handleVoipInvitation('expired', true, '', '', Date.now());
    expect(fake.snapshot).not.toHaveBeenCalled();
    await handleVoipInvitation('incoming', true, '', '', Date.now() + 5000);
    expect(fake.snapshot).toHaveBeenCalledExactlyOnceWith('incoming');
    expect(fake.commands).toContainEqual(expect.objectContaining({ op: 'watch', snapshot: ringingSnapshot() }));
  });

  it('does not restore a notification that expires while its message is being fetched', async () => {
    const fetched = deferred<ReturnType<typeof ringingSnapshot>>();
    fake.snapshot.mockReturnValue(fetched.promise);
    const pending = handleVoipInvitation('incoming', true, '', '', Date.now() + 500);
    await vi.advanceTimersByTimeAsync(501);
    expect(fake.snapshot).toHaveBeenCalledOnce();
    fetched.resolve(ringingSnapshot());
    await pending;
    expect(fake.commands.some(command => command.op === 'watch')).toBe(false);
  });

  it('does not open a notification handled across a session clear during bootstrap', async () => {
    const pending = handleVoipInvitation('incoming', true);
    clearVoipSession();
    await pending;
    expect(fake.snapshot).not.toHaveBeenCalled();
    expect(fake.commands.some(command => command.op === 'watch')).toBe(false);
  });

  it('ignores an invitation explicitly addressed to a different account', async () => {
    await handleVoipInvitation('incoming', true, '', '', Date.now() + 5000, 'former-account');
    expect(fake.snapshot).not.toHaveBeenCalled();
    expect(fake.commands.some(command => command.op === 'watch')).toBe(false);
  });
});

async function deliverIncoming(presentation: { nativeIncomingUI: boolean; foregroundIncomingPage: boolean; systemRingingOnly?: boolean } | null = null) {
  const initialized = fake.commands.find(command => command.op === 'initialize');
  fake.events.push({ type: 'snapshot', scope: initialized.scope, ...presentation, snapshot: {
    callId: 'incoming', convId: 'chat', version: 1, state: 'ringing',
    callerId: 'bob', calleeId: 'alice', callerDeviceId: 'b1', mediaType: 'audio',
    expiresAt: Date.now() + 45_000,
  } });
  await vi.advanceTimersByTimeAsync(100);
  expect(getVoipSnapshot()?.callId).toBe('incoming');
}

describe('session-level VoIP push readiness', () => {
  function registration(state: string, nativePush = false, scope?: string) {
    fake.events.push({ type: 'pushRegistration', scope: scope ?? fake.commands.filter(c => c.op === 'initialize').at(-1).scope,
      provider: 'apns', state, nativePush, token: 'must-not-be-exposed' });
  }
  it('exposes unavailable registration before the first call without asking for media permissions', async () => {
    await bootstrapVoip();
    registration('configurationMissing');
    await vi.advanceTimersByTimeAsync(100);
    expect(getVoipSnapshot()).toBeNull();
    expect(voipPushRegistration.value).toEqual({ provider: 'apns', state: 'configurationMissing', serverReady: false });
    expect(fake.permissions).not.toHaveBeenCalled(); expect(fake.claimAudio).not.toHaveBeenCalled();
    expect(voipError.value).toBe('');
  });
  it('separates a stored device registration from a sender readiness declaration', async () => {
    await bootstrapVoip();
    registration('registered', false); await vi.advanceTimersByTimeAsync(100);
    expect(voipPushRegistration.value.serverReady).toBe(false);
    registration('registered', true); await vi.advanceTimersByTimeAsync(100);
    expect(voipPushRegistration.value.serverReady).toBe(true);
    registration('unavailable', true); await vi.advanceTimersByTimeAsync(100);
    expect(voipPushRegistration.value.serverReady).toBe(false);
  });
  it('clears readiness on identity refresh/logout and ignores an old registration callback', async () => {
    await bootstrapVoip();
    const previous = fake.commands.filter(c => c.op === 'initialize').at(-1).scope;
    registration('registered', true); await vi.advanceTimersByTimeAsync(100);
    fake.token = 'refreshed-fixture'; await bootstrapVoip();
    expect(voipPushRegistration.value).toEqual({ provider: '', state: 'unknown', serverReady: false });
    registration('registered', true, previous); await vi.advanceTimersByTimeAsync(100);
    expect(voipPushRegistration.value.state).toBe('unknown');
    registration('registered', true); await vi.advanceTimersByTimeAsync(100);
    clearVoipSession();
    expect(voipPushRegistration.value).toEqual({ provider: '', state: 'unknown', serverReady: false });
  });
  it('keeps an online call alive when dedicated push registration fails', async () => {
    await bootstrapVoip(); await deliverIncoming();
    const call = getVoipSnapshot();
    registration('unavailable'); await vi.advanceTimersByTimeAsync(100);
    expect(getVoipSnapshot()).toBe(call);
    expect(getVoipSnapshot()?.state).toBe('ringing'); expect(voipError.value).toBe('');
  });
});

describe('outgoing call races', () => {
  it('offers system settings after a denied outgoing permission without creating a call', async () => {
    fake.permissions.mockResolvedValue(false);
    await startVoipCall('chat', 'audio');
    expect(fake.create).not.toHaveBeenCalled();
    const modal = vi.mocked(uni.showModal).mock.calls[0][0];
    expect(modal.confirmText).toBe('Mobile.Voip.openSettings');
    expect(fake.settings).not.toHaveBeenCalled();
    modal.success({ confirm: false }); expect(fake.settings).not.toHaveBeenCalled();
    modal.success({ confirm: true }); expect(fake.settings).toHaveBeenCalledOnce();
  });
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

describe('incoming actions and event isolation', () => {
  async function incoming() { await bootstrapVoip(); await deliverIncoming(); }
  function event(value: any) { fake.events.push({ scope: fake.commands.find(c => c.op === 'initialize').scope, ...value }); }

  it('opens the foreground call page once for a reported iOS call', async () => {
    await bootstrapVoip();
    const navigate = vi.spyOn(uni, 'navigateTo');
    await deliverIncoming({ nativeIncomingUI: true, foregroundIncomingPage: true });
    event({ type: 'snapshot', nativeIncomingUI: true, foregroundIncomingPage: true,
      snapshot: { ...getVoipSnapshot(), version: 2 } });
    await vi.advanceTimersByTimeAsync(100);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ url: '/subpackages/pages/voip-call/voip-call' }));
  });

  it('defers the App page while CallKit rings and opens it once after the system answers', async () => {
    await bootstrapVoip();
    const navigate = vi.spyOn(uni, 'navigateTo');
    await deliverIncoming({ nativeIncomingUI: true, foregroundIncomingPage: false, systemRingingOnly: true });
    restoreVoipCall();
    expect(navigate).not.toHaveBeenCalled();

    fake.background = true;
    event({ type: 'snapshot', foregroundIncomingPage: true,
      snapshot: { ...getVoipSnapshot(), version: 2, state: 'connecting', acceptedDeviceId: 'a1' } });
    await vi.advanceTimersByTimeAsync(100);
    expect(navigate).not.toHaveBeenCalled();

    fake.background = false;
    await vi.advanceTimersByTimeAsync(100);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ url: '/subpackages/pages/voip-call/voip-call' }));
    event({ type: 'snapshot', foregroundIncomingPage: true,
      snapshot: { ...getVoipSnapshot(), version: 3, state: 'active' } });
    await vi.advanceTimersByTimeAsync(100);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('still opens the App permission flow for a CallKit call', async () => {
    await bootstrapVoip();
    const navigate = vi.spyOn(uni, 'navigateTo');
    await deliverIncoming({ nativeIncomingUI: true, foregroundIncomingPage: false, systemRingingOnly: true });
    event({ type: 'permissionPending', callId: 'incoming' });
    event({ type: 'openPage', callId: 'incoming' });
    await vi.advanceTimersByTimeAsync(100);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ url: '/subpackages/pages/voip-call/voip-call' }));
  });

  it('opens a still-ringing iOS call after the App returns to the foreground', async () => {
    await bootstrapVoip();
    const navigate = vi.spyOn(uni, 'navigateTo');
    fake.background = true;
    await deliverIncoming({ nativeIncomingUI: true, foregroundIncomingPage: true });
    expect(navigate).not.toHaveBeenCalled();
    fake.background = false;
    await vi.advanceTimersByTimeAsync(100);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ url: '/subpackages/pages/voip-call/voip-call' }));
    endVoipCall();
    expect(fake.commands.at(-1)).toMatchObject({ op: 'action', action: 'reject', callId: 'incoming' });
    await vi.advanceTimersByTimeAsync(300);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('waits for the root page after the system answered a cold-start iOS call', async () => {
    await bootstrapVoip();
    const navigate = vi.spyOn(uni, 'navigateTo');
    vi.stubGlobal('getCurrentPages', () => []);
    event({ type: 'snapshot', foregroundIncomingPage: true, snapshot: {
      callId: 'accepted', convId: 'chat', version: 2, state: 'connecting',
      callerId: 'bob', calleeId: 'alice', callerDeviceId: 'b1', acceptedDeviceId: 'a1', mediaType: 'audio',
    } });
    await vi.advanceTimersByTimeAsync(100);
    expect(navigate).not.toHaveBeenCalled();
    vi.stubGlobal('getCurrentPages', () => [{ route: 'pages/tab-shell/tab-shell' }]);
    await vi.advanceTimersByTimeAsync(100);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ url: '/subpackages/pages/voip-call/voip-call' }));
    endVoipCall();
    expect(fake.commands.at(-1)).toMatchObject({ op: 'action', action: 'end', callId: 'accepted' });
  });

  it('reopens a minimized call without creating another call and ignores a late tap after hangup', async () => {
    await incoming();
    event({ type: 'snapshot', snapshot: { ...getVoipSnapshot(), version: 2, state: 'active', acceptedDeviceId: 'a1' } });
    await vi.advanceTimersByTimeAsync(100);
    const navigate = vi.spyOn(uni, 'navigateTo');
    const sent = fake.commands.length;
    restoreVoipCall();
    expect(navigate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ url: '/subpackages/pages/voip-call/voip-call' }));
    expect(fake.commands).toHaveLength(sent);
    event({ type: 'localEnded', callId: 'incoming', reason: 'ended' });
    await vi.advanceTimersByTimeAsync(100);
    restoreVoipCall();
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('leaves background calls and native-only incoming activities to the system', async () => {
    await bootstrapVoip();
    const navigate = vi.spyOn(uni, 'navigateTo');
    fake.background = true;
    await deliverIncoming({ nativeIncomingUI: true, foregroundIncomingPage: true });
    event({ type: 'localEnded', callId: 'incoming', reason: 'remoteCancelled' });
    await vi.advanceTimersByTimeAsync(100);
    fake.background = false;
    event({ type: 'snapshot', nativeIncomingUI: true, snapshot: {
      callId: 'native', convId: 'chat', version: 1, state: 'ringing',
      callerId: 'bob', calleeId: 'alice', callerDeviceId: 'b1', mediaType: 'audio',
      expiresAt: Date.now() + 45_000,
    } });
    await vi.advanceTimersByTimeAsync(100);
    expect(getVoipSnapshot()?.callId).toBe('native');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('recovers the reserved incoming call after native rejects a conflicting outgoing watch', async () => {
    fake.create.mockResolvedValue({ callId: 'outgoing', convId: 'chat', version: 1, state: 'ringing', callerId: 'alice', calleeId: 'bob', callerDeviceId: 'a1', mediaType: 'audio', expiresAt: Date.now() + 45_000 });
    await startVoipCall('chat', 'audio');
    expect(getVoipSnapshot()?.callId).toBe('outgoing');
    event({ type: 'localEnded', callId: 'outgoing', reason: 'busy' });
    await deliverIncoming();
    expect(getVoipSnapshot()?.callId).toBe('incoming');
    expect(getVoipSnapshot()?.state).toBe('ringing');
  });

  it('ignores an old call error while a replacement incoming call is ringing', async () => {
    await incoming();
    event({ type: 'error', callId: 'previous', code: 'CALL_MEDIA_FAILED' });
    await vi.advanceTimersByTimeAsync(100);
    expect(voipError.value).toBe('');
    expect(getVoipSnapshot()?.state).toBe('ringing');
  });
  it('reports a filtered incoming call without opening an ended-only call page', async () => {
    await bootstrapVoip();
    const navigate = vi.spyOn(uni, 'navigateTo');
    event({ type: 'error', callId: 'filtered', code: 'CALL_SYSTEM_FOCUS_FILTERED' });
    event({ type: 'localEnded', callId: 'filtered', reason: 'systemFocusFiltered' });
    await vi.advanceTimersByTimeAsync(100);
    expect(getVoipSnapshot()).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    expect(uni.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Mobile.Voip.focusFiltered' }));
  });
  it('coalesces repeated answers while the permission request is pending', async () => {
    await incoming(); const permission = deferred<boolean>(); fake.permissions.mockReturnValue(permission.promise);
    const first = answerVoipCall('audio'); const second = answerVoipCall('audio');
    expect(fake.permissions).toHaveBeenCalledOnce();
    permission.resolve(true); await Promise.all([first, second]);
    expect(fake.commands.filter(c => c.action === 'accept')).toHaveLength(1);
  });
  it('does not set permission errors after logout', async () => {
    await incoming(); const permission = deferred<boolean>(); fake.permissions.mockReturnValue(permission.promise);
    const answering = answerVoipCall('audio'); clearVoipSession(); permission.resolve(false); await answering;
    expect(voipError.value).toBe('');
    expect(fake.commands.filter(c => c.action === 'accept')).toHaveLength(0);
  });
  it('does not accept a call that ended during the permission request', async () => {
    await incoming(); const permission = deferred<boolean>(); fake.permissions.mockReturnValue(permission.promise);
    const answering = answerVoipCall('audio');
    event({ type: 'localEnded', callId: 'incoming', reason: 'remoteCancelled' }); await vi.advanceTimersByTimeAsync(100);
    permission.resolve(true); await answering;
    expect(fake.commands.filter(c => c.action === 'accept')).toHaveLength(0);
    expect(getVoipSnapshot()?.state).toBe('ended');
  });
  it('does not request video capture for an audio-only incoming call', async () => {
    await incoming(); await answerVoipCall('video');
    expect(fake.permissions).not.toHaveBeenCalled();
  });
  it('retains the call and clock when only access credentials refresh', async () => {
    await incoming(); const original = getVoipSnapshot();
    fake.token = 'refreshed'; await bootstrapVoip();
    expect(getVoipSnapshot()).toBe(original);
    expect(fake.commands.filter(c => c.op === 'initialize')).toHaveLength(2);
  });
  it('loads history without an active call and clears it on logout', async () => {
    await bootstrapVoip();
    event({ type: 'history', records: [{ callId: 'observed', convId: 'chat', direction: 'incoming', mediaType: 'audio', startedAt: 1, endedAt: 2, missed: true }] });
    await vi.advanceTimersByTimeAsync(100);
    expect(voipHistory.value).toHaveLength(1);
    clearVoipSession();
    expect(voipHistory.value).toEqual([]);
  });
  it('ignores old account history and stale audio changes', async () => {
    await incoming();
    fake.events.push({ scope: 'previous-account', type: 'history', records: [{ callId: 'leaked', convId: 'chat' }] });
    event({ type: 'audioInterrupted', callId: 'old-call', enabled: true });
    event({ type: 'audioRoute', callId: 'incoming', selected: 'earpiece' });
    event({ type: 'audioRoute', callId: 'old-call', selected: 'speaker' });
    await vi.advanceTimersByTimeAsync(100);
    expect(voipHistory.value).toEqual([]); expect(voipAudioInterrupted.value).toBe(false);
    expect(voipAudioRoute.value).toBe('earpiece');
  });
  it('resets permissions, interruption and routes at terminal cleanup', async () => {
    await incoming();
    event({ type: 'permissionPending', callId: 'incoming' });
    event({ type: 'speaker', callId: 'incoming', enabled: true });
    event({ type: 'audioRoutes', callId: 'incoming', routes: [{ id: 'speaker', kind: 'speaker' }], selected: 'speaker' });
    event({ type: 'audioInterrupted', callId: 'incoming', enabled: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(voipAudioRoutes.value).toHaveLength(1); expect(voipPermissionPending.value).toBe(true); expect(voipAudioInterrupted.value).toBe(true);
    expect(voipSpeaker.value).toBe(true);
    expect(voipAudioRoute.value).toBe('speaker');
    event({ type: 'localEnded', callId: 'incoming', reason: 'permissionRequired' });
    await vi.advanceTimersByTimeAsync(100);
    expect(voipAudioRoutes.value).toEqual([]); expect(voipPermissionPending.value).toBe(false); expect(voipAudioInterrupted.value).toBe(false);
    expect(voipSpeaker.value).toBe(false);
    expect(voipAudioRoute.value).toBe('');
  });
  it('tracks initial audio routing only for the current call and clears it on end', async () => {
    await incoming();
    event({ type: 'audioRoutePending', callId: 'old-call', enabled: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(voipAudioRoutePending.value).toBe(false);
    event({ type: 'audioRoutePending', callId: 'incoming', enabled: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(voipAudioRoutePending.value).toBe(true);
    event({ type: 'audioRoutePending', callId: 'incoming', enabled: false });
    await vi.advanceTimersByTimeAsync(100);
    expect(voipAudioRoutePending.value).toBe(false);
    event({ type: 'audioRoutePending', callId: 'incoming', enabled: true });
    event({ type: 'localEnded', callId: 'incoming', reason: 'ended' });
    await vi.advanceTimersByTimeAsync(100);
    expect(voipAudioRoutePending.value).toBe(false);
  });

  it('hides remote video on mute, restores it on unmute, and discards ended-call video state', async () => {
    await incoming();
    event({ type: 'snapshot', snapshot: { ...getVoipSnapshot(), version: 2, state: 'active', mediaType: 'video', acceptedDeviceId: 'a1' } });
    event({ type: 'remoteVideo', callId: 'incoming', enabled: true });
    event({ type: 'cameraSwitching', callId: 'incoming', enabled: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(voipRemoteVideo.value).toBe(true);
    expect(voipCameraSwitching.value).toBe(true);
    event({ type: 'remoteVideo', callId: 'incoming', enabled: false });
    event({ type: 'cameraSwitching', callId: 'incoming', enabled: false });
    await vi.advanceTimersByTimeAsync(100);
    expect(voipRemoteVideo.value).toBe(false);
    expect(voipCameraSwitching.value).toBe(false);
    event({ type: 'remoteVideo', callId: 'incoming', enabled: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(voipRemoteVideo.value).toBe(true);
    event({ type: 'cameraSwitching', callId: 'incoming', enabled: true });
    event({ type: 'localEnded', callId: 'incoming', reason: 'ended' });
    event({ type: 'remoteVideo', callId: 'incoming', enabled: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(voipRemoteVideo.value).toBe(false);
    expect(voipCameraSwitching.value).toBe(false);
  });
});


describe('native plugin unavailable', () => {
  it('does not interrupt App background/foreground lifecycle', () => {
    fake.nativeFails = true;
    expect(() => setVoipBackground(true)).not.toThrow();
    expect(() => setVoipBackground(false)).not.toThrow();
    expect(voipError.value).toBe('CALL_SYSTEM_UNAVAILABLE');
  });
  it('retries initialization after a failed native call for the same session', async () => {
    fake.nativeFails = true;
    await expect(bootstrapVoip()).rejects.toThrow('uts plugin unavailable');
    fake.nativeFails = false;
    await bootstrapVoip();
    expect(fake.commands.filter(command => command.op === 'initialize')).toHaveLength(1);
  });
});
