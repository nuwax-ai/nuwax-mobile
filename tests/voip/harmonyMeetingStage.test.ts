import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function nativeStage() {
  const source = readFileSync(new URL('../../uni_modules/nuwax-livekit/utssdk/app-harmony/MeetingStage.ets', import.meta.url), 'utf8');
  // Execute the host and NodeController state machine. ArkUI's declarative layout
  // and component lifecycle are tested on a device, outside this suite.
  const hostSource = source.split('\n@Builder\n')[0].replace(/^import .*$/gm, '').replace(/^export /gm, '');
  const stages: MockBuilderNode[] = [];
  const task = {
    acquire: vi.fn(async (_owner: string, _context: unknown, needed: () => boolean) => needed()),
    release: vi.fn(async (_owner: string) => {}),
    acceptsNotification: vi.fn((_want: unknown) => false),
  };
  const permissions = {
    checkAccessTokenSync: vi.fn((_token: number, _permission: string) => -1),
    requestPermissionsFromUser: vi.fn(async (_context: unknown, _names: string[]) => ({ authResults: [0] })),
  };
  const routing = {
    setCommunicationDevice: vi.fn(async (_device: number, _active: boolean) => {}),
    isCommunicationDeviceActiveSync: vi.fn((_device: number) => true),
  };
  const destroy = vi.fn();
  const request = vi.fn().mockResolvedValue({ responseCode: 200, result: '{"code":"0000"}' });
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let nextTimer = 0;
  class MockBuilderNode {
    build = vi.fn();
    frame = {};
    getFrameNode() { return this.frame; }
    dispose = vi.fn();
  }
  class MockNodeController {
    rebuild = vi.fn();
  }
  class MockController {
    onActive = vi.fn();
    runJavaScript = vi.fn().mockResolvedValue('1');
  }
  const context = vm.createContext({
    BuilderNode: class extends MockBuilderNode {
      constructor() { super(); stages.push(this); }
    },
    NodeController: MockNodeController,
    webview: { WebviewController: MockController },
    wrapBuilder: (builder: unknown) => builder,
    buildMeetingStage: vi.fn(),
    EntryVoipBackgroundTask: task,
    audio: {
      CommunicationDeviceType: { SPEAKER: 2 },
      getAudioManager: () => ({ getRoutingManager: () => routing }),
    },
    abilityAccessCtrl: { createAtManager: () => permissions },
    ProtectedResourceType: { AUDIO_CAPTURE: 'audio', VIDEO_CAPTURE: 'video' },
    WebCaptureMode: { HOME_SCREEN: 0 },
    console: { info: vi.fn(), warn: vi.fn() },
    http: {
      createHttp: () => ({ request, destroy }),
      RequestMethod: { POST: 'POST' },
      HttpDataType: { STRING: 'string' },
    },
    setTimeout(callback: () => void, delay: number) {
      timers.set(++nextTimer, { callback, delay });
      return nextTimer;
    },
    clearTimeout(id: number) { timers.delete(id); },
  });
  const session = vm.runInContext(stripTypeScriptTypes(hostSource) + '\nMeetingStageSession;', context);
  return { session, stages, request, destroy, timers, task, permissions, routing };
}

