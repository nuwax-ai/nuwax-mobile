import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const context = vi.hoisted(() => ({base:'',embedded:false,assign:vi.fn(),replace:vi.fn()}));
vi.mock('../constants/config.uts', () => ({getApiBaseUrl:()=>context.base}));
vi.mock('../utils/appWebViewDetect.uts', () => ({isAppWebViewEmbedded:()=>context.embedded}));
import { ordinaryLoginUrl, authBrowserQuery, beginBrowserIdp, canUseBrowserIdp } from '../utils/idpNavigation.uts';
beforeEach(() => {
  vi.clearAllMocks(); context.base='';context.embedded=false;
  vi.stubGlobal('window',{location:{origin:'https://mobile.example',hash:'#/subpackages/pages/login/login',search:'',assign:context.assign,replace:context.replace}});
});
afterEach(()=>vi.unstubAllGlobals());
describe('H5 实际导航与普通登录逃生',()=>{
  it('切换普通登录不会丢失可信的待绑定账号上下文',()=>{
    const pending='/auth/bind-or-register?token=opaque&bind=1';
    const url=new URL(ordinaryLoginUrl(pending),'https://mobile.example');
    expect(url.searchParams.get('local')).toBe('1');
    expect(url.searchParams.get('redirect')).toBe(pending);
  });
  it('外部认证链接不能通过普通登录逃生跳转',()=>{
    const url=new URL(ordinaryLoginUrl('https://evil.test/auth/bind-or-register?token=x'),'https://mobile.example');
    expect(url.searchParams.get('redirect')).toBe('/pages/message/message');
  });
  it.each(['cross-origin','embedded'])('%s 不发起浏览器授权',kind=>{
    if(kind==='embedded')context.embedded=true;else context.base='https://other.example';
    expect(canUseBrowserIdp()).toBe(false);
    expect(beginBrowserIdp('1','/pages/mine/mine')).toBe(false);
    expect(context.assign).not.toHaveBeenCalled();
  });
  it('hash 参数优先，并只解码一层',()=>{
    window.location.search='?local=1&redirect=old';
    window.location.hash='#/subpackages/pages/login/login?redirect=%2Fpages%2Fmine%2Fmine%3Fx%3D%2526&local=0';
    expect(authBrowserQuery('redirect')).toBe('/pages/mine/mine?x=%26');
    expect(authBrowserQuery('local')).toBe('0');
  });
  it('发起整页授权，业务目标经独立回跳页完成验证',()=>{
    expect(beginBrowserIdp('9223372036854775807','/pages/mine/mine',true)).toBe(true);
    const url=new URL(context.replace.mock.calls[0][0],'https://mobile.example');
    expect(url.pathname).toBe('/api/auth/idp/authorize');
    expect(url.searchParams.get('provider')).toBe('9223372036854775807');
    expect(url.searchParams.get('redirect')).toBe('/m/#/subpackages/pages/auth/idp-return?redirect=%2Fpages%2Fmine%2Fmine');
  });
});
