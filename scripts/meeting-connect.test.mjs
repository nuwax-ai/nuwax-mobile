import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

function forPlatform(raw, platform) {
  const stack = [true];
  const lines = [];
  for (const line of raw.split('\n')) {
    const condition = line.match(/^\s*\/\/ #(ifdef|ifndef) (.+)$/);
    if (condition) {
      const matches = condition[2].split('||').map(s => s.trim()).includes(platform);
      stack.push(stack.at(-1) && (condition[1] === 'ifdef' ? matches : !matches));
    } else if (/^\s*\/\/ #endif/.test(line)) stack.pop();
    else if (stack.at(-1)) lines.push(line);
  }
  return lines.join('\n');
}

// 执行业务状态机，原生桥和网络为桩；不调用 HBuilderX/设备或真实接口。
function harness({ platform = 'APP-IOS', configThrows = false, coreThrows = false, preCode = '0', tokenCode = '0',
  apiOrigin = 'https://testagent.xspaceagi.com', screenSupported = true, nativeShareAccepted = true,
  nativeShareStopping = false, claimResult = async () => ({ code: '0' }),
  preData = { active: true } } = {}) {
  const raw = readFileSync(new URL('../utils/meeting/meetingMedia.uts', import.meta.url), 'utf8');
  const source = forPlatform(raw, platform).replace(/^import[\s\S]*?;\s*$/gm, '');
  const timers = new Map(), logs = [], operations = [], presentations = [], navigations = [];
  let restoreRequested = false, persistentRestore = false;
  let restoreAcks = 0;
  let pageReady = true, navigationFails = false, deferNavigation = false, voipActive = false;
  let routes = ['pages/tab-shell/tab-shell'];
  let nativeSnapshot = '';
  const backDeltas = [];
  const navigationObservers = new Map();
  let now = 10000;
  let nextTimer = 0, connected = false, configured = false, claims = 0;
  let microphone = false, speaker = true, remoteScreen = false, shareError = '', releases = 0;
  const globals = {
    console: { error: value => logs.push(String(value)) },
    Date: { now: () => now },
    JSON: { parseObject: JSON.parse, parse: JSON.parse, stringify: JSON.stringify },
    SUCCESS_CODE: '0', eventBus: { emit() {} },
    apiImMeetingPublicRoomSafe: async () => ({ code: preCode, data: preData }),
    apiImMeetingIssueToken: async () => ({ code: tokenCode, data: { wsUrl: 'wss://rtc.test', token: 'secret-seat-token' } }),
    apiResCode: response => response.code,
    apiResData: response => response.data,
    meetingShareReleaseEndpoint: room => 'https://api.test/rooms/' + room + '/release',
    livekitIsSupported: () => true, livekitSdkVersion: () => '2.19.0|probe=ios-share-20261121-p2',
    livekitConnect() {
      operations.push('connect');
      if (coreThrows) throw new Error('native failure');
      configured = false; // Android 原生 connect 会清理上一场配置。
    },
    livekitIsConnected: () => connected,
    livekitIsMicEnabled: () => microphone,
    livekitIsSpeakerEnabled: () => speaker,
    livekitLastError: () => '', livekitParticipantCount: () => connected ? 1 : 0,
    livekitConfigureBackgroundSession(endpoint, token) {
      assert.equal(connected, true, '不能在原生连接成功前配置后台能力');
      assert.equal(token, 'secret-seat-token');
      operations.push('configure');
      if (configThrows) throw new Error('missing bridge method: secret-seat-token');
      configured = true;
    },
    getApiBaseUrl: () => apiOrigin,
    hasNativeVoipCall: () => voipActive,
    livekitMicEnabled: () => microphone,
    livekitCameraEnabled: () => false,
    livekitSpeakerEnabled: () => true,
    livekitSetMic: on => operations.push(platform === 'APP-HARMONY' ? (on ? 'unmute' : 'mute') : `mic:${on}`),
    livekitSetCamera: on => operations.push(on ? 'cameraOn' : 'cameraOff'),
    livekitSwitchCamera: () => operations.push('flipCamera'),
    livekitSetSpeaker: on => operations.push(platform === 'APP-HARMONY' ? (on ? 'speaker' : 'earpiece') : `speaker:${on}`),
    livekitRemoteVideoIdentities: () => '',
    livekitRemoteScreenVisible: () => remoteScreen,
    livekitScreenCaptureSupported: () => screenSupported,
    livekitAwaitingScreenCapture: () => false,
    livekitPrepareScreenCapture(label, cancel, url, token) {
      operations.push(label + '/' + cancel);
      assert.equal(url, 'https://api.test/rooms/123456789/release');
      assert.equal(token, 'secret-seat-token');
      return nativeShareAccepted;
    },
    livekitIsScreenShareOn: () => false, livekitScreenShareError: () => shareError,
    livekitIsScreenShareStopping: () => {
      if (configThrows) throw new Error('旧基座不能调用新增导出');
      return nativeShareStopping;
    },
    livekitRequestScreenShare() { if (!configThrows) assert.equal(configured, true); operations.push('share'); },
    apiImMeetingTakeShareHolder: async () => { claims++; return claimResult(); },
    livekitDisconnect: () => { connected = false; operations.push('disconnect'); },
    livekitDisconnectConfirmed: async () => { connected = false; operations.push('disconnect'); return true; },
    livekitSendMeetingMessage: () => operations.push('chat'),
    livekitSetHandRaised: on => operations.push(on ? 'raise' : 'lower'),
    livekitStopScreenShare: () => operations.push('stopShare'),
    apiImMeetingGuestReleaseShareHolder: async () => { releases++; return { code: '0' }; },
    livekitSetMeetingPresentation(visible, foreground) {
      if (configThrows) throw new Error('旧基座没有自动小窗');
      presentations.push({ visible, foreground });
    },
    livekitConsumeMeetingRestoreRequest() { const value = restoreRequested; if (!persistentRestore) restoreRequested = false; return value; },
    acknowledgeMeetingRestoreRequest() { restoreRequested = false; restoreAcks++; },
    restoreMeetingResumeState: () => nativeSnapshot,
    rememberMeetingResumeState(room, url, token) {
      nativeSnapshot = JSON.stringify({ room, url, token, mic: true, camera: false, speaker: true });
    },
    getCurrentPages: () => pageReady ? routes.map(route => ({ route })) : [],
    uni: { addInterceptor(method, observer) {
      assert.equal(navigationObservers.has(method), false, '全局导航监听不能重复安装');
      navigationObservers.set(method, observer);
    }, navigateTo(options) { navigations.push(options.url);
      if (navigationFails) options.fail?.({}); else {
        if (!deferNavigation) routes.push(options.url.split('?')[0].replace(/^\//, ''));
        options.success?.({});
      }
      options.complete?.({}); },
      navigateBack(options) {
        backDeltas.push(options.delta);
        routes = routes.slice(0, -options.delta);
        options.success?.({}); options.complete?.({});
      },
      redirectTo(options) {
        navigations.push(options.url);
        routes[routes.length - 1] = options.url.split('?')[0].replace(/^\//, '');
        options.success?.({}); options.complete?.({});
      },
    },
    setInterval(callback) { timers.set(++nextTimer, callback); return nextTimer; },
    clearInterval(id) { timers.delete(id); },
  };
  const context = vm.createContext(globals);
  vm.runInContext(stripTypeScriptTypes(source).replace(/^export /gm, ''), context);
  return {
    api: context, operations, logs, presentations, navigations, backDeltas,
    join: () => context.meetingMediaConnect({ room: '123456789', displayName: 'Test', passcode: '' }),
    complete() { connected = true; for (const callback of [...timers.values()]) callback(); },
    claims: () => claims,
    releases: () => releases,
    media({ mic = false, shared = false, error = '' }) { microphone = mic; remoteScreen = shared; shareError = error; },
    staleFailure() {
      vm.runInContext('state.connected = false; state.connecting = false; state.errorText = "exception";', context);
    },
    nativeConnected(value) { connected = value; },
    nativeAudio(mic, output) { microphone = mic; speaker = output; },
    advance(ms = 1000) { now += ms; },
    requestRestore(persistent = false) { restoreRequested = true; persistentRestore = persistent; },
    restoreAcks: () => restoreAcks,
    pageReady(value) { pageReady = value; },
    voipActive(value) { voipActive = value; },
    navigationFails(value) { navigationFails = value; },
    routes(value) { routes = value; },
    deferNavigation(value) { deferNavigation = value; },
    nativeSnapshot(value) { nativeSnapshot = value; },
    navigationSucceeded(method) { navigationObservers.get(method).success({}); },
  };
}

for (const platform of ['APP-IOS', 'APP-ANDROID']) test(`${platform} 旧基座缺少后台方法：原有聊天、举手和共享仍可用`, async () => {
  const h = harness({ platform, configThrows: true });
  await h.join();
  assert.equal(h.api.meetingMediaState().connecting, true);
  h.complete();
  const state = h.api.meetingMediaState();
  assert.equal(state.connected, true);
  assert.equal(state.connecting, false);
  assert.equal(state.errorText, '');
  h.api.meetingMediaSendMessage('hello', 'Test', false);
  assert.ok(h.operations.includes('chat'));
  h.api.meetingMediaSetHandRaised(true);
  h.api.meetingMediaSetHandRaised(false);
  assert.ok(h.operations.includes('raise'));
  assert.ok(h.operations.includes('lower'));
  assert.equal(await h.api.meetingMediaStartScreenShare('123456789'), true);
  assert.equal(h.claims(), 1);
  assert.ok(h.operations.includes('share'));
  assert.equal(h.api.meetingMediaScreenShareError(), '');
  assert.equal(h.logs.some(line => line.includes('secret-seat-token')), false);
});

test('原生已连接而页面残留 exception：恢复状态后聊天、举手和共享可用', async () => {
  const h = harness({ configThrows: true });
  await h.join();
  h.nativeConnected(true);
  h.staleFailure();
  h.api.meetingMediaReconcile('123456789');
  assert.equal(h.api.meetingMediaState().connected, true);
  assert.equal(h.api.meetingMediaState().errorText, '');
  h.api.meetingMediaSendMessage('hello', 'Test', false);
  h.api.meetingMediaSetHandRaised(true);
  assert.equal(await h.api.meetingMediaStartScreenShare('123456789'), true);
  assert.deepEqual(h.operations, ['connect', 'configure', 'chat', 'raise', 'share']);
});

test('主动离会后即使原生返回迟到连接状态也不会重新入会', async () => {
  const h = harness();
  await h.join();
  h.complete();
  await h.api.meetingMediaDisconnect();
  h.nativeConnected(true);
  h.api.meetingMediaReconcile();
  assert.equal(h.api.meetingMediaState().connected, false);
  h.api.meetingMediaSendMessage('hello', 'Test', false);
  h.api.meetingMediaSetHandRaised(true);
  assert.equal(await h.api.meetingMediaStartScreenShare('123456789'), false);
  assert.equal(h.claims(), 0);
  assert.equal(h.operations.includes('chat'), false);
  assert.equal(h.operations.includes('raise'), false);
});

test('实际未连接或页面房间不匹配，不伪造入会成功', async () => {
  const h = harness();
  await h.join();
  h.staleFailure();
  h.api.meetingMediaReconcile('123456789');
  assert.equal(h.api.meetingMediaState().connected, false);
  h.nativeConnected(true);
  h.api.meetingMediaReconcile('987654321');
  assert.equal(h.api.meetingMediaState().connected, false);
});

for (const platform of ['APP-IOS', 'APP-ANDROID']) {
  test(`${platform} 新基座：连接完成后配置一次，随后才可申请共享`, async () => {
    const h = harness({ platform });
    await h.join();
    assert.deepEqual(h.operations, ['connect']);
    h.complete();
    h.complete();
    assert.deepEqual(h.operations, ['connect', 'configure']);
    assert.equal(await h.api.meetingMediaStartScreenShare('123456789'), true);
    assert.equal(h.claims(), 1);
    assert.deepEqual(h.operations, ['connect', 'configure', 'share']);
  });
}

test('真正的原生连接异常仍保留失败状态', async () => {
  const h = harness({ coreThrows: true });
  assert.equal(await h.join(), false);
  assert.equal(h.api.meetingMediaState().connected, false);
  assert.equal(h.api.meetingMediaState().errorText, 'exception');
  assert.deepEqual(h.operations, ['connect']);
});

test('页面返回/退后台自动更新小窗，原会话不断开，点击小窗仅恢复路由', async () => {
  const h = harness();
  await h.join();
  h.complete();
  h.api.meetingMediaSetResumeURL('/subpackages/pages/im-meeting/im-meeting-room?room=123456789');
  h.api.meetingMediaSetMinimized(true);
  assert.deepEqual(h.presentations.at(-1), { visible: false, foreground: true });
  h.api.meetingMediaSetAppForeground(false);
  assert.deepEqual(h.presentations.at(-1), { visible: false, foreground: false });
  h.requestRestore();
  h.api.meetingMediaReconcile();
  assert.equal(h.navigations.length, 0, '后台不擅自导航');
  h.api.meetingMediaSetAppForeground(true);
  h.api.meetingMediaReconcile();
  assert.equal(h.navigations.length, 1);
  h.api.meetingMediaSetPageVisible(true);
  assert.deepEqual(h.presentations.at(-1), { visible: true, foreground: true });
  assert.equal(h.api.meetingMediaIsMinimized(), false);
  assert.equal(h.api.meetingMediaState().connected, true);
  assert.equal(h.operations.filter(op => op === 'connect').length, 1);
  assert.equal(h.operations.includes('disconnect'), false);
});

function pageFunctions(names, platform = 'APP-IOS') {
  const source = readFileSync(new URL('../subpackages/pages/im-meeting/im-meeting-room.uvue', import.meta.url), 'utf8');
  return names.map(name => {
    const plainStart = source.indexOf(`  function ${name}(`);
    const start = plainStart >= 0 ? plainStart : source.indexOf(`  async function ${name}(`);
    assert.notEqual(start, -1);
    const end = source.indexOf('\n  }', start);
    return forPlatform(source.slice(start, end + 4), platform);
  }).join('\n');
}

for (const code of ['IM_50001', 'IM_50002']) {
  for (const stage of ['preCode', 'tokenCode']) test(`${stage} ${code}：已结束或不存在的会议不再连接原生`, async () => {
    const h = harness({ [stage]: code });
    assert.equal(await h.join(), false);
    assert.equal(h.api.meetingMediaState().errorText, 'ended');
    assert.equal(h.api.meetingMediaState().connecting, false);
    assert.equal(h.operations.includes('connect'), false);
  });
}

test('预检网络错误仍尝试签令牌，不把临时失败当作会议结束', async () => {
  const h = harness({ preCode: '500' });
  await h.join();
  assert.ok(h.operations.includes('connect'));
  assert.notEqual(h.api.meetingMediaState().errorText, 'ended');
});

for (const root of [false, true]) test(`失效会议仅退出一次，根页面=${root}`, () => {
  const timers = [], navigations = [], toasts = [];
  let disconnects = 0;
  const context = vm.createContext({
    pageUnmounted: false, meetingClosing: false, preserveMeetingOnUnmount: true,
    t: key => key, console: { error() {} }, eventBus: { emit() {} }, IM_MEETING_CHANGED_EVENT: 'meeting',
    meetingMediaDisconnect() { disconnects++; },
    setTimeout(fn) { timers.push(fn); },
    uni: {
      showToast(value) { toasts.push(value); },
      navigateBack(value) { navigations.push('back'); if (root) value.fail({}); },
      reLaunch(value) { navigations.push(value.url); },
    },
  });
  vm.runInContext(stripTypeScriptTypes(pageFunctions(['returnFromClosedMeeting', 'handleConnectFailure'])), context);
  context.handleConnectFailure('exception');
  assert.equal(timers.length, 0, '临时错误不自动退栈');
  context.handleConnectFailure('ended');
  context.handleConnectFailure('ended');
  assert.equal(disconnects, 1);
  assert.equal(context.preserveMeetingOnUnmount, false);
  assert.equal(timers.length, 1);
  timers[0]();
  assert.deepEqual(navigations, root ? ['back', '/pages/tab-shell/tab-shell'] : ['back']);
  context.pageUnmounted = true;
  context.returnFromClosedMeeting();
  assert.equal(navigations.length, root ? 2 : 1, '卸载后的迟到回调不能退出上一页');
});

test('会议图标备用入口：拖动不误触返回、上下边界限制、回会后隐藏', () => {
  const raw = readFileSync(new URL('../components/meeting-active-banner/meeting-active-banner.uvue', import.meta.url), 'utf8');
  const source = raw.split('<script setup lang="uts">')[1].split('</script>')[0].replace(/^\s*import[^;]+;/gm, '');
  let now = 1000, returned = 0, minimized = true, native = false;
  const context = vm.createContext({
    ref: value => ({ value }), onMounted: fn => fn(), onUnmounted() {},
    eventBus: { on() {}, off() {} }, MEETING_MEDIA_CHANGED_EVENT: 'changed', Date: { now: () => now },
    meetingMediaIsMinimized: () => minimized, meetingMediaHasNativeWindow: () => native,
    meetingMediaResume() { returned++; }, uni: { getWindowInfo: () => ({ windowHeight: 800 }) },
  });
  vm.runInContext(stripTypeScriptTypes(source) + '; globalThis.inspect = () => ({ top: top.value, visible: visible.value }); globalThis.refreshEntry = refresh;', context);
  const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }] });
  assert.equal(context.inspect().visible, true);
  context.handleTouchStart(touch(370, 450));
  context.handleTouchMove(touch(370, -1000));
  assert.equal(context.inspect().top, 28);
  context.handleTouchEnd(touch(370, -1000));
  context.resume();
  assert.equal(returned, 0);
  now += 600;
  context.handleTouchStart(touch(370, 28));
  context.handleTouchMove(touch(370, 2000));
  assert.equal(context.inspect().top, 708);
  context.handleTouchEnd(touch(370, 2000));
  now += 600;
  context.handleTouchStart(touch(370, 708));
  context.handleTouchEnd(touch(370, 708));
  context.resume();
  assert.equal(returned, 1);
  minimized = false; context.refreshEntry(null);
  assert.equal(context.inspect().visible, false);
  minimized = true; native = true; context.refreshEntry(null);
  assert.equal(context.inspect().visible, false, '原生入口可用时不重复展示');
});

test('实际页面聊天、举手和共享入口先校准连接，返回不再弹小窗/最小化选择', async () => {
  const h = harness({ configThrows: true });
  await h.join();
  h.nativeConnected(true);
  h.staleFailure();
  const ref = value => ({ value });
  const opened = [], unavailable = [], navigated = [];
  const context = vm.createContext({
    ...h.api,
    roomRaw: ref('123456789'), mediaSupported: ref(true), mediaConnected: ref(false),
    mediaConnecting: ref(false), mediaError: ref('exception'), handRaised: ref(false),
    localSharePending: ref(false), localShareWasOn: ref(false), moreBusy: ref(''),
    shareHolder: ref(''), shareHolderName: ref(''), sharePendingAt: 0, shareErrorBaseline: '',
    sheet: ref(''), status: ref(1), meetingClosing: false, preserveMeetingOnUnmount: false,
    openSheet: name => opened.push(name), mediaUnavailableToast: tag => unavailable.push(tag),
    closeSheet() {},
    uni: {
      navigateBack: () => navigated.push('back'),
      showActionSheet: () => assert.fail('返回不应要求用户选择最小化'),
    },
  });
  const source = pageFunctions(['syncConnectionBeforeAction', 'handleMeetingChatTap', 'handleRaiseHandTap', 'handleShareTap', 'minimizeMeetingPage', 'handleBack']);
  vm.runInContext(stripTypeScriptTypes(source), context);
  context.handleMeetingChatTap();
  context.handleRaiseHandTap();
  context.handleShareTap();
  await new Promise(resolve => setImmediate(resolve));
  context.handleBack();
  assert.deepEqual(opened, ['chat']);
  assert.deepEqual(unavailable, []);
  assert.ok(h.operations.includes('raise'));
  assert.ok(h.operations.includes('share'));
  assert.deepEqual(navigated, ['back']);
  assert.equal(h.api.meetingMediaState().connected, true);
  assert.equal(h.api.meetingMediaIsMinimized(), true);
});

test('鸿蒙会议连接后返回最小化，点击入口复用当前房间', async () => {
  const h = harness({ platform: 'APP-HARMONY' });
  const resume = '/subpackages/pages/im-meeting/im-meeting-room?room=123456789';
  h.api.meetingMediaSetResumeURL(resume);
  h.routes(['pages/tab-shell/tab-shell', 'subpackages/pages/im-meeting/im-meeting-room']);
  await h.join(); h.complete();
  const ref = value => ({ value });
  const context = vm.createContext({
    ...h.api, sheet: ref(''), status: ref(1), mediaConnected: ref(true), mediaConnecting: ref(false),
    meetingClosing: false, preserveMeetingOnUnmount: false,
    syncConnectionBeforeAction() {},
  });
  vm.runInContext(stripTypeScriptTypes(pageFunctions(['minimizeMeetingPage', 'handleBack'], 'APP-HARMONY')), context);
  context.handleBack();
  assert.deepEqual(h.backDeltas, [1]);
  assert.equal(h.api.meetingMediaIsMinimized(), true);
  h.api.meetingMediaResume();
  assert.deepEqual(h.navigations, [resume]);
  await h.join();
  assert.deepEqual(h.operations, ['connect']);
});

test('鸿蒙连接途中返回取消入会，避免恢复一个尚未建立的会话', () => {
  const h = harness({ platform: 'APP-HARMONY' });
  const ref = value => ({ value });
  const context = vm.createContext({
    ...h.api, sheet: ref(''), status: ref(1), mediaConnected: ref(false), mediaConnecting: ref(true),
    meetingClosing: false,
    syncConnectionBeforeAction() {},
    minimizeMeetingPage: () => assert.fail('入会尚未完成'),
  });
  vm.runInContext(stripTypeScriptTypes(pageFunctions(['handleBack'], 'APP-HARMONY')), context);
  context.handleBack();
  assert.deepEqual(h.backDeltas, [1]);
  assert.equal(context.meetingClosing, true);
});

test('通知返回会议：页面未就绪或导航失败时保留请求，成功后不重复打开', async () => {
  const h = harness();
  await h.join(); h.complete();
  h.api.meetingMediaSetResumeURL('/subpackages/pages/im-meeting/im-meeting-room?room=123456789');
  h.pageReady(false); h.requestRestore(); h.api.meetingMediaReconcile();
  assert.equal(h.navigations.length, 0);
  h.pageReady(true); h.navigationFails(true); h.api.meetingMediaReconcile();
  assert.equal(h.navigations.length, 1);
  h.navigationFails(false); h.advance(); h.api.meetingMediaReconcile(); h.api.meetingMediaReconcile();
  assert.equal(h.navigations.length, 2);
  assert.equal(h.operations.filter(op => op === 'connect').length, 1);
  assert.equal(h.operations.includes('disconnect'), false);
});

test('离会会清除尚未完成的通知返回请求', async () => {
  const h = harness(); await h.join(); h.complete();
  h.api.meetingMediaSetResumeURL('/subpackages/pages/im-meeting/im-meeting-room?room=123456789');
  h.pageReady(false); h.requestRestore(); h.api.meetingMediaReconcile();
  await h.api.meetingMediaDisconnect(); h.pageReady(true);
  await h.join(); h.complete(); h.api.meetingMediaReconcile();
  assert.equal(h.navigations.length, 0);
});

const meetingRoute = 'subpackages/pages/im-meeting/im-meeting-room';
const meetingURL = '/' + meetingRoute + '?room=123456789';

for (const platform of ['APP-ANDROID', 'APP-IOS']) {
  test(`${platform} 全局页面切换：所有业务页展示入口，点击回当前会议`, async () => {
    const h = harness({ platform }); await h.join(); h.complete();
    h.api.meetingMediaSetResumeURL(meetingURL);
    for (const route of ['pages/message/chat', 'subpackages/pages/settings/settings', 'subpackages/pages/im-meeting/im-meeting-detail']) {
      h.routes([route]); h.api.meetingMediaPageDidShow();
      assert.equal(h.api.meetingMediaIsMinimized(), true);
      assert.deepEqual(h.presentations.at(-1), { visible: false, foreground: true });
      h.api.meetingMediaResume(); h.api.meetingMediaPageDidShow();
      assert.equal(h.navigations.at(-1), meetingURL);
      assert.equal(h.api.meetingMediaIsMinimized(), false);
      assert.deepEqual(h.presentations.at(-1), { visible: true, foreground: true });
    }
    assert.equal(h.operations.filter(op => op === 'connect').length, 1);
    assert.equal(h.operations.includes('disconnect'), false);
  });
}

test('导航成功回调先于会议页显示：消息页仍保留返回请求', async () => {
  const h = harness(); await h.join(); h.complete();
  h.api.meetingMediaSetResumeURL(meetingURL);
  h.deferNavigation(true); h.requestRestore(); h.api.meetingMediaReconcile();
  assert.equal(h.navigations.length, 1);
  // 首次导航成功但宿主仍停留消息页，下一次就绪通知必须重试。
  h.deferNavigation(false); h.advance(); h.api.meetingMediaPageDidShow();
  assert.equal(h.navigations.length, 2);
  h.api.meetingMediaPageDidShow(); h.api.meetingMediaReconcile();
  assert.equal(h.navigations.length, 2);
});

test('旧会议页残留在页面列表：回会只向前导航，不能按旧栈退到桌面', async () => {
  const h = harness(); await h.join(); h.complete();
  h.api.meetingMediaSetResumeURL(meetingURL);
  h.routes(['pages/tab-shell/tab-shell', meetingRoute, 'pages/message/chat', 'pages/detail']);
  h.requestRestore(); h.api.meetingMediaReconcile(); h.api.meetingMediaPageDidShow();
  assert.deepEqual(h.backDeltas, []);
  assert.deepEqual(h.navigations, [meetingURL]);
  assert.equal(h.api.meetingMediaIsMinimized(), false);
});

test('原生窗口配置失败也能消费通知返回请求', async () => {
  const h = harness({ configThrows: true }); await h.join(); h.complete();
  h.api.meetingMediaSetResumeURL(meetingURL);
  h.requestRestore(); h.api.meetingMediaReconcile();
  assert.deepEqual(h.navigations, [meetingURL]);
});

test('Android 业务运行时重建：恢复存活的原生会议并处理桌面入口，不重新连接', () => {
  const h = harness({ platform: 'APP-ANDROID' });
  h.nativeConnected(true);
  h.nativeSnapshot(JSON.stringify({ room: '123456789', url: meetingURL, token: 'secret-seat-token', mic: true, camera: false, speaker: true }));
  h.pageReady(false); h.requestRestore(); h.api.meetingMediaReconcile();
  assert.equal(h.api.meetingMediaState().connected, true);
  assert.equal(h.api.meetingMediaState().micOn, true);
  assert.equal(h.navigations.length, 0);
  h.pageReady(true); h.api.meetingMediaPageDidShow(); h.api.meetingMediaReconcile();
  assert.deepEqual(h.navigations, [meetingURL]);
  assert.equal(h.operations.includes('connect'), false);
  assert.equal(h.operations.includes('disconnect'), false);
});

test('Android 主动离会后不从迟到原生快照恢复；进程已结束无快照时不伪造会议', async () => {
  const h = harness({ platform: 'APP-ANDROID' });
  h.api.meetingMediaReconcile(); assert.equal(h.api.meetingMediaState().connected, false);
  await h.join(); h.complete(); h.api.meetingMediaSetResumeURL(meetingURL);
  await h.api.meetingMediaDisconnect();
  h.nativeConnected(true); h.requestRestore(); h.api.meetingMediaReconcile();
  assert.equal(h.api.meetingMediaState().connected, false);
  assert.equal(h.navigations.length, 0);
});

test('全局导航监听只安装一次，五种路由变更均同步浮窗', async () => {
  const h = harness();
  h.api.installMeetingNavigationObservers(); h.api.installMeetingNavigationObservers();
  await h.join(); h.complete();
  for (const method of ['navigateTo', 'navigateBack', 'redirectTo', 'reLaunch', 'switchTab']) {
    h.routes([meetingRoute]); h.navigationSucceeded(method);
    assert.equal(h.api.meetingMediaIsMinimized(), false);
    h.routes(['pages/any/' + method]); h.navigationSucceeded(method);
    assert.equal(h.api.meetingMediaIsMinimized(), true);
    assert.deepEqual(h.presentations.at(-1), { visible: false, foreground: true });
  }
});

test('页面栈已满时回会使用替换当前页，不遗留消息页', async () => {
  const h = harness(); await h.join(); h.complete();
  h.api.meetingMediaSetResumeURL(meetingURL);
  h.routes(Array.from({ length: 10 }, (_, i) => 'pages/detail/' + i));
  h.navigationFails(true); h.requestRestore(); h.api.meetingMediaReconcile();
  h.api.meetingMediaPageDidShow();
  assert.deepEqual(h.navigations, [meetingURL, meetingURL]);
  assert.equal(h.api.meetingMediaIsMinimized(), false);
});


test('Android 桌面点击后经过消息页/运行时恢复：实际会议页 onShow 才确认返回', async () => {
  const h = harness({ platform: 'APP-ANDROID' }); await h.join(); h.complete();
  h.api.meetingMediaSetResumeURL(meetingURL);
  h.requestRestore(true); h.deferNavigation(true);
  h.api.meetingMediaReconcile();
  assert.equal(h.restoreAcks(), 0, '导航成功回调不能确认返回');
  h.api.meetingMediaConfirmPageVisible('other-room');
  assert.equal(h.restoreAcks(), 0, '其他会议不能确认当前返回请求');
  h.deferNavigation(false); h.advance(); h.api.meetingMediaReconcile();
  assert.equal(h.restoreAcks(), 0, '页面栈出现路由还不等于 onShow');
  h.api.meetingMediaConfirmPageVisible('123456789');
  assert.equal(h.restoreAcks(), 1);
  // 已成功回会，之后用户主动返回聊天页，不能被残留请求再拉回会议。
  const navigated = h.navigations.length;
  h.routes(['pages/message/chat']); h.api.meetingMediaSetPageVisible(false);
  h.api.meetingMediaPageDidShow(); h.api.meetingMediaReconcile();
  assert.equal(h.navigations.length, navigated);
  assert.equal(h.api.meetingMediaIsMinimized(), true);
  assert.deepEqual(h.backDeltas, []);
});


test('原生页面切换尚未完成：短间隔轮询不能重复压入会议页', async () => {
  const h = harness({ platform: 'APP-ANDROID' }); await h.join(); h.complete();
  h.api.meetingMediaSetResumeURL(meetingURL); h.deferNavigation(true);
  h.requestRestore(true); h.api.meetingMediaReconcile();
  for (let i = 0; i < 3; i++) { h.advance(250); h.api.meetingMediaReconcile(); }
  assert.equal(h.navigations.length, 1);
  h.advance(250); h.api.meetingMediaReconcile();
  assert.equal(h.navigations.length, 2, '超时仍未显示才重试');
  assert.deepEqual(h.backDeltas, []);
});


test('鸿蒙会议媒体在正式环境启用，设备开关跟随实际采集状态', async () => {
  const production = harness({ platform: 'APP-HARMONY', apiOrigin: 'https://agent.nuwax.com' });
  await production.join();
  assert.equal(production.api.meetingMediaSupported(), true);
  assert.deepEqual(production.operations, ['connect']);

  const h = harness({ platform: 'APP-HARMONY' });
  await h.join(); h.complete();
  h.api.meetingMediaSetMic(true);
  assert.ok(h.operations.includes('unmute'));
  assert.equal(h.api.meetingMediaState().micOn, false);
  h.media({ mic: true, shared: true }); h.api.meetingMediaReconcile();
  assert.equal(h.api.meetingMediaState().micOn, true);
  assert.equal(h.api.meetingMediaState().visualMedia, true);
});

test('鸿蒙整屏共享交给原生释放，业务层停止时不重复释放', async () => {
  const h = harness({ platform: 'APP-HARMONY' });
  await h.join(); h.complete();
  assert.equal(await h.api.meetingMediaStartScreenShare('other', '共享整个屏幕', '取消'), false);
  assert.equal(h.claims(), 0);
  assert.equal(await h.api.meetingMediaStartScreenShare('123456789', '共享整个屏幕', '取消'), true);
  assert.equal(h.claims(), 1);
  assert.ok(h.operations.includes('共享整个屏幕/取消'));
  h.media({ error: 'cancelled' }); h.api.meetingMediaReconcile();
  assert.ok(h.operations.includes('stopShare'));
  assert.equal(h.releases(), 0);
  h.api.meetingMediaReconcile();
  assert.equal(h.operations.filter(operation => operation === 'stopShare').length, 1);
});

test('鸿蒙 ArkWeb 无采屏能力时不申请服务端占位', async () => {
  const h = harness({ platform: 'APP-HARMONY', screenSupported: false });
  await h.join(); h.complete();
  assert.equal(await h.api.meetingMediaStartScreenShare('123456789', '共享整个屏幕', '取消'), false);
  assert.equal(h.claims(), 0);
});


test('鸿蒙原生未接管共享时，业务层归还已申请的席位', async () => {
  const h = harness({ platform: 'APP-HARMONY', nativeShareAccepted: false });
  await h.join(); h.complete();
  assert.equal(await h.api.meetingMediaStartScreenShare('123456789', '共享整个屏幕', '取消'), false);
  assert.equal(h.claims(), 1);
  assert.equal(h.releases(), 1);
});

test('鸿蒙释放尚在途中时不重新申请同席位共享', async () => {
  const h = harness({ platform: 'APP-HARMONY', nativeShareStopping: true });
  await h.join(); h.complete();
  assert.equal(await h.api.meetingMediaStartScreenShare('123456789', '共享整个屏幕', '取消'), false);
  assert.equal(h.claims(), 0);
});

test('鸿蒙离会后迟到的共享占用由业务层归还，不唤起采集', async () => {
  let grant;
  const h = harness({ platform: 'APP-HARMONY', claimResult: () => new Promise(resolve => { grant = resolve; }) });
  await h.join(); h.complete();
  const start = h.api.meetingMediaStartScreenShare('123456789', '共享整个屏幕', '取消');
  assert.equal(h.claims(), 1);
  await h.api.meetingMediaDisconnect();
  assert.equal(h.releases(), 0);
  grant({ code: '0' });
  assert.equal(await start, false);
  assert.equal(h.releases(), 1);
  assert.equal(h.operations.includes('共享整个屏幕/取消'), false);
});

test('会议共享请求使用鸿蒙席位，保持 Android 和 iOS 请求形状', async () => {
  const source = readFileSync(new URL('../servers/imMeeting.uts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function apiImMeetingTakeShareHolder(');
  const end = source.indexOf('\n}', start) + 2;
  for (const platform of ['harmonyos', 'android', 'ios']) {
    let sent;
    const part = source.slice(start, end).replace('export ', '');
    const context = vm.createContext({
      MEETING_RTC_BASE: '/meetings/rtc', enc: encodeURIComponent,
      request: async options => { sent = options; },
    });
    vm.runInContext(stripTypeScriptTypes(part), context);
    await context.apiImMeetingTakeShareHolder('123456789', platform);
    assert.equal(sent.url, '/meetings/rtc/rooms/123456789/share-holder');
    assert.equal(sent.method, 'POST');
    assert.equal(sent.data?.platform, platform);
  }
});


test('鸿蒙点击系统通知时复用当前会议并等待回到前台', async () => {
  const h = harness({ platform: 'APP-HARMONY' });
  const resume = '/subpackages/pages/im-meeting/im-meeting-room?room=123456789';
  h.api.meetingMediaSetResumeURL(resume);
  await h.join(); h.complete();
  h.api.meetingMediaSetAppForeground(false);
  h.requestRestore();
  h.api.meetingMediaReconcile();
  assert.deepEqual(h.navigations, []);
  h.api.meetingMediaSetAppForeground(true);
  h.api.meetingMediaReconcile();
  assert.deepEqual(h.navigations, [resume]);
  assert.deepEqual(h.operations, ['connect']);
});

test('鸿蒙单聊来电优先，通知返回请求不会在挂断后跳到旧会议页', async () => {
  const h = harness({ platform: 'APP-HARMONY' });
  h.api.meetingMediaSetResumeURL('/subpackages/pages/im-meeting/im-meeting-room?room=123456789');
  await h.join(); h.complete();
  h.pageReady(false);
  h.requestRestore();
  h.api.meetingMediaReconcile();
  h.voipActive(true);
  h.pageReady(true);
  h.api.meetingMediaReconcile();
  h.voipActive(false);
  h.api.meetingMediaReconcile();
  assert.deepEqual(h.navigations, []);
});

test('鸿蒙会议在原生单聊占用通话路由时不切换扬声器', async () => {
  const h = harness({ platform: 'APP-HARMONY' });
  await h.join();
  h.complete();
  h.voipActive(true);
  h.api.meetingMediaSetSpeaker(false);
  assert.equal(h.operations.includes('earpiece'), false);
  h.voipActive(false);
  h.api.meetingMediaSetSpeaker(false);
  assert.equal(h.operations.at(-1), 'earpiece');
});

test('鸿蒙原生单聊占用设备期间会议只能关闭本地麦克风和摄像头', async () => {
  const h = harness({ platform: 'APP-HARMONY' });
  await h.join();
  h.complete();
  h.voipActive(true);
  h.api.meetingMediaSetMic(true);
  h.api.meetingMediaSetCamera(true);
  h.api.meetingMediaSwitchCamera();
  h.api.meetingMediaSetMic(false);
  h.api.meetingMediaSetCamera(false);
  assert.deepEqual(h.operations, ['connect', 'mute', 'cameraOff']);

  h.voipActive(false);
  h.api.meetingMediaSetMic(true);
  h.api.meetingMediaSetCamera(true);
  h.api.meetingMediaSwitchCamera();
  assert.deepEqual(h.operations.slice(-3), ['unmute', 'cameraOn', 'flipCamera']);
});

test('鸿蒙提前入会时媒体舞台已挂载，收到进行中详情时不重建', async () => {
  const page = readFileSync(new URL('../subpackages/pages/im-meeting/im-meeting-room.uvue', import.meta.url), 'utf8');
  const markup = page.match(/<native-view v-if="mediaSupported && meetingStageEnabled"[^>]+@init="handleHarmonyStageInit"/s);
  assert.ok(markup);
  const stageStart = page.indexOf('const meetingStageEnabled = computed(');
  assert.notEqual(stageStart, -1);
  const stage = page.slice(stageStart, page.indexOf(';', stageStart) + 1);
  const context = vm.createContext({
    computed: get => get, roomRaw: { value: '123456789' }, status: { value: 0 },
    mediaConnecting: { value: false }, mediaConnected: { value: false },
  });
  vm.runInContext(stripTypeScriptTypes(stage) + '\nglobalThis.stage = meetingStageEnabled;', context);
  assert.equal(context.stage(), true);
  const h = harness({ platform: 'APP-HARMONY', preData: { active: false, status: 0, allowEarlyJoin: true } });
  await h.join();
  assert.deepEqual(h.operations, ['connect']);
  h.complete();
  context.mediaConnected.value = h.api.meetingMediaState().connected;
  context.status.value = 1;
  assert.equal(context.stage(), true);
  context.status.value = 2;
  context.mediaConnected.value = false;
  assert.equal(context.stage(), false);
});

test('鸿蒙未开放提前入会时，预检会阻止媒体连接', async () => {
  const h = harness({ platform: 'APP-HARMONY', preData: { active: false, status: 0, allowEarlyJoin: false } });
  assert.equal(await h.join(), false);
  assert.equal(h.api.meetingMediaState().errorText, 'notStarted');
  assert.deepEqual(h.operations, []);
});


test('鸿蒙最后一位参会者只在退席确认后请求结束空房', async () => {
  const room = '123456789';
  for (const [left, rejoined, expected] of [[true, false, [room]], [false, false, []], [true, true, []]]) {
    let finishLeave;
    const deleted = [];
    const context = vm.createContext({
      meetingMediaDisconnect: () => new Promise(resolve => { finishLeave = resolve; }),
      meetingMediaActiveRoom: () => rejoined ? room : '',
      apiImMeetingDeleteRoom: async room => { deleted.push(room); },
    });
    vm.runInContext(stripTypeScriptTypes(pageFunctions(['deleteRoomAfterLeaving'], 'APP-HARMONY')), context);
    const result = context.deleteRoomAfterLeaving(room);
    assert.deepEqual(deleted, []);
    finishLeave(left);
    await result;
    assert.deepEqual(deleted, expected);
  }
});

test('鸿蒙媒体舞台在卡片内承载成员状态且不再重复渲染横向名单', () => {
  const page = readFileSync(new URL('../subpackages/pages/im-meeting/im-meeting-room.uvue', import.meta.url), 'utf8');
  assert.equal(page.includes('mr-harmony-roster'), false);
  const start = page.indexOf('const harmonyStagePresentation = computed(');
  const presentation = page.slice(start, page.indexOf('// #endif', start));
  for (const field of ['micOn:', 'handRaised:', 'hostLabel:', 'recording:']) {
    assert.equal(presentation.includes(field), true);
  }
});

test('iOS 会议音频按钮以原生启麦和路由的实际结果为准', async () => {
  const h = harness();
  await h.join();
  h.complete();
  assert.equal(h.api.meetingMediaState().micOn, false);
  assert.equal(h.api.meetingMediaState().speakerOn, true);
  h.api.meetingMediaSetMic(true);
  h.api.meetingMediaSetSpeaker(false);
  assert.deepEqual(h.operations.slice(-2), ['mic:true', 'speaker:false']);
  assert.equal(h.api.meetingMediaState().micOn, false);
  assert.equal(h.api.meetingMediaState().speakerOn, true);
  h.nativeAudio(true, false);
  h.api.meetingMediaReconcile();
  assert.equal(h.api.meetingMediaState().micOn, true);
  assert.equal(h.api.meetingMediaState().speakerOn, false);
});
