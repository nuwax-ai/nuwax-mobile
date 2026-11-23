import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

// 执行业务状态机，原生桥和网络为桩；不调用 HBuilderX/设备或真实接口。
function harness({ platform = 'APP-IOS', configThrows = false, coreThrows = false } = {}) {
  const raw = readFileSync(new URL('../utils/meeting/meetingMedia.uts', import.meta.url), 'utf8');
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
  const source = lines.join('\n').replace(/^import[\s\S]*?;\s*$/gm, '');
  const timers = new Map(), logs = [], operations = [], presentations = [], navigations = [];
  let restoreRequested = false;
  let nextTimer = 0, connected = false, configured = false, claims = 0;
  const globals = {
    console: { error: value => logs.push(String(value)) },
    SUCCESS_CODE: '0', eventBus: { emit() {} },
    apiImMeetingPublicRoomSafe: async () => ({ code: '0', data: { active: true } }),
    apiImMeetingIssueToken: async () => ({ code: '0', data: { wsUrl: 'wss://rtc.test', token: 'secret-seat-token' } }),
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
    livekitLastError: () => '', livekitParticipantCount: () => connected ? 1 : 0,
    livekitConfigureBackgroundSession(endpoint, token) {
      assert.equal(connected, true, '不能在原生连接成功前配置后台能力');
      assert.equal(token, 'secret-seat-token');
      operations.push('configure');
      if (configThrows) throw new Error('missing bridge method: secret-seat-token');
      configured = true;
    },
    livekitIsScreenShareOn: () => false, livekitScreenShareError: () => '',
    livekitIsScreenShareStopping: () => {
      if (configThrows) throw new Error('旧基座不能调用新增导出');
      return false;
    },
    livekitRequestScreenShare() { if (!configThrows) assert.equal(configured, true); operations.push('share'); },
    apiImMeetingTakeShareHolder: async () => { claims++; return { code: '0' }; },
    livekitDisconnect: () => { connected = false; operations.push('disconnect'); },
    livekitSendMeetingMessage: () => operations.push('chat'),
    livekitSetHandRaised: on => operations.push(on ? 'raise' : 'lower'),
    livekitStopScreenShare: () => operations.push('stopShare'),
    apiImMeetingGuestReleaseShareHolder: async () => ({ code: '0' }),
    livekitSetMeetingPresentation(visible, foreground) {
      if (configThrows) throw new Error('旧基座没有自动小窗');
      presentations.push({ visible, foreground });
    },
    livekitConsumeMeetingRestoreRequest() { const value = restoreRequested; restoreRequested = false; return value; },
    getCurrentPages: () => [{ route: 'pages/tab-shell/tab-shell' }],
    uni: { navigateTo(options) { navigations.push(options.url); options.complete?.({}); } },
    setInterval(callback) { timers.set(++nextTimer, callback); return nextTimer; },
    clearInterval(id) { timers.delete(id); },
  };
  const context = vm.createContext(globals);
  vm.runInContext(stripTypeScriptTypes(source).replace(/^export /gm, ''), context);
  return {
    api: context, operations, logs, presentations, navigations,
    join: () => context.meetingMediaConnect({ room: '123456789', displayName: 'Test', passcode: '' }),
    complete() { connected = true; for (const callback of [...timers.values()]) callback(); },
    claims: () => claims,
    staleFailure() {
      vm.runInContext('state.connected = false; state.connecting = false; state.errorText = "exception";', context);
    },
    nativeConnected(value) { connected = value; },
    requestRestore() { restoreRequested = true; },
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

function pageFunctions(names) {
  const source = readFileSync(new URL('../subpackages/pages/im-meeting/im-meeting-room.uvue', import.meta.url), 'utf8');
  return names.map(name => {
    const start = source.indexOf(`  function ${name}(`);
    assert.notEqual(start, -1);
    const end = source.indexOf('\n  }', start);
    return source.slice(start, end + 4);
  }).join('\n');
}

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
