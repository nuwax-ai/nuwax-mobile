import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

function harness(platform = 'APP-IOS', origin = 'https://testagent.xspaceagi.com') {
  let background = false, ready = true, activeRoom = '', resumeCount = 0, voipBusy = false;
  let now = 1_000_000;
  const navigations = [], timers = new Map(), listeners = new Map();
  let timerID = 0;
  const context = vm.createContext({
    isAppInBackground: () => background,
    getApiBaseUrl: () => origin,
    TEST_PUSH_API_ORIGIN: 'https://testagent.xspaceagi.com',
    hasNativeVoipCall: () => voipBusy,
    Date: { now: () => now },
    IM_SESSION_CLEARED: 'cleared', eventBus: { on: (name, fn) => listeners.set(name, fn) },
    meetingMediaActiveRoom: () => activeRoom, meetingMediaResume: () => resumeCount++,
    getCurrentPages: () => ready ? [{}] : [],
    uni: { navigateTo: options => navigations.push(options) },
    setInterval: fn => { timers.set(++timerID, fn); return timerID; },
    clearInterval: id => timers.delete(id),
  });
  const raw = readFileSync(new URL('../utils/meeting/meetingInviteNavigation.uts', import.meta.url), 'utf8');
  vm.runInContext(stripTypeScriptTypes(preprocessHarmony(raw, platform).replace(/^import[^;]+;/gm, '')).replace(/^export /gm, ''), context);
  return { api: context, navigations, timers,
    background: value => { background = value; }, ready: value => { ready = value; },
    voipBusy: value => { voipBusy = value; }, advance: ms => { now += ms; }, now: () => now,
    activeRoom: value => { activeRoom = value; }, resumes: () => resumeCount,
    clearSession: () => listeners.get('cleared')({}),
    tick: () => { for (const fn of [...timers.values()]) fn(); },
    open: (id = 'invite-1', room = '123456789', expiry = 0) => context.openMeetingInvite(id, room, '测试 & 会议', '12&34', expiry),
    finish(success = true) { const n = navigations.at(-1); if (success) n.success({}); n.complete({}); },
  };
}

test('锁屏/后台接受邀请，等前台和页面就绪再入会，保留主题与密码', () => {
  const h = harness(); h.background(true); h.open(); h.tick();
  assert.equal(h.navigations.length, 0);
  h.background(false); h.ready(false); h.tick(); assert.equal(h.navigations.length, 0);
  h.ready(true); h.tick();
  assert.equal(h.navigations.length, 1);
  const url = new URL(h.navigations[0].url, 'https://app.test');
  assert.equal(url.pathname, '/subpackages/pages/im-meeting/im-meeting-room');
  assert.equal(url.searchParams.get('room'), '123456789');
  assert.equal(url.searchParams.get('title'), '测试 & 会议');
  assert.equal(url.searchParams.get('pc'), '12&34');
  // 邀请入会不再自动开麦/开摄像头：URL 不带 call/video。
  assert.equal(url.searchParams.get('call'), null);
  assert.equal(url.searchParams.get('video'), null);
  h.finish(); h.tick(); assert.equal(h.timers.size, 0);
});

test('重复事件与导航重试不能打开多个会议页面', () => {
  const h = harness(); h.open(); h.open(); h.tick(); assert.equal(h.navigations.length, 1);
  h.finish(false); h.tick(); assert.equal(h.navigations.length, 2);
  h.finish(); h.open(); h.tick(); assert.equal(h.navigations.length, 2);
});

test('退出/切换账号清除未完成入会，迟到回调不能消费新账号请求', () => {
  const h = harness(); h.open(); const old = h.navigations[0]; h.clearSession(); h.open('new-invite');
  old.success({}); old.complete({}); h.tick(); assert.equal(h.navigations.length, 2);
  h.finish(); h.tick(); assert.equal(h.navigations.length, 2);
  h.background(true); h.open('third-invite'); h.clearSession(); h.background(false); h.tick();
  assert.equal(h.navigations.length, 2);
});

