import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  base: 'https://tenant.example', pending: null as any, storage: new Map<string, unknown>(),
  clear: vi.fn(), redirect: vi.fn(), bearer: vi.fn(),
}));
vi.mock('../constants/config.uts', () => ({
  getApiBaseUrl: () => state.base, getVoxBaseUrl: () => state.base,
  LOGIN_WHITELIST_URL: [], clearStoragePreservingApiBaseUrl: state.clear,
}));
vi.mock('../utils/authSession.uts', () => ({ bootstrapH5AccessTokenFromUrl: vi.fn(), applyBearerAuthorization: state.bearer }));
vi.mock('../utils/system.uts', () => ({ handleExternalLink: vi.fn() }));
vi.mock('../utils/common.uts', () => ({ getCurrentPageFullPath: () => '/pages/message/message' }));
vi.mock('../utils/authNavigation.uts', () => ({
  LOGIN_PAGE_PATH: '/subpackages/pages/login/login', LOGIN_WEIXIN_PAGE_PATH: '/subpackages/pages/login-weixin/login-weixin',
  redirectToLoginOnce: state.redirect, canRequestNativeLogin: () => false,
}));
vi.mock('../utils/appWebViewDetect.uts', () => ({ applyXClientTypeHeader: vi.fn() }));
vi.mock('../constants/i18n.local.constants.uts', () => ({ getLocalFallback: () => 'failed' }));
import request from '../servers/useRequest.uts';
import { apiAuthIdpLoginList, apiAuthIdpSession } from '../servers/authIdp.uts';

class WebUTSJSONObject {
  constructor(value = {}) { Object.assign(this, value); }
  static [Symbol.hasInstance](value: unknown) {
    return value != null && typeof value === 'object' && !Array.isArray(value);
  }
}
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.clearAllMocks();
  state.storage.clear();
  state.storage.set('ACCESS_TOKEN', 'old-session');
  state.storage.set('ACCESS_TOKEN_ORIGIN', state.base);
  vi.stubGlobal('UTSJSONObject', WebUTSJSONObject);
  vi.stubGlobal('uni', {
    getStorageSync: (key: string) => state.storage.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => state.storage.set(key, value),
    request: (options: any) => { state.pending = options; }, showToast: vi.fn(),
  });
});

describe('可选接口路由探测的错误提示', () => {
  let now = Date.now();
  beforeEach(() => {
    now += 3000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
  });
  afterEach(() => vi.restoreAllMocks());
  it.each([
    { status: 404, suppress: true, expected: 0 },
    { status: 404, suppress: false, expected: 1 },
    { status: 500, suppress: true, expected: 1 },
  ])('HTTP $status / suppressNotFoundToast=$suppress', async ({ status, suppress, expected }) => {
    const result = request({ url: '/api/app/meetings/42/audio-files', method: 'GET', suppressNotFoundToast: suppress });
    state.pending.success({ statusCode: status, data: JSON.stringify({ status, message: `fixture HTTP ${status}` }), header: {} });
    expect((await result).status).toBe(status);
    expect(uni.showToast).toHaveBeenCalledTimes(expected);
  });
});
function respond(code: string, data: unknown = null) {
  state.pending.success({ statusCode: 200, data: JSON.stringify({ code, data, message: '/login?local=1' }), header: {} });
}

describe('H5 联合登录真实请求层', () => {
  it.each(['4010', '4011'])('普通业务 %s 继续清理过期登录态并跳登录', async code => {
    const result = request({ url: '/api/user/identity/list', method: 'GET' });
    respond(code);
    await result;
    expect(state.clear).toHaveBeenCalledOnce();
    expect(state.redirect).toHaveBeenCalledOnce();
  });
  it.each([apiAuthIdpLoginList, apiAuthIdpSession])('公开能力和 Cookie 验证不带旧 Bearer，也不因鉴权错误循环跳转', async api => {
    const result = api();
    respond('4011');
    expect((await result).code).toBe('4011');
    expect(state.bearer).not.toHaveBeenCalled();
    expect(state.storage.get('ACCESS_TOKEN')).toBe('old-session');
    expect(state.clear).not.toHaveBeenCalled();
    expect(state.redirect).not.toHaveBeenCalled();
  });
  it('Cookie 验证成功返回用户，不从响应写入本地 token', async () => {
    const result = apiAuthIdpSession();
    expect(state.pending.url).toBe('https://tenant.example/api/user/getLoginInfo');
    respond('0000', { id: '9007199254740993' });
    expect((await result).data.id).toBe('9007199254740993');
    expect(state.storage.get('ACCESS_TOKEN')).toBe('old-session');
  });
  it('能力接口网络失败正常拒绝，让登录表单自行回退', async () => {
    const result = apiAuthIdpLoginList();
    const error = { errMsg: 'fixture timeout' };
    state.pending.fail(error);
    await expect(result).rejects.toEqual(error);
    expect(state.redirect).not.toHaveBeenCalled();
  });
});
