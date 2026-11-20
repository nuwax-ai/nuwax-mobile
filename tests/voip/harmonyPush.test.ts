import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const token = vi.hoisted(() => ({ get: vi.fn() }));
const transport = vi.hoisted(() => ({ request: vi.fn(), destroy: vi.fn() }));
const kits = vi.hoisted(() => ({
  receive: vi.fn(), loadAsset: vi.fn(), report: vi.fn(), reportError: vi.fn(), reportState: vi.fn(),
  onCall: vi.fn(), createPicture: vi.fn(), createCallId: vi.fn(),
}));
vi.mock('BuildProfile', () => ({ default: { DEBUG: true } }));
vi.mock('@kit.AbilityKit', () => ({ bundleManager: {
  BundleFlag: { GET_BUNDLE_INFO_DEFAULT: 0 },
  getBundleInfoForSelfSync: () => ({ name: 'com.nuwax.app' }),
} }));
vi.mock('@kit.NetworkKit', () => ({ http: {
  createHttp: () => ({ request: transport.request, destroy: transport.destroy }),
  HttpDataType: { STRING: 0 }, RequestMethod: { GET: 'GET', POST: 'POST' },
} }));
vi.mock('@kit.ArkTS', () => ({ util: { generateRandomUUID: kits.createCallId, TextEncoder: class {
  encodeInto(value: string) { return new TextEncoder().encode(value); }
}, TextDecoder: class {
  decodeWithStream(value: Uint8Array) { return new TextDecoder().decode(value); }
} } }));
vi.mock('@kit.AssetStoreKit', () => ({ asset: {
  Tag: {}, Accessibility: {}, ConflictResolution: {}, SyncType: {}, ReturnType: { ALL: 0 },
  addSync: vi.fn(), removeSync: vi.fn(), querySync: kits.loadAsset,
} }));
vi.mock('@kit.PushKit', () => ({ pushService: { getToken: token.get, receiveMessage: kits.receive } }));
vi.mock('@kit.CallServiceKit', () => ({ voipCall: {
  on: kits.onCall, reportIncomingCall: kits.report, reportIncomingCallError: kits.reportError, reportCallStateChange: kits.reportState,
  ErrorReason: { ERROR_NONE: 0 },
  VoipCallType: { VOIP_CALL_VOICE: 'voice', VOIP_CALL_VIDEO: 'video' },
  VoipCallFailureCause: { OTHER: 'other', ROUTE_BUSY: 'busy' },
  VoipCallState: {
    VOIP_CALL_STATE_RINGING: 'ringing', VOIP_CALL_STATE_ANSWERED: 'answered',
    VOIP_CALL_STATE_ACTIVE: 'active', VOIP_CALL_STATE_DISCONNECTED: 'disconnected',
  },
  VoipCallUiEvent: { VOIP_CALL_EVENT_VOICE_ANSWER: 'answer-voice', VOIP_CALL_EVENT_VIDEO_ANSWER: 'answer-video',
    VOIP_CALL_EVENT_REJECT: 'reject', VOIP_CALL_EVENT_HANGUP: 'hangup' },
} }));
vi.mock('@kit.BackgroundTasksKit', () => ({ backgroundTaskManager: {} }));
vi.mock('@kit.ImageKit', () => ({ image: { createPixelMap: kits.createPicture, PixelMapFormat: { RGBA_8888: 0 } } }));
vi.mock('@kit.AudioKit', () => ({ audio: {} }));
vi.mock('@kit.ArkWeb', () => ({ webview: {} }));

import { VoipBridge, VoipBusinessPolicy } from '../../uni_modules/nuwax-voip/utssdk/app-harmony/VoipBridge.ets';
const actualRequest = VoipBridge.request;
const actualFinish = VoipBridge.finish;

function session(userId: string) {
  return {
    userId, scope: userId, deviceId: 'fixture-device', accessToken: `fixture-${userId}`,
    apiBaseUrl: 'http://development.example', development: true, qaAccepted: false, callLabel: 'fixture',
  };
}