test('同一会议已在进行时恢复原会议，不重新入会', () => {
  const h = harness(); h.activeRoom('123456789'); h.open();
  assert.equal(h.resumes(), 1); assert.equal(h.navigations.length, 0); assert.equal(h.timers.size, 0);
});

test('鸿蒙测试端保持首个接听请求，已在导航时不压入另一场会议', () => {
  const h = harness('APP-HARMONY');
  h.background(true);
  h.open('first', '111111111');
  h.open('second', '222222222');
  h.background(false);
  h.tick();
  assert.equal(h.navigations.length, 1);
  assert.match(h.navigations[0].url, /room=111111111/);
  h.navigations[0].success({});
  h.open('third', '333333333');
  assert.equal(h.navigations.length, 1);
  h.navigations[0].complete({});
});

test('鸿蒙锁屏接听后先让单聊来电处理，单聊结束仍在有效期内才入会', () => {
  const h = harness('APP-HARMONY');
  h.background(true);
  h.open('accepted', '123456789', h.now() + 60_000);
  h.voipBusy(true);
  h.background(false);
  h.tick();
  assert.equal(h.navigations.length, 0);
  h.voipBusy(false);
  h.advance(2000);
  h.tick();
  assert.equal(h.navigations.length, 1);
  assert.match(h.navigations[0].url, /room=123456789/);
});

test('鸿蒙不在解锁或单聊结束后恢复已过期的系统接听', () => {
  const h = harness('APP-HARMONY');
  h.background(true);
  h.open('accepted', '123456789', h.now() + 500);
  h.advance(500);
  h.tick();
  assert.equal(h.timers.size, 0);
  h.background(false);
  h.open('late-native-event', '123456789', h.now() - 1);
  h.tick();
  assert.equal(h.navigations.length, 0);
  h.open('fresh');
  assert.equal(h.navigations.length, 1);
});

test('鸿蒙生产入口仍沿用现有邀请导航行为', () => {
  const h = harness('APP-HARMONY', 'https://agent.nuwax.com');
  h.voipBusy(true);
  h.background(true);
  h.open('first', '111111111');
  h.open('second', '222222222');
  h.background(false);
  h.tick();
  assert.equal(h.navigations.length, 1);
  assert.match(h.navigations[0].url, /room=222222222/);
});

function preprocessHarmony(source, platform) {
  return source.replace(/^[ \t]*\/\/ #(ifdef|ifndef) APP-HARMONY\n([\s\S]*?)^[ \t]*\/\/ #endif$/gm,
    (_, condition, body) => (condition === 'ifdef') === (platform === 'APP-HARMONY') ? body : '');
}

function meetingNotificationClick(nativeVoip = true) {
  const timers = [];
  const opens = [], handled = [], dismissed = [], webViews = [];
  const appEntryStage = { value: 'entry' };
  let userId = '', stamp = 'session';
  const pushClient = readFileSync(new URL('../utils/im/imPushClient.uts', import.meta.url), 'utf8');
  const source = pushClient.slice(pushClient.indexOf('function openMeetingRoomWithRetry('), pushClient.indexOf('// #ifdef APP-ANDROID\n/** 上一次'));
  const context = vm.createContext({
    setTimeout: callback => timers.push(callback),
    getImSessionStamp: () => stamp,
    isLoggedIn: () => true,
    getMyUserIdSync: () => userId,
    getCurrentPages: () => [{ route: 'pages/tab-shell/tab-shell' }],
    appEntryStage, LAUNCH_PAGE_ROUTE: 'launch', LOGIN_PAGE_ROUTE: 'login',
    PUSH_CLICK_NAV_DELAY_MS: 300, PUSH_CLICK_NAV_MAX_RETRY: 2,
    isNativeImVoipEnabled: () => nativeVoip,
    meetingMediaSupported: () => true,
    getNativeMeetingInviteState: msgId => handled.includes(msgId) ? 'handled' : 'pending',
    markNativeMeetingInviteHandled: msgId => handled.push(msgId),
    hideHandledMeetingInviteBanner: (...args) => dismissed.push(args),
    openMeetingInvite: (...args) => opens.push(args),
    getApiBaseUrl: () => 'https://app.test',
    buildMeetingInviteUrl: (origin, room) => origin + '/meet/' + room,
    uni: { navigateTo: ({ url }) => webViews.push(url) },
  });
  vm.runInContext(stripTypeScriptTypes(preprocessHarmony(source, 'APP-HARMONY')), context);
  return {
    opens, handled, dismissed, webViews, appEntryStage,
    click: () => context.openMeetingRoomWithRetry('123', '会议', 'p&c', 0, stamp, 'invite', 'msg', 'callee'),
    loginAs: id => { userId = id; },
    switchSession: () => { stamp = 'new-session'; },
    tick: () => timers.shift()?.(),
  };
}

