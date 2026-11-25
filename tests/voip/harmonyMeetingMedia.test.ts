import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomEvent, Track } from 'livekit-client';
import { createMeetingMedia } from '../../scripts/meeting-harmony/room.mjs';

const rooms = vi.hoisted(() => [] as MockRoom[]);
vi.mock('livekit-client', async (importOriginal) => {
  const sdk = await importOriginal<typeof import('livekit-client')>();
  return {
    ...sdk,
    Room: function Room() {
      const room = new MockRoom();
      rooms.push(room);
      return room;
    },
  };
});

class MockRoom extends EventEmitter {
  state = 'disconnected';
  metadata = '';
  remoteParticipants = new Map();
  localParticipant = {
    name: '本机', identity: 'test:member:harmony', attributes: {}, audioLevel: 0,
    isMicrophoneEnabled: false, isCameraEnabled: false,
    getTrackPublication: vi.fn(),
    setMicrophoneEnabled: vi.fn(async (on: boolean) => { this.localParticipant.isMicrophoneEnabled = on; }),
    setAttributes: vi.fn(async (attributes) => { this.localParticipant.attributes = attributes; }),
    publishData: vi.fn(async (_bytes: Uint8Array, _options: unknown) => {}),
    publishTrack: vi.fn(async () => {}),
    unpublishTrack: vi.fn(async () => {}),
  };
  connect = vi.fn(async () => { this.state = 'connected'; });
  disconnect = vi.fn(async () => { this.state = 'disconnected'; });
  startAudio = vi.fn(async () => {});
}

function connection() {
  const post = vi.fn();
  const render = vi.fn();
  const media = createMeetingMedia(post, render);
  media.dispatch({ id: 1, type: 'connect', url: 'wss://room.test', token: 'room-token' });
  return { media, post, render, room: rooms.at(-1)! };
}

function waitForOperations() {
  return new Promise(resolve => setImmediate(resolve));
}

function fakeScreen() {
  const track = Object.assign(new EventTarget(), { stop: vi.fn() });
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  return { track, stream };
}

afterEach(() => {
  rooms.length = 0;
  vi.unstubAllGlobals();
});

describe('Harmony LiveKit room', () => {
  it('joins with the supplied token and shares the existing device, hand and chat protocol', async () => {
    const { media, room, post } = connection();
    await waitForOperations();
    expect(room.connect).toHaveBeenCalledWith('wss://room.test', 'room-token');
    expect(room.startAudio).toHaveBeenCalledOnce();
    media.dispatch({ id: 1, type: 'mic', on: true });
    media.dispatch({ id: 1, type: 'hand', on: true });
    media.dispatch({ id: 1, type: 'message', text: ' 你好 ', name: '本机', danmaku: false });
    await waitForOperations();
    expect(room.localParticipant.isMicrophoneEnabled).toBe(true);
    expect(room.localParticipant.attributes).toEqual({ handRaised: '1' });
    const [payload, options] = room.localParticipant.publishData.mock.calls[0];
    expect(JSON.parse(new TextDecoder().decode(payload))).toEqual({ text: '你好', name: '本机' });
    expect(options).toEqual({ topic: 'meeting-chat', reliable: true });
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'message', message: expect.objectContaining({ self: true }) }));
  });

  it('receives the current holder screen independently of the remote camera and plays remote audio', async () => {
    const { room, render, post } = connection();
    await waitForOperations();
    const camera = { source: Track.Source.Camera };
    const screen = { source: Track.Source.ScreenShare };
    const voice = { source: Track.Source.Microphone };
    const participant = {
      identity: 'test:other:web', name: '同事',
      getTrackPublication: (source: string) => ({ track: source === Track.Source.Camera ? camera : screen }),
      audioTrackPublications: new Map([['voice', { track: voice }]]),
    };
    room.remoteParticipants.set(participant.identity, participant);
    room.metadata = JSON.stringify({ shareHolder: participant.identity });
    room.emit(RoomEvent.TrackSubscribed);
    expect(render).toHaveBeenLastCalledWith([{ participant, track: camera }], { participant, track: screen }, [voice], undefined);
    room.emit(RoomEvent.DataReceived,
      new TextEncoder().encode(JSON.stringify({ text: '弹幕', name: '假名', identity: 'fake' })),
      participant, undefined, 'danmaku');
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'message', message: expect.objectContaining({
      identity: participant.identity, name: participant.name, topic: 'danmaku', text: '弹幕',
    }) }));
    room.metadata = '{}';
    room.emit(RoomEvent.RoomMetadataChanged);
    expect(render).toHaveBeenLastCalledWith([{ participant, track: camera }], undefined, [voice], undefined);
  });

  it('starts capture from the confirmation gesture after ownership and stops it on takeover', async () => {
    const { media, room, render, post } = connection();
    await waitForOperations();
    const { track, stream } = fakeScreen();
    const getDisplayMedia = vi.fn(async () => stream);
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } });
    media.dispatch({ id: 1, type: 'prepareShare', shareId: 2, text: 'Share the entire screen', name: 'Cancel' });
    expect(render.mock.lastCall?.[3]).toBeUndefined();
    room.metadata = JSON.stringify({ shareHolder: room.localParticipant.identity });
    room.emit(RoomEvent.RoomMetadataChanged);
    const request = render.mock.lastCall?.[3];
    expect(request.label).toBe('Share the entire screen');
    const capture = media.startCapture(request);
    expect(getDisplayMedia).toHaveBeenCalledWith({ video: true, audio: false });
    await capture;
    expect(room.localParticipant.publishTrack).toHaveBeenCalledWith(track, expect.objectContaining({ source: Track.Source.ScreenShare }));
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ sharing: true, shareId: 2 }));
    media.dispatch({ id: 1, type: 'stopShare', shareId: 1 });
    expect(track.stop).not.toHaveBeenCalled();
    room.metadata = JSON.stringify({ shareHolder: 'test:other:ios' });
    room.emit(RoomEvent.RoomMetadataChanged);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'shareError', shareId: 2, error: 'stopped' }));
    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(track);
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ sharing: false }));
  });

  it('dismisses pending confirmation when another participant takes over the share', async () => {
    const { media, room, render, post } = connection();
    await waitForOperations();
    room.metadata = JSON.stringify({ shareHolder: room.localParticipant.identity });
    media.dispatch({ id: 1, type: 'prepareShare', shareId: 2, text: 'Share', name: 'Cancel' });
    expect(render.mock.lastCall?.[3]).toBeDefined();
    room.metadata = JSON.stringify({ shareHolder: 'test:other:android' });
    room.emit(RoomEvent.RoomMetadataChanged);
    expect(render.mock.lastCall?.[3]).toBeUndefined();
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'shareError', shareId: 2, error: 'stopped' }));
  });

  it('discards a late system capture result after cancellation or leaving', async () => {
    const { media, room, render } = connection();
    await waitForOperations();
    const { track, stream } = fakeScreen();
    let resolveCapture!: (result: typeof stream) => void;
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: () => new Promise(resolve => { resolveCapture = resolve; }) } });
    room.metadata = JSON.stringify({ shareHolder: room.localParticipant.identity });
    media.dispatch({ id: 1, type: 'prepareShare', shareId: 2, text: 'Share', name: 'Cancel' });
    const capture = media.startCapture(render.mock.lastCall?.[3]);
    media.dispatch({ id: 1, type: 'disconnect' });
    resolveCapture(stream);
    await capture;
    expect(track.stop).toHaveBeenCalledOnce();
    expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
    expect(room.disconnect).toHaveBeenCalledOnce();
  });
});
