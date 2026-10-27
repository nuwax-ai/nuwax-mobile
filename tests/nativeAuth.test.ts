import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { NativeAuthFlow } from '../utils/nativeAuthFlow.uts';
import { NativeAuthLaunch, NativeAuthSession } from '../types/interfaces/nativeAuth.uts';
import { NATIVE_AUTH_CALLBACK_URL, NATIVE_AUTH_MAX_AGE_MS } from '../constants/nativeAuth.uts';
import { decodeNativeAuthTransaction, parseNativeAuthCallback, trustedNativeAuthorizeUrl } from '../utils/nativeAuthProtocol.uts';

const hash = (value: string) => createHash('sha256').update(value).digest('base64url');
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function harness() {
  let now = 1_000_000;
  let origin = 'https://tenant.example';
  let stamp = 'account-generation-1';
  let secure = '';
  const crypto = { randomToken: () => randomBytes(32).toString('base64url'), sha256Base64Url: hash };
  const storage = { read: vi.fn(() => secure), write: vi.fn((raw: string) => { secure = raw; return true; }), clear: vi.fn(() => { secure = ''; return true; }) };
  const browser = { available: vi.fn(() => true), open: vi.fn(() => true), cancel: vi.fn() };
  const session = Object.assign(new NativeAuthSession(), { token: 'fixture-business-token', expiresAt: now + 600_000, resetPass: 1 });
  const backend = {
    prepare: vi.fn(async (request: any) => Object.assign(new NativeAuthLaunch(), {
      authorizeUrl: origin + '/api/oauth2/authorize?state=' + request.state + '&code_challenge=' + request.codeChallenge,
      serverTransactionId: 'fixture-transaction', expiresAt: now + 120_000,
    })),
    exchange: vi.fn(async () => session), verify: vi.fn(async () => '9007199254740993'),
  };
  const host = { currentOrigin: () => origin, currentSessionStamp: () => stamp, commit: vi.fn() };
  const make = (enabled = true, adapter: typeof backend | null = backend) => new NativeAuthFlow(crypto, storage, browser, adapter, host, enabled, () => now);
  const flow = make();
  const tx = () => JSON.parse(secure);
  const callback = (state = tx().state) => NATIVE_AUTH_CALLBACK_URL + '?code=fixture-code&state=' + state;
  return { flow, make, crypto, storage, browser, backend, host, session, tx, callback,
    read: () => secure, write: (raw: string) => { secure = raw; }, tick: (ms: number) => { now += ms; },
    setOrigin: (value: string) => { origin = value; }, setStamp: (value: string) => { stamp = value; }, now: () => now };
}

