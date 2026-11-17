import { beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ rooms: [] as any[] }));
vi.mock('livekit-client', () => ({
  RoomEvent: { TrackSubscribed: 'subscribed', TrackUnsubscribed: 'unsubscribed', ParticipantConnected: 'participant', DataReceived: 'data', Reconnecting: 'reconnecting', Reconnected: 'reconnected', AudioPlaybackStatusChanged: 'audio', Disconnected: 'disconnected' },
  Track: { Source: { Camera: 'camera', Microphone: 'microphone' }, Kind: { Audio: 'audio', Video: 'video' } },
  Room: class {
    resolve!: () => void;
    on = vi.fn(); disconnect = vi.fn(async () => {});
    localParticipant = { setMicrophoneEnabled: vi.fn(async () => {}), setCameraEnabled: vi.fn(async () => {}), getTrackPublication: vi.fn(), publishData: vi.fn(async () => {}) };
    constructor() { fake.rooms.push(this); }
    connect() { return new Promise<void>(resolve => { this.resolve = resolve; }); }
  },
}));
beforeEach(() => { fake.rooms.length = 0; vi.stubGlobal('document', { documentElement: { dataset: {} } }); });
async function media() {
  const { createMediaEngine } = await import('../../scripts/voip-dev/media.mjs');
  const events: any[] = [];
  return { engine: createMediaEngine((event: any) => events.push(event), {}), events };
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
