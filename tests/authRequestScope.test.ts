import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ base: 'https://a.example', epoch: 0, pending: null as any,
  storage: new Map<string, unknown>(), clear: vi.fn(), redirect: vi.fn() }));
vi.mock('../constants/config.uts', () => ({
  getApiBaseUrl: () => state.base, getVoxBaseUrl: () => state.base,
  LOGIN_WHITELIST_URL: [], clearStoragePreservingApiBaseUrl: state.clear,
}));
vi.mock('../utils/authSession.uts', () => ({ bootstrapH5AccessTokenFromUrl: vi.fn(), applyBearerAuthorization: vi.fn() }));
vi.mock('../utils/im/imSessionScope.uts', () => ({getImSessionStamp: () => String(state.epoch)}));
vi.mock('../utils/system.uts', () => ({ handleExternalLink: vi.fn() }));
vi.mock('../utils/common.uts', () => ({ getCurrentPageFullPath: () => '/pages/mine/mine' }));
vi.mock('../utils/authNavigation.uts', () => ({ LOGIN_PAGE_PATH: '/subpackages/pages/login/login',
  LOGIN_WEIXIN_PAGE_PATH: '/subpackages/pages/login-weixin/login-weixin',
  redirectToLoginOnce: state.redirect, canRequestNativeLogin: () => false }));
vi.mock('../utils/appWebViewDetect.uts', () => ({ applyXClientTypeHeader: vi.fn() }));
vi.mock('../constants/i18n.local.constants.uts', () => ({ getLocalFallback: () => 'failed' }));
import request from '../servers/useRequest.uts';

// H5 编译运行时将普通 JSON 对象视为 UTSJSONObject；全局测试垫片默认只供
// 纯函数的兜底分支使用。请求层测试必须模拟真实 instanceof 语义。
class WebUTSJSONObject {
  constructor(value = {}) { Object.assign(this, value); }
  static [Symbol.hasInstance](value: unknown) {
    return value != null && typeof value === 'object' && !Array.isArray(value);
  }
}
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.clearAllMocks();
  state.base = 'https://a.example';
  state.epoch = 0;
  state.storage.clear();
  state.storage.set('ACCESS_TOKEN', 'old');
  state.storage.set('ACCESS_TOKEN_ORIGIN', state.base);
  vi.stubGlobal('UTSJSONObject', WebUTSJSONObject);
  vi.stubGlobal('uni', {
    getStorageSync: (key: string) => state.storage.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => state.storage.set(key, value),
    request: (options: any) => { state.pending = options; },
    showToast: vi.fn(),
  });
});
function respond(code = '4010') {
  state.pending.success({ statusCode: 200, data: JSON.stringify({code, message: '/login?local=1'}), header: {} });
}
describe('实际请求层认证副作用', () => {
  it.each(['4010', '4011'])('当前用户 %s 仍能正常回登录页', async code => {
    const result = request({url: '/api/user/identity/list', method: 'GET'});
    respond(code);
    await result;
    expect(state.clear).toHaveBeenCalledOnce();
    expect(state.redirect).toHaveBeenCalledOnce();
  });
  it.each(['domain', 'session', 'cookie'])('旧 %s 请求不能清除新会话', async reason => {
    const result = request({url: '/api/user/identity/list', method: 'GET'});
    if (reason === 'domain') state.base = 'https://b.example';
    else if (reason === 'cookie') state.epoch++;
    else state.storage.set('ACCESS_TOKEN', 'new');
    respond();
    expect((await result).code).toBe('4010');
    expect(state.clear).not.toHaveBeenCalled();
    expect(state.redirect).not.toHaveBeenCalled();
  });
  it('能力读取失败由登录组件回落，不能清会话', async () => {
    const result = request({url: '/api/auth/idp/list', method: 'GET', skipAuth: true, skipAuthRedirect: true});
    respond();
    expect((await result).code).toBe('4010');
    expect(state.storage.get('ACCESS_TOKEN')).toBe('old');
    expect(state.clear).not.toHaveBeenCalled();
    expect(state.redirect).not.toHaveBeenCalled();
  });
  it('Cookie 回跳验证失败由回调页显示错误，不能自动再次授权', async () => {
    const result = request({url: '/api/user/getLoginInfo', method: 'GET', skipAuthRedirect: true});
    respond('4011');
    expect((await result).code).toBe('4011');
    expect(state.redirect).not.toHaveBeenCalled();
  });
});
