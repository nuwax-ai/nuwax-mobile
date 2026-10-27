import { beforeEach, describe, expect, it, vi } from 'vitest';

const context = vi.hoisted(() => ({ base: '', embedded: false }));
vi.mock('@/constants/config', () => ({ getApiBaseUrl: () => context.base }));
vi.mock('@/utils/appWebViewDetect', () => ({ isAppWebViewEmbedded: () => context.embedded }));
import { authBrowserQuery, beginBrowserIdp, canUseBrowserIdp, finishBrowserLogin, idpLoginEntryUrl } from '../utils/idpNavigation.uts';

const origin = 'https://tenant.example';
const assign = vi.fn();
const replace = vi.fn();
beforeEach(() => {
  context.base = '';
  context.embedded = false;
  vi.clearAllMocks();
  vi.stubGlobal('window', { location: { origin, search: '', hash: '', assign, replace } });
});

describe('浏览器 Cookie 登录', () => {
  it('同源启用，跨域开发和原生内嵌禁用', () => {
    expect(canUseBrowserIdp()).toBe(true);
    context.base = origin;
    expect(canUseBrowserIdp()).toBe(true);
    context.base = 'https://other.example';
    expect(beginBrowserIdp('5', '', false)).toBe(false);
    expect(assign).not.toHaveBeenCalled();
    context.base = '';
    context.embedded = true;
    expect(canUseBrowserIdp()).toBe(false);
  });
  it('区分缺失和空 local/idpError，hash 参数优先并只解码一次', () => {
    window.location.search = '?local&idpError&redirect=top';
    window.location.hash = '#/login?redirect=%2Fpages%2Fmessage%2Fchat%3Fname%3Da%2520b';
    expect(authBrowserQuery('local')).toBe('');
    expect(authBrowserQuery('idpError')).toBe('');
    expect(authBrowserQuery('unknown')).toBeNull();
    expect(authBrowserQuery('redirect')).toBe('/pages/message/chat?name=a%20b');
  });
  it('手动授权 push，自动授权 replace', () => {
    expect(beginBrowserIdp('5', '', false)).toBe(true);
    expect(assign).toHaveBeenCalledOnce();
    expect(beginBrowserIdp('5', '', true)).toBe(true);
    expect(replace).toHaveBeenCalledOnce();
  });
  it.each([true, false])('浏览器拒绝跳转时返回失败，让表单解除加载 replace=%s', shouldReplace => {
    const navigate = shouldReplace ? replace : assign;
    navigate.mockImplementationOnce(() => { throw new Error('navigation blocked'); });
    expect(beginBrowserIdp('5', '', shouldReplace)).toBe(false);
  });
  it('普通登录后回移动路由或安全 pending 页面', () => {
    finishBrowserLogin('/pages/message/chat?convId=123');
    expect(replace).toHaveBeenLastCalledWith('/m/#/pages/message/chat?convId=123');
    finishBrowserLogin('/auth/bind-or-register?token=fixture&bind=1');
    expect(replace).toHaveBeenLastCalledWith('/auth/bind-or-register?token=fixture&bind=1');
    finishBrowserLogin('https://evil.example');
    expect(replace).toHaveBeenLastCalledWith('/m/#/pages/message/message');
  });
  it('回到登录入口时不注入覆盖服务端自动配置的 local 参数', () => {
    const url = new URL(idpLoginEntryUrl('/pages/message/chat?convId=123'), origin);
    expect(url.searchParams.has('local')).toBe(false);
    expect(url.searchParams.get('redirect')).toBe('/m/#/pages/message/chat?convId=123');
  });
});