describe('Harmony meeting native stage', () => {
  it('keeps ArkTS component and intercept responses non-null for strict Harmony compilation', () => {
    const stage = readFileSync(new URL('../../uni_modules/nuwax-livekit/utssdk/app-harmony/MeetingStage.ets', import.meta.url), 'utf8');
    const plugin = readFileSync(new URL('../../uni_modules/nuwax-livekit/utssdk/app-harmony/index.uts', import.meta.url), 'utf8');
    expect(stage).toContain('host: MeetingStageHost = MeetingStageSession.host as MeetingStageHost');
    expect(stage).toContain('assetResponse(url: string): WebResourceResponse');
    expect(stage).not.toContain('assetResponse(url: string): WebResourceResponse | null');
    expect(plugin).toContain('export function createVideoView(): any { return {}; }');
    expect(plugin).toContain('export function createRemoteVideoView(_identity: string): any { return {}; }');
  });

  it('enables Harmony meeting media from the plugin capability without an API-origin gate', () => {
    const media = readFileSync(new URL('../../utils/meeting/meetingMedia.uts', import.meta.url), 'utf8');
    const page = readFileSync(new URL('../../subpackages/pages/im-meeting/im-meeting-room.uvue', import.meta.url), 'utf8');
    const support = media.slice(media.indexOf('export function meetingMediaSupported(): boolean {'), media.indexOf('/** 当前平台名'));
    const harmonySupport = support.slice(support.indexOf('// #ifdef APP-HARMONY'));
    expect(harmonySupport).toContain('supported = livekitIsSupported();');
    expect(harmonySupport).not.toContain('getApiBaseUrl');
    expect(harmonySupport).not.toContain('testagent.xspaceagi.com');
    expect(media).not.toContain('import { getApiBaseUrl } from "@/constants/config";');

    const mic = page.slice(page.indexOf('function handleMicTap(): void {'), page.indexOf('function handleMyAvatarError'));
    const camera = page.slice(page.indexOf('function handleCameraTap(): void {'), page.indexOf('// #ifdef APP-ANDROID || APP-IOS', page.indexOf('function handleCameraTap(): void {')));
    expect(mic).toContain('meetingMediaSetMic(next);');
    expect(camera).toContain('meetingMediaSetCamera(next);');
    expect(page).toContain('meetingMediaSwitchCamera();');
    expect(page).toContain('meetingMediaSetSpeaker(!speakerOn.value);');
    expect(mic).not.toContain('mediaHarmonyPending');
    expect(camera).not.toContain('mediaHarmonyPending');
  });

  it('reuses the same ArkWeb frame and connection after minimizing and returning', () => {
    const { session, stages } = nativeStage();
    const initial = session.attach({}, 'Picture in picture');
    const frame = initial.makeNode({});
    const host = session.host;
    host.ready = true;
    session.connect('wss://room.test', 'seat-token');
    session.connection = 'connected';
    const roomGeneration = session.id;
    host.controller.runJavaScript.mockClear();

    expect(session.releaseView(initial.id)).toBe(true);
    expect(initial.makeNode({})).toBeNull();
    expect(host.controller.onActive).toHaveBeenCalledOnce();
    expect(stages[0].dispose).not.toHaveBeenCalled();
    const restored = session.attach({}, 'Picture in picture');
    expect(restored.makeNode({})).toBe(frame);
    expect(stages).toHaveLength(1);
    expect(session.id).toBe(roomGeneration);
    expect(session.isConnected()).toBe(true);
    expect(host.controller.runJavaScript.mock.calls.map(([command]: [string]) => command))
      .toEqual(["window.meetingMedia.setPictureInPictureLabel(\"Picture in picture\")"]);
  });

  it('ignores a stale unmount and disposes the detached frame only after the SDK confirms leave', async () => {
    const { session, stages } = nativeStage();
    const old = session.attach({}, 'Picture in picture');
    const frame = old.makeNode({});
    const host = session.host;
    host.ready = true;
    session.connect('wss://room.test', 'seat-token');
    session.connection = 'connected';
    const restored = session.attach({}, 'Picture in picture');

    expect(session.releaseView(old.id)).toBe(false);
    expect(restored.makeNode({})).toBe(frame);
    expect(session.releaseView(restored.id)).toBe(true);
    const id = session.id;
    const leaving = session.disconnect();
    expect(session.disconnect()).toBe(leaving);
    session.releaseIdleHost();
    host.postMessage(JSON.stringify({ type: 'leaveComplete', id: id - 1, left: true }));
    expect(stages[0].dispose).not.toHaveBeenCalled();
    host.postMessage(JSON.stringify({ type: 'leaveComplete', id, left: true }));
    expect(await leaving).toBe(true);
    expect(stages[0].dispose).toHaveBeenCalledOnce();
    expect(session.host).toBeUndefined();
    expect(session.isConnected()).toBe(false);
  });

  it('disposes a page that never joined a room', () => {
    const { session, stages } = nativeStage();
    const mount = session.attach({}, 'Picture in picture');
    mount.makeNode({});
    expect(session.releaseView(mount.id)).toBe(true);
    expect(stages[0].dispose).toHaveBeenCalledOnce();
    expect(session.host).toBeUndefined();
  });
});


