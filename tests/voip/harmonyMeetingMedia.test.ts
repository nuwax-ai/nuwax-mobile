import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomEvent, Track } from 'livekit-client';
import { createMeetingMedia, meetingGridGeometry, meetingStageLayout } from '../../scripts/meeting-harmony/room.mjs';

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
  activeSpeakers: { identity: string }[] = [];
  remoteParticipants = new Map();
  localParticipant = {
    name: '本机', identity: 'test:member:harmony', attributes: {}, audioLevel: 0,
    permissions: { canPublish: true, canPublishSources: [] as number[] },
    isMicrophoneEnabled: false, isCameraEnabled: false,
    getTrackPublication: vi.fn(),
    setMicrophoneEnabled: vi.fn(async (on: boolean) => { this.localParticipant.isMicrophoneEnabled = on; }),
    setCameraEnabled: vi.fn(async (on: boolean) => { this.localParticipant.isCameraEnabled = on; }),
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
  it('fills camera cards while keeping shared screens fully visible', () => {
    const page = readFileSync(new URL('../../scripts/meeting-harmony/media.html', import.meta.url), 'utf8');
    expect(page).toContain('video { position: absolute; inset: 0;');
    expect(page).toContain('object-fit: cover !important;');
    expect(page).toContain('video.screen-share { object-fit: contain !important; }');
    expect(page).toContain('#cameras > figure { height: auto; }');
  });

  it('matches the native mobile grid geometry for two through nine participants', () => {
    expect(meetingGridGeometry(2, 1)).toEqual({ columns: 1, rows: 2 });
    expect(meetingGridGeometry(3, 2)).toEqual({ columns: 2, rows: 2 });
    expect(meetingGridGeometry(4, 2)).toEqual({ columns: 2, rows: 2 });
    expect(meetingGridGeometry(5, 3)).toEqual({ columns: 3, rows: 2 });
    expect(meetingGridGeometry(9, 3)).toEqual({ columns: 3, rows: 3 });
  });

  it('keeps inline participant avatars in the ArkWeb layout without allowing remote image requests', () => {
    const inline = 'data:image/png;base64,YXZhdGFy';
    const layout = meetingStageLayout({ members: [
      { identity: 'inline', name: 'Alice', avatar: inline },
      { identity: 'remote', name: 'Bob', avatar: 'https://example.test/avatar.png' },
    ] }, [], undefined, false);
    expect(layout.details.get('inline')?.avatar).toBe(inline);
    expect(layout.details.get('remote')?.avatar).toBe('');
    const page = readFileSync(new URL('../../scripts/meeting-harmony/media.html', import.meta.url), 'utf8');
    expect(page).toContain('img-src data:');
    expect(page).toContain('.member-avatar');
  });

  it('uses the shared page and focus selection across ArkWeb camera and screen tracks', () => {
    const members = [{ identity: 'a', name: 'Alice' }, { identity: 'b', name: 'Bob' }, { identity: 'c', name: 'Carol' }];
    const cameras = [{ participant: members[0] }];
    const shared = { participant: members[1] };
    expect(meetingStageLayout({ mode: 'grid', members, grid: ['c', 'a'] }, cameras, shared, false))
      .toMatchObject({ visible: ['c', 'a'], thumbs: false, sharedVisible: false, sharedInGrid: false });
    expect(meetingStageLayout({ mode: 'grid', members, grid: ['c', 'b', 'a'] }, cameras, shared, false))
      .toMatchObject({ visible: ['c', 'b', 'a'], thumbs: false, sharedVisible: false, sharedInGrid: true });
    expect(meetingStageLayout({ mode: 'grid', members, main: 'a', focused: true }, cameras, shared, false))
      .toMatchObject({ visible: ['a'], thumbs: false, sharedVisible: false });
    expect(meetingStageLayout({ mode: 'grid', members, main: 'b', focused: true }, cameras, shared, false))
      .toMatchObject({ visible: [], thumbs: false, sharedVisible: true });
    for (const mode of ['topThumbs', 'sideThumbs']) {
      expect(meetingStageLayout({ mode, members, main: 'b' }, cameras, shared, false))
        .toMatchObject({ visible: [], thumbs: true, sharedVisible: true });
    }
    expect(meetingStageLayout({ mode: 'speaker', members, main: 'c' }, cameras, shared, false))
      .toMatchObject({ visible: ['c'], thumbs: false, sharedVisible: false });
  });

  it('forwards a remote speaker and long Markdown chat without a legacy character cap', async () => {
    const { media, room, post } = connection();
    await waitForOperations();
    const speaker = { identity: 'test:other:ios', name: 'Alice' };
    room.activeSpeakers = [room.localParticipant, speaker];
    room.emit(RoomEvent.ActiveSpeakersChanged);
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ remoteSpeaker: speaker.identity }));
    const text = '## 会议内容\n' + '详细内容。'.repeat(230);
    media.dispatch({ id: 1, type: 'message', text, name: '本机', danmaku: false });
    await waitForOperations();
    expect(room.localParticipant.publishData).toHaveBeenCalledOnce();
    room.emit(RoomEvent.DataReceived, new TextEncoder().encode(JSON.stringify({ text })),
      speaker, undefined, 'meeting-chat');
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({
      message: expect.objectContaining({ identity: speaker.identity, text }),
    }));
    media.dispatch({ id: 1, type: 'message', text: '字'.repeat(16_000), name: '本机', danmaku: false });
    await waitForOperations();
    expect(room.localParticipant.publishData).toHaveBeenCalledOnce();
  });

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

  it('checks microphone and camera publication rights before opening local tracks', async () => {
    const { media, room, post } = connection();
    await waitForOperations();
    const local = room.localParticipant;
    local.permissions = { canPublish: true, canPublishSources: [Track.sourceToProto(Track.Source.Camera)] };
    room.emit(RoomEvent.ParticipantPermissionsChanged);
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ micAllowed: false, cameraAllowed: true }));
    media.dispatch({ id: 1, type: 'mic', on: true });
    media.dispatch({ id: 1, type: 'camera', on: true });
    await waitForOperations();
    expect(local.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(local.setCameraEnabled).toHaveBeenCalledWith(true, { facingMode: 'user' });

    local.permissions.canPublishSources.push(Track.sourceToProto(Track.Source.Microphone));
    room.emit(RoomEvent.ParticipantPermissionsChanged);
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ micAllowed: true, cameraAllowed: true }));
    media.dispatch({ id: 1, type: 'mic', on: true });
    await waitForOperations();
    expect(local.setMicrophoneEnabled).toHaveBeenCalledWith(true);
  });

  it.each(['reconnecting', 'signalReconnecting'])('honors mute and camera-off during %s', async state => {
    const { media, room, post } = connection();
    await waitForOperations();
    const local = room.localParticipant;
    local.isMicrophoneEnabled = true;
    local.isCameraEnabled = true;
    room.state = state;
    room.emit(RoomEvent.ConnectionStateChanged);
    media.dispatch({ id: 1, type: 'mic', on: false });
    media.dispatch({ id: 1, type: 'camera', on: false });
    media.dispatch({ id: 1, type: 'mic', on: true });
    media.dispatch({ id: 1, type: 'camera', on: true });
    await waitForOperations();
    expect(local.setMicrophoneEnabled).toHaveBeenCalledExactlyOnceWith(false);
    expect(local.setCameraEnabled).toHaveBeenCalledExactlyOnceWith(false, { facingMode: 'user' });
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ connection: state, mic: false, camera: false }));

    room.state = 'connected';
    room.emit(RoomEvent.ConnectionStateChanged);
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ connection: 'connected', mic: false, camera: false }));
  });

  it('confirms leave only after the LiveKit disconnection promise resolves', async () => {
    const { media, room, post } = connection();
    await waitForOperations();
    let close!: () => void;
    room.disconnect.mockImplementationOnce(() => new Promise(resolve => { close = resolve; }));
    media.dispatch({ id: 0, type: 'disconnect' });
    expect(room.disconnect).not.toHaveBeenCalled();
    media.dispatch({ id: 1, type: 'disconnect' });
    expect(room.disconnect).toHaveBeenCalledOnce();
    await waitForOperations();
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'leaveComplete' }));
    close();
    await waitForOperations();
    expect(post).toHaveBeenLastCalledWith({ type: 'leaveComplete', id: 1, left: true });
  });

  it('does not join if a connect command arrives after leave for the same generation', async () => {
    const media = createMeetingMedia(vi.fn(), vi.fn());
    media.dispatch({ id: 1, type: 'disconnect' });
    media.dispatch({ id: 1, type: 'connect', url: 'wss://room.test', token: 'room-token' });
    expect(rooms).toHaveLength(0);
    media.dispatch({ id: 2, type: 'connect', url: 'wss://room.test', token: 'next-token' });
    await waitForOperations();
    expect(rooms[0].connect).toHaveBeenCalledExactlyOnceWith('wss://room.test', 'next-token');
  });

  it('does not report successful leave if the SDK fails to disconnect', async () => {
    const { media, room, post } = connection();
    await waitForOperations();
    room.disconnect.mockRejectedValueOnce(new Error('disconnection failed'));
    media.dispatch({ id: 1, type: 'disconnect' });
    await waitForOperations();
    expect(post).toHaveBeenLastCalledWith({ type: 'leaveComplete', id: 1, left: false });
  });

  it('switches facing mode on the published local camera without recreating the room', async () => {
    const { media, room } = connection();
    await waitForOperations();
    const videoTrack = {
      mediaStreamTrack: { getSettings: () => ({ facingMode: 'user' }) },
      restartTrack: vi.fn(async (_options: object) => {}),
    };
    room.localParticipant.getTrackPublication.mockReturnValue({ videoTrack });
    media.dispatch({ id: 1, type: 'flip' });
    await waitForOperations();
    expect(videoTrack.restartTrack).toHaveBeenCalledExactlyOnceWith({ facingMode: 'environment' });
    expect(room.connect).toHaveBeenCalledOnce();
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

  it('waits for both ownership and publication permission before capture, then stops on takeover', async () => {
    const { media, room, render, post } = connection();
    await waitForOperations();
    const { track, stream } = fakeScreen();
    const getDisplayMedia = vi.fn(async () => stream);
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } });
    room.localParticipant.permissions.canPublishSources = [Track.sourceToProto(Track.Source.Camera)];
    media.dispatch({ id: 1, type: 'prepareShare', shareId: 2, text: 'Share the entire screen', name: 'Cancel' });
    expect(render.mock.lastCall?.[3]).toBeUndefined();
    room.metadata = JSON.stringify({ shareHolder: room.localParticipant.identity });
    room.emit(RoomEvent.RoomMetadataChanged);
    expect(render.mock.lastCall?.[3]).toBeUndefined();
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ captureAllowed: false, awaitingCapture: false }));
    room.localParticipant.permissions.canPublishSources.push(Track.sourceToProto(Track.Source.ScreenShare));
    room.emit(RoomEvent.ParticipantPermissionsChanged);
    const request = render.mock.lastCall?.[3];
    expect(request.label).toBe('Share the entire screen');
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ captureAllowed: false, awaitingCapture: true }));
    const capture = media.startCapture(request);
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ captureAllowed: true, awaitingCapture: false }));
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

  it('holds a new capture until the cancelled system consent request has settled', async () => {
    const { media, room, render, post } = connection();
    await waitForOperations();
    const firstScreen = fakeScreen();
    const secondScreen = fakeScreen();
    let finishFirst!: (value: typeof firstScreen.stream) => void;
    const getDisplayMedia = vi.fn(async () => secondScreen.stream)
      .mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } });
    room.metadata = JSON.stringify({ shareHolder: room.localParticipant.identity });
    media.dispatch({ id: 1, type: 'prepareShare', shareId: 2, text: 'Share', name: 'Cancel' });
    const first = media.startCapture(render.mock.lastCall?.[3]);
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ captureAllowed: true, shareId: 2 }));
    media.dispatch({ id: 1, type: 'stopShare', shareId: 2 });
    media.dispatch({ id: 1, type: 'prepareShare', shareId: 3, text: 'Share', name: 'Cancel' });
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({
      captureAllowed: false, awaitingCapture: false, shareId: 3,
    }));
    expect(render.mock.lastCall?.[3]).toBeUndefined();
    expect(getDisplayMedia).toHaveBeenCalledOnce();

    finishFirst(firstScreen.stream);
    await first;
    expect(firstScreen.track.stop).toHaveBeenCalledOnce();
    expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
    const request = render.mock.lastCall?.[3];
    expect(request.shareId).toBe(3);
    await media.startCapture(request);
    expect(getDisplayMedia).toHaveBeenCalledTimes(2);
    expect(room.localParticipant.publishTrack).toHaveBeenCalledExactlyOnceWith(secondScreen.track,
      expect.objectContaining({ source: Track.Source.ScreenShare }));
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

  it('stops an already published screen if the server removes its publication right', async () => {
    const { media, room, render, post } = connection();
    await waitForOperations();
    const { track, stream } = fakeScreen();
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: vi.fn(async () => stream) } });
    const local = room.localParticipant;
    room.metadata = JSON.stringify({ shareHolder: local.identity });
    media.dispatch({ id: 1, type: 'prepareShare', shareId: 3, text: 'Share', name: 'Cancel' });
    await media.startCapture(render.mock.lastCall?.[3]);
    expect(local.publishTrack).toHaveBeenCalledOnce();

    local.permissions.canPublishSources = [Track.sourceToProto(Track.Source.Camera)];
    room.emit(RoomEvent.ParticipantPermissionsChanged);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(local.unpublishTrack).toHaveBeenCalledWith(track);
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: 'shareError', shareId: 3, error: 'screen_capture_permission',
    }));
  });

  it('does not publish a capture returned after permission is revoked during OS consent', async () => {
    const { media, room, render, post } = connection();
    await waitForOperations();
    const { track, stream } = fakeScreen();
    let resolveCapture!: (result: typeof stream) => void;
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: () => new Promise(resolve => { resolveCapture = resolve; }) } });
    const local = room.localParticipant;
    room.metadata = JSON.stringify({ shareHolder: local.identity });
    media.dispatch({ id: 1, type: 'prepareShare', shareId: 4, text: 'Share', name: 'Cancel' });
    const consent = media.startCapture(render.mock.lastCall?.[3]);
    local.permissions.canPublish = false;
    room.emit(RoomEvent.ParticipantPermissionsChanged);
    resolveCapture(stream);
    await consent;
    expect(track.stop).toHaveBeenCalledOnce();
    expect(local.publishTrack).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: 'shareError', shareId: 4, error: 'screen_capture_permission',
    }));
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


describe('Harmony meeting card controls', () => {
  it('does not expose picture in picture and uses image assets for microphone and raised hand state', () => {
    const source = readFileSync(new URL('../../scripts/meeting-harmony/room.mjs', import.meta.url), 'utf8');
    const page = readFileSync(new URL('../../scripts/meeting-harmony/media.html', import.meta.url), 'utf8');
    expect(source.toLowerCase()).not.toContain('pictureinpicture');
    expect(page).not.toContain('meeting-pip');
    expect(source).toContain('microphone-ink.png');
    expect(source).toContain('microphone-off-ink.png');
    expect(source).toContain('icon-hand.svg');
    expect(page).toContain('.member-hand { position: absolute;');
    expect(page).toContain('top: 8px; left: 8px;');
  });
});
