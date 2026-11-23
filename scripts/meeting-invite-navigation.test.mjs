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
