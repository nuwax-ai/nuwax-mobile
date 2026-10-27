import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ switchTab: vi.fn(), reLaunch: vi.fn() }));
vi.mock('@/utils/mainTabNavigation', () => ({
  isMainTabPath: (path: string) => path.split('?')[0] === '/pages/message/message',
  switchMainTab: navigation.switchTab,
}));
import { finishNativeAuthNavigation } from '../utils/nativeAuthNavigation.uts';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('uni', { reLaunch: navigation.reLaunch });
});

describe('原生登录与设密码后的安全导航', () => {
  it('不接受外部 URL、pending 或认证页面作为业务返回目标', () => {
    for (const target of ['https://evil.example', '/auth/bind-or-register?token=fixture', '/subpackages/pages/login/login']) {
      finishNativeAuthNavigation(target);
      expect(navigation.switchTab).toHaveBeenLastCalledWith({ url: '/pages/message/message' });
    }
    expect(navigation.reLaunch).not.toHaveBeenCalled();
  });
  it('保留业务 query 中的编码，避免二次解码改变字段含义', () => {
    const target = '/pages/message/chat?convId=123&name=a%26b%20c';
    finishNativeAuthNavigation(target);
    expect(navigation.reLaunch).toHaveBeenCalledWith({ url: target });
    expect(navigation.switchTab).not.toHaveBeenCalled();
  });
});
