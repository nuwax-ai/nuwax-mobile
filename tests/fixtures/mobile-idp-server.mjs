import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

// 仅在 loopback 提供本地模拟接口，不转发真实 API，不使用真实账号或凭据。
if (!process.argv[2]) throw new Error('Usage: node tests/fixtures/mobile-idp-server.mjs <HBuilderX web output>');
const root = path.resolve(process.argv[2]);
const port = Number(process.env.IDP_FIXTURE_PORT || 18765);
const providers = [
  { id: '101', type: 'CAS', name: '西财统一认证（本地模拟）' },
  { id: '102', type: 'OAUTH2', name: 'OAuth2（本地模拟）' },
  { id: '103', type: 'WECHAT', name: '微信', wechatMode: 'QRCODE' },
];
const state = { auto: null, listFailure: false, verifyFailure: false, authorizeFailure: false, pending: false, events: [] };
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const json = (data, code = '0000', message = '') => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ code, message, data }));
  };
  const redirect = (target) => { res.writeHead(302, { location: target }); res.end(); };
  if (url.pathname === '/_fixture') {
    if (req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      Object.assign(state, JSON.parse(body));
    }
    return json(state);
  }
  const signedIn = (req.headers.cookie || '').includes('ticket=local-fixture-session');
  if (url.pathname.startsWith('/api/')) {
    state.events.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), cookieSession: signedIn, hasAuthorization: Boolean(req.headers.authorization) });
    if (url.pathname === '/api/auth/idp/list') return json({ items: providers, autoRedirectIdpId: state.auto }, state.listFailure ? '4011' : '0000', state.listFailure ? '/login' : '');
    if (url.pathname === '/api/tenant/config') return json({ siteName: '西财 H5 本地验收', siteLogo: '', openCaptcha: 0, openImageCaptcha: 0, authType: 0 });
    if (url.pathname === '/api/user/getLoginInfo') return json(signedIn ? { id: '100', userName: '本地验证账号', nickName: '本地验证账号', resetPass: 1 } : null, signedIn && !state.verifyFailure ? '0000' : '4010');
    if (url.pathname === '/api/auth/idp/authorize') {
      const target = url.searchParams.get('redirect');
      if (!target?.startsWith('/m/#/subpackages/pages/auth/idp-return?')) return json(null, '4000');
      if (state.authorizeFailure) return redirect(target + '&idpError=' + encodeURIComponent('统一认证暂不可用（本地模拟）'));
      if (state.pending) return redirect('/auth/bind-or-register?token=local-pending&redirect=' + encodeURIComponent(target));
      res.setHeader('Set-Cookie', 'ticket=local-fixture-session; Path=/; HttpOnly; SameSite=Lax');
      return redirect(target);
    }
    if (url.pathname === '/api/user/passwordLogin' || url.pathname === '/api/user/codeLogin') {
      res.setHeader('Set-Cookie', 'ticket=local-fixture-session; Path=/; HttpOnly; SameSite=Lax');
      return json({ token: 'fixture-not-for-storage', resetPass: 1 });
    }
    if (url.pathname === '/api/user/logout') {
      res.setHeader('Set-Cookie', 'ticket=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
      return json(null);
    }
    if (url.pathname.includes('/i18n/')) return json([]);
    return json({ records: [], list: [], total: 0 });
  }
  if (url.pathname === '/auth/bind-or-register') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (signedIn) return res.end('<p>首次关联续接成功（本地模拟）</p>');
    const login = '/m/#/subpackages/pages/login/login?redirect=' + encodeURIComponent('/auth/bind-or-register?token=local-pending&bind=1');
    return res.end('<p>首次关联（本地模拟）</p><a href="' + login + '">登录已有账号</a>');
  }
  try {
    const relative = decodeURIComponent(url.pathname).replace(/^\/m\/?/, '');
    const file = path.resolve(root, relative || 'index.html');
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    const content = await fs.readFile(file);
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(content);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Local mobile IdP fixture: http://127.0.0.1:${port}/m/`));
