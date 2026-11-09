import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { expect, it, vi } from 'vitest';
vi.mock('@/utils/authSession', () => ({ hasLoginSession: () => false }));
vi.mock('@/utils/authNavigation', () => ({ redirectToLoginOnce: vi.fn() }));
vi.mock('@/utils/im/imForwardSession', () => ({ openShareIntoChat: vi.fn() }));
vi.mock('@/utils/i18n', () => ({
  emptyI18nParams: () => new Map(),
  t: (key: string) => key,
}));
import {
  isQrLoginLink,
  parseQrLoginLink,
  qrLoginAppUrl,
  qrLoginPageUrl,
} from '@/utils/qrLogin.uts';
import { parseShareUrl } from '@/utils/appShare.uts';
import { mobileLoginDestination } from '@/utils/authIdp.uts';

const origin = 'https://agent.nuwax.com';
function setup(incoming: string, onLoginPage = false) {
  const source = readFileSync('utils/qrLoginNavigation.uts', 'utf8')
    .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, '')
    .replace(/^export /gm, '')
    .replace(/^\s*\/\/ #(?:ifdef APP|endif).*$/gm, '');
  const login = vi.fn(),
    launch = vi.fn();
  let clock = 10000;
  const route = runInNewContext(
    transformSync(source + '\nrouteIncomingQrLogin;', { loader: 'ts' }).code,
    {
      isQrLoginLink,
      parseQrLoginLink,
      qrLoginPageUrl,
      currentQrLoginOrigin: () => origin,
      LOGIN_PAGE_PATH: '/subpackages/pages/login/login',
      redirectToLoginOnce: login,
      isOnLoginPage: () => onLoginPage,
      mobileLoginDestination,
      Date: { now: () => clock },
      uni: {
        getEnterOptionsSync: () => ({ appScheme: incoming }),
        reLaunch: launch,
      },
    },
  );
  return { route, login, launch, later: () => (clock += 3000) };
}
it('冷启动未登录保留完整确认场景，登录返回仍进入手动确认页', () => {
  const link = qrLoginAppUrl('scene-a', origin),
    f = setup(link);
  expect(f.route(false, '', true)).toBe(true);
  const url = qrLoginPageUrl('scene-a', origin);
  expect(f.login).toHaveBeenCalledWith('/subpackages/pages/login/login', url);
  const login = mobileLoginDestination(
    '/subpackages/pages/login/login',
    url,
    origin,
  );
  expect(decodeURIComponent(login.split('redirect=')[1])).toBe(url);
  expect(f.launch).not.toHaveBeenCalled();
});
it('热启动只消费本次明确链接，普通回前台不重放上一次登录码', () => {
  const link = qrLoginAppUrl('scene-a', origin),
    f = setup(link);
  expect(f.route(true, '')).toBe(false);
  expect(f.route(true, link)).toBe(true);
  expect(f.launch).toHaveBeenLastCalledWith({
    url: qrLoginPageUrl('scene-a', origin),
  });
  expect(f.route(true, link)).toBe(true);
  expect(f.launch).toHaveBeenCalledOnce();
  f.later();
  f.route(true, link);
  expect(f.launch).toHaveBeenCalledTimes(2);
});
it('已在登录页时，新扫码意图替换登录返回目标，重复回调不重建登录页', () => {
  const link = qrLoginAppUrl('scene-b', origin),
    f = setup(link, true);
  expect(f.route(false, link)).toBe(true);
  expect(f.login).not.toHaveBeenCalled();
  expect(f.launch).toHaveBeenCalledWith({
    url: mobileLoginDestination(
      '/subpackages/pages/login/login',
      qrLoginPageUrl('scene-b', origin),
      origin,
    ),
  });
  f.route(false, link);
  expect(f.launch).toHaveBeenCalledOnce();
});
it.each(['APP', 'MP-WEIXIN'])('扫码登录在 %s 只进入支持的确认路由', (platform) => {
  const component = readFileSync('components/scan-launcher/scan-launcher.uvue', 'utf8');
  const start = component.indexOf('  function routeScanResult(');
  const source = component.slice(start, component.indexOf('  /** 相机权限检查结果', start));
  const enabled = [true];
  const compiled = source.split('\n').filter((line) => {
    const directive = line.match(/^\s*\/\/ #(ifdef|ifndef) (.+)$/);
    if (directive) {
      const matches = directive[2].split('||').some((name) => name.trim() === platform);
      enabled.push(enabled[enabled.length - 1] && (directive[1] === 'ifdef' ? matches : !matches));
      return false;
    }
    if (/^\s*\/\/ #endif/.test(line)) {
      enabled.pop();
      return false;
    }
    return enabled[enabled.length - 1];
  }).join('\n');
  const navigate = vi.fn(), toast = vi.fn();
  const route = runInNewContext(
    transformSync(compiled + '\nrouteScanResult;', { loader: 'ts' }).code,
    {
      parseScanContent: () => ({ kind: 'qrLogin', qrLoginSceneId: 'scene-a', qrLoginOrigin: origin }),
      qrLoginPageUrl,
      navigateToPageOnce: navigate,
      t: (key: string) => key,
      uni: { showToast: toast },
    },
  );
  route(origin + '/qrlogin/scene-a');
  if (platform === 'APP') {
    expect(navigate).toHaveBeenCalledWith(qrLoginPageUrl('scene-a', origin));
    expect(toast).not.toHaveBeenCalled();
  } else {
    expect(navigate).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({ title: 'Mobile.Error.unsupportedPlatform', icon: 'none' });
  }
});
it('异域 scheme 进入错误页，不切企业域、不发起登录', () => {
  const f = setup('');
  f.route(true, qrLoginAppUrl('scene-a', 'https://evil.example'));
  expect(f.launch).toHaveBeenCalledWith({ url: qrLoginPageUrl('', '') });
  expect(f.login).not.toHaveBeenCalled();
});
it('登录二维码不能通过额外 kind 参数伪装成分享入口', () => {
  expect(
    parseShareUrl(qrLoginAppUrl('scene-a', origin) + '&kind=file&sk=foo'),
  ).toBeNull();
});

it('M 站首屏分流在桌面模式下保留扫码确认及其登录返回，其它页面仍回 PC', () => {
  const script = [
    ...readFileSync('index.html', 'utf8').matchAll(
      /<script>\s*([\s\S]*?)<\/script>/g,
    ),
  ].find((match) => match[1].includes('const isMobile'))![1];
  function run(path: string, userAgent: string) {
    const replace = vi.fn();
    const url = new URL(origin + path);
    const location = {
      href: url.href,
      protocol: url.protocol,
      host: url.host,
      hash: url.hash,
      hostname: url.hostname,
      port: url.port,
      replace,
    };
    runInNewContext(script, {
      window: { location },
      location,
      navigator: { userAgent },
      URL,
      URLSearchParams,
    });
    return replace;
  }
  const page = qrLoginPageUrl('scene-a', origin);
  for (const ua of [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X)',
    'iPhone Mobile',
  ]) {
    expect(run('/m/#' + page, ua)).not.toHaveBeenCalled();
    for (const back of [page, '/m/#' + page]) {
      expect(
        run(
          '/m/#/subpackages/pages/login/login?redirect=' +
            encodeURIComponent(back),
          ua,
        ),
      ).not.toHaveBeenCalled();
    }
  }
  expect(run('/m/#/pages/message/message', 'Macintosh')).toHaveBeenCalledWith(
    origin + '/',
  );
});
