import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';

function platformSource(source: string, platforms = ['APP', 'APP-ANDROID']) {
  const active = [true];
  return source.split('\n').filter(line => {
    const directive = line.match(/^\s*\/\/ #(ifdef|ifndef) (.+)$/);
    if (directive) {
      const matches = directive[2].split('||').some(p => platforms.includes(p.trim()));
      active.push(active[active.length - 1] && (directive[1] === 'ifdef' ? matches : !matches));
      return false;
    }
    if (/^\s*\/\/ #endif/.test(line)) { active.pop(); return false; }
    return active[active.length - 1];
  }).join('\n');
}
function evaluate(file: string, names: string[], context: object, platforms?: string[]) {
  let source = readFileSync(file, 'utf8');
  if (file.endsWith('.uvue')) source = source.split('<script setup lang="uts">')[1].split('</script>')[0];
  source = platformSource(source, platforms)
    .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, '')
    .replace(/^export /gm, '');
  return runInNewContext(transformSync(source + `\n({ ${names.join(',')} });`, { loader: 'ts' }).code, context);
}
function setup(consent = true, initialToken = '', platforms?: string[]) {
  let token = initialToken;
  let accepted = consent;
  let routes = ['pages/tab-shell/tab-shell'];
  const ticks: (() => void)[] = [];
  const context: any = {
    ref: (value: unknown) => ({ value }),
    ACCESS_TOKEN: 'token', hasAppPrivacyConsent: () => accepted,
    nextTick: (callback: () => void) => ticks.push(callback),
    CUSTOM_TAB_BAR_ENABLED: true, closeAllPopups: vi.fn(),
    getCurrentPages: () => routes.map(route => ({ route })),
    uni: { getStorageSync: () => token, reLaunch: vi.fn(), navigateBack: vi.fn(), switchTab: vi.fn() },
  };
  Object.assign(context, evaluate('utils/appEntryState.uts', [
    'appEntryStage', 'appEntryLoginReturn', 'attachAppEntry', 'detachAppEntry',
    'resolveAppEntryStage', 'activateAppEntryMain', 'hasAppEntryToken',
    'isAppEntryLogin', 'showAppEntryLogin', 'takeAppEntryColdStart',
  ], context, platforms));
  Object.assign(context, evaluate('utils/mainTabNavigation.uts', [
    'MAIN_TAB_PATHS', 'isMainTabPath', 'mainTabPathOnly', 'selectMainTab',
    'switchMainTab', 'resolveMainTabPagePath', 'mainTabActivePath',
  ], context, platforms));
  context.getCurrentPageFullPath = () => context.resolveMainTabPagePath(routes[routes.length - 1]);
  context.mobileLoginDestination = (url: string, back: string) => url.includes('?redirect=')
    ? url : `${url}?redirect=${encodeURIComponent(back || '/pages/message/message')}`;
  Object.assign(context, evaluate('utils/authNavigation.uts', [
    'redirectToLoginOnce', 'isOnLoginPage',
  ], context, platforms));
  return {
    api: context,
    setToken: (value: string) => { token = value; },
    consent: () => { accepted = true; },
    setRoutes: (value: string[]) => { routes = value; },
    settle: () => { while (ticks.length > 0) ticks.shift()!(); },
  };
}

describe('固定根页面的鉴权门禁与导航', () => {
  it.each(['', 'saved-token'])('未授权时即使 Token=%s，也不挂载登录/主界面', token => {
    const { api } = setup(false, token);
    api.attachAppEntry();
    expect(api.appEntryStage.value).toBe('privacy');
    api.activateAppEntryMain();
    expect(api.appEntryStage.value).toBe('privacy');
    expect(api.showAppEntryLogin('/pages/message/message')).toBe(false);
  });
  it.each([['', 'login'], ['saved-token', 'main']])('授权后由本地 Token 直接选择 %s → %s', (token, stage) => {
    const { api } = setup(true, token);
    api.attachAppEntry();
    expect(api.appEntryStage.value).toBe(stage);
    expect(api.uni.reLaunch).not.toHaveBeenCalled();
  });
  it('保存 Token 不会自动退出强制改密，显式完成登录才原位进入首页', () => {
    const f = setup(); const { api } = f;
    api.attachAppEntry(); f.setToken('new-token');
    expect(api.appEntryStage.value).toBe('login');
    const success = vi.fn();
    api.switchMainTab({ url: '/pages/message/message', success });
    expect(api.appEntryStage.value).toBe('main');
    expect(success).not.toHaveBeenCalled(); f.settle();
    expect(success).toHaveBeenCalledOnce();
    expect(api.uni.reLaunch).not.toHaveBeenCalled();
    expect(api.uni.navigateBack).not.toHaveBeenCalled();
  });
  it('根页面上的过期登录态原位回登录，并发 401 不覆盖扫码回跳', () => {
    const f = setup(true, 'expired'); const { api } = f;
    api.attachAppEntry(); f.setToken('');
    expect(api.redirectToLoginOnce('/subpackages/pages/login/login', '/pages/mine/mine')).toBe(true);
    expect(api.appEntryStage.value).toBe('login');
    expect(api.isOnLoginPage()).toBe(true);
    const qr = '/subpackages/pages/qr-login/qr-login?sceneId=a&origin=https%3A%2F%2Fagent.nuwax.com';
    expect(api.showAppEntryLogin(qr)).toBe(true);
    expect(api.redirectToLoginOnce('/subpackages/pages/login/login', '/pages/message/message')).toBe(false);
    expect(api.appEntryLoginReturn.value).toBe(qr);
    expect(api.uni.reLaunch).not.toHaveBeenCalled();
  });
  it('深层页面鉴权失效仍沿用清栈登录，不把登录藏在详情后面', () => {
    const f = setup(true, 'token'); const { api } = f;
    api.attachAppEntry(); f.setRoutes(['pages/tab-shell/tab-shell', 'pages/message/chat']);
    api.redirectToLoginOnce('/subpackages/pages/login/login', '/pages/message/chat?id=1');
    expect(api.uni.reLaunch).toHaveBeenCalledOnce();
    expect(api.uni.reLaunch.mock.calls[0][0].url).toContain(encodeURIComponent('/pages/message/chat?id=1'));
  });
  it('旧根页面延迟卸载不会取消新根页面的所有权；启动链接每进程只消费一次', () => {
    const { api } = setup();
    const oldOwner = api.attachAppEntry(); const newOwner = api.attachAppEntry();
    api.detachAppEntry(oldOwner);
    expect(api.showAppEntryLogin('/pages/mine/mine')).toBe(true);
    expect(api.takeAppEntryColdStart()).toBe(true);
    expect(api.takeAppEntryColdStart()).toBe(false);
    api.detachAppEntry(newOwner);
    expect(api.showAppEntryLogin('/pages/mine/mine')).toBe(false);
  });
  it('H5 不接管既有登录页面路由', () => {
    const { api } = setup(true, '', ['H5', 'WEB']);
    api.attachAppEntry();
    expect(api.isAppEntryLogin()).toBe(false);
    expect(api.showAppEntryLogin('/pages/mine/mine')).toBe(false);
  });
});

describe('根页面冷启动生命周期', () => {
  function root(consent: boolean, token: string) {
    const f = setup(consent, token); const { api } = f;
    const hooks: Record<string, (...args: any[]) => any> = {};
    const callbacks: ((accepted: boolean) => void)[] = [];
    for (const name of ['onLoad', 'onShow', 'onHide', 'onReady', 'onUnload', 'onBackPress', 'onResize']) {
      api[name] = (callback: (...args: any[]) => any) => { hooks[name] = callback; };
    }
    api.prepareAppPrivacyConsent = (done: (accepted: boolean) => void) => callbacks.push(done);
    api.routeIncomingQrLogin = vi.fn(() => false);
    api.scheduleImPushAfterLogin = vi.fn();
    api.schedulePushBackgroundGuideAfterLogin = vi.fn();
    const page = evaluate('pages/tab-shell/tab-shell.uvue', ['acceptPrivacy', 'pageVisible'], api);
    return { ...f, hooks, callbacks, page };
  }
  it.each(['', 'saved-token'])('普通冷启动 Token=%s 不进行跨页面跳转，首屏不等接口', token => {
    const f = root(true, token);
    f.hooks.onLoad({}); f.hooks.onShow(); f.hooks.onReady(); f.settle();
    expect(f.api.appEntryStage.value).toBe(token ? 'main' : 'login');
    expect(f.api.routeIncomingQrLogin).toHaveBeenCalledWith(token.length > 0, '', true);
    expect(f.api.uni.reLaunch).not.toHaveBeenCalled();
    expect(f.api.uni.switchTab).not.toHaveBeenCalled();
    f.callbacks[0](true); f.settle();
    expect(f.api.routeIncomingQrLogin).toHaveBeenCalledOnce();
  });
  it('首次隐私同意前不读启动链接、不注册推送，同意后在本页面显示登录', () => {
    const f = root(false, '');
    f.hooks.onLoad({}); f.hooks.onReady(); f.settle();
    expect(f.api.routeIncomingQrLogin).not.toHaveBeenCalled();
    expect(f.api.scheduleImPushAfterLogin).not.toHaveBeenCalled();
    f.consent(); f.page.acceptPrivacy(); f.settle();
    expect(f.api.appEntryStage.value).toBe('login');
    expect(f.api.routeIncomingQrLogin).toHaveBeenCalledOnce();
    expect(f.api.uni.reLaunch).not.toHaveBeenCalled();
  });
  it('卸载后忽略晚到的隐私准备回调，页面显隐传给内容', () => {
    const f = root(false, 'token');
    f.hooks.onLoad({}); f.hooks.onShow();
    expect(f.page.pageVisible.value).toBe(true);
    f.hooks.onHide(); expect(f.page.pageVisible.value).toBe(false);
    f.hooks.onUnload(); f.consent(); f.callbacks[0](true); f.settle();
    expect(f.api.appEntryStage.value).toBe('privacy');
    expect(f.api.scheduleImPushAfterLogin).not.toHaveBeenCalled();
  });
});