test('鸿蒙点会议通知等主界面和收件账号就绪，再交接原生入会且只处理一次', () => {
  const h = meetingNotificationClick();
  h.click();
  h.tick();
  h.appEntryStage.value = 'main';
  h.tick();
  assert.deepEqual(h.opens, []);
  h.loginAs('callee');
  h.tick();
  h.click();
  h.tick();
  assert.deepEqual(h.opens, [['invite', '123', '会议', 'p&c']]);
  assert.deepEqual(h.handled, ['msg']);
  assert.deepEqual(h.dismissed, [['msg', 'invite']]);
  assert.deepEqual(h.webViews, []);
});

test('鸿蒙会议通知拒绝其他账号和过时会话，常规入口保持 H5 处理', () => {
  for (const invalidate of [h => h.loginAs('other'), h => h.switchSession()]) {
    const h = meetingNotificationClick();
    h.click();
    h.tick();
    h.appEntryStage.value = 'main';
    invalidate(h);
    h.tick();
    assert.deepEqual(h.opens, []);
    assert.deepEqual(h.handled, []);
  }
  const h = meetingNotificationClick(false);
  h.appEntryStage.value = 'main';
  h.loginAs('callee');
  h.click();
  h.tick();
  assert.deepEqual(h.opens, []);
  assert.deepEqual(h.webViews, ['/subpackages/pages/webview/webview?url=https%3A%2F%2Fapp.test%2Fmeet%2F123']);
});

function meetingInviteReceiver(platform, nativeVoip = true) {
  let now = 1_000_000;
  let background = true;
  let nativeState = '';
  let nextTimeout = 0;
  const timeouts = new Map();
  const listeners = new Map();
  const banner = { value: null };
  const context = vm.createContext({
    console: { error() {} },
    Date: { now: () => now },
    eventBus: { on: (name, fn) => listeners.set(name, fn), emit() {} },
    EVENT_TYPE: { ImMessageReceived: 'message', ImCustomEvent: 'custom' },
    isNativeImVoipEnabled: () => nativeVoip,
    isAppInBackground: () => background,
    getNativeMeetingInviteState: () => nativeState,
    setTimeout(fn) { timeouts.set(++nextTimeout, fn); return nextTimeout; },
    clearTimeout: id => timeouts.delete(id),
    getMyUserIdSync: () => 'callee',
    UTSJSONObject: class {},
    ref: () => banner,
  });
  const session = preprocessHarmony(readFileSync(new URL('../utils/im/imCallSession.uts', import.meta.url), 'utf8'), platform);
  const bannerSource = readFileSync(new URL('../utils/im/meetingInviteBanner.uts', import.meta.url), 'utf8');
  for (const source of [bannerSource, session]) {
    vm.runInContext(stripTypeScriptTypes(source.replace(/^import[^;]+;/gm, '')).replace(/^export /gm, ''), context);
  }
  context.bindImCallEvents();
  return {
    banner, timeouts,
    nativeStatus: status => { nativeState = status; },
    tick() {
      const callbacks = [...timeouts.values()];
      timeouts.clear();
      for (const callback of callbacks) callback();
    },
    advance: elapsed => { now += elapsed; },
    foreground: () => { background = false; context.resumeHarmonyMeetingInvite?.(); },
    enterRoom: room => context.hideMeetingInviteBannerForRoom(room),
    invite: (inviteId = 'invite-1', offset = 0) => listeners.get('message')({
      msgType: 'meeting_invite', sendTime: now + offset, senderId: 'caller',
      convId: '245475557381246976', msgId: '9223372036854775807',
      body: { inviteId, roomName: '123456789', title: '会议', mediaType: 'video', passcode: '1234' },
    }),
    handled: () => listeners.get('custom')({
      eventType: 'meeting:invite-handled', payload: { msgId: '9223372036854775807' },
    }),
    clear: () => context.clearImCallSession(),
  };
}