const releaseURL = 'https://testagent.xspaceagi.com/api/instant-message/meetings/public/rooms/room-1/share-holder/release';

function connectedStage() {
  const fixture = nativeStage();
  const { session } = fixture;
  const mount = session.attach({ applicationInfo: { accessTokenId: 43 } }, 'Picture in picture');
  mount.makeNode({});
  session.host.ready = true;
  session.host.screenSupported = true;
  session.connect('wss://room.test', 'seat-token');
  session.connection = 'connected';
  session.host.controller.runJavaScript.mockClear();
  return { ...fixture, mount };
}

function settle() {
  return new Promise(resolve => setImmediate(resolve));
}

it('reads back the system speaker state after switching and on return to the foreground', async () => {
  const { session, routing } = connectedStage();
  session.control('speaker', false);
  await settle();
  expect(routing.setCommunicationDevice).toHaveBeenCalledWith(2, false);
  expect(session.speaker).toBe(true);
  expect(session.controlError).toBe('speaker');

  session.setAppForeground(false);
  routing.isCommunicationDeviceActiveSync.mockReturnValue(false);
  session.setAppForeground(true);
  expect(session.speaker).toBe(false);

  routing.isCommunicationDeviceActiveSync.mockReturnValue(true);
  session.control('speaker', true);
  await settle();
  expect(session.speaker).toBe(true);
});

it('ignores a speaker change that finishes after the room generation changes', async () => {
  const { session, routing } = connectedStage();
  let finish!: () => void;
  routing.setCommunicationDevice.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  session.control('speaker', false);
  await settle();
  expect(routing.setCommunicationDevice).toHaveBeenCalledOnce();

  void session.disconnect();
  session.connect('wss://other-room.test', 'new-token');
  routing.isCommunicationDeviceActiveSync.mockReturnValue(false);
  finish();
  await settle();
  expect(routing.isCommunicationDeviceActiveSync).not.toHaveBeenCalled();
  expect(session.speaker).toBe(true);
  expect(session.controlError).toBe('');
});

describe('Harmony meeting share lease', () => {
  it('releases the seat on OS capture stop even with all business views detached', async () => {
    const { session, mount, request, destroy } = connectedStage();
    expect(session.prepareShare('Share', 'Cancel', releaseURL, 'release-seat-token')).toBe(true);
    const browser = session.host.controller.runJavaScript;
    expect(browser.mock.lastCall?.[0]).not.toContain('release-seat-token');
    session.releaseView(mount.id);

    session.receive({ type: 'shareError', id: session.id, shareId: 1, error: 'stopped' });
    session.stopShare();
    expect(request).toHaveBeenCalledOnce();
    const [url, options] = request.mock.lastCall!;
    expect(url).toBe(releaseURL);
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.extraData)).toEqual({ token: 'release-seat-token' });
    expect(session.isShareReleaseRunning()).toBe(true);
    expect(session.prepareShare('Share', 'Cancel', releaseURL, 'release-seat-token')).toBe(false);
    await settle();
    expect(destroy).toHaveBeenCalledOnce();
    expect(session.isShareReleaseRunning()).toBe(false);
  });

  it('does not use production and ignores a stale stop from an earlier share', async () => {
    const { session, request } = connectedStage();
    const production = releaseURL.replace('testagent.xspaceagi.com', 'agent.nuwax.com');
    expect(session.prepareShare('Share', 'Cancel', production, 'token')).toBe(false);
    expect(session.prepareShare('Share', 'Cancel', releaseURL, 'first')).toBe(true);
    session.stopShare();
    await settle();
    expect(session.prepareShare('Share', 'Cancel', releaseURL, 'second')).toBe(true);
    session.receive({ type: 'shareError', id: session.id, shareId: 1, error: 'stopped' });
    expect(request).toHaveBeenCalledOnce();
    session.disconnect();
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(request.mock.lastCall![1].extraData)).toEqual({ token: 'second' });
    await settle();
  });

  it('cancels a pending consent on timeout and retries one transient release failure', async () => {
    const { session, request, destroy, timers } = connectedStage();
    request.mockRejectedValueOnce(new Error('timeout'));
    expect(session.prepareShare('Share', 'Cancel', releaseURL, 'token')).toBe(true);
    const expiry = [...timers.values()].find(timer => timer.delay === 65000);
    expect(expiry).toBeDefined();
    expiry!.callback();
    await settle();
    expect(session.shareError).toBe('screen_capture_timeout');
    expect(session.captureArmed).toBe(false);
    const retry = [...timers.values()].find(timer => timer.delay === 500);
    expect(retry).toBeDefined();
    retry!.callback();
    await settle();
    expect(request).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledTimes(2);
    expect(session.isShareReleaseRunning()).toBe(false);
  });

  it('keeps a published share past the consent deadline and releases it when the connection ends', async () => {
    const { session, request, timers } = connectedStage();
    expect(session.prepareShare('Share', 'Cancel', releaseURL, 'token')).toBe(true);
    session.receive({ type: 'state', id: session.id, connection: 'connected', shareId: 1, sharing: true });
    expect(session.sharing).toBe(true);
    expect(timers.size).toBe(0);
    session.receive({ type: 'state', id: session.id, connection: 'disconnected' });
    expect(session.sharing).toBe(false);
    expect(request).toHaveBeenCalledOnce();
    await settle();
  });
});


