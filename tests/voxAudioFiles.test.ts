import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('../servers/useRequest.uts', () => ({ default: request }));
vi.mock('../constants/config.uts', () => ({ getVoxBaseUrl: () => 'https://tenant.example' }));
import { requestVoxAudioFiles } from '../servers/vox/voxAudioFiles.uts';

beforeEach(() => {
  request.mockReset();
  vi.stubGlobal('UTSJSONObject', class {});
});
afterEach(() => vi.unstubAllGlobals());

describe('回放接口部署兼容', () => {
  it.each(['meetings', 'monitorings'])('%s 路由 404 时把旧录音转换为单段', async resource => {
    request.mockResolvedValueOnce({ status: 404, path: `/api/app/${resource}/42/audio-files` })
      .mockResolvedValueOnce({ code: '0000', data: { url: 'https://audio.example/legacy.wav' } });
    const result = await requestVoxAudioFiles(resource, 42, 1, 50);
    expect(request.mock.calls.map(([opts]) => opts.url)).toEqual([
      `/api/app/${resource}/42/audio-files?page=1&pageSize=50`, `/api/app/${resource}/42/audio-url`,
    ]);
    expect(result.code).toBe('0000');
    expect(result.data).toMatchObject({ page: 1, pageSize: 50, total: 1 });
    expect(result.data.items).toEqual([{ segmentIndex: 0, audioUrl: 'https://audio.example/legacy.wav', durationMs: 0, audioBytes: 0 }]);
  });

  it.each([
    { code: '0000', data: { total: 0, items: [] } },
    { code: '0000', data: { total: 2, items: [{ segmentIndex: 0 }, { segmentIndex: 1 }] } },
    { code: '4010', message: '未登录' },
    { code: '4040', message: '录音不存在' },
    { status: 500, path: '/api/app/meetings/42/audio-files' },
    { status: 404, path: '/other-route' },
  ])('保留新接口结果，不以旧录音覆盖空列表或错误 %j', async response => {
    request.mockResolvedValueOnce(response);
    expect(await requestVoxAudioFiles('meetings', 42, 1, 50)).toBe(response);
    expect(request).toHaveBeenCalledOnce();
  });

  it('旧地址获取失败时保留失败响应', async () => {
    const error = { code: '4030', message: '无权限' };
    request.mockResolvedValueOnce({ status: 404, path: '/api/app/meetings/42/audio-files' }).mockResolvedValueOnce(error);
    expect(await requestVoxAudioFiles('meetings', 42, 1, 50)).toBe(error);
  });
});
