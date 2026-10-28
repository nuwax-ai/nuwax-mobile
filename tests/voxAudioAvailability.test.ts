import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';

const playerSource = readFileSync('components/audio-transcript-player/audio-transcript-player.uvue', 'utf8');
const ref = (value: unknown) => ({ value });
const computed = (get: () => unknown) => ({ get value() { return get(); } });

function executeSetup(source: string, context: Record<string, unknown>, expose: string) {
  const script = source.match(/<script setup lang="uts">([\s\S]*?)<\/script>/)![1]
    .replace(/^\s*import .+;\s*$/gm, '');
  return runInNewContext(transformSync(`${script}\n;({${expose}});`, { loader: 'ts' }).code, {
    ref, computed, watch: vi.fn(), onLoad: vi.fn(), onMounted: vi.fn(), onUnmounted: vi.fn(),
    emptyI18nParams: () => ({}), translateFn: (key: string) => key,
    apiResCode: (res: { code: string }) => res.code,
    apiResData: (res: { data: unknown }) => res.data,
    apiResMessage: () => '', SUCCESS_CODE: '0000',
    AudioTranscriptSegment: class {}, MsgItem: class {},
    AiMsgMarkdownParser: class { resetForNewMessage() {} resolveRenderList() { return []; } },
    setCurrentPageNavigationBarTitle: vi.fn(), renderSummaryMarkdown: vi.fn(),
    setTimeout: vi.fn(), clearTimeout: vi.fn(), console,
    ...context,
  });
}

// 求值真实模板的显示条件，连同页面 setup 验证入口没有被旧详情字段挡住。
function condition(source: string, tag: string, state: Record<string, unknown>) {
  const opening = source.match(new RegExp(`<${tag}\\b(?:[^">]|"[^"]*")*>`))![0];
  const expression = opening.match(/v-if="([^"]*)"/)?.[1] ?? 'true';
  const values = Object.fromEntries(Object.entries(state).map(([key, value]) => [
    key, value != null && typeof value === 'object' && 'value' in value ? value.value : value,
  ]));
  return runInNewContext(expression, values);
}

async function detail(type: string, metadata: Record<string, unknown> = {}) {
  const source = readFileSync(`subpackages/pages/terminal/terminal-${type}-detail.uvue`, 'utf8');
  const request = vi.fn().mockResolvedValue({ code: '0000', data: { id: 42, segments: [], ...metadata } });
  const page = executeSetup(source, {
    apiVoxMeetingDetail: request, apiVoxMonitoringDetail: request,
    uni: { showToast: vi.fn() },
  }, `${type === 'meeting' ? 'meetingId, recordType' : 'monitoringId'}, fetchDetail, detailReady, hasAudio, segments, autoplay`);
  (page.meetingId ?? page.monitoringId).value = 42;
  await page.fetchDetail();
  return { page, mounted: condition(source, 'audio-transcript-player', page) };
}

function player(hasAudio: boolean, items: Record<string, unknown>[]) {
  const mounted: (() => void)[] = [];
  const unmounted: (() => void)[] = [];
  const tasks: Promise<void>[] = [];
  const props = { meetingId: 42, recordType: 'meeting', hasAudio, segments: [], durationMs: 0, autoplay: false, showPlayer: true };
  const request = vi.fn().mockResolvedValue({ code: '0000', data: { total: items.length, items } });
  const audio = { src: '', playbackRate: 1, onTimeUpdate: vi.fn(), onEnded: vi.fn(), onCanplay: vi.fn(), onError: vi.fn(), destroy: vi.fn(), play: vi.fn() };
  const createAudio = vi.fn(() => audio);
  const state = executeSetup(playerSource, {
    defineProps: () => props, withDefaults: (value: unknown) => value,
    defineEmits: () => vi.fn(), defineExpose: vi.fn(),
    onMounted: (fn: () => void) => mounted.push(fn), onUnmounted: (fn: () => void) => unmounted.push(fn),
    apiVoxMeetingAudioFiles: (...args: unknown[]) => {
      const task = request(...args);
      tasks.push(task);
      return task;
    },
    apiVoxMonitoringAudioFiles: request,
    uni: { createInnerAudioContext: createAudio, showToast: vi.fn() },
  }, 'resolvedHasAudio, initAudio, destroyAudio, displayDurationMs');
  return {
    request, audio, createAudio, props, state,
    mount: async () => { mounted.forEach(fn => fn()); await Promise.all(tasks); await Promise.resolve(); },
    unmount: () => unmounted.forEach(fn => fn()),
    visible: () => condition(
      playerSource.slice(playerSource.indexOf('<view v-if="showPlayer')), 'view', { ...props, ...state },
    ),
  };
}

const audioFiles = [{ segmentIndex: 0, audioUrl: 'https://audio.example/segment.wav', durationMs: 12000 }];

describe('回放音频以 audio-files 为准', () => {
  it.each(['meeting', 'monitor'])('%s 详情缺少旧地址且无转写时仍加载播放器', async type => {
    expect((await detail(type)).mounted).toBe(true);
  });

  it('旧 hasAudio=false 时仍请求新接口并显示、绑定音频', async () => {
    const f = player(false, audioFiles);
    await f.mount();
    expect(f.request).toHaveBeenCalledWith(42, 1, 50);
    expect(f.visible()).toBe(true);
    expect(f.audio.src).toBe(audioFiles[0].audioUrl);
  });

  it('旧字段有地址但新接口没有有效音频时隐藏播放条', async () => {
    const f = player(true, [{ segmentIndex: 0, audioUrl: '', durationMs: 0 }]);
    await f.mount();
    expect(f.visible()).toBe(false);
    expect(f.createAudio).not.toHaveBeenCalled();
  });

  it('空音频列表隐藏播放条', async () => {
    const f = player(false, []);
    await f.mount();
    expect(f.request).toHaveBeenCalledOnce();
    expect(f.visible()).toBe(false);
  });

  it('旧录音兼容单段沿用详情时长', async () => {
    const f = player(true, [{ ...audioFiles[0], durationMs: 0 }]);
    f.props.durationMs = 12000;
    await f.mount();
    expect(f.visible()).toBe(true);
    expect(f.state.displayDurationMs.value).toBe(12000);
  });

  it('加载期间点击播放复用同一请求，就绪后续播', async () => {
    const f = player(true, audioFiles);
    let finish!: (res: unknown) => void;
    f.request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const loading = f.state.initAudio(false);
    await f.state.initAudio(true);
    expect(f.request).toHaveBeenCalledOnce();
    finish({ code: '0000', data: { total: 1, items: audioFiles } });
    await loading;
    expect(f.audio.play).toHaveBeenCalledOnce();
  });

  it('离开详情后迟到的响应不再创建播放器', async () => {
    const f = player(true, audioFiles);
    let finish!: (res: unknown) => void;
    f.request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const loading = f.state.initAudio(false);
    f.unmount();
    finish({ code: '0000', data: { total: 1, items: audioFiles } });
    await loading;
    expect(f.createAudio).not.toHaveBeenCalled();
  });

  it.each([{ meetingId: 0 }, { recordType: 'monitoring' }])('详情标识变化后拒绝旧请求 %j', async changed => {
    const f = player(true, audioFiles);
    let finish!: (res: unknown) => void;
    f.request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const loading = f.state.initAudio(false);
    Object.assign(f.props, changed);
    finish({ code: '0000', data: { total: 1, items: audioFiles } });
    await loading;
    expect(f.createAudio).not.toHaveBeenCalled();
  });
});