describe('Harmony meeting background lifecycle', () => {
  it('abstains while the room has no media and acquires when remote audio arrives', async () => {
    const { session, task, mount } = connectedStage();
    const id = session.id;
    session.receive({ type: 'state', id, connection: 'connected' });
    expect(task.acquire).not.toHaveBeenCalled();
    session.receive({ type: 'state', id, connection: 'connected', remoteAudio: true });
    expect(task.acquire).toHaveBeenCalledOnce();
    expect(task.acquire.mock.lastCall?.[0]).toBe('meeting:' + id);

    session.releaseView(mount.id);
    session.setAppForeground(false);
    session.receive({ type: 'state', id, connection: 'reconnecting', remoteAudio: true });
    expect(task.release).not.toHaveBeenCalled();
    session.receive({ type: 'state', id, connection: 'disconnected' });
    await settle();
    expect(task.release).toHaveBeenCalledExactlyOnceWith('meeting:' + id);
  });

  it('waits for the foreground to start a task and stops holding it when the room leaves', async () => {
    const { session, task } = connectedStage();
    const id = session.id;
    session.setAppForeground(false);
    session.receive({ type: 'state', id, connection: 'connected', mic: true });
    expect(task.acquire).not.toHaveBeenCalled();
    session.setAppForeground(true);
    expect(task.acquire).toHaveBeenCalledOnce();
    const leaving = session.disconnect();
    await settle();
    expect(task.release).not.toHaveBeenCalled();
    session.host.postMessage(JSON.stringify({ type: 'leaveComplete', id, left: true }));
    await leaving;
    await settle();
    expect(task.release).toHaveBeenCalledExactlyOnceWith('meeting:' + id);
  });

  it.each([false, true])('keeps the background owner until the share has been returned (stopped first: %s)', async stoppedFirst => {
    const { session, task, request, mount } = connectedStage();
    let finishRelease!: (response: object) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { finishRelease = resolve; }));
    const id = session.id;
    const host = session.host;
    expect(session.prepareShare('Share', 'Cancel', releaseURL, 'token')).toBe(true);
    session.receive({ type: 'state', id, connection: 'connected', shareId: 1, sharing: true });
    expect(task.acquire).toHaveBeenCalledOnce();

    session.releaseView(mount.id);
    session.setAppForeground(false);
    if (stoppedFirst) session.stopShare();
    const leaving = session.disconnect();
    host.postMessage(JSON.stringify({ type: 'leaveComplete', id, left: true }));
    expect(await leaving).toBe(true);
    await settle();
    expect(request).toHaveBeenCalledOnce();
    expect(task.release).not.toHaveBeenCalled();

    finishRelease({ responseCode: 200, result: '{"code":"0000"}' });
    await settle();
    expect(task.release).toHaveBeenCalledExactlyOnceWith('meeting:' + id);
  });
});


