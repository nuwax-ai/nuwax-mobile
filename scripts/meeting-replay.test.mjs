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
  let timerId = 0, pauses = 0, albumFail = false;
  const context = vm.createContext({
    console: { error() {} },
    ref: value => ({ value }), computed: fn => ({ get value() { return fn(); } }),
    SUCCESS_CODE: '0', apiResCode: r => r.code, apiResData: r => r.data, apiResMessage: r => r.message ?? '',
    translateFn: key => key, emptyI18nParams: () => ({}), toI18nParams: value => value,
    formatMeetingId: value => value, meetingDisplayTitle: (title, room) => title || room,
    setCurrentPageNavigationBarTitle() {},
    apiImMeetingRecordFileUrl: (...args) => new Promise((resolve, reject) => requests.push({ args, resolve, reject })),
    saveVideoToAlbumInApp: async url => { saved.push(url); if (albumFail) throw new Error('denied'); },
    uni: {
      getElementById: () => ({ pause() { pauses++; } }),
      showToast: value => toasts.push(value), navigateTo: value => navigations.push(value.url),
      downloadFile(options) {
        const entry = { options, aborted: false, progress: null };
        downloads.push(entry);
        return { abort() { entry.aborted = true; options.fail({}); options.complete?.({}); },
          onProgressUpdate(callback) { entry.progress = callback; } };
      },
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
    context, hooks, timers, requests, downloads, saved, navigations, toasts, evaluate,
    get: name => evaluate(name + '.value'), pauses: () => pauses,
    denyAlbum: () => { albumFail = true; },
    start: options => { hooks.load(options ?? { id: 'meeting-1', fileId: 'file-1', seek: '15' }); hooks.ready?.(); },
    respond: (index = 0, data = { playUrl: 'https://storage.test/play?sig=a%2Fb' }) => requests[index].resolve({ code: '0', data }),
    event: (name, detail = {}, attempt = evaluate('attemptId.value')) =>
      context[name]({ currentTarget: { id: 'meetingReplayVideo-' + attempt }, detail }),
    expire() { const [id, item] = timers.entries().next().value; timers.delete(id); item.fn(); },
    finishDownload(path = '/tmp/replay.mp4', status = 200) {
      const entry = downloads.at(-1); entry.options.success({ statusCode: status, tempFilePath: path }); entry.options.complete?.({});
    },
  };
}

test('视频进入时现签，原样使用 playUrl，播放进度解除加载提示', async () => {
  const h = pageHarness(); h.start(); h.respond(); await tick();
  assert.deepEqual(h.requests[0].args, ['meeting-1', 'file-1', false]);
  assert.equal(h.get('initialTime'), 15);
  assert.equal(h.get('src'), 'https://storage.test/play?sig=a%2Fb');
  h.event('handlePlay'); h.event('handleTimeUpdate', { currentTime: 16 });
  assert.equal(h.get('loading'), false); assert.equal(h.timers.size, 0);
});
test('在线播放报错：重新签名并缓存一次，缓存失败给出错误和重试', async () => {
  const h = pageHarness(); h.start(); h.respond(); await tick();
  h.event('handleVideoError'); h.respond(1, { playUrl: 'https://storage.test/fresh' }); await tick();
  assert.equal(h.get('caching'), true);
  assert.equal(h.downloads[0].options.url, 'https://storage.test/fresh');
  assert.equal(h.downloads[0].options.header, undefined);
  h.downloads[0].progress({ progress: 65 }); assert.equal(h.get('progress'), 65);
  h.finishDownload(); await tick();
  assert.equal(h.get('src'), '/tmp/replay.mp4');
  h.event('handleVideoError');
  assert.equal(h.requests.length, 2); assert.equal(h.get('loading'), false);
  assert.equal(h.get('errorText'), 'Mobile.Message.videoPlayFailed');
  h.context.retry(); assert.equal(h.requests.length, 3);
});
test('在线加载超时只降级一次，本地仍加载超时则显示可重试状态', async () => {
  const h = pageHarness(); h.start(); h.respond(); await tick(); h.expire();
  assert.equal(h.requests.length, 2); h.respond(1); await tick(); h.finishDownload(); await tick(); h.expire();
  assert.equal(h.get('errorText'), 'Mobile.Meeting.replayLoadTimeout');
  assert.equal(h.get('loading'), false); assert.equal(h.timers.size, 0);
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
test('缓存 HTTP 失败不把错误文件交给播放器', async () => {
  const h = pageHarness(); h.start(); h.respond(); await tick(); h.event('handleVideoError');
  h.respond(1); await tick(); h.finishDownload('/tmp/error.html', 403); await tick();
  assert.equal(h.get('src'), ''); assert.equal(h.get('loading'), false);
  assert.ok(h.get('errorText').length > 0);
});
test('换源后忽略旧播放器事件，避免旧 pause 清掉新加载超时保护', async () => {
  const h = pageHarness(); h.start(); h.respond(); await tick(); const old = h.get('attemptId');
  h.event('handleVideoError'); h.respond(1); await tick();
  h.event('handlePause', {}, old); assert.equal(h.get('loading'), true);
  h.finishDownload(); await tick(); h.event('handlePause', {}, old); h.event('handleVideoError', {}, old);
  assert.equal(h.get('loading'), true); assert.equal(h.timers.size, 1); assert.equal(h.requests.length, 2);
});
test('缓存中离开取消下载，再显示重新取地址；销毁后忽略回包', async () => {
  const h = pageHarness(); h.start(); h.respond(); await tick(); h.event('handleVideoError'); h.respond(1); await tick();
  h.hooks.hide(); await tick(); assert.equal(h.downloads[0].aborted, true);
  assert.equal(h.timers.size, 0); h.hooks.show(); assert.equal(h.requests.length, 3);
  h.hooks.unload(); h.respond(2); await tick();
  assert.equal(h.downloads.length, 1); assert.equal(h.get('src'), ''); assert.equal(h.timers.size, 0);
});
test('已播放页面退后台会暂停，回来保持暂停不误判超时', async () => {
  const h = pageHarness(); h.start(); h.respond(); await tick(); h.event('handleTimeUpdate', { currentTime: 16 });
  h.hooks.hide(); h.hooks.show(); assert.equal(h.pauses(), 1); assert.equal(h.timers.size, 0);
  assert.equal(h.requests.length, 1); assert.equal(h.get('loading'), false);
});
test('未准备好组件时不计播放超时，ready 后开始保护', async () => {
  const h = pageHarness(); h.hooks.load({ id: '1', fileId: '2' }); h.respond(); await tick();
  assert.equal(h.timers.size, 0); h.hooks.ready(); assert.equal(h.timers.size, 1);
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
