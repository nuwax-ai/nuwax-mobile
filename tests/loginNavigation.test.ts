import { beforeEach, describe, expect, it, vi } from 'vitest';
const context = vi.hoisted(() => ({ supported: true, replace: vi.fn() }));
vi.mock('../utils/common.uts', () => ({redirectTo: vi.fn()}));
vi.mock('../utils/idpNavigation.uts', () => ({
  authBrowserOrigin: () => 'https://mobile.example', canUseBrowserIdp: () => context.supported,
}));
import { navigateAfterMobileLogin } from '../utils/loginNavigation.uts';
beforeEach(() => { vi.clearAllMocks(); context.supported=true; vi.stubGlobal('window', {location:{replace:context.replace}}); });
describe('普通登录后完成业务返回或 pending 续接', () => {
  it('密码与验证码结果都可以消费后端可信续接', () => {
    navigateAfterMobileLogin('/auth/bind-or-register?token=pending&bind=1', '/pages/mine/mine');
    expect(context.replace).toHaveBeenCalledWith('/auth/bind-or-register?token=pending&bind=1');
  });
  it('没有响应 redirect 时恢复登录前的 pending 目标', () => {
    navigateAfterMobileLogin('', '/auth/bind-or-register?token=pending&bind=1');
    expect(context.replace).toHaveBeenCalledWith('/auth/bind-or-register?token=pending&bind=1');
  });
  it('普通 App 路由转换为部署在 /m/ 的 hash 路由', () => {
    navigateAfterMobileLogin('', '/pages/mine/mine');
    expect(context.replace).toHaveBeenCalledWith('/m/#/pages/mine/mine');
  });
  it('拒绝后端或 query 的跨域跳转', () => {
    navigateAfterMobileLogin('https://evil.test', 'https://evil.test');
    expect(context.replace).toHaveBeenCalledWith('/m/#/pages/message/message');
  });
  it('内嵌 H5 不跳到后端 Cookie 认证页面', () => {
    context.supported=false;
    navigateAfterMobileLogin('/auth/bind-or-register?token=x', '');
    expect(context.replace).toHaveBeenCalledWith('/m/#/pages/message/message');
  });
});