it('queues only a valid task notification while connected and consumes the return request once', () => {
  const { session, task } = connectedStage();
  session.handleBackgroundWant({});
  expect(session.consumeRestoreRequest()).toBe(false);

  task.acceptsNotification.mockReturnValue(true);
  session.handleBackgroundWant({});
  expect(session.consumeRestoreRequest()).toBe(true);
  expect(session.consumeRestoreRequest()).toBe(false);
  session.handleBackgroundWant({});
  session.disconnect();
  expect(session.consumeRestoreRequest()).toBe(false);
  session.handleBackgroundWant({});
  expect(session.consumeRestoreRequest()).toBe(false);
});


it('requests OS permissions only for media the participant can publish in the foreground', async () => {
  const { session, permissions } = connectedStage();
  const id = session.id;
  session.receive({ type: 'state', id, connection: 'connected', micAllowed: false, cameraAllowed: true });
  session.control('mic', true);
  await settle();
  expect(permissions.requestPermissionsFromUser).not.toHaveBeenCalled();
  expect(session.controlError).toBe('mic');

  session.setAppForeground(false);
  session.control('camera', true);
  await settle();
  expect(permissions.requestPermissionsFromUser).not.toHaveBeenCalled();

  session.setAppForeground(true);
  session.control('camera', true);
  await settle();
  expect(permissions.requestPermissionsFromUser).toHaveBeenCalledWith(expect.anything(), ['ohos.permission.CAMERA']);
  permissions.checkAccessTokenSync.mockReturnValue(0);
  expect(session.host.captureResourceAllowed('audio')).toBe(false);
  expect(session.host.captureResourceAllowed('video')).toBe(true);
});


it('cleans up a detached ArkWeb host when leave confirmation times out', async () => {
  const { session, mount, stages, timers } = connectedStage();
  const host = session.host;
  const id = session.id;
  const leaving = session.disconnect();
  session.releaseView(mount.id);
  expect(stages[0].dispose).not.toHaveBeenCalled();
  [...timers.values()].find(timer => timer.delay === 2500)!.callback();
  expect(await leaving).toBe(false);
  expect(stages[0].dispose).toHaveBeenCalledOnce();
  host.postMessage(JSON.stringify({ type: 'leaveComplete', id, left: true }));
  expect(session.host).toBeUndefined();
});


it('only grants the current authorized ArkWeb screen capture request once', async () => {
  const { session } = connectedStage();
  const origin = 'https://nuwax-meeting.invalid';
  const handler = { getOrigin: vi.fn(() => origin), grant: vi.fn(), deny: vi.fn() };
  expect(session.prepareShare('Share', 'Cancel', releaseURL, 'token')).toBe(true);
  session.host.requestScreenCapture(handler);
  expect(handler.grant).not.toHaveBeenCalled();

  session.receive({ type: 'state', id: session.id, connection: 'connected', captureAllowed: true, shareId: 99 });
  session.host.requestScreenCapture(handler);
  expect(handler.grant).not.toHaveBeenCalled();
  session.receive({ type: 'state', id: session.id, connection: 'connected', awaitingCapture: true, shareId: 1 });
  session.host.requestScreenCapture(handler);
  expect(handler.grant).not.toHaveBeenCalled();
  session.receive({ type: 'state', id: session.id, connection: 'connected', captureAllowed: true, shareId: 1 });
  handler.getOrigin.mockReturnValueOnce('https://elsewhere.test');
  session.host.requestScreenCapture(handler);
  expect(handler.grant).not.toHaveBeenCalled();

  session.host.requestScreenCapture(handler);
  session.host.requestScreenCapture(handler);
  expect(handler.grant).toHaveBeenCalledExactlyOnceWith({ captureMode: 0 });
  expect(handler.deny).toHaveBeenCalledTimes(5);
  session.stopShare();
  await settle();
  expect(session.captureAllowed).toBe(false);
});
