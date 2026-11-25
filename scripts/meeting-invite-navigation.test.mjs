import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

function harness() {
  let background = false, ready = true, activeRoom = '', resumeCount = 0;
  const navigations = [], timers = new Map(), listeners = new Map();
  let timerID = 0;
  const context = vm.createContext({
    isAppInBackground: () => background,
    IM_SESSION_CLEARED: 'cleared', eventBus: { on: (name, fn) => listeners.set(name, fn) },
    meetingMediaActiveRoom: () => activeRoom, meetingMediaResume: () => resumeCount++,
    getCurrentPages: () => ready ? [{}] : [],
    uni: { navigateTo: options => navigations.push(options) },
    setInterval: fn => { timers.set(++timerID, fn); return timerID; },
    clearInterval: id => timers.delete(id),
  });
  const raw = readFileSync(new URL('../utils/meeting/meetingInviteNavigation.uts', import.meta.url), 'utf8');
  vm.runInContext(stripTypeScriptTypes(raw.replace(/^import[^;]+;/gm, '')).replace(/^export /gm, ''), context);
  return { api: context, navigations, timers,
    background: value => { background = value; }, ready: value => { ready = value; },
    activeRoom: value => { activeRoom = value; }, resumes: () => resumeCount,
    clearSession: () => listeners.get('cleared')({}),
    tick: () => { for (const fn of [...timers.values()]) fn(); },
    open: (id = 'invite-1') => context.openMeetingInvite(id, '123456789', '测试 & 会议', 'video', '12&34'),
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
  assert.equal(url.searchParams.get('video'), '1');
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

function meetingInviteReceiver(platform, nativeVoip = true) {
  let now = 1_000_000;
  let background = true;
  const listeners = new Map();
  const banner = { value: null };
  const context = vm.createContext({
    console: { error() {} },
    Date: { now: () => now },
    eventBus: { on: (name, fn) => listeners.set(name, fn), emit() {} },
    EVENT_TYPE: { ImMessageReceived: 'message', ImCustomEvent: 'custom' },
    isNativeImVoipEnabled: () => nativeVoip,
    isAppInBackground: () => background,
    getMyUserIdSync: () => 'callee',
    UTSJSONObject: class {},
    ref: () => banner,
  });
  const session = readFileSync(new URL('../utils/im/imCallSession.uts', import.meta.url), 'utf8')
    .replace(/^[ \t]*\/\/ #(ifdef|ifndef) APP-HARMONY\n([\s\S]*?)^[ \t]*\/\/ #endif$/gm,
      (_, condition, body) => (condition === 'ifdef') === (platform === 'APP-HARMONY') ? body : '');
  const bannerSource = readFileSync(new URL('../utils/im/meetingInviteBanner.uts', import.meta.url), 'utf8');
  for (const source of [bannerSource, session]) {
    vm.runInContext(stripTypeScriptTypes(source.replace(/^import[^;]+;/gm, '')).replace(/^export /gm, ''), context);
  }
  context.bindImCallEvents();
  return {
    banner,
    advance: elapsed => { now += elapsed; },
    foreground: () => { background = false; context.resumeHarmonyMeetingInvite?.(); },
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
