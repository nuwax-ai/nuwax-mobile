import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

// 执行真实 UTS 业务逻辑，网络/播放器/生命周期为桩；不启动 HX 或调用设备。
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const helperSource = read('utils/meeting/meetingReplay.uts');
function executable(source, platform = 'APP') {
  const active = [true], lines = [];
  for (const line of source.split('\n')) {
    const condition = line.match(/^\s*\/\/ #(ifdef|ifndef) (.+)$/);
    if (condition) {
      const matches = condition[2].split('||').map(s => s.trim()).includes(platform);
      active.push(active.at(-1) && (condition[1] === 'ifdef' ? matches : !matches));
    } else if (/^\s*\/\/ #endif/.test(line)) active.pop();
    else if (active.at(-1)) lines.push(line);
  }
  return stripTypeScriptTypes(lines.join('\n').replace(/^\s*import[^;]+;\s*$/gm, '')).replace(/^export /gm, '');
}
const helper = vm.createContext({});
vm.runInContext(executable(helperSource), helper);
const file = (id, name, contentType = '') => ({ id, name, contentType,
  isVideo: helper.meetingReplayKind(name, contentType) === 'video', status: 2 });
const ids = list => Array.from(helper.visibleMeetingReplayFiles(list), f => f.id);

test('原录像保留，隐藏转写音频与历史同名派生音频', () => {
  assert.deepEqual(ids([file('v', '录制/会议.mp4'), file('a', '录制/会议-音频.m4a', 'audio/mp4'),
    file('old', '会议.m4a'), file('v2', '会议2.MP4'), file('a2', '会议2-音频.m4a')]), ['v', 'v2']);
});
test('保留独立纯音频会议；仅剩派生音频时不把回放列表清空', () => {
  assert.deepEqual(ids([file('a', '录音.ogg', 'audio/ogg')]), ['a']);
  assert.deepEqual(ids([file('a', '会议-音频.m4a', 'audio/mp4')]), ['a']);
  assert.deepEqual(ids([]), []);
});
test('MIME 优先于扩展名，且 Windows 对象路径也能配对', () => {
  assert.equal(helper.meetingReplayKind('audio.mp4', 'audio/mp4'), 'audio');
  assert.equal(helper.meetingReplayKind('no-extension', 'video/mp4'), 'video');
  assert.deepEqual(ids([file('v', 'folder\\test.mp4'), file('a', 'test.m4a')]), ['v']);
});
test('播放/下载分开取签名，不把参会人的播放地址用作下载地址', () => {
  const signed = 'https://storage.test/录制.mp4?X-Signature=a%2Fb%2B&name=x%252Fy';
  assert.equal(helper.meetingReplaySignedUrl({ playUrl: signed, url: 'download' }, false), signed);
  assert.equal(helper.meetingReplaySignedUrl({ playUrl: signed, downloadUrl: 'download' }, true), 'download');
  assert.equal(helper.meetingReplaySignedUrl({ playUrl: signed }, true), '');
  assert.equal(helper.meetingReplaySignedUrl({ url: signed }, false), signed);
});
test('导航只携带业务 ID 和定位秒数，不携带签名 URL', () => {
  assert.equal(helper.meetingReplayVideoRoute('123', '456', 12.9),
    '/subpackages/pages/im-meeting/im-meeting-replay?id=123&fileId=456&seek=12');
  assert.match(helper.meetingReplayVideoRoute('1&other=2', '3/4', -1), /id=1%26other%3D2&fileId=3%2F4&seek=0$/);
});

const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function pageHarness(kind = 'replay') {
  const page = read('subpackages/pages/im-meeting/im-meeting-' + kind + '.uvue');
  const script = page.match(/<script setup lang="uts">([\s\S]*?)<\/script>/)[1];
  const hooks = {}, timers = new Map(), requests = [], downloads = [], saved = [], navigations = [], toasts = [];
  let timerId = 0, pauses = 0, plays = 0, albumFail = false;
  const seeks = [];
  const context = vm.createContext({
    console: { error() {} },
    ref: value => ({ value }), computed: fn => ({ get value() { return fn(); } }),
    nextTick: fn => Promise.resolve().then(fn),
    SUCCESS_CODE: '0', apiResCode: r => r.code, apiResData: r => r.data, apiResMessage: r => r.message ?? '',
    translateFn: key => key, emptyI18nParams: () => ({}), toI18nParams: value => value,
    formatMeetingId: value => value, meetingDisplayTitle: (title, room) => title || room,
    setCurrentPageNavigationBarTitle() {},
    apiImMeetingRecordFileUrl: (...args) => new Promise((resolve, reject) => requests.push({ args, resolve, reject })),
    saveVideoToAlbumInApp: async url => { saved.push(url); if (albumFail) throw new Error('denied'); },
    uni: {
      getElementById: () => ({ pause() { pauses++; }, play() { plays++; }, seek(value) { seeks.push(value); } }),
      showToast: value => toasts.push(value), navigateTo: value => navigations.push(value.url),
      // 回放页不再下载整段文件；保留桩以便断言"从未下载"。
      downloadFile(options) { downloads.push({ options }); return { abort() {} }; },
      createInnerAudioContext() { throw new Error('视频不能创建音频播放器'); },
    },
    onLoad: fn => { hooks.load = fn; }, onReady: fn => { hooks.ready = fn; },
    onShow: fn => { hooks.show = fn; }, onHide: fn => { hooks.hide = fn; }, onUnload: fn => { hooks.unload = fn; },
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout: id => timers.delete(id), setInterval: () => 1, clearInterval() {},
  });
  vm.runInContext(executable(helperSource) + '\nconst DetailFile = MeetingReplayFile;\n' + executable(script), context);
  const evaluate = expression => vm.runInContext(expression, context);
  return {
    context, hooks, timers, requests, downloads, saved, navigations, toasts, evaluate, seeks,
    get: name => evaluate(name + '.value'), pauses: () => pauses, plays: () => plays,
    denyAlbum: () => { albumFail = true; },
    start: options => { hooks.load(options ?? { id: 'meeting-1', fileId: 'file-1', seek: '15' }); hooks.ready?.(); },
    respond: (index = 0, data = { playUrl: 'https://storage.test/play?sig=a%2Fb' }) => requests[index].resolve({ code: '0', data }),
    event: (name, detail = {}, attempt = evaluate('attemptId.value')) =>
      // 原生媒体事件不保证提供 currentTarget/dataset；轮次来自模板闭包。
      context[name](attempt, { detail }),
    expire() { const [id, item] = timers.entries().next().value; timers.delete(id); item.fn(); },
  };
}

test('进入时现签并静音预播，时间推进后只暂停保留画面并结束加载', async () => {
  const h = pageHarness(); h.start(); h.respond(); await tick();
  assert.deepEqual(h.requests[0].args, ['meeting-1', 'file-1', false]);
  assert.equal(h.get('initialTime'), 15);
  assert.equal(h.get('src'), 'https://storage.test/play?sig=a%2Fb');
  assert.equal(h.get('loading'), true);
  assert.equal(h.plays(), 1); assert.equal(h.get('preparingPreview'), true);
  h.event('handlePlay');
  assert.equal(h.get('loading'), true);
  h.event('handleTimeUpdate', { currentTime: 15 });
  assert.equal(h.get('loading'), true);
  h.event('handleTimeUpdate', { currentTime: 15.25 });
  assert.equal(h.get('loading'), false); assert.equal(h.timers.size, 0);
  assert.equal(h.get('preparingPreview'), false); assert.equal(h.pauses(), 1);
  assert.deepEqual(h.seeks, []); assert.equal(h.evaluate('currentTime'), 15.25);
});
test('播放器始终绑定播放地址，并按每轮实例绑定媒体事件', () => {
  const page = read('subpackages/pages/im-meeting/im-meeting-replay.uvue');
  const video = page.match(/<video\b[\s\S]*?\/>/)[0];
  assert.match(video, /:src="src"/);
  assert.match(video, /:muted="preparingPreview"/);
  assert.match(video, /:controls="!preparingPreview"/);
  assert.match(video, /v-for="videoAttempt in playerAttempts"/);
  assert.match(video, /@play="handlePlay\(videoAttempt\)"/);
  assert.match(video, /@timeupdate="handleTimeUpdate\(videoAttempt, \$event\)"/);
  assert.match(page, /\.replay-status\s*\{[^}]*position:\s*absolute/);
});
test('首帧就绪后保留同一视频和画面，等待点击不 seek、不重建或下载', async () => {
  const h = pageHarness(); h.start({ id: 'm', fileId: 'v' }); h.respond(); await tick();
  const attempt = h.get('attemptId'), source = h.get('src');
  const playerAttempts = h.get('playerAttempts');
  assert.equal(h.plays(), 1);
  h.event('handlePlay'); h.event('handlePause'); h.event('handleTimeUpdate', { currentTime: 0 });
  // 只有一个首帧兜底计时器，没有播放缓冲/缓存下载计时器。
  assert.equal(h.get('loading'), true); assert.equal(h.timers.size, 1);
  h.event('handleTimeUpdate', { currentTime: 0.25 });
  assert.deepEqual(h.seeks, []); assert.equal(h.get('loading'), false);
  h.event('handlePause'); h.event('handleWaiting'); h.event('handleTimeUpdate', { currentTime: 0.25 });
  await tick();
  assert.equal(h.get('loading'), false); assert.equal(h.timers.size, 0);
  assert.equal(h.requests.length, 1); assert.equal(h.downloads.length, 0);
  assert.equal(h.get('src'), source); assert.equal(h.get('attemptId'), attempt);
  assert.equal(h.get('playerAttempts'), playerAttempts); assert.equal(h.plays(), 1);
  assert.deepEqual(h.seeks, []);
  h.event('handlePlay');
  assert.equal(h.evaluate('playing'), true); assert.equal(h.get('preparingPreview'), false);
  // 点击播放从预览停下的位置直接续播：不回跳、不重新定位。
  assert.deepEqual(h.seeks, []); assert.equal(h.evaluate('currentTime'), 0.25);
  h.event('handleTimeUpdate', { currentTime: 8 }); h.event('handlePause'); h.event('handlePlay');
  assert.deepEqual(h.seeks, []); assert.equal(h.evaluate('currentTime'), 8);
});
test('转写位置预览保持画面，点击播放从预览位置续播不跳回指定位置', async () => {
  const h = pageHarness(); h.start(); h.respond(); await tick();
  h.event('handleTimeUpdate', { currentTime: 15.25 });
  assert.deepEqual(h.seeks, []);
  h.hooks.hide(); h.hooks.show(); await tick();
  assert.deepEqual(h.seeks, []);
  h.event('handlePlay'); assert.deepEqual(h.seeks, []);
  assert.equal(h.evaluate('currentTime'), 15.25); assert.equal(h.evaluate('playing'), true);
  assert.equal(h.evaluate('previewHeld'), false);
  h.event('handleTimeUpdate', { currentTime: 25 }); h.event('handlePause'); h.event('handlePlay');
  assert.deepEqual(h.seeks, []); assert.equal(h.evaluate('currentTime'), 25);
});
test('预览没落在转写起点时首次点击播放才定位一次，之后拖动回看不被拉回', async () => {
  const h = pageHarness(); h.start(); h.respond(); await tick();
  // 模拟平台没按 initial-time 起播：预览从 0 开始。
  h.event('handleTimeUpdate', { currentTime: 0.25 });
  assert.equal(h.get('preparingPreview'), false);
  h.event('handlePlay');
  assert.deepEqual(h.seeks, [15]); assert.equal(h.evaluate('currentTime'), 15);
  // 用户拖回 5 秒暂停后再播，不应再次被拉回转写秒数。
  h.event('handleTimeUpdate', { currentTime: 5 }); h.event('handlePause'); h.event('handlePlay');
  assert.deepEqual(h.seeks, [15]); assert.equal(h.evaluate('currentTime'), 5);
});
test('首次启动未生效时在原生 waiting 后补启动，收到 play 后不重复触发', async () => {
  const h = pageHarness(); h.start(); h.respond(); await tick();
  h.event('handleWaiting'); await tick(); assert.equal(h.plays(), 2);
  h.event('handlePlay'); h.event('handleWaiting'); await tick(); assert.equal(h.plays(), 2);
});
test('极短视频提前 ended 时回到起点并暂停，点击播放从头继续', async () => {
  const h = pageHarness(); h.start({ id: 'm', fileId: 'v' }); h.respond(); await tick();
  const pauses = h.pauses();
  h.event('handleEnded');
  assert.equal(h.get('preparingPreview'), false); assert.equal(h.get('loading'), false);
  assert.deepEqual(h.seeks, [0]); assert.equal(h.evaluate('currentTime'), 0);
  assert.equal(h.evaluate('playing'), false); assert.equal(h.pauses(), pauses + 1);
  assert.equal(h.timers.size, 0);
  h.event('handlePlay');
  assert.deepEqual(h.seeks, [0]); assert.equal(h.evaluate('playing'), true);
});
test('播放结束后回到视频起点并暂停，点击播放从头继续', async () => {
  const h = pageHarness(); h.start(); h.respond(); await tick();
  h.event('handleTimeUpdate', { currentTime: 15.25 }); h.event('handlePlay');
  h.event('handleTimeUpdate', { currentTime: 600 });
  const pauses = h.pauses();
  h.event('handleEnded');
  assert.deepEqual(h.seeks, [0]); assert.equal(h.evaluate('currentTime'), 0);
  assert.equal(h.evaluate('playing'), false); assert.equal(h.pauses(), pauses + 1);
  assert.equal(h.get('loading'), false); assert.equal(h.timers.size, 0);
  h.event('handlePlay');
  assert.deepEqual(h.seeks, [0]); assert.equal(h.evaluate('playing'), true);
});
test('换源后旧首帧事件不能暂停新播放器或清除新一轮加载', async () => {
  const h = pageHarness(); h.start(); h.respond(); await tick(); const old = h.get('attemptId');
  h.context.retry(); h.respond(1); await tick(); const pauses = h.pauses();
  h.event('handleTimeUpdate', { currentTime: 15.25 }, old); h.event('handleEnded', {}, old);
  assert.equal(h.get('preparingPreview'), true); assert.equal(h.get('loading'), true);
  assert.equal(h.pauses(), pauses); assert.deepEqual(h.seeks, []);
  h.event('handleTimeUpdate', { currentTime: 15.25 }); assert.equal(h.get('loading'), false);
});
test('首帧尚未准备好时退后台会取消预播，返回重新准备；就绪后保持暂停', async () => {
  const h = pageHarness(); h.start(); h.respond(); await tick(); const old = h.get('attemptId');
  h.hooks.hide(); h.hooks.show(); assert.equal(h.requests.length, 2);
  h.respond(1); await tick(); h.event('handleTimeUpdate', { currentTime: 15.25 }, old);
  assert.equal(h.get('loading'), true);
  h.event('handleTimeUpdate', { currentTime: 15.25 }); const plays = h.plays();
  h.hooks.hide(); h.hooks.show(); await tick();
  assert.equal(h.get('loading'), false); assert.equal(h.plays(), plays);
  assert.equal(h.requests.length, 2); assert.equal(h.timers.size, 0);
});
test('组件挂载前离页，排队的预播不能在后台或销毁后启动', async () => {
  for (const hook of ['hide', 'unload']) {
    const h = pageHarness(); h.start(); h.respond(); h.hooks[hook](); await tick();
    assert.equal(h.plays(), 0); assert.equal(h.timers.size, 0);
  }
});
test('播放中真实缓冲才重新显示加载，恢复播放或进度后及时清除', async () => {
  const h = pageHarness(); h.start(); h.respond(); await tick();
  h.event('handleTimeUpdate', { currentTime: 15.25 }); h.event('handlePlay');
  h.event('handleWaiting'); assert.equal(h.get('loading'), true);
  h.event('handlePlay'); assert.equal(h.get('loading'), false);
  h.event('handleWaiting'); h.event('handleTimeUpdate', { currentTime: 16 });
  assert.equal(h.get('loading'), false);
});
test('在线播放报错给出错误与重试，重试重新签名且不缓存本地', async () => {
  const h = pageHarness(); h.start(); h.respond(); await tick();
  h.event('handleVideoError');
  assert.equal(h.get('loading'), false); assert.equal(h.get('src'), '');
  assert.equal(h.get('errorText'), 'Mobile.Message.videoPlayFailed');
  assert.deepEqual(h.get('playerAttempts'), []); assert.equal(h.downloads.length, 0);
  h.context.retry(); assert.equal(h.requests.length, 2);
  h.respond(1, { playUrl: 'https://storage.test/fresh' }); await tick();
  assert.equal(h.get('src'), 'https://storage.test/fresh'); assert.equal(h.get('errorText'), '');
});
test('取地址超时显示可重试状态，重试重新请求', async () => {
  const h = pageHarness(); h.start(); h.expire();
  assert.equal(h.get('errorText'), 'Mobile.Meeting.replayLoadTimeout');
  assert.equal(h.get('loading'), false); assert.equal(h.timers.size, 0);
  h.context.retry(); assert.equal(h.requests.length, 2);
});
test('签名请求超时后，迟到结果不能替换重试结果', async () => {
  const h = pageHarness(); h.start(); h.expire();
  assert.equal(h.get('loading'), false); h.context.retry();
  h.respond(1, { playUrl: 'fresh' }); await tick(); h.respond(0, { playUrl: 'stale' }); await tick();
  assert.equal(h.get('src'), 'fresh');
});
test('服务端拒绝/生成中均展示原因，网络失败不一直转圈', async () => {
  for (const response of [{ code: '403', message: '没有回放权限' },
    { code: '0', data: { reason: '录制仍在处理中' } }]) {
    const h = pageHarness(); h.start(); h.requests[0].resolve(response); await tick();
    assert.equal(h.get('loading'), false); assert.ok(h.get('errorText').length > 0);
    assert.equal(h.downloads.length, 0); assert.equal(h.timers.size, 0);
  }
  const h = pageHarness(); h.start(); h.requests[0].reject(new Error('offline')); await tick();
  assert.equal(h.get('loading'), false); assert.equal(h.timers.size, 0);
});
test('重试换源后旧播放器事件不污染新一轮加载', async () => {
  const h = pageHarness(); h.start(); h.respond(); await tick(); const old = h.get('attemptId');
  h.context.retry(); h.respond(1); await tick();
  h.event('handlePause', {}, old); h.event('handleVideoError', {}, old);
  h.event('handlePlay', {}, old); h.event('handleEnded', {}, old);
  assert.equal(h.get('loading'), true); assert.equal(h.get('errorText'), '');
  assert.equal(h.get('preparingPreview'), true); assert.deepEqual(h.seeks, []);
  h.event('handleTimeUpdate', { currentTime: 15.25 });
  assert.equal(h.get('loading'), false); assert.equal(h.get('preparingPreview'), false);
});
test('取地址途中离页，返回重新取地址；销毁后忽略回包', async () => {
  const h = pageHarness(); h.start(); h.hooks.hide(); h.hooks.show();
  assert.equal(h.requests.length, 2);
  h.hooks.unload(); h.respond(1); await tick();
  assert.equal(h.get('src'), ''); assert.equal(h.timers.size, 0);
});
test('已播放页面退后台会暂停，回来保持暂停不误判超时', async () => {
  const h = pageHarness(); h.start(); h.respond(); await tick(); h.event('handleTimeUpdate', { currentTime: 16 });
  h.hooks.hide(); h.hooks.show(); assert.equal(h.pauses(), 2); assert.equal(h.timers.size, 0);
  assert.equal(h.requests.length, 1); assert.equal(h.get('loading'), false);
});
test('组件未就绪时不启动预播，ready 后再启动', async () => {
  const h = pageHarness(); h.hooks.load({ id: '1', fileId: '2' }); h.respond(); await tick();
  assert.equal(h.plays(), 0); assert.equal(h.get('loading'), true);
  h.hooks.ready(); await tick(); assert.equal(h.plays(), 1);
});
test('首帧一直不出现时给出错误与重试，不无限停在无控制条的加载态', async () => {
  const h = pageHarness(); h.start(); h.respond(); await tick();
  assert.equal(h.get('preparingPreview'), true);
  h.expire();
  assert.equal(h.get('errorText'), 'Mobile.Meeting.replayLoadTimeout');
  assert.equal(h.get('loading'), false); assert.equal(h.timers.size, 0);
  h.context.retry(); assert.equal(h.requests.length, 2);
});
test('视频下载针对点击行，主持人权限与重复点击保护有效', async () => {
  const h = pageHarness('detail'); h.evaluate('meetingId.value = "m"; host.value = true; selectedFileId.value = "other";');
  const target = file('target', '会议.mp4'); const promise = h.context.handleDownload(target);
  await h.context.handleDownload(target); assert.equal(h.requests.length, 1);
  assert.deepEqual(h.requests[0].args, ['m', 'target', true]);
  h.respond(0, { playUrl: 'play', downloadUrl: 'download' }); await promise;
  assert.deepEqual(h.saved, ['download']); assert.equal(h.get('downloadBusy'), false);
  h.evaluate('host.value = false'); await h.context.handleDownload(target); assert.equal(h.requests.length, 1);
});
test('视频保存失败保留公共方法权限提示，离页后不开始保存', async () => {
  const h = pageHarness('detail'); h.evaluate('host.value = true'); h.denyAlbum();
  const p = h.context.handleDownload(file('v', 'video.mp4')); h.respond(0, { downloadUrl: 'download' }); await p;
  assert.equal(h.toasts.length, 0); assert.equal(h.get('downloadBusy'), false);
  const p2 = h.context.handleDownload(file('v', 'video.mp4')); h.hooks.unload();
  h.respond(1, { downloadUrl: 'new' }); await p2; assert.deepEqual(h.saved, ['download']);
});
test('MP4 行/播放按钮/转写定位都进入视频页，不走音频播放器', () => {
  const h = pageHarness('detail'); h.evaluate('meetingId.value = "m"; files.value = [{ id: "v", name: "video.mp4", isVideo: true, status: 2 }];');
  const target = file('v', 'video.mp4'); h.context.handleFileClick(target); h.context.handlePlayToggle();
  h.context.handleTranscriptClick({ fileId: 'v', beginMs: 12500 });
  assert.equal(h.navigations.length, 3); assert.match(h.navigations[2], /fileId=v&seek=12$/);
  h.evaluate('host.value = false; replayVisible.value = false'); h.context.handleFileClick(target);
  assert.equal(h.navigations.length, 3);
});
