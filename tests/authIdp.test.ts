import { describe, expect, it } from 'vitest';
import {
  AuthLoadScope, MOBILE_AUTH_HOME, parseAuthIdpList, availableAuthProviders,
  autoAuthProviderId, buildIdpAuthorizePath, mobileAuthWebReturn,
  resolveMobileAuthReturn, resolvePendingAuthReturn,
} from '../utils/authIdp.uts';

const origin = 'https://tenant.example';
const list = parseAuthIdpList({ items: [
  { id: 5, type: 'CAS', name: '西财统一认证' },
  { id: 1, type: 'OAUTH2', name: 'OAuth2' },
  { id: 10, type: 'WECHAT', wechatMode: 'QRCODE' },
  { id: 4, type: 'WECHAT', wechatMode: 'OA' },
] });

describe('移动 H5 登录方式配置', () => {
  it('展示服务端开放的提供方，不再维护前端类型及 ID 白名单', () => {
    expect(availableAuthProviders(list.items, 'Chrome').map(p => p.id)).toEqual(['5', '1', '10']);
  });
  it('自动提供方只看服务端 ID，不依赖手动按钮列表或浏览器类型过滤', () => {
    expect(autoAuthProviderId('4')).toBe('4');
    expect(autoAuthProviderId('999')).toBe('999');
  });
  it.each([['Chrome', '10'], ['MicroMessenger', '4']])('启用微信后按 UA 选择授权形态 %s', (ua, id) => {
    expect(availableAuthProviders(list.items, ua).filter(p => p.type === 'WECHAT').map(p => p.id)).toEqual([id]);
  });
  it.each(['', '0', '../5', '5&redirect=//evil'])('仅拒绝空或格式无效的自动提供方 ID %s', id => {
    expect(autoAuthProviderId(id)).toBe('');
  });
  it('手动列表为空或缺失时仍保留服务端的自动配置', () => {
    expect(parseAuthIdpList({ autoRedirectIdpId: '5' }).autoRedirectIdpId).toBe('5');
    expect(parseAuthIdpList({ items: null, autoRedirectIdpId: '5' }).autoRedirectIdpId).toBe('5');
    expect(availableAuthProviders(parseAuthIdpList({ items: [{ id: '6', type: 'SAML' }] }).items, 'Chrome').map(p => p.id)).toEqual(['6']);
  });
  it('容忍旧后端/畸形列表，跳过无效和重复 ID，保留 int64 字符串', () => {
    expect(parseAuthIdpList(null).items).toEqual([]);
    expect(parseAuthIdpList({ items: {} }).items).toEqual([]);
    const parsed = parseAuthIdpList({ items: [null, { id: '../5' }, { id: '9007199254740993', type: 'CAS' }, { id: '9007199254740993' }], autoRedirectIdpId: '9007199254740993' });
    expect(parsed.items).toHaveLength(1);
    expect(parsed.autoRedirectIdpId).toBe('9007199254740993');
  });
});

describe('移动登录回跳', () => {
  const route = '/pages/message/chat?convId=9007199254740993&name=%E8%A5%BF%E8%B4%A2';
  it.each([route, '/m/#' + route, origin + '/m/#' + route, encodeURIComponent('/m/#' + route)])('保留移动深链接及编码 %s', (path) => {
    expect(resolveMobileAuthReturn(path, origin)).toBe(route);
    expect(mobileAuthWebReturn(path, origin)).toBe('/m/#' + route);
  });
  it.each(['https://evil.example/', '//evil.example', '/\\evil.example', '/m/#//evil.example', '/pages/../login', '/pages/%2e%2e/login', '/pages/%252f%252fevil', '/pages/index/index\n', '/subpackages/pages/login/login', '/subpackages/pages/auth/idp-return', '/pages/launch/launch', '/pages/offline-h5-bootstrap/offline-h5-bootstrap', '/subpackages/pages/temporary-session/temporary-session'])('拒绝外域、归一化绕过及登录循环 %s', (value) => {
    expect(resolveMobileAuthReturn(value, origin)).toBe(MOBILE_AUTH_HOME);
  });
  it('授权回跳不传 token，嵌套 redirect 只编码一次', () => {
    const url = new URL(buildIdpAuthorizePath('5', route, origin), origin);
    expect(url.pathname).toBe('/api/auth/idp/authorize');
    expect(url.searchParams.get('provider')).toBe('5');
    const callback = new URL(url.searchParams.get('redirect')!, origin);
    expect(callback.pathname).toBe('/m/');
    expect(callback.hash.split('?')[0]).toBe('#/subpackages/pages/auth/idp-return');
    expect(new URLSearchParams(callback.hash.split('?')[1]).get('redirect')).toBe(route);
  });
  it('非法 provider 不生成授权地址', () => {
    expect(buildIdpAuthorizePath('5&redirect=//evil', route)).toBe('');
  });
  it('首次关联只允许本站 pending 续接，保留 opaque token', () => {
    const path = '/auth/bind-or-register?token=opaque.jwt%2Fcode%3D&bind=1';
    expect(resolvePendingAuthReturn(path, origin)).toBe(path);
    expect(resolvePendingAuthReturn(origin + path, origin)).toBe(path);
    expect(resolvePendingAuthReturn(encodeURIComponent(path), origin)).toBe(path);
  });
  it.each(['/auth/bind-or-register?token=', '/auth/bind-or-register?token=%20', '/auth/bind-or-register?token=%ZZ', '/auth/bind-or-register?token=a&token=b', '/auth/bind-or-register?token=a&redirect=//evil', '/auth/bind-or-register?token=a#x', '//evil/auth/bind-or-register?token=a', '/api/auth/idp/callback?token=a'])('拒绝不可信 pending 地址 %s', (path) => {
    expect(resolvePendingAuthReturn(path, origin)).toBe('');
  });
});

it('卸载、切域和新请求使旧授权列表失效', () => {
  const scope = new AuthLoadScope();
  const first = scope.begin();
  expect(scope.accepts(first, origin, origin)).toBe(true);
  expect(scope.accepts(first, origin, 'https://other.example')).toBe(false);
  const second = scope.begin();
  expect(scope.accepts(first, origin, origin)).toBe(false);
  scope.invalidate();
  expect(scope.accepts(second, origin, origin)).toBe(false);
});
