import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setApiBaseUrl } from '@/constants/config';
import {
  currentQrLoginOrigin,
  normalizeQrLoginOrigin,
  parseQrLoginLink,
  qrLoginAppUrl,
  qrLoginPageUrl,
  validQrLoginScene,
} from '@/utils/qrLogin.uts';
import { parseScanContent } from '@/utils/scanRouter.uts';
const request = vi.hoisted(() =>
  vi.fn(async (_options: any) => ({ code: '0000' })),
);
vi.mock('@/servers/useRequest', () => ({ default: request }));
import {
  apiQrLoginUser,
  apiQrLoginScan,
  apiQrLoginConfirm,
} from '@/servers/qrLogin.uts';

const origin = 'https://agent.nuwax.com';
beforeEach(() => {
  setApiBaseUrl(origin);
  request.mockClear();
});
describe('扫码登录入口及请求边界', () => {
  it('同服务二维码和 App scheme 均还原到同一个确认页', () => {
    const target = parseQrLoginLink(origin + '/qrlogin/scene-A_9~', origin)!;
    expect(target).toMatchObject({ origin, sceneId: 'scene-A_9~' });
    expect(
      parseQrLoginLink(qrLoginAppUrl(target.sceneId, target.origin), origin),
    ).toEqual(target);
    expect(qrLoginPageUrl(target.sceneId, target.origin)).toBe(
      '/subpackages/pages/qr-login/qr-login?sceneId=scene-A_9~&origin=https%3A%2F%2Fagent.nuwax.com',
    );
    expect(parseScanContent(origin + '/qrlogin/scene-A_9~')).toMatchObject({
      kind: 'qrLogin',
      qrLoginSceneId: target.sceneId,
      qrLoginOrigin: origin,
    });
  });
  it('统一默认端口和大小写，不把其它端口或协议当作同服务', () => {
    expect(normalizeQrLoginOrigin('HTTPS://AGENT.NUWAX.COM:443/')).toBe(origin);
    expect(
      parseQrLoginLink('HTTPS://AGENT.NUWAX.COM:443/qrlogin/opaque.id', origin)
        ?.sceneId,
    ).toBe('opaque.id');
    expect(
      parseQrLoginLink('http://agent.nuwax.com/qrlogin/a', origin),
    ).toBeNull();
    expect(parseQrLoginLink(origin + ':8443/qrlogin/a', origin)).toBeNull();
  });
  it.each([
    'https://agent.nuwax.com.evil.example/qrlogin/a',
    'https://agent.nuwax.com@evil.example/qrlogin/a',
    'https://evil.example@agent.nuwax.com/qrlogin/a',
    'https://agent.nuwax.com\\@evil.example/qrlogin/a',
    'https://testagent.xspaceagi.com/qrlogin/a',
    origin + '/qrlogin/%2Fa',
    origin + '/qrlogin/a%5Cb',
    origin + '/qrlogin/a/b',
    origin + '/qrlogin/%252Fa',
    origin + '/qrlogin/%00',
    origin + '/qrlogin/..',
    'nuwax://qrlogin?sceneId=a&origin=https%3A%2F%2Fevil.example',
    'nuwax://qrlogin?sceneId=a&sceneId=b&origin=' + encodeURIComponent(origin),
    'nuwax://qrlogin?sceneId=a&origin=' +
      encodeURIComponent(origin) +
      '&origin=' +
      encodeURIComponent(origin),
  ])('拒绝异域或畸形二维码 %s', (value) => {
    expect(parseQrLoginLink(value, origin)).toBeNull();
    expect(parseScanContent(value).kind).toBe('qrLoginInvalid');
  });
  it('sceneId 保持不透明字符串，额外的二维码参数不进入移动页面', () => {
    expect(validQrLoginScene('opaque-A_1.id')).toBe(true);
    expect(validQrLoginScene('.')).toBe(false);
    expect(validQrLoginScene('a'.repeat(257))).toBe(false);
    const target = parseQrLoginLink(
      origin + '/qrlogin/opaque?pollToken=must-not-travel&origin=evil',
      origin,
    )!;
    expect(qrLoginPageUrl(target.sceneId, target.origin)).not.toContain(
      'pollToken',
    );
    expect(parseScanContent('https://example.com/article').kind).toBe('url');
  });
  it('三类请求只走当前服务，保留登录续接并关闭旧响应的全局鉴权副作用', async () => {
    await apiQrLoginUser('scene-a', origin);
    await apiQrLoginScan('scene-a', origin);
    await apiQrLoginConfirm('scene-a', origin);
    expect(request.mock.calls.map(([opts]) => opts)).toEqual([
      expect.objectContaining({ url: '/api/user/getLoginInfo', method: 'GET' }),
      expect.objectContaining({
        url: '/api/user/qrcode/scan/scene-a',
        method: 'POST',
      }),
      expect.objectContaining({
        url: '/api/user/qrcode/confirm/scene-a',
        method: 'POST',
      }),
    ]);
    for (const [opts] of request.mock.calls as any[]) {
      expect(opts.authReturnUrl).toBe(qrLoginPageUrl('scene-a', origin));
      expect(opts.suppressErrorToast).toBe(true);
      expect(opts.suppressAuthRedirect).toBe(true);
      expect(opts.skipAuth).toBeUndefined();
      expect(opts.baseUrl).toBeUndefined();
    }
    setApiBaseUrl('https://testagent.xspaceagi.com');
    expect(currentQrLoginOrigin()).not.toBe(origin);
    await expect(apiQrLoginConfirm('scene-a', origin)).rejects.toThrow(
      'qrLoginContextChanged',
    );
    expect(request).toHaveBeenCalledTimes(3);
  });
});
