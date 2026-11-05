import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import {
  normalizeQrLoginOrigin,
  validQrLoginScene,
  qrLoginPageUrl,
  qrLoginAppUrl,
} from '@/utils/qrLogin.uts';
const source = readFileSync('subpackages/pages/qr-login/qr-login.uvue', 'utf8')
  .split('<script setup lang="uts">')[1]
  .split('</script>')[0];
const origin = 'https://agent.nuwax.com';
const user = {
  uid: 'u-1',
  userName: 'user1',
  nickName: 'Alice',
  phone: '18012345678',
};
const ok = (data: unknown = null) => ({ code: '0000', data });
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function setup(app = false, initialToken = app ? 'phone-session' : '') {
  const script = source
    .replace(/\/\/ #ifdef APP\n([\s\S]*?)\/\/ #endif/g, (_, body) =>
      app ? body : '',
    )
    .replace(/\/\/ #ifdef H5 \|\| WEB\n([\s\S]*?)\/\/ #endif/g, (_, body) =>
      app ? '' : body,
    )
    .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, '');
  const info = vi.fn().mockResolvedValue(ok(user)),
    scan = vi.fn().mockResolvedValue(ok()),
    confirm = vi
      .fn()
      .mockResolvedValue(ok({ token: 'target-token-is-ignored' }));
  const login = vi.fn();
  let token = initialToken,
    currentOrigin = origin;
  let load!: (query: any) => void,
    show!: () => void,
    hide!: () => void,
    unload!: () => void;
  const page = runInNewContext(
    transformSync(
      script +
        '\n({ prepareLogin, confirmLogin, cancelLogin, state, errorText, accountName, accountLabel, confirmationAttempted });',
      { loader: 'ts' },
    ).code,
    {
      ref: <T>(value: T) => ({ value }),
      computed: vi.fn(),
      onLoad: (cb: typeof load) => (load = cb),
      onShow: (cb: typeof show) => (show = cb),
      onHide: (cb: typeof hide) => (hide = cb),
      onUnload: (cb: typeof unload) => (unload = cb),
      apiQrLoginUser: info,
      apiQrLoginScan: scan,
      apiQrLoginConfirm: confirm,
      apiResCode: (r: any) => r.code,
      apiResData: (r: any) => r.data,
      apiResMessage: (r: any) => r.message ?? '',
      SUCCESS_CODE: '0000',
      USER_NO_LOGIN: '4010',
      REDIRECT_LOGIN: '4011',
      ACCESS_TOKEN: 'ACCESS_TOKEN',
      currentQrLoginOrigin: () => currentOrigin,
      normalizeQrLoginOrigin,
      validQrLoginScene,
      qrLoginPageUrl,
      qrLoginAppUrl,
      redirectToLoginOnce: login,
      LOGIN_PAGE_PATH: '/subpackages/pages/login/login',
      bootstrapH5AccessTokenFromUrl: vi.fn(),
      clearAccessToken: () => (token = ''),
      useI18n: () => ({ t: (key: string) => key }),
      emptyI18nParams: () => ({}),
      authBrowserQuery: () => null,
      isAppWebViewEmbedded: () => false,
      switchMainTab: vi.fn(),
      window: { location: { href: '' }, open: vi.fn() },
      document: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        visibilityState: 'visible',
      },
      uni: { getStorageSync: () => token, navigateBack: vi.fn() },
    },
  );
  return {
    page,
    info,
    scan,
    confirm,
    login,
    load: (query: any = { sceneId: 'scene-a', origin }) => load(query),
    show: () => show(),
    hide: () => hide(),
    unload: () => unload(),
    setOrigin: (value: string) => (currentOrigin = value),
    setToken: (value: string) => (token = value),
    token: () => token,
  };
}
describe.each([false, true])('扫码确认页面 app=%s', (app) => {
  it('打开、登录返回和刷新只校验账号/扫码，不自动确认', async () => {
    const f = setup(app);
    f.load();
    f.show();
    await settle();
    expect(f.page.state.value).toBe('ready');
    expect(f.info).toHaveBeenCalledTimes(1);
    expect(f.scan).toHaveBeenCalledTimes(1);
    expect(f.confirm).not.toHaveBeenCalled();
    expect(f.page.accountName.value).toBe('Alice');
    expect(f.page.accountLabel.value).toBe('180****5678');
    f.hide();
    f.show();
    await settle();
    expect(f.page.state.value).toBe('ready');
    expect(f.confirm).not.toHaveBeenCalled();
  });
  it('只有明确点击才授权，防止重复提交，手机账号不被目标端结果替换', async () => {
    const f = setup(app);
    f.load();
    await settle();
    const previous = f.token();
    await Promise.all([f.page.confirmLogin(), f.page.confirmLogin()]);
    expect(f.confirm).toHaveBeenCalledTimes(1);
    expect(f.page.state.value).toBe('success');
    expect(f.token()).toBe(previous);
    f.hide();
    f.show();
    await settle();
    expect(f.confirm).toHaveBeenCalledTimes(1);
  });
  it('提交前实际账号变化时要求重新校验，不确认另一个账号', async () => {
    const f = setup(app);
    f.load();
    await settle();
    f.info.mockResolvedValue(ok({ ...user, uid: 'u-2' }));
    await f.page.confirmLogin();
    expect(f.confirm).not.toHaveBeenCalled();
    expect(f.page.errorText.value).toBe('Mobile.QrLogin.accountChanged');
  });
  it('无效或异域场景不发送任何请求', async () => {
    const f = setup(app);
    f.load({ sceneId: 'scene-a', origin: 'https://evil.example' });
    await settle();
    expect(f.page.state.value).toBe('invalid');
    expect(f.info).not.toHaveBeenCalled();
    expect(f.scan).not.toHaveBeenCalled();
  });
  it('取消后丢弃在途扫码响应，回前台也不自动重开', async () => {
    const f = setup(app);
    let resolve!: (value: any) => void;
    f.scan.mockReturnValueOnce(new Promise((done) => (resolve = done)));
    f.load();
    await settle();
    f.page.cancelLogin();
    resolve(ok());
    await settle();
    f.hide();
    f.show();
    expect(f.page.state.value).toBe('cancelled');
    expect(f.confirm).not.toHaveBeenCalled();
    expect(f.scan).toHaveBeenCalledTimes(1);
  });
  it('等待返回期间换域或换 Token，旧结果不能变成可确认状态', async () => {
    const f = setup(app);
    let resolve!: (value: any) => void;
    f.info.mockReturnValueOnce(new Promise((done) => (resolve = done)));
    f.load();
    app ? f.setToken('new-account') : f.setOrigin('https://other.example');
    resolve(ok(user));
    await settle();
    expect(f.page.state.value).toBe('error');
    expect(f.scan).not.toHaveBeenCalled();
    expect(f.confirm).not.toHaveBeenCalled();
  });
  it('确认期间离开后不采纳迟到成功，也不自动重试确认', async () => {
    const f = setup(app);
    f.load();
    await settle();
    let resolve!: (value: any) => void;
    f.confirm.mockReturnValueOnce(new Promise((done) => (resolve = done)));
    const pending = f.page.confirmLogin();
    await settle();
    f.hide();
    resolve(ok());
    await pending;
    f.show();
    await settle();
    expect(f.page.state.value).toBe('error');
    expect(f.page.errorText.value).toBe('Mobile.QrLogin.confirmUnknown');
    expect(f.confirm).toHaveBeenCalledTimes(1);
  });
  it('确认超时提示先查看电脑，不自动重发；重试只重新校验', async () => {
    const f = setup(app);
    f.load();
    await settle();
    f.confirm.mockRejectedValueOnce(new Error('timeout'));
    await f.page.confirmLogin();
    expect(f.page.errorText.value).toBe('Mobile.QrLogin.confirmUnknown');
    await f.page.prepareLogin();
    expect(f.page.state.value).toBe('ready');
    expect(f.confirm).toHaveBeenCalledTimes(1);
  });
  it('未登录保留场景返回，取消登录后回前台不循环拉起登录', async () => {
    const f = setup(app);
    f.info.mockResolvedValue({ code: '4010' });
    f.load();
    await settle();
    expect(f.login).toHaveBeenCalledWith(
      '/subpackages/pages/login/login',
      qrLoginPageUrl('scene-a', origin),
    );
    expect(f.scan).not.toHaveBeenCalled();
    f.hide();
    f.show();
    await settle();
    expect(f.login).toHaveBeenCalledTimes(1);
    expect(f.page.state.value).toBe('error');
  });
});
it('App 无 Token 时先登录，不请求账号或扫码接口', async () => {
  const f = setup(true, '');
  f.load();
  await settle();
  expect(f.login).toHaveBeenCalledOnce();
  expect(f.info).not.toHaveBeenCalled();
});