beforeEach(() => {
  if (VoipBridge.expiry >= 0) clearTimeout(VoipBridge.expiry);
  VoipBridge.expiry = -1; VoipBridge.mediaId = ''; VoipBridge.nativeId = ''; VoipBridge.connected = false; VoipBridge.readySent = false;
  VoipBridge.peerReady = false;
  VoipBridge.answeredNativeId = ''; VoipBridge.ability = null; VoipBridge.systemRegistered = false;
  VoipBridge.clearPendingIncoming();
  token.get.mockReset();
  transport.request.mockReset(); transport.destroy.mockClear();
  kits.receive.mockReset(); kits.loadAsset.mockReset();
  kits.report.mockReset().mockResolvedValue(0);
  kits.reportError.mockReset().mockResolvedValue(undefined);
  kits.reportState.mockReset().mockResolvedValue(undefined);
  kits.createPicture.mockReset().mockResolvedValue({ release: vi.fn() });
  kits.createCallId.mockReset().mockReturnValue('local-system-call');
  vi.spyOn(VoipBridge, 'startStream').mockImplementation(() => {});
  vi.spyOn(VoipBridge, 'finish').mockImplementation(() => {});
  vi.spyOn(VoipBridge, 'request').mockResolvedValue({} as any);
  VoipBridge.current = null;
  VoipBridge.reset();
  vi.mocked(VoipBridge.finish).mockClear();
});
afterEach(() => { VoipBridge.clearPendingIncoming(); VoipBridge.reset(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Harmony system call cold start', () => {
  const convId = '245475557381246976';
  const msgId = '9223372036854775807';
  const callId = 'business-call';
  const systemId = 'huawei-system-call';
  const config = { ...session('alice'), protocol: 'im-voip-v1' };
  const invite = (override: Record<string, unknown> = {}) => ({
    type: 'voip', callId, convId, msgId, mediaType: 'video', calleeId: 'alice',
    displayName: 'Bob', expiresAt: Date.now() + 30000, ...override,
  });
  const push = (override: Record<string, unknown> = {}, nativeId = systemId) => ({
    callId: nativeId, data: JSON.stringify(invite(override)),
  });
  const message = () => ({
    convId, msgId, msgType: 'voip', senderId: 'bob', senderType: 1, msgStatus: 1,
    sendTime: Date.now(), body: { callId, roomName: 'authenticated-room', mediaType: 'video' },
  });
  const detail = { convType: 1, peerUserId: 'bob', peerName: 'Bob' };
  const setup = () => {
    vi.mocked(VoipBridge.finish).mockImplementation(actualFinish);
    VoipBridge.initialize(config);
  };

  it('binds the push listener before session restore and preserves the system envelope identifier', async () => {
    const ability = { context: {} } as any;
    kits.loadAsset.mockReturnValue([new Map([[undefined, new TextEncoder().encode(JSON.stringify(config))]])]);
    kits.receive.mockImplementation(() => expect(VoipBridge.configuration).toBeNull());
    VoipBridge.bindPush(ability);
    VoipBridge.bindPush(ability);
    expect(kits.receive).toHaveBeenCalledExactlyOnceWith('VoIP', ability, expect.any(Function));
    expect(VoipBridge.configuration?.userId).toBe('alice');
    vi.mocked(VoipBridge.request).mockResolvedValueOnce(message() as any).mockResolvedValueOnce(detail as any);

    const received = kits.receive.mock.calls[0][2];
    received({ data: JSON.stringify({ header: 'system', callId: systemId, data: JSON.stringify(invite()) }) });
    await vi.waitFor(() => expect(VoipBridge.current?.callId).toBe(callId));
    expect(kits.report).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ callId: systemId, abilityName: 'NuwaxVoipMediaAbility' }));
    expect(VoipBridge.current?.roomName).toBe('authenticated-room');
    expect(VoipBridge.queue).toContainEqual(expect.objectContaining({ type: 'snapshot', nativeIncomingUI: true }));
  });

  it('reports the system call before IM validation and processes an early locked-screen voice answer once', async () => {
    setup();
    let resolveMessage!: (value: any) => void;
    vi.mocked(VoipBridge.request).mockReturnValueOnce(new Promise(resolve => { resolveMessage = resolve; }))
      .mockResolvedValueOnce(detail as any);
    vi.spyOn(VoipBridge, 'ensurePermissions').mockResolvedValue(true);
    const media = vi.spyOn(VoipBridge, 'startMedia').mockImplementation(() => {});

    const pending = VoipBridge.incoming(push());
    await vi.waitFor(() => expect(VoipBridge.request).toHaveBeenCalledExactlyOnceWith(
      `/api/instant-message/messages/${msgId}?convId=${convId}`, '', true));
    expect(kits.report.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(VoipBridge.request).mock.invocationCallOrder[0]);
    await VoipBridge.incoming(push());
    await VoipBridge.incoming(push({}, 'duplicate-system-call'));
    await VoipBridge.receiveInvitation(message() as any);
    const answer = { callId: systemId, voipCallUiEvent: 'answer-voice' } as any;
    VoipBridge.systemEvent(answer);
    VoipBridge.systemEvent(answer);
    expect(kits.report).toHaveBeenCalledOnce();
    expect(kits.reportError).toHaveBeenCalledWith('duplicate-system-call', 'busy');
    expect(kits.reportState).toHaveBeenCalledExactlyOnceWith(systemId, 'answered');
    expect(media).not.toHaveBeenCalled();

    resolveMessage(message()); await pending;
    await vi.waitFor(() => expect(media).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      callId, state: 'connecting', mediaType: 'audio', roomName: 'authenticated-room',
    })));
    expect(kits.reportState).toHaveBeenCalledExactlyOnceWith(systemId, 'answered');
    vi.spyOn(VoipBridge, 'startTask').mockResolvedValue();
    vi.spyOn(VoipBridge, 'mediaJoined').mockResolvedValue();
    VoipBridge.mediaEvent(JSON.stringify({ type: 'connected', callId }));
    expect(kits.reportState).toHaveBeenCalledOnce();
    VoipBridge.mediaEvent(JSON.stringify({ type: 'peerMediaReady', callId }));
    expect(kits.reportState).toHaveBeenLastCalledWith(systemId, 'active', 'voice');
    expect(VoipBridge.current?.state).toBe('active');
  });

  it('reports a verified WS invitation in the background and rejects a later push as already presented', async () => {
    setup();
    VoipBridge.execute(JSON.stringify({ op: 'background', scope: config.scope, hidden: true }));
    vi.mocked(VoipBridge.request).mockResolvedValueOnce(detail as any);

    await VoipBridge.receiveInvitation(message() as any);
    await VoipBridge.incoming(push());

    expect(VoipBridge.request).toHaveBeenCalledExactlyOnceWith(`/api/instant-message/conversations/${convId}`, '', true);
    expect(kits.report).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ callId: 'local-system-call' }));
    expect(kits.reportError).toHaveBeenCalledExactlyOnceWith(systemId, 'busy');
    expect(VoipBridge.current?.callId).toBe(callId);
    expect(VoipBridge.queue).toContainEqual(expect.objectContaining({ type: 'snapshot', nativeIncomingUI: true }));
  });

  it('retains a verified background invitation if Call Service Kit rejects its presentation', async () => {
    setup();
    VoipBridge.execute(JSON.stringify({ op: 'background', scope: config.scope, hidden: true }));
    vi.mocked(VoipBridge.request).mockResolvedValueOnce(detail as any);
    kits.report.mockResolvedValueOnce(1);
    await VoipBridge.receiveInvitation(message() as any);
    expect(VoipBridge.current).toMatchObject({ callId, state: 'ringing' });
    expect(VoipBridge.pendingIncoming).toBeNull();
    expect(VoipBridge.nativeId).toBe('');
  });

  it.each(['cancel', 'answered', 'account switch'])('drops validation after %s while ringing', async reason => {
    setup();
    let resolveMessage!: (value: any) => void;
    vi.mocked(VoipBridge.request).mockReturnValueOnce(new Promise(resolve => { resolveMessage = resolve; }));
    const pending = VoipBridge.incoming(push());
    await vi.waitFor(() => expect(VoipBridge.nativeId).toBe(systemId));
    if (reason === 'account switch') VoipBridge.initialize({ ...config, userId: 'charlie' });
    else VoipBridge.receiveSignal({ eventType: `voip:${reason}`, payload: { convId, msgId, userId: 'alice' } } as any);
    resolveMessage(message()); await pending;
    expect(kits.reportState).toHaveBeenCalledExactlyOnceWith(systemId, 'disconnected');
    expect(VoipBridge.current).toBeNull();
    expect(VoipBridge.request).toHaveBeenCalledOnce();
  });

  it('rejects expired or wrong-account pushes and never uses a naked business ID for Call Service', async () => {
    setup();
    await VoipBridge.incoming(push({ expiresAt: Date.now() - 1 }));
    await VoipBridge.incoming(push({ calleeId: 'bob' }));
    await VoipBridge.incoming(push({ scene: 'meeting' }));
    await VoipBridge.incoming({ data: JSON.stringify(invite()) } as any);
    expect(kits.reportError.mock.calls).toEqual(Array(3).fill([systemId, 'other']));
    expect(kits.report).not.toHaveBeenCalled();
    expect(VoipBridge.request).not.toHaveBeenCalled();
  });

  it('dismisses mismatched IM invitations without letting a retransmission ring again', async () => {
    setup();
    vi.mocked(VoipBridge.request).mockResolvedValueOnce({ ...message(), msgId: '9001' } as any);
    await VoipBridge.incoming(push());
    expect(VoipBridge.current).toBeNull();
    expect(kits.reportState).toHaveBeenCalledExactlyOnceWith(systemId, 'disconnected');
    await VoipBridge.incoming(push({}, 'replacement-system-call'));
    expect(kits.report).toHaveBeenCalledOnce();
    expect(kits.reportError).toHaveBeenCalledWith('replacement-system-call', 'busy');
  });

  it('cleans up a late system report after the user signs out', async () => {
    setup();
    let finishReport!: (value: number) => void;
    kits.report.mockReturnValueOnce(new Promise(resolve => { finishReport = resolve; }));
    const pending = VoipBridge.incoming(push());
    await vi.waitFor(() => expect(kits.report).toHaveBeenCalledOnce());
    VoipBridge.reset();
    finishReport(0); await pending;
    expect(kits.reportState).toHaveBeenCalledExactlyOnceWith(systemId, 'disconnected');
    expect(VoipBridge.request).not.toHaveBeenCalled();
  });
});

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

