import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ rooms: [] as any[] }));
vi.mock('livekit-client', () => ({
  RoomEvent: { TrackSubscribed: 'subscribed', TrackUnsubscribed: 'unsubscribed', ParticipantConnected: 'participant', ParticipantDisconnected: 'left', DataReceived: 'data', Reconnecting: 'reconnecting', Reconnected: 'reconnected', AudioPlaybackStatusChanged: 'audio', Disconnected: 'disconnected' },
  ConnectionState: { Reconnecting: 'reconnecting', Connected: 'connected' },
  Track: { Source: { Camera: 'camera', Microphone: 'microphone' }, Kind: { Audio: 'audio', Video: 'video' } },
  Room: class {
    resolve!: () => void;
    state = 'connected'; remoteParticipants = new Map();
    on = vi.fn(); disconnect = vi.fn(async () => {});
    localParticipant = { setMicrophoneEnabled: vi.fn(async () => {}), setCameraEnabled: vi.fn(async () => {}), getTrackPublication: vi.fn(), publishData: vi.fn(async () => {}) };
    constructor() { fake.rooms.push(this); }
    connect() { return new Promise<void>(resolve => { this.resolve = resolve; }); }
  },
}));
beforeEach(() => { fake.rooms.length = 0; vi.stubGlobal('document', { documentElement: { dataset: {} } }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
async function media(root = {}) {
  const { createMediaEngine } = await import('../../scripts/voip-dev/media.mjs');
  const events: any[] = [];
  return { engine: createMediaEngine((event: any) => events.push(event), root), events };
}
describe('media bridge lifetime', () => {
  it('confirms a muted peer through a scoped reliable packet and repeats after a peer joins', async () => {
    const { engine, events } = await media();
    const pending = engine.execute({ op: 'connect', callId: 'muted', mediaType: 'audio', microphoneEnabled: false });
    await vi.waitFor(() => expect(fake.rooms).toHaveLength(1)); const room = fake.rooms[0]; room.resolve(); await pending;
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false);
    expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalledWith(true);
    const [data, options] = room.localParticipant.publishData.mock.calls[0];
    expect(JSON.parse(new TextDecoder().decode(data))).toEqual({ v: 1, type: 'ready', callId: 'muted' });
    expect(options).toEqual({ reliable: true, topic: 'nuwax.voip.media-ready.v1' });
    const received = room.on.mock.calls.find(([type]: any[]) => type === 'data')[1];
    received(new TextEncoder().encode('{"v":1,"type":"ready","callId":"old"}'), {}, undefined, options.topic);
    expect(events.filter(e => e.type === 'peerMediaReady')).toHaveLength(0);
    received(data, {}, undefined, options.topic);
    expect(events.filter(e => e.type === 'peerMediaReady')).toHaveLength(1);
    room.on.mock.calls.find(([type]: any[]) => type === 'participant')[1]();
    expect(room.localParticipant.publishData).toHaveBeenCalledTimes(2);
    await engine.execute({ op: 'disconnect' });
  });
  it('does not label an old mute completion as an event for a replacement call', async () => {
    const { engine, events } = await media();
    const old = engine.execute({ op: 'connect', callId: 'old', mediaType: 'audio' });
    await vi.waitFor(() => expect(fake.rooms).toHaveLength(1)); fake.rooms[0].resolve(); await old;
    let complete!: () => void;
    fake.rooms[0].localParticipant.setMicrophoneEnabled.mockReturnValueOnce(new Promise<void>(resolve => { complete = resolve; }));
    const mute = engine.execute({ op: 'microphone', callId: 'old', enabled: false });
    const next = engine.execute({ op: 'connect', callId: 'new', mediaType: 'audio' });
    await vi.waitFor(() => expect(fake.rooms).toHaveLength(2)); fake.rooms[1].resolve(); await next;
    complete(); await mute;
    expect(events.filter(e => e.type === 'microphone')).toHaveLength(0);
    await engine.execute({ op: 'disconnect' });
  });
  it('ignores a previous call mute or hangup after a replacement has joined', async () => {
    const { engine } = await media();
    const joining = engine.execute({ op: 'connect', callId: 'new', mediaType: 'audio' });
    await vi.waitFor(() => expect(fake.rooms).toHaveLength(1)); fake.rooms[0].resolve(); await joining;
    await engine.execute({ op: 'microphone', callId: 'old', enabled: false });
    await engine.execute({ op: 'disconnect', callId: 'old' });
    expect(engine.room()).toBe(fake.rooms[0]);
    expect(fake.rooms[0].localParticipant.setMicrophoneEnabled).not.toHaveBeenCalledWith(false);
    await engine.execute({ op: 'disconnect', callId: 'new' });
  });
  it('does not acquire the microphone after a pending join is cancelled', async () => {
    const { engine, events } = await media();
    const pending = engine.execute({ op: 'connect', callId: 'old', mediaType: 'audio' });
    await vi.waitFor(() => expect(fake.rooms).toHaveLength(1));
    await engine.execute({ op: 'disconnect' }); fake.rooms[0].resolve(); await pending;
    expect(fake.rooms[0].localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(engine.room()).toBeNull();
    expect(events.some(e => e.type === 'connected')).toBe(false);
  });
  it('keeps a replacement call when the earlier connect completes late', async () => {
    const { engine, events } = await media();
    const old = engine.execute({ op: 'connect', callId: 'old', mediaType: 'audio' });
    await vi.waitFor(() => expect(fake.rooms).toHaveLength(1));
    const next = engine.execute({ op: 'connect', callId: 'next', mediaType: 'audio' });
    await vi.waitFor(() => expect(fake.rooms).toHaveLength(2));
    fake.rooms[1].resolve(); await next; fake.rooms[0].resolve(); await old;
    expect(engine.room()).toBe(fake.rooms[1]);
    expect(events.filter(e => e.type === 'connected').map(e => e.callId)).toEqual(['next']);
    await engine.execute({ op: 'disconnect' });
    expect(fake.rooms[1].disconnect).toHaveBeenCalled();
  });
  it('honors background and muted state while the join is pending', async () => {
    const { engine } = await media();
    const pending = engine.execute({ op: 'connect', callId: 'video', mediaType: 'video', microphoneEnabled: false });
    await vi.waitFor(() => expect(fake.rooms).toHaveLength(1));
    await engine.execute({ op: 'background', hidden: true }); fake.rooms[0].resolve(); await pending;
    expect(fake.rooms[0].localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false);
    expect(fake.rooms[0].localParticipant.setCameraEnabled).not.toHaveBeenCalledWith(true);
    await engine.execute({ op: 'disconnect' });
  });
});

describe('ArkWeb camera preview', () => {
  async function joiningVideo() {
    const root = { append: vi.fn() };
    const { engine, events } = await media(root);
    const pending = engine.execute({ op: 'connect', callId: 'video', mediaType: 'video', cameraEnabled: false });
    await vi.waitFor(() => expect(fake.rooms).toHaveLength(1));
    const room = fake.rooms[0], participant = room.localParticipant;
    const track = {
      attach: vi.fn(() => ({ remove: vi.fn() })),
      detach: vi.fn(),
      restartTrack: vi.fn(async () => {}),
      mediaStreamTrack: { getSettings: () => ({ facingMode: 'user' }) },
    };
    const publication = { videoTrack: track };
    participant.setCameraEnabled.mockResolvedValue(publication);
    participant.getTrackPublication.mockReturnValue(publication);
    return { root, engine, events, pending, room, participant, track, publication };
  }

  it('restores one preview after returning and keeps an explicitly disabled camera off', async () => {
    const { root, engine, pending, room, participant, track } = await joiningVideo();
    await engine.execute({ op: 'background', hidden: true });
    await engine.execute({ op: 'camera', callId: 'video', enabled: true });
    room.resolve();
    await pending;
    expect(participant.setCameraEnabled).not.toHaveBeenCalledWith(true);
    expect(root.append).not.toHaveBeenCalled();

    await engine.execute({ op: 'background', hidden: false });
    const firstPreview = root.append.mock.calls[0][0];
    expect(firstPreview).toMatchObject({ className: 'local-video', muted: true, playsInline: true });
    await engine.execute({ op: 'background', hidden: false });
    expect(track.attach).toHaveBeenCalledTimes(1);
    await engine.execute({ op: 'switchCamera', callId: 'video' });
    expect(track.restartTrack).toHaveBeenCalledWith({ facingMode: 'environment' });

    await engine.execute({ op: 'background', hidden: true });
    expect(track.detach).toHaveBeenCalledWith(firstPreview);
    expect(firstPreview.remove).toHaveBeenCalledOnce();
    expect(participant.setCameraEnabled).toHaveBeenLastCalledWith(false);
    await engine.execute({ op: 'background', hidden: false });
    expect(root.append).toHaveBeenCalledTimes(2);

    await engine.execute({ op: 'camera', callId: 'video', enabled: false });
    await engine.execute({ op: 'background', hidden: true });
    await engine.execute({ op: 'background', hidden: false });
    expect(participant.setCameraEnabled).toHaveBeenLastCalledWith(false);
    expect(root.append).toHaveBeenCalledTimes(2);
    await engine.execute({ op: 'disconnect', callId: 'video' });
  });

  it('ignores a camera enable completion after the call is hung up', async () => {
    const { root, engine, events, pending, room, participant, publication } = await joiningVideo();
    room.resolve();
    await pending;
    let finishEnable!: () => void;
    participant.setCameraEnabled.mockImplementationOnce(() => new Promise(resolve => {
      finishEnable = () => resolve(publication);
    }));
    const enable = engine.execute({ op: 'camera', callId: 'video', enabled: true });
    await vi.waitFor(() => expect(participant.setCameraEnabled).toHaveBeenCalledWith(true));
    await engine.execute({ op: 'disconnect', callId: 'video' });
    finishEnable();
    await enable;
    expect(room.disconnect).toHaveBeenCalledOnce();
    expect(events).toContainEqual({ type: 'disconnected', callId: 'video', released: true });
    expect(root.append).not.toHaveBeenCalled();
  });
});

describe('business-call remote departure protection', () => {
  async function connected() {
    vi.useFakeTimers();
    const result = await media();
    const pending = result.engine.execute({ op: 'connect', callId: 'call', protocol: 'im-voip-v1', mediaType: 'audio' });
    await vi.waitFor(() => expect(fake.rooms).toHaveLength(1));
    const room = fake.rooms[0]; room.resolve(); await pending;
    const emit = (event: string) => room.on.mock.calls.find(([type]: any[]) => type === event)[1]();
    return { ...result, room, emit };
  }
  it('does not end a call while its peer disappears and returns during full reconnect', async () => {
    const { engine, events, room, emit } = await connected();
    room.remoteParticipants.set('peer', {}); emit('participant');
    room.remoteParticipants.clear(); room.state = 'reconnecting'; emit('left'); emit('reconnecting');
    await vi.advanceTimersByTimeAsync(6500);
    expect(events.some(e => e.type === 'remoteEnded' || e.type === 'disconnected')).toBe(false);
    room.remoteParticipants.set('peer', {}); room.state = 'connected'; emit('reconnected');
    await vi.advanceTimersByTimeAsync(3500);
    expect(events.some(e => e.type === 'remoteEnded')).toBe(false);
    await engine.execute({ op: 'disconnect' });
  });
  it('ends a real departure after one grace period, without extending it for duplicate events', async () => {
    const { engine, events, room, emit } = await connected();
    room.remoteParticipants.set('peer', {}); emit('participant'); room.remoteParticipants.clear(); emit('left');
    await vi.advanceTimersByTimeAsync(1000); emit('left');
    await vi.advanceTimersByTimeAsync(1999); expect(events.some(e => e.type === 'remoteEnded')).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(events.filter(e => e.type === 'remoteEnded')).toHaveLength(1);
    await engine.execute({ op: 'disconnect' });
  });
  it('does not classify an initially empty room as a peer hanging up', async () => {
    const { engine, events, emit } = await connected(); emit('left');
    await vi.advanceTimersByTimeAsync(7000);
    expect(events.some(e => e.type === 'remoteEnded')).toBe(false);
    emit('disconnected'); expect(events.filter(e => e.type === 'disconnected')).toHaveLength(1);
    await engine.execute({ op: 'disconnect' });
  });
  it('cancels the previous call grace timer when a new call replaces it', async () => {
    const { engine, events, room, emit } = await connected();
    room.remoteParticipants.set('peer', {}); emit('participant'); room.remoteParticipants.clear(); emit('left');
    const next = engine.execute({ op: 'connect', callId: 'replacement', protocol: 'im-voip-v1', mediaType: 'audio' });
    await vi.waitFor(() => expect(fake.rooms).toHaveLength(2)); fake.rooms[1].resolve(); await next;
    emit('left'); await vi.advanceTimersByTimeAsync(4000);
    expect(events.some(e => e.type === 'remoteEnded')).toBe(false);
    expect(engine.room()).toBe(fake.rooms[1]);
    await engine.execute({ op: 'disconnect' });
  });
});