describe('原生授权安全边界', () => {
  it('未配置后端或功能关闭时不发请求、不打开浏览器', async () => {
    const h = harness();
    expect((await h.make(false).start('5', 'CAS', '')).status).toBe('blocked');
    expect((await h.make(true, null).start('5', 'CAS', '')).error).toBe('backend_unconfigured');
    expect(h.backend.prepare).not.toHaveBeenCalled();
    expect(h.browser.open).not.toHaveBeenCalled();
    expect(h.storage.write).not.toHaveBeenCalled();
  });
  it('微信 SDK 不在客户端实现范围内', async () => {
    const h = harness();
    expect((await h.flow.start('5', 'WECHAT', '')).error).toBe('provider_unsupported');
    expect(h.backend.prepare).not.toHaveBeenCalled();
  });
  it('拒绝不可信 origin、随机源失败及安全存储不可写', async () => {
    const h = harness(); h.setOrigin('http://tenant.example');
    expect((await h.flow.start('5', 'CAS', '')).error).toBe('invalid_configuration');
    h.setOrigin('https://tenant.example'); h.crypto.randomToken = () => 'insecure';
    expect((await h.flow.start('5', 'CAS', '')).error).toBe('crypto_unavailable');
    const other = harness(); other.storage.write.mockReturnValue(false);
    expect((await other.flow.start('5', 'CAS', '')).error).toBe('secure_storage_failed');
    expect(other.backend.prepare).not.toHaveBeenCalled();
  });
  it('PKCE 使用独立随机量，只向 prepare 交付 challenge，不泄漏 verifier', async () => {
    const h = harness();
    expect((await h.flow.start('5', 'CAS', '/pages/message/chat?convId=123')).status).toBe('authorizing');
    const tx = h.tx(); const request = h.backend.prepare.mock.calls[0][0];
    expect(tx.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tx.verifier).not.toBe(tx.state);
    expect(tx.challenge).toBe(hash(tx.verifier));
    expect(request.codeChallengeMethod).toBe('S256');
    expect(JSON.stringify(request)).not.toContain(tx.verifier);
    expect(JSON.stringify(h.browser.open.mock.calls)).not.toContain(tx.verifier);
    expect(JSON.stringify(h.flow.status())).not.toContain(tx.verifier);
  });
  it('RFC 7636 S256 向量是跨平台加密适配器的共同验收值', () => {
    expect(hash('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  it('重复点击只启动一笔事务', async () => {
    const h = harness(); await h.flow.start('5', 'CAS', '');
    expect((await h.flow.start('6', 'OAUTH2', '')).error).toBe('busy');
    expect(h.backend.prepare).toHaveBeenCalledOnce(); expect(h.browser.open).toHaveBeenCalledOnce();
  });
  it.each(['https://evil.example/authorize', 'https://tenant.example@evil.example/authorize', 'https://tenant.example/../authorize', 'https://tenant.example/%5cevil/authorize', 'https://tenant.example/authorize?code_verifier=secret'])('拒绝异常授权 URL %s', async url => {
    const h = harness(); h.backend.prepare.mockResolvedValue(Object.assign(new NativeAuthLaunch(), { authorizeUrl: url, expiresAt: h.now() + 30_000 }));
    expect((await h.flow.start('5', 'CAS', '')).error).toBe('invalid_launch_response');
    expect(h.browser.open).not.toHaveBeenCalled();
  });
  it('服务器更长 TTL 不扩大客户端寿命，系统浏览器不可用会清理事务', async () => {
    const h = harness(); h.backend.prepare.mockImplementation(async () => Object.assign(new NativeAuthLaunch(), { authorizeUrl: 'https://tenant.example/auth/start', expiresAt: h.now() + 999_999 }));
    await h.flow.start('5', 'CAS', ''); expect(h.tx().expiresAt - h.tx().createdAt).toBe(NATIVE_AUTH_MAX_AGE_MS);
    h.flow.cancel(); h.browser.open.mockReturnValue(false);
    expect((await h.flow.start('5', 'CAS', '')).error).toBe('browser_unavailable'); expect(h.read()).toBe('');
  });
  it('清理失败明确报错，并用无效记录阻止旧事务恢复', async () => {
    const h = harness(); await h.flow.start('5', 'CAS', ''); h.storage.clear.mockReturnValue(false);
    expect(h.flow.cancel().error).toBe('secure_storage_failed');
    expect(JSON.parse(h.read()).phase).toBe('cancelled');
    expect(h.make().restore().status).not.toBe('authorizing');
  });
});

describe('异步事务隔离与业务会话提交', () => {
  it('取消后 prepare 迟到，不能打开浏览器', async () => {
    const h = harness(); const gate = deferred<NativeAuthLaunch>(); h.backend.prepare.mockReturnValue(gate.promise);
    const pending = h.flow.start('5', 'CAS', ''); h.flow.cancel();
    gate.resolve(Object.assign(new NativeAuthLaunch(), { authorizeUrl: 'https://tenant.example/auth/start', expiresAt: h.now() + 30_000 }));
    expect((await pending).status).toBe('cancelled'); expect(h.browser.open).not.toHaveBeenCalled();
  });
  it('切域后迟到 prepare 不得导航', async () => {
    const h = harness(); const gate = deferred<NativeAuthLaunch>(); h.backend.prepare.mockReturnValue(gate.promise);
    const pending = h.flow.start('5', 'CAS', ''); h.setOrigin('https://new.example');
    gate.resolve(Object.assign(new NativeAuthLaunch(), { authorizeUrl: 'https://tenant.example/auth/start', expiresAt: h.now() + 30_000 }));
    expect((await pending).error).toBe('context_changed'); expect(h.browser.open).not.toHaveBeenCalled();
  });
  it('必须验证业务用户后才能保存会话，完成前清理 verifier，重放不再兑换', async () => {
    const h = harness(); await h.flow.start('5', 'CAS', 'https://evil.example');
    const tx = h.tx(); const uri = h.callback(); const gate = deferred<string>(); h.backend.verify.mockReturnValue(gate.promise);
    const pending = h.flow.handleResult(tx.id, 'callback', uri);
    await vi.waitFor(() => expect(h.backend.verify).toHaveBeenCalledOnce());
    expect(h.host.commit).not.toHaveBeenCalled();
    expect(h.backend.exchange.mock.calls[0][0]).toMatchObject({ origin: tx.origin, providerId: '5', code: 'fixture-code', codeVerifier: tx.verifier });
    await h.flow.handleResult(tx.id, 'callback', uri); expect(h.backend.exchange).toHaveBeenCalledOnce();
    h.host.commit.mockImplementation(() => expect(h.read()).toBe(''));
    gate.resolve('9007199254740993'); expect((await pending).status).toBe('completed');
    expect(h.host.commit).toHaveBeenCalledWith(h.session, '9007199254740993', '/pages/message/message');
    await h.flow.handleResult(tx.id, 'callback', uri); expect(h.backend.exchange).toHaveBeenCalledOnce();
  });
  it('外来回调保持当前事务，已验证的拒绝回调才取消', async () => {
    const h = harness(); await h.flow.start('5', 'CAS', ''); const id = h.tx().id;
    expect((await h.flow.handleResult(id, 'callback', h.callback('wrong'))).status).toBe('authorizing');
    expect(h.backend.exchange).not.toHaveBeenCalled();
    const state = h.tx().state;
    expect((await h.flow.handleResult(id, 'callback', NATIVE_AUTH_CALLBACK_URL + '?error=access_denied&state=' + state)).status).toBe('cancelled');
  });
  it('取消后 exchange 迟到不验证或落 Token', async () => {
    const h = harness(); await h.flow.start('5', 'CAS', ''); const tx = h.tx();
    const gate = deferred<NativeAuthSession>(); h.backend.exchange.mockReturnValue(gate.promise);
    const pending = h.flow.handleResult(tx.id, 'callback', h.callback()); h.flow.cancel(); gate.resolve(h.session);
    expect((await pending).status).toBe('cancelled'); expect(h.backend.verify).not.toHaveBeenCalled(); expect(h.host.commit).not.toHaveBeenCalled();
  });
  it.each(['domain', 'account', 'expired'])('验证中 %s 改变时不污染当前会话', async kind => {
    const h = harness(); await h.flow.start('5', 'CAS', ''); const tx = h.tx(); const gate = deferred<string>(); h.backend.verify.mockReturnValue(gate.promise);
    const pending = h.flow.handleResult(tx.id, 'callback', h.callback()); await vi.waitFor(() => expect(h.backend.verify).toHaveBeenCalledOnce());
    if (kind === 'domain') h.setOrigin('https://new.example');
    if (kind === 'account') h.setStamp('account-generation-2');
    if (kind === 'expired') h.tick(120_001);
    gate.resolve('123'); expect((await pending).status).not.toBe('completed'); expect(h.host.commit).not.toHaveBeenCalled();
  });
  it.each(['', 'token\nheader', '已过期'])('拒绝无效候选会话 %s', async token => {
    const h = harness(); await h.flow.start('5', 'CAS', ''); const id = h.tx().id;
    h.session.token = token; if (token === '已过期') { h.session.token = 'token'; h.session.expiresAt = h.now(); }
    expect((await h.flow.handleResult(id, 'callback', h.callback())).error).toBe('invalid_business_session');
    expect(h.host.commit).not.toHaveBeenCalled();
  });
  it('业务用户验证失败不落会话，错误结果不含后端异常里的秘密', async () => {
    const h = harness(); await h.flow.start('5', 'CAS', ''); const id = h.tx().id;
    h.backend.verify.mockRejectedValue(new Error('secret-token-in-backend-error'));
    const result = await h.flow.handleResult(id, 'callback', h.callback());
    expect(result.error).toBe('exchange_or_verify_failed'); expect(JSON.stringify(result)).not.toContain('secret-token'); expect(h.host.commit).not.toHaveBeenCalled();
  });
  it('本地保存失败不会错误报告已完成', async () => {
    const h = harness(); await h.flow.start('5', 'CAS', ''); const id = h.tx().id;
    h.host.commit.mockImplementation(() => { throw new Error('storage failed'); });
    expect((await h.flow.handleResult(id, 'callback', h.callback())).error).toBe('session_commit_failed');
  });
});

describe('安全恢复与回调解析', () => {
  it('同一会话恢复等待回调，既不重新 prepare 也不自动重开浏览器', async () => {
    const h = harness(); await h.flow.start('5', 'CAS', ''); const tx = h.tx(); const uri = h.callback();
    const restored = h.make(); expect(restored.restore().status).toBe('authorizing');
    expect(h.backend.prepare).toHaveBeenCalledOnce(); expect(h.browser.open).toHaveBeenCalledOnce();
    expect((await restored.handleResult(tx.id, 'callback', uri)).status).toBe('completed');
  });
  it.each(['exchanging', 'verifying', 'preparing'])('进程中断于 %s 时不重放不确定结果', async phase => {
    const h = harness(); await h.flow.start('5', 'CAS', ''); const tx = h.tx(); tx.phase = phase; h.write(JSON.stringify(tx));
    expect(h.make().restore().error).toBe('authorization_interrupted'); expect(h.backend.exchange).not.toHaveBeenCalled(); expect(h.read()).toBe('');
  });
  it('篡改、过期、版本未知与账号变化均拒绝恢复', async () => {
    const h = harness(); await h.flow.start('5', 'CAS', ''); const tx = h.tx();
    expect(decodeNativeAuthTransaction(JSON.stringify({ ...tx, version: 2 }), h.now())).toBeNull();
    expect(decodeNativeAuthTransaction(JSON.stringify({ ...tx, expiresAt: h.now() }), h.now())).toBeNull();
    h.write(JSON.stringify({ ...tx, challenge: 'x'.repeat(43) })); expect(h.make().restore().error).toBe('invalid_transaction');
    h.write(JSON.stringify(tx)); h.setStamp('new-account'); expect(h.make().restore().error).toBe('context_changed');
  });
  it.each([
    'https://evil.example/callback?code=a&state=STATE',
    'com.nuwax.app.auth://oauth/callback/extra?code=a&state=STATE',
    'com.nuwax.app.auth://oauth/callback?code=a&state=STATE&%73tate=STATE',
    'com.nuwax.app.auth://oauth/callback?code=a&state=STATE&error=',
    'com.nuwax.app.auth://oauth/callback?code=a&state=STATE#fragment',
    'com.nuwax.app.auth://oauth/callback?code=%0a&state=STATE',
    'com.nuwax.app.auth://oauth/callback?code=%ZZ&state=STATE',
    'com.nuwax.app.auth://oauth/callback?code=a&state=STATE&origin=https://evil.example',
  ])('拒绝异常回调 %s', uri => {
    expect(parseNativeAuthCallback(uri.replaceAll('STATE', 'x'.repeat(43)), NATIVE_AUTH_CALLBACK_URL, 'x'.repeat(43)).valid).toBe(false);
  });
  it('授权入口 URL 不可泄漏 verifier 或跨域', () => {
    const verifier = 'x'.repeat(43);
    expect(trustedNativeAuthorizeUrl('https://tenant.example/auth/start?token=' + verifier, 'https://tenant.example', verifier)).toBe(false);
    expect(trustedNativeAuthorizeUrl('https://tenant.example.evil/auth/start', 'https://tenant.example', verifier)).toBe(false);
  });
});
