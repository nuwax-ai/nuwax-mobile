import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { mapMonitoringTranscriptSegments } from '../utils/voxTranscriptTimeline.uts';
import { AudioTranscriptSegment } from '../components/audio-transcript-player/types.uts';

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
    AudioTranscriptSegment, mapMonitoringTranscriptSegments, MsgItem: class {},
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

function player(hasAudio: boolean, items: Record<string, unknown>[], overrides: { recordType?: string; segments?: AudioTranscriptSegment[] } = {}) {
  const mounted: (() => void)[] = [];
  const unmounted: (() => void)[] = [];
  const tasks: Promise<void>[] = [];
  const props = { meetingId: 42, recordType: 'meeting', hasAudio, segments: [] as AudioTranscriptSegment[], durationMs: 0, autoplay: false, showPlayer: true, ...overrides };
  const request = vi.fn().mockResolvedValue({ code: '0000', data: { total: items.length, items } });
  const audio = { src: '', playbackRate: 1, onTimeUpdate: vi.fn(), onEnded: vi.fn(), onCanplay: vi.fn(), onError: vi.fn(), destroy: vi.fn(), play: vi.fn(), pause: vi.fn(), seek: vi.fn() };
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
  }, 'resolvedHasAudio, initAudio, destroyAudio, displayDurationMs, resolveActiveSeq, transcriptTimeMs, handleSegmentClick, seekToMs, currentTimeMs, activeSeq');
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

describe('分段转写时间轴', () => {
  // 对应真机监控的首段、第二段和一个靠后段；音频 segmentIndex 可有空段缺口。
  const files = [
    { segmentIndex: 0, audioUrl: 'https://audio.example/0.wav', durationMs: 125940, startedAt: '2026-10-27 16:02:39' },
    { segmentIndex: 1, audioUrl: 'https://audio.example/1.wav', durationMs: 33760, startedAt: '2026-10-27 16:04:45' },
    { segmentIndex: 25, audioUrl: 'https://audio.example/25.wav', durationMs: 41700, startedAt: '2026-10-27 16:09:39' },
  ];
  const segments = [
    new AudioTranscriptSegment(1, '', '首段第一句', 10420, 26960, files[0].startedAt),
    new AudioTranscriptSegment(12, '', '首段末句', 123702, 125920, files[0].startedAt),
    new AudioTranscriptSegment(13, '', '第二段第一句', 0, 6200, files[1].startedAt),
    new AudioTranscriptSegment(14, '', '第二段下一句', 6920, 18886, files[1].startedAt),
    new AudioTranscriptSegment(61, '', '后段的局部第八秒', 8664, 8900, files[2].startedAt),
  ];

  it('开头不会高亮到后面分段中同样从零开始的文字', async () => {
    const f = player(false, files, { recordType: 'monitoring', segments });
    await f.mount();
    expect(f.state.resolveActiveSeq(9000)).toBe(-1);
    expect(f.state.resolveActiveSeq(20000)).toBe(1);
    expect(f.state.resolveActiveSeq(125940 + 7000)).toBe(14);
  });

  it('节点标时与点击跳转使用同一个全局时间，保留正确段内偏移', async () => {
    const f = player(false, files, { recordType: 'monitoring', segments });
    await f.mount();
    expect(f.state.transcriptTimeMs(4)).toBe(168364);
    f.state.handleSegmentClick(4);
    expect(f.audio.src).toBe(files[2].audioUrl);
    expect(f.audio.seek).toHaveBeenCalledWith(8.664);
    expect(f.state.currentTimeMs.value).toBe(168364);
    expect(f.state.activeSeq.value).toBe(61);
  });

  it('跨段拖动尚未切换音频源时，已按目标段更新高亮', async () => {
    const f = player(false, files, { recordType: 'monitoring', segments });
    await f.mount();
    f.state.seekToMs(125940 + 7000);
    expect(f.state.activeSeq.value).toBe(14);
  });

  it('会议的 startMs 已是整场时间，不再叠加音频段起点', async () => {
    const meetingSegments = [new AudioTranscriptSegment(2, '', '会议全局时间', 130000, 131000, files[1].startedAt)];
    const f = player(false, files, { recordType: 'meeting', segments: meetingSegments });
    await f.mount();
    expect(f.state.transcriptTimeMs(0)).toBe(130000);
    expect(f.state.resolveActiveSeq(130500)).toBe(2);
  });

  it('缺少或重复采集起点时不猜测多段归属，单文件保持旧行为', () => {
    expect(mapMonitoringTranscriptSegments(['', 'missing', 'same'], ['same', 'same'])).toEqual([-1, -1, -1]);
    expect(mapMonitoringTranscriptSegments(['', 'anything'], [''])).toEqual([0, 0]);
  });
});