test('鸿蒙测试环境的后台会议邀请回前台补展示，保留原邀请的过期时间', () => {
  const h = meetingInviteReceiver('APP-HARMONY');
  h.invite('newest');
  h.invite('older', -500);
  assert.equal(h.banner.value, null);
  h.advance(45_000);
  h.foreground();
  assert.equal(h.banner.value.inviteId, 'newest');
  assert.equal(h.banner.value.expiresAt, 1_060_000);
  assert.equal(h.banner.value.mediaType, 'video');
  assert.equal(h.banner.value.passcode, '1234');
});

test('鸿蒙后台过期、跨设备已处理和退出账号的邀请都不会在回前台时弹出', () => {
  for (const discard of [h => h.advance(60_000), h => h.handled(), h => h.clear()]) {
    const h = meetingInviteReceiver('APP-HARMONY');
    h.invite();
    discard(h);
    h.foreground();
    assert.equal(h.banner.value, null);
  }
});

test('iOS 和 Android 继续由原生处理后台会议来电，鸿蒙生产入口沿用现有行为', () => {
  for (const platform of ['APP-IOS', 'APP-ANDROID']) {
    const h = meetingInviteReceiver(platform);
    h.invite();
    h.foreground();
    assert.equal(h.banner.value, null);
  }
  const harmonyProduction = meetingInviteReceiver('APP-HARMONY', false);
  harmonyProduction.invite();
  assert.equal(harmonyProduction.banner.value.inviteId, 'invite-1');
  assert.equal(harmonyProduction.banner.value.expiresAt, undefined);
});

test('从聊天卡片/邀请链接进入同一场会议时收起邀请条，其它房间不受影响', () => {
  const h = meetingInviteReceiver('APP-HARMONY', false);
  h.invite();
  assert.equal(h.banner.value.inviteId, 'invite-1');
  h.enterRoom('987654321');
  assert.equal(h.banner.value.inviteId, 'invite-1');
  h.enterRoom('123456789');
  assert.equal(h.banner.value, null);
});


test('鸿蒙原生已接管会议邀请时不重复弹 WS 邀请条，原生失败后按原期限提示', () => {
  const h = meetingInviteReceiver('APP-HARMONY');
  h.invite();
  h.nativeStatus('pending');
  h.foreground();
  assert.equal(h.banner.value, null);
  assert.equal(h.timeouts.size, 1);
  h.tick();
  assert.equal(h.banner.value, null);
  h.nativeStatus('');
  h.advance(3500);
  h.tick();
  assert.equal(h.banner.value.inviteId, 'invite-1');
  assert.equal(h.banner.value.expiresAt, 1_060_000);
  assert.equal(h.timeouts.size, 0);
});

test('鸿蒙已处理、已过期或清除账号的原生会议邀请不会恢复 WS 弹层', () => {
  for (const discard of [
    h => h.nativeStatus('handled'),
    h => { h.handled(); assert.equal(h.timeouts.size, 0); },
    h => h.advance(60_000),
    h => { h.clear(); assert.equal(h.timeouts.size, 0); },
  ]) {
    const h = meetingInviteReceiver('APP-HARMONY');
    h.invite();
    h.nativeStatus('pending');
    h.foreground();
    discard(h);
    h.tick();
    assert.equal(h.banner.value, null);
    assert.equal(h.timeouts.size, 0);
  }
});