describe('PC-aligned business lifecycle', () => {
  function setup() {
    VoipBridge.initialize({ ...session('alice'), protocol: 'im-voip-v1' });
    vi.mocked(VoipBridge.request).mockClear();
  }
  const outgoing = () => ({ callId: 'c1', convId: 'chat', version: 1, state: 'ringing',
    callerId: 'alice', callerDeviceId: 'fixture-device', calleeId: 'bob', acceptedDeviceId: '',
    msgId: '', roomName: 'call-c1', mediaType: 'audio', expiresAt: Date.now() + 60000, connectedAt: 0 } as any);
  it('retains joined media when the answered notification fails, but still fails an unsent invitation', async () => {
    setup();
    VoipBridge.current = { ...outgoing(), callerId: 'bob', calleeId: 'alice', msgId: 'm1', state: 'active' };
    const current = VoipBridge.current;
    vi.mocked(VoipBridge.request).mockRejectedValueOnce(new Error('temporary 5xx'));
    await VoipBridge.mediaJoined();
    expect(VoipBridge.current).toBe(current); expect(VoipBridge.finish).not.toHaveBeenCalled();
    expect(VoipBridge.queue).toContainEqual(expect.objectContaining({ type: 'controlWarning', code: 'CALL_ANSWER_REPORT_FAILED' }));
    VoipBridge.current = outgoing();
    vi.mocked(VoipBridge.request).mockRejectedValueOnce(new Error('invitation failed'));
    await expect(VoipBridge.mediaJoined()).rejects.toThrow('invitation failed');
  });
  it.each([401, 403])('expires the current session on HTTP %s instead of treating it as a retryable report failure', async status => {
    setup();
    transport.request.mockResolvedValue({ responseCode: status, result: 'not JSON' });
    await expect(actualRequest('/answered', '{}')).rejects.toThrow('CALL_SESSION_EXPIRED');
    expect(VoipBridge.configuration).toBeNull();
    expect(VoipBridge.queue).toContainEqual(expect.objectContaining({ type: 'localEnded', reason: 'sessionExpired' }));
    expect(transport.destroy).toHaveBeenCalledOnce();
  });
  it('does not let a previous token authentication failure clear the refreshed session', async () => {
    setup(); let finish!: (response: any) => void;
    transport.request.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const pending = actualRequest('/answered', '{}');
    VoipBridge.initialize({ ...session('alice'), protocol: 'im-voip-v1', accessToken: 'new-fixture' });
    finish({ responseCode: 401, result: '{"code":"EXPIRED","data":null}' });
    await expect(pending).rejects.toThrow('CALL_ACTION_FAILED');
    expect(VoipBridge.configuration?.accessToken).toBe('new-fixture');
    expect(VoipBridge.queue.some(event => event.type === 'localEnded' && event.reason === 'sessionExpired')).toBe(false);
  });
  it('starts the full ringing window after invitation success even after a slow media setup', async () => {
    setup(); vi.useFakeTimers();
    vi.spyOn(VoipBridge, 'startMedia').mockImplementation(call => { VoipBridge.mediaId = call.callId; });
    vi.spyOn(VoipBridge, 'outgoing').mockResolvedValue();
    VoipBridge.adopt(outgoing()); await vi.advanceTimersByTimeAsync(20000);
    const sentAt = Date.now();
    vi.mocked(VoipBridge.request).mockResolvedValueOnce({ msgId: 'm1', sendTime: sentAt } as any);
    await VoipBridge.mediaJoined();
    expect(VoipBridge.current?.expiresAt).toBe(sentAt + 60000);
    await vi.advanceTimersByTimeAsync(41000); expect(VoipBridge.finish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(19000); expect(VoipBridge.finish).toHaveBeenCalledWith('timeout');
  });
  it('bounds preparation independently and does not extend it on duplicate snapshots', async () => {
    setup(); vi.useFakeTimers();
    vi.spyOn(VoipBridge, 'startMedia').mockImplementation(call => { VoipBridge.mediaId = call.callId; });
    vi.spyOn(VoipBridge, 'outgoing').mockResolvedValue();
    VoipBridge.adopt(outgoing()); await vi.advanceTimersByTimeAsync(25000);
    VoipBridge.adopt({ ...VoipBridge.current!, version: 2 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(VoipBridge.finish).toHaveBeenCalledExactlyOnceWith('connectionTimeout');
  });
  it('does not restart an expired idempotent invitation window', async () => {
    setup();
    VoipBridge.current = outgoing();
    vi.mocked(VoipBridge.request).mockResolvedValueOnce({ msgId: 'm1', sendTime: Date.now() - 61000 } as any);
    await VoipBridge.mediaJoined();
    expect(VoipBridge.finish).toHaveBeenCalledWith('timeout');
    const now = Date.now();
    expect(VoipBusinessPolicy.ringDeadline(now + 999999, now)).toBe(now + 60000);
  });
  it('compensates an invitation acknowledged after local cancellation instead of restarting ringing', async () => {
    setup(); VoipBridge.current = outgoing(); let accept!: (value: any) => void;
    vi.mocked(VoipBridge.request).mockReturnValueOnce(new Promise(resolve => { accept = resolve; }));
    const pending = VoipBridge.mediaJoined(); VoipBridge.current = null;
    accept({ msgId: 'late-m1', sendTime: Date.now() }); await pending;
    expect(VoipBridge.current).toBeNull();
    expect(VoipBridge.request).toHaveBeenLastCalledWith('/ended', expect.stringContaining('"msgId":"late-m1"'), false, expect.any(Object));
  });
  it('does not attach a failed old answer report to a replacement call', async () => {
    setup(); VoipBridge.current = { ...outgoing(), callerId: 'bob', calleeId: 'alice', msgId: 'm1', state: 'active' };
    let reject!: (error: Error) => void;
    vi.mocked(VoipBridge.request).mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    const pending = VoipBridge.mediaJoined(); VoipBridge.current = { ...outgoing(), callId: 'replacement' };
    reject(new Error('old answer report')); await pending;
    expect(VoipBridge.current?.callId).toBe('replacement');
    expect(VoipBridge.finish).not.toHaveBeenCalled();
    expect(VoipBridge.queue.some(event => event.type === 'controlWarning')).toBe(false);
  });
  it('keeps active hangup out of legacy cancel while preserving ringing cancel, timeout, and rejection', () => {
    setup();
    const call = { ...outgoing(), msgId: 'm1' };
    VoipBridge.notifyBusinessEnd({ ...call, state: 'active' }, 'ended');
    expect(VoipBridge.request).not.toHaveBeenCalled();
    VoipBridge.notifyBusinessEnd(call, 'cancelled');
    expect(VoipBridge.request).toHaveBeenLastCalledWith('/ended', expect.stringContaining('"reason":"cancel"'), false, expect.any(Object));
    VoipBridge.notifyBusinessEnd(call, 'timeout');
    expect(VoipBridge.request).toHaveBeenLastCalledWith('/ended', expect.stringContaining('"reason":"timeout"'), false, expect.any(Object));
    VoipBridge.notifyBusinessEnd({ ...call, callerId: 'bob', calleeId: 'alice' }, 'rejected');
    expect(VoipBridge.request).toHaveBeenLastCalledWith('/declined', expect.any(String), false, expect.any(Object));
  });
  it('does not finish an online call when a nonfatal control warning arrives from the media page', () => {
    setup(); VoipBridge.current = { ...outgoing(), state: 'active' };
    VoipBridge.mediaEvent(JSON.stringify({ type: 'controlWarning', callId: 'c1', code: 'CALL_ANSWER_REPORT_FAILED' }));
    expect(VoipBridge.finish).not.toHaveBeenCalled();
  });
});

describe('IM call event ordering and isolation', () => {
  const invitation = () => ({ msgType: 'voip', senderType: 1, senderId: 'bob', convId: 'chat', msgId: '1987654321098765432', sendTime: Date.now(), body: { callId: 'c1', roomName: 'call-c1', mediaType: 'audio' } });
  const setup = () => {
    token.get.mockResolvedValue('unused');
    VoipBridge.initialize({ ...session('alice'), protocol: 'im-voip-v1' });
    vi.mocked(VoipBridge.request).mockResolvedValue({ convType: 1, peerUserId: 'bob', peerName: 'Bob' } as any);
    return vi.spyOn(VoipBridge, 'adopt').mockImplementation(() => {});
  };
  it('keeps snowflake identifiers exact when decoding native events', () => {
    expect(VoipBridge.parse('{"convId":1987654321098765432,"msgId":1987654321098765433,"sendTime":1794190000000}')).toMatchObject({ convId: '1987654321098765432', msgId: '1987654321098765433', sendTime: 1794190000000 });
  });
  it('does not revive an invitation after its cancel arrived first', async () => {
    const adopt = setup();
    VoipBridge.receiveSignal({ eventType: 'voip:cancel', payload: { callId: 'c1', convId: 'chat' } } as any);
    await VoipBridge.receiveInvitation(invitation() as any);
    expect(adopt).not.toHaveBeenCalled();
  });
  it('ignores expired invitations and group invitations', async () => {
    const adopt = setup();
    await VoipBridge.receiveInvitation({ ...invitation(), sendTime: Date.now() - 61000 } as any);
    vi.mocked(VoipBridge.request).mockResolvedValue({ convType: 2, peerUserId: 'bob' } as any);
    await VoipBridge.receiveInvitation(invitation() as any);
    expect(adopt).not.toHaveBeenCalled();
  });
  it('does not stop an outgoing call with an unrelated signal lacking a msgId', () => {
    setup();
    VoipBridge.current = { callId: 'c1', convId: 'chat', msgId: '' } as any;
    VoipBridge.receiveSignal({ eventType: 'voip:cancel', payload: { callId: 'different', convId: 'chat' } } as any);
    expect(VoipBridge.finish).not.toHaveBeenCalled();
    VoipBridge.current = null;
  });
  it('reconciles only validated direct invitations and never starts capture on receipt', async () => {
    const adopt = setup();
    const connect = vi.spyOn(VoipBridge, 'connect');
    await VoipBridge.receiveInvitation(invitation() as any);
    expect(adopt).toHaveBeenCalledWith(expect.objectContaining({ state: 'ringing', callId: 'c1', callerId: 'bob', calleeId: 'alice', msgId: '1987654321098765432' }));
    expect(connect).not.toHaveBeenCalled();
    expect(token.get).not.toHaveBeenCalled(); // current backend has no Harmony native-token contract
  });
  it('does not fall back to msgId when the signal contains a conflicting callId', () => {
    setup(); VoipBridge.current = { callId: 'current', convId: 'chat', msgId: 'm1', state: 'ringing' } as any;
    VoipBridge.receiveSignal({ eventType: 'voip:cancel', payload: { callId: 'old', msgId: 'm1', convId: 'chat' } } as any);
    expect(VoipBridge.finish).not.toHaveBeenCalled();
  });
  it.each(['voip:decline', 'voip:timeout'])('ignores a late %s after an answer without poisoning the active call', type => {
    setup(); VoipBridge.current = { callId: 'c1', convId: 'chat', msgId: 'm1', state: 'active' } as any;
    VoipBridge.receiveSignal({ eventType: type, payload: { callId: 'c1', convId: 'chat' } } as any);
    expect(VoipBridge.finish).not.toHaveBeenCalled();
    expect(VoipBridge.terminal.has('c1')).toBe(false);
  });
  it('deduplicates another device answer that preceded its incoming invitation', async () => {
    const adopt = setup();
    VoipBridge.receiveSignal({ eventType: 'voip:answered', payload: { callId: 'c1', convId: 'chat', userId: 'alice' } } as any);
    await VoipBridge.receiveInvitation(invitation() as any);
    expect(adopt).not.toHaveBeenCalled();
  });
  it.each(['timeout', 'systemFailed', 'busy', 'mediaFailed'])('does not claim an explicit rejection for %s', reason => {
    setup(); vi.mocked(VoipBridge.request).mockClear();
    VoipBridge.notifyBusinessEnd({ callId: 'c1', convId: 'chat', msgId: 'm1', callerId: 'bob', state: 'ringing' } as any, reason);
    expect(VoipBridge.request).not.toHaveBeenCalled();
  });
  it('sends a user rejection through the existing declined contract', () => {
    setup(); vi.mocked(VoipBridge.request).mockClear();
    VoipBridge.notifyBusinessEnd({ callId: 'c1', convId: 'chat', msgId: 'm1', callerId: 'bob', state: 'ringing' } as any, 'rejected');
    expect(VoipBridge.request).toHaveBeenCalledWith('/declined', expect.any(String), false, expect.any(Object));
  });
  it('drops a previous media connection failure after a replacement call', async () => {
    setup(); let reject!: (error: Error) => void;
    vi.spyOn(VoipBridge, 'connect').mockReturnValue(new Promise((_, fail) => { reject = fail; }));
    VoipBridge.current = { callId: 'old' } as any; VoipBridge.startMedia(VoipBridge.current!);
    VoipBridge.current = { callId: 'new' } as any;
    reject(new Error('old transport')); await Promise.resolve();
    expect(VoipBridge.finish).not.toHaveBeenCalled();
  });
});
