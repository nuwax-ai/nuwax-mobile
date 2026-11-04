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
function setup(incoming: string) {
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
