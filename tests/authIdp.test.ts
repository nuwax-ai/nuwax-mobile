import { describe, it, expect } from 'vitest';
import { AUTH_HOME_PATH, AuthLoadScope, parseAuthIdpList, parseAuthIdentities, availableAuthProviders,
  autoAuthProviderId, resolveMobileAuthReturn, resolvePendingAuthReturn, mobileAuthWebReturn,
  buildIdpAuthorizePath, buildIdentityBindPath, decodeAuthQuery } from '../utils/authIdp.uts';

const origin = 'https://testagent.xspaceagi.com';
const listing = parseAuthIdpList({ items: [
  { id: '9223372036854775807', type: 'CAS', name: 'Enterprise' },
  { id: 2, type: 'OAUTH2', name: '任意自定义名称' },
  { id: 3, type: 'WECHAT', name: 'WeChat', wechatMode: 'QRCODE' },
  { id: 4, type: 'WECHAT', name: 'WeChat OA', wechatMode: 'OA' },
  { id: 5, type: 'FUTURE', name: 'unsupported' },
], autoRedirectIdpId: '9223372036854775807' });

describe('公开能力与 JSON 映射', () => {
  it('保留 int64 与配置名称，不用名称猜测原生 SDK', () => {
    expect(listing.valid).toBe(true);
    expect(listing.items[0].id).toBe('9223372036854775807');
    expect(listing.items[1].name).toBe('任意自定义名称');
    expect(availableAuthProviders(listing.items, false, '')).toEqual([]);
  });
  it('浏览器只开放已支持类型，微信按环境二选一', () => {
    expect(availableAuthProviders(listing.items, true, 'Android Chrome').map(p => p.id)).toEqual(['9223372036854775807', '2', '3']);
    expect(availableAuthProviders(listing.items, true, 'Windows MicroMessenger').map(p => p.id)).toEqual(['9223372036854775807', '2', '4']);
  });
  it.each([null, {}, { items: null }, { items: [{}] }, { items: ['CAS'] }])('失败/畸形数据不是成功空列表 %j', raw => {
    expect(parseAuthIdpList(raw).valid).toBe(false);
  });
  it('成功空列表与失败有不同状态', () => {
    expect(parseAuthIdpList({ items: [] }).valid).toBe(true);
    expect(parseAuthIdentities([])).toEqual([]);
    expect(parseAuthIdentities(null)).toBeNull();
    expect(parseAuthIdentities([{id: '9'}])).toBeNull();
    expect(parseAuthIdentities([{id: '9', idpId: '2', externalIdMasked: '***123'}])?.[0]).toMatchObject({id: '9', idpId: '2', externalIdMasked: '***123'});
  });
});

describe('自动登录边界', () => {
  const items = availableAuthProviders(listing.items, true, 'Chrome');
  it('必须同意协议，provider 必须在可用项中', () => {
    expect(autoAuthProviderId(items, '2', false, '', true)).toBe('2');
    expect(autoAuthProviderId(items, '2', false, '', false)).toBe('');
    expect(autoAuthProviderId(items, '4', false, '', true)).toBe('');
    expect(autoAuthProviderId(items, 'unknown', false, '', true)).toBe('');
  });
  it('退出、普通登录和错误返回不会自动再次发起', () => {
    expect(autoAuthProviderId(items, '2', true, '', true)).toBe('');
    expect(autoAuthProviderId(items, '2', false, 'Denied', true)).toBe('');
  });
});

describe('业务回跳不接受外部 URL 或编码绕过', () => {
  const page = '/subpackages/pages/app-details/app-details?id=12&title=%E4%BD%A0%E5%A5%BD';
  it.each([page, '/m/#' + page, origin + '/m/#' + page])('保留合法深链 %s', value => {
    expect(resolveMobileAuthReturn(value, origin)).toBe(page);
  });
  it.each([
    '', '-1', '/', 'https://evil.test/m/#/pages/mine/mine', origin + '.evil.test/m/#/pages/mine/mine',
    '//evil.test', '/\\evil.test', '/%2fevil.test', '/%255cevil.test', '/m/#//evil.test',
    '/pages/mine/../login', '/pages/mine/%2e%2e/login', '/pages/mine/mine\n', '/pages/mine/mine?x=%0d%0a',
    '/pages/mine/mine?bad=%E0%A4%A', '/m/#/subpackages/pages/login/login', '/pages/launch/launch',
    '/subpackages/pages/auth/idp-return?redirect=/pages/mine/mine', '/api/user/logout', 'javascript:alert(1)',
  ])('不安全返回值回主页 %s', value => {
    expect(resolveMobileAuthReturn(value, origin)).toBe(AUTH_HOME_PATH);
  });
  it('授权 URL 整体编码 hash 与嵌套 query', () => {
    const callback = mobileAuthWebReturn(page, origin);
    const href = buildIdpAuthorizePath('2', callback);
    expect(href.includes('#')).toBe(false);
    expect(new URL(href, origin).searchParams.get('redirect')).toBe(callback);
    expect(buildIdpAuthorizePath('2&redirect=https://evil.test', callback)).toBe('');
    expect(buildIdentityBindPath('2', callback)).toContain('/api/user/identity/bind/2?');
    expect(decodeAuthQuery('%E0%A4%A')).toBe('');
  });
});

describe('后端 pending 页面单独放行', () => {
  it('允许本站 pending token 与 bind=1 续接', () => {
    const target='/auth/bind-or-register?token=opaque&bind=1';
    expect(resolvePendingAuthReturn(target, origin)).toBe(target);
    expect(resolvePendingAuthReturn(origin+target, origin)).toBe(target);
    expect(resolveMobileAuthReturn(target, origin)).toBe(AUTH_HOME_PATH);
  });
  it.each(['/auth/bind-or-register', '/auth/bind-or-register?token=', '/auth/bind-or-register?token=a&redirect=//evil',
    '/auth/bind-or-register?token=a#x', '/auth/bind-or-register?token=a&token=b',
    '/auth/bind-or-register?token=a&bind=1&bind=1', '/auth/other?token=a', '/api/auth/idp/logout', 'https://evil.test/auth/bind-or-register?token=a'])('拒绝其他认证 URL %s', value => {
    expect(resolvePendingAuthReturn(value, origin)).toBe('');
  });
});

describe('异步请求归属', () => {
  it('换域、后发先至、页面卸载均使旧响应失效', () => {
    const scope = new AuthLoadScope();
    const first = scope.begin();
    const second = scope.begin();
    expect(scope.accepts(first, 'A', 'A')).toBe(false);
    expect(scope.accepts(second, 'A', 'B')).toBe(false);
    expect(scope.accepts(second, 'A', 'A')).toBe(true);
    scope.invalidate();
    expect(scope.accepts(second, 'A', 'A')).toBe(false);
  });
});
