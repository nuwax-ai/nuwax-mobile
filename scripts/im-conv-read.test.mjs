import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

function harness() {
  let session = 'a';
  const handlers = [];
  const context = vm.createContext({
    apiResData: r => r.data, getImSessionStamp: () => session,
    eventBus: { emit() { for (const fn of handlers) fn({}); } },
  });
  const raw = readFileSync(new URL('../utils/im/imConvReadLocal.uts', import.meta.url), 'utf8');
  vm.runInContext(stripTypeScriptTypes(raw.replace(/^import[^;]+;/gm, '')).replace(/^export /gm, ''), context);
  return { api: context, handlers, session: value => { session = value; },
    report: (data = {}, conv = 'conv-1') => context.noteConvReadFromReadReport(conv, { data: {
      advanced: true, unreadCleared: 2, readSeqAfter: 50, lastMsgSeq: 50, ...data,
    } }),
  };
}

for (const page of ['message/message-content', 'union-record/union-record-content']) {
  test(page + ': Android 返回列表后已读回包晚到，克隆换行立即清除角标', () => {
    const h = harness();
    const original = { convId: 'conv-1', unreadCount: 2, lastMsgSeq: 50 };
    const rows = { value: [original] };
    let refreshes = 0;
    const context = vm.createContext({
      ...h.api, messagePageDisposed: false, messagePageSession: 'a', getImSessionStamp: () => 'a',
      conversations: rows, findConvRowById: id => rows.value.find(r => r.convId === id) ?? null,
      cloneConvRow: row => ({ ...row }), convRevision: 0, scheduleConvRefresh: () => refreshes++,
    });
    const raw = readFileSync(new URL('../pages/' + page + '.uvue', import.meta.url), 'utf8');
    const start = raw.indexOf('  function applyPendingConvReadMark()');
    const end = raw.indexOf('  function handleImConvUpdated', start);
    vm.runInContext(stripTypeScriptTypes(raw.slice(start, end)), context);
    context.applyPendingConvReadMark(); // onShow 先发生，还没有回包。
    assert.equal(rows.value[0].unreadCount, 2);
    h.handlers.push(() => context.applyPendingConvReadMark());
    h.report();
    assert.equal(rows.value[0].unreadCount, 0);
    assert.notEqual(rows.value[0], original, 'Android 行组件需要新的对象身份');
    assert.equal(refreshes, 1);
    const staleRows = [{ convId: 'conv-1', unreadCount: 2, lastMsgSeq: 50 }];
    rows.value = staleRows; // 隐藏期消费了通知，返回前旧快照又覆盖该行。
    context.applyPendingConvReadMark(); // onShow 同步纠正，不等刷新请求。
    assert.equal(rows.value[0].unreadCount, 0);
    assert.notEqual(rows.value, staleRows, '列表属性也需新引用以触发原生子组件更新');
  });
}

test('iOS 先回包后返回仍正常；两个列表独立消费，多个会话不互相覆盖', () => {
  const h = harness(); h.report(); h.report({}, 'conv-2');
  assert.equal(h.api.consumeConvReadMark('message').convId, 'conv-1');
  assert.equal(h.api.consumeConvReadMark('message').convId, 'conv-2');
  assert.equal(h.api.consumeConvReadMark('message'), null);
  assert.equal(h.api.consumeConvReadMark('union').convId, 'conv-1');
  assert.equal(h.api.consumeConvReadMark('union').convId, 'conv-2');
});

test('重复报读 advanced=false 但服务端确认已清除，仍纠正残留角标', () => {
  const h = harness(); h.report({ advanced: false }); const mark = h.api.consumeConvReadMark();
  assert.equal(h.api.unreadAfterConvRead(mark, 2, 50), 0);
  assert.equal(h.api.unreadAfterConvRead(mark, 3, 51), 3, '后来新消息不得被旧回包清掉');
});

test('限流/降级不伪造清零，限流或 clamp 不推进到未确认的请求水位', () => {
  for (const data of [{ rateLimited: true }, { redisDegraded: true }]) {
    const h = harness(); h.report(data); assert.equal(h.api.consumeConvReadMark(), null);
  }
  const h = harness();
  assert.equal(h.api.confirmedConvReadSeq({ data: { rateLimited: true } }, 100), 0);
  assert.equal(h.api.confirmedConvReadSeq({ data: { readSeqAfter: 90, clamped: true } }, 100), 90);
});

test('切换账号不串未读标记', () => {
  const h = harness(); h.report(); h.session('b');
  assert.equal(h.api.consumeConvReadMark(), null); assert.equal(h.api.consumeConvReadMark('union'), null);
});


