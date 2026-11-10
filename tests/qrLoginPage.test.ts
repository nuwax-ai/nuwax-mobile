import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { APP_DOWNLOAD_PAGE_URL } from '@/constants/config';
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
function setup(
  app = false,
  initialToken = app ? 'phone-session' : '',
  routes = ['subpackages/pages/qr-login/qr-login'],
  embedded = !app,
) {
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
  const home = vi.fn();
  const nativeHome = vi.fn();
  const bridgeReady = vi.fn().mockResolvedValue(true);
  const bootstrapToken = vi.fn();
  const browserWindow: any = {
    location: { href: '', replace: vi.fn() },
    open: vi.fn(),
    uni: { webView: { reLaunch: nativeHome } },
  };
  const navigateBack = vi.fn((options: any) => {
    if (back?.({ from: 'navigateBack' }) === true) return;
    options.success?.({ errMsg: 'navigateBack:ok' });
  });
  let token = initialToken,
    currentOrigin = origin;
  let load!: (query: any) => void,
    show!: () => void,
    hide!: () => void,
    unload!: () => void,
    back!: (options: { from: string }) => boolean;
  const page = runInNewContext(
    transformSync(
      script +
        '\n({ prepareLogin, confirmLogin, cancelLogin, finish, state, errorText, accountName, accountLabel, confirmationAttempted });',
      { loader: 'ts' },
    ).code,
    {
      ref: <T>(value: T) => ({ value }),
      computed: vi.fn(),
      onLoad: (cb: typeof load) => (load = cb),
      onShow: (cb: typeof show) => (show = cb),
      onHide: (cb: typeof hide) => (hide = cb),
      onUnload: (cb: typeof unload) => (unload = cb),
      onBackPress: (cb: typeof back) => (back = cb),
      getCurrentPages: () => routes.map((route) => ({ route })),
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
      APP_DOWNLOAD_PAGE_URL,
      currentQrLoginOrigin: () => currentOrigin,
      normalizeQrLoginOrigin,
      validQrLoginScene,
      qrLoginPageUrl,
      qrLoginAppUrl,
      redirectToLoginOnce: login,
      LOGIN_PAGE_PATH: '/subpackages/pages/login/login',
      bootstrapH5AccessTokenFromUrl: bootstrapToken,
      clearAccessToken: () => (token = ''),
      useI18n: () => ({ t: (key: string) => key }),
      emptyI18nParams: () => ({}),
      authBrowserQuery: () => null,
      isNativeAppWebView: () => embedded,
      ensureAppWebViewNavigationReady: bridgeReady,
      switchMainTab: home,
      window: browserWindow,
      document: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        visibilityState: 'visible',
      },
      uni: { getStorageSync: () => token, navigateBack },
    },
  );
  return {
    page,
    info,
    scan,
    confirm,
    login,
    home,
    nativeHome,
    bridgeReady,
    bootstrapToken,
    browserWindow,
    navigateBack,
    back: (from = 'backbutton') => back({ from }),
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
    expect(f.browserWindow.location.replace).not.toHaveBeenCalled();
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
    if (app) expect(f.home).toHaveBeenCalledOnce();
    else expect(f.nativeHome).toHaveBeenCalledOnce();
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
    expect(app ? f.home : f.nativeHome).toHaveBeenCalledWith(
      expect.objectContaining({
        url: app
          ? '/pages/message/message'
          : '/pages/tab-shell/tab-shell?tab=/pages/message/message',
      }),
    );
    expect(f.navigateBack).not.toHaveBeenCalled();
  });
  it.each(['ready', 'error', 'invalid', 'success'])(
    '单页栈在 %s 状态点击完成或返回直接回首页',
    async (state) => {
      const f = setup(app);
      f.load();
      await settle();
      f.page.state.value = state;
      f.page.finish();
      await settle();
      expect(app ? f.home : f.nativeHome).toHaveBeenCalledWith(
        expect.objectContaining({
          url: app
            ? '/pages/message/message'
            : '/pages/tab-shell/tab-shell?tab=/pages/message/message',
        }),
      );
      expect(f.navigateBack).not.toHaveBeenCalled();
      expect(f.confirm).not.toHaveBeenCalled();
    },
  );
  it('单页栈系统返回回首页，重复点击只导航一次', async () => {
    const f = setup(app);
    f.load();
    await settle();
    expect(f.back()).toBe(true);
    f.page.finish();
    await settle();
    expect(app ? f.home : f.nativeHome).toHaveBeenCalledOnce();
    expect(f.navigateBack).not.toHaveBeenCalled();
  });
  it('应用内扫码取消退回上一页，放行 navigateBack 避免递归拦截', async () => {
    const f = setup(app, 'phone-session', [
      'pages/tab-shell/tab-shell',
      'subpackages/pages/qr-login/qr-login',
    ]);
    f.load();
    await settle();
    f.page.cancelLogin();
    await settle();
    if (app) {
      expect(f.navigateBack).toHaveBeenCalledOnce();
      expect(f.navigateBack).toHaveBeenCalledWith(
        expect.objectContaining({ delta: 1 }),
      );
    } else {
      expect(f.nativeHome).toHaveBeenCalledOnce();
      expect(f.navigateBack).not.toHaveBeenCalled();
    }
    expect(f.back('navigateBack')).toBe(false);
    expect(f.home).not.toHaveBeenCalled();
  });
  it('有上一页时系统返回只退一层，不重建首页', async () => {
    const f = setup(app, 'phone-session', [
      'pages/tab-shell/tab-shell',
      'subpackages/pages/qr-login/qr-login',
    ]);
    f.load();
    await settle();
    expect(f.back()).toBe(true);
    await settle();
    if (app) expect(f.navigateBack).toHaveBeenCalledOnce();
    else expect(f.nativeHome).toHaveBeenCalledOnce();
    expect(f.home).not.toHaveBeenCalled();
  });
  it('返回时立即丢弃迟到的未登录响应，不能又跳回登录页', async () => {
    const f = setup(app);
    let resolve!: (value: any) => void;
    f.info.mockReturnValueOnce(new Promise((done) => (resolve = done)));
    f.load();
    f.page.finish();
    // 导航完成前的 onShow 不能重新校验并把用户拉回扫码页。
    f.show();
    resolve({ code: '4010' });
    await settle();
    expect(f.login).not.toHaveBeenCalled();
    expect(f.scan).not.toHaveBeenCalled();
    expect(app ? f.home : f.nativeHome).toHaveBeenCalledOnce();
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
it('App 原生返回 API 失败时兜底回首页，失败后仍可再次退出', () => {
  const f = setup(true, 'phone-session', [
    'pages/tab-shell/tab-shell',
    'subpackages/pages/qr-login/qr-login',
  ]);
  f.navigateBack.mockImplementation((options: any) =>
    options.fail({ errMsg: 'navigateBack:fail' }),
  );
  f.home.mockImplementation((options: any) =>
    options.fail({ errMsg: 'switchTab:fail' }),
  );
  f.page.finish();
  expect(f.home).toHaveBeenCalledOnce();
  f.page.finish();
  expect(f.home).toHaveBeenCalledTimes(2);
});

describe('App 外 H5 扫码入口', () => {
  it.each(['', 'existing-browser-session'])(
    '浏览器 Token 为 %s 时直接跳下载页，不启动扫码或登录流程',
    async (token) => {
      const f = setup(false, token, undefined, false);
      f.load();
      f.show();
      f.hide();
      f.show();
      await f.page.prepareLogin();
      await f.page.confirmLogin();
      await settle();
      // 即使普通浏览器已加载 uni.webView JSSDK，也不能被当成 App 内。
      expect(f.browserWindow.uni.webView).toBeDefined();
      expect(f.browserWindow.location.replace).toHaveBeenCalledExactlyOnceWith(
        APP_DOWNLOAD_PAGE_URL,
      );
      expect(f.bootstrapToken).not.toHaveBeenCalled();
      expect(f.info).not.toHaveBeenCalled();
      expect(f.scan).not.toHaveBeenCalled();
      expect(f.confirm).not.toHaveBeenCalled();
      expect(f.login).not.toHaveBeenCalled();
    },
  );
});

it('App 无 Token 时先登录，不请求账号或扫码接口', async () => {
  const f = setup(true, '');
  f.load();
  await settle();
  expect(f.login).toHaveBeenCalledOnce();
  expect(f.info).not.toHaveBeenCalled();
});

describe('旧客户端内嵌扫码登录网页', () => {
  const nativeHomeUrl = '/pages/tab-shell/tab-shell?tab=/pages/message/message';
  it('随包 JSSDK 将退出请求送往原生服务，使用 1.2.8 已有的首页路由', async () => {
    const f = setup(false, 'phone-session', undefined, true);
    const nativeService = vi.fn();
    f.browserWindow.__uniapp_x_postMessage = vi.fn();
    f.browserWindow.__uniapp_x_postMessageToService = nativeService;
    const context: any = {
      window: f.browserWindow,
      document: { addEventListener: vi.fn() },
      navigator: { userAgent: 'uni-app appview' },
    };
    context.self = context;
    runInNewContext(
      readFileSync('static/uni.webview.1.5.5.js', 'utf8'),
      context,
    );
    f.browserWindow.uni = context.uni;
    f.page.cancelLogin();
    await settle();
    expect(nativeService).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: 'WEB_INVOKE_APPSERVICE',
        args: expect.objectContaining({
          data: expect.objectContaining({
            name: 'reLaunch',
            arg: { url: nativeHomeUrl },
          }),
        }),
      }),
    );
    expect(f.navigateBack).not.toHaveBeenCalled();
    expect(f.home).not.toHaveBeenCalled();
  });
  it('确认成功即退出原生容器回首页，不操作 H5 页面栈', async () => {
    const f = setup(false, 'phone-session', undefined, true);
    f.load();
    await settle();
    await f.page.confirmLogin();
    expect(f.confirm).toHaveBeenCalledOnce();
    expect(f.nativeHome).toHaveBeenCalledExactlyOnceWith({
      url: nativeHomeUrl,
    });
    expect(f.navigateBack).not.toHaveBeenCalled();
    expect(f.home).not.toHaveBeenCalled();
  });
  it('二维码过期后点取消，也退出原生容器回首页', async () => {
    const f = setup(false, 'phone-session', undefined, true);
    f.scan.mockResolvedValue({
      code: '4000',
      message: '二维码不存在、已过期或已失效',
    });
    f.load();
    await settle();
    expect(f.page.state.value).toBe('error');
    f.page.cancelLogin();
    await settle();
    expect(f.nativeHome).toHaveBeenCalledExactlyOnceWith({
      url: nativeHomeUrl,
    });
    expect(f.navigateBack).not.toHaveBeenCalled();
    expect(f.home).not.toHaveBeenCalled();
  });
  it('桥加载失败后允许重新退出，不假装已回到网页首页', async () => {
    const f = setup(false, 'phone-session', undefined, true);
    f.bridgeReady.mockResolvedValueOnce(false);
    f.page.finish();
    await settle();
    expect(f.nativeHome).not.toHaveBeenCalled();
    expect(f.home).not.toHaveBeenCalled();
    f.page.finish();
    await settle();
    expect(f.nativeHome).toHaveBeenCalledExactlyOnceWith({
      url: nativeHomeUrl,
    });
  });
  it('等待桥加载时页面已经卸载，不再发起迟到的首页跳转', async () => {
    const f = setup(false, 'phone-session', undefined, true);
    let resolve!: (ready: boolean) => void;
    f.bridgeReady.mockReturnValueOnce(new Promise((done) => (resolve = done)));
    f.page.finish();
    f.unload();
    resolve(true);
    await settle();
    expect(f.nativeHome).not.toHaveBeenCalled();
  });
  it('等待桥加载时切后台，回前台仍可再次点完成退出', async () => {
    const f = setup(false, 'phone-session', undefined, true);
    let resolve!: (ready: boolean) => void;
    f.bridgeReady.mockReturnValueOnce(new Promise((done) => (resolve = done)));
    f.page.state.value = 'success';
    f.page.finish();
    f.hide();
    resolve(true);
    await settle();
    expect(f.nativeHome).not.toHaveBeenCalled();
    f.show();
    f.page.finish();
    await settle();
    expect(f.nativeHome).toHaveBeenCalledExactlyOnceWith({
      url: nativeHomeUrl,
    });
  });
  it('确认失败不会自动退出或再次授权', async () => {
    const f = setup(false, 'phone-session', undefined, true);
    f.confirm.mockResolvedValue({ code: '4000' });
    f.load();
    await settle();
    await f.page.confirmLogin();
    expect(f.page.state.value).toBe('error');
    expect(f.nativeHome).not.toHaveBeenCalled();
    expect(f.confirm).toHaveBeenCalledOnce();
  });
});