test('进入会话后立即清行角标，返回不等待已读接口，旧列表回包不能恢复红点', () => {
  const h = harness();
  h.api.noteConvViewedLocally('conv-1', 50);
  const mark = h.api.consumeConvReadMark();
  assert.equal(h.api.unreadAfterConvRead(mark, 2, 50), 0);
  assert.equal(h.api.unreadAfterLocalView('conv-1', 2, 50), 0);
  assert.equal(h.api.unreadAfterLocalView('conv-1', 1, 51), 1);
  assert.equal(h.api.unreadAfterLocalView('unopened', 2, 50), 2);
  h.report({ rateLimited: true });
  assert.equal(h.api.unreadAfterLocalView('conv-1', 2, 50), 0);
  assert.equal(h.api.confirmedConvReadSeq({ data: { rateLimited: true } }, 50), 0);
  h.session('b');
  assert.equal(h.api.unreadAfterLocalView('conv-1', 2, 50), 2);
});

for (const page of ['message/message-content', 'union-record/union-record-content']) {
  test(page + ': 已看会议邀请返回后，旧未读通知不能恢复角标，新消息仍有角标', () => {
    const h = harness();
    const rows = { value: [{ convId: 'conv-1', unreadCount: 0, lastMsgSeq: 50 }] };
    const context = vm.createContext({
      ...h.api, conversations: rows, messagePageVisible: true, convRevision: 0,
      convLoaded: { value: true }, isAppInBackground: () => false, scheduleConvRefresh() {},
      findConvRowById: id => rows.value.find(row => row.convId === id) ?? null,
      cloneConvRow: row => ({ ...row }), readString: (obj, key) => String(obj[key] ?? ''),
      readNumber: (obj, key, fallback) => Number(obj[key] ?? fallback),
    });
    const raw = readFileSync(new URL('../pages/' + page + '.uvue', import.meta.url), 'utf8');
    const start = raw.indexOf('  function handleImConvUnread(');
    const end = raw.indexOf('  /** 已读回包', start);
    vm.runInContext(stripTypeScriptTypes(raw.slice(start, end)), context);
    h.api.noteConvViewedLocally('conv-1', 50);
    context.handleImConvUnread({ convId: 'conv-1', unreadCount: 1, readSeq: 49, lastMsgSeq: 50 });
    assert.equal(rows.value[0].unreadCount, 0);
    context.handleImConvUnread({ convId: 'conv-1', unreadCount: 1, readSeq: 50, lastMsgSeq: 51 });
    assert.equal(rows.value[0].unreadCount, 1);
    assert.equal(rows.value[0].lastMsgSeq, 51);
    context.handleImConvUnread({ convId: 'conv-1', unreadCount: 0, readSeq: 50, lastMsgSeq: 50 });
    assert.equal(rows.value[0].unreadCount, 1, '旧的清零帧也不能清除后来消息');
  });
}

test('退页后服务端已读确认保留水位，队列已消费也不能被旧列表回包复活', () => {
  const h = harness();
  h.report(); h.api.consumeConvReadMark('message'); h.api.consumeConvReadMark('union');
  assert.equal(h.api.unreadAfterLocalView('conv-1', 2, 50), 0);
  assert.equal(h.api.unreadAfterLocalView('conv-1', 1, 51), 1);
});


test('只有会议邀请卡片的会话也立即报读；隐藏预加载不能清未读', () => {
  const h = harness();
  const raw = readFileSync(new URL('../pages/message/components/chat-view.uvue', import.meta.url), 'utf8');
  function source(start, end) { return raw.slice(raw.indexOf(start), raw.indexOf(end, raw.indexOf(start))); }
  let active = true;
  const context = vm.createContext({
    ...h.api, messages: { value: [{ msgType: 'meeting_invite', seq: 50 }] },
    convId: { value: 'conv-1' }, isChatActive: () => active,
    reportedReadSeq: 0, wantedReadSeq: 0, readReportRunning: false, readReportTimer: 0,
    pullEntryDialog: false, pageVisible: true, setTimeout: () => 1,
  });
  const code = source('  function maxSeq():', '  /** 本地未确认行') +
    source('  function reportReadIfNeeded(', '  // ===== 未读定位') +
    source('  function reportReadAuto()', '  /** 距底余量阈值');
  vm.runInContext(stripTypeScriptTypes(code), context);
  active = false;
  context.reportReadAuto();
  assert.equal(h.api.consumeConvReadMark(), null);
  active = true;
  context.reportReadAuto();
  assert.equal(h.api.consumeConvReadMark().readSeq, 50);
  assert.equal(context.wantedReadSeq, 50);
});
