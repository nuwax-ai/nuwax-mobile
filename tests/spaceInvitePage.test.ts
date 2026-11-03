import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { spaceInvitePageUrl } from '../utils/spaceInvite.uts';

const source = readFileSync('subpackages/pages/space-invite/space-invite.uvue', 'utf8')
  .split('<script setup lang="uts">')[1].split('</script>')[0];
const active = { status: 'Active', spaceId: '1140', spaceName: '学校团队', joined: false };
const ok = (data: unknown) => ({ code: '0000', data });
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

function setup(options: { app?: boolean; token?: string; info?: object } = {}) {
  // 执行真实页面脚本，分别保留 H5 与 APP 的条件编译分支。
  const script = source.replace(/\/\/ #ifdef APP\n([\s\S]*?)\/\/ #endif/g, (_, body) => options.app ? body : '')
    .replace(/\/\/ #ifdef H5 \|\| WEB\n([\s\S]*?)\/\/ #endif/g, (_, body) => options.app ? '' : body)
    .replace(/^import .+;\s*$/gm, '');
  const info = vi.fn().mockResolvedValue(ok(options.info ?? active));
  const join = vi.fn().mockImplementation(async () => {
    info.mockResolvedValue(ok({ ...active, joined: true }));
    return ok(null);
  });
  const enter = vi.fn().mockResolvedValue(ok({ convId: '9007199254740993', convType: 4, name: '学校 & 交流', avatar: '/team.png?a=1&b=2' }));
  const redirect = vi.fn();
  const login = vi.fn();
  let load: (query: object) => void = () => {};
  let unload: () => void = () => {};
  const page = runInNewContext(transformSync(script + '\n({ continueInvite, state, errorText });', { loader: 'ts' }).code, {
    ref: <T>(value: T) => ({ value }), computed: vi.fn(),
    onLoad: (callback: typeof load) => { load = callback; }, onUnload: (callback: typeof unload) => { unload = callback; },
    apiSpaceInviteInfo: info, apiSpaceInviteJoin: join, apiImSpaceEnter: enter,
    apiResCode: (r: any) => r.code, apiResData: (r: any) => r.data, apiResMessage: (r: any) => r.message ?? '',
    SUCCESS_CODE: '0000', USER_NO_LOGIN: '4010', REDIRECT_LOGIN: '4011', ACCESS_TOKEN: 'ACCESS_TOKEN',
    redirectToLoginOnce: login, LOGIN_PAGE_PATH: '/subpackages/pages/login/login', spaceInvitePageUrl,
    useI18n: () => ({ t: (key: string) => key }), emptyI18nParams: () => ({}), authBrowserQuery: () => null,
    uni: { getStorageSync: () => options.token ?? 'session', redirectTo: redirect },
  });
  return { ...page, info, join, enter, redirect, login, load, unload };
}

describe('邀请页面自动入团并打开指定群', () => {
  it.each([false, true])('H5 / APP=%s 顺序加入并保留 int64 群号和查询编码', async app => {
    const p = setup({ app }); p.load({ code: 'school-code' }); await settle();
    expect(p.join).toHaveBeenCalledExactlyOnceWith('school-code');
    expect(p.enter).toHaveBeenCalledExactlyOnceWith('1140', spaceInvitePageUrl('school-code'));
    expect(p.redirect.mock.calls[0][0].url).toBe('/pages/message/chat?convId=9007199254740993&convType=4&name=%E5%AD%A6%E6%A0%A1%20%26%20%E4%BA%A4%E6%B5%81&avatar=%2Fteam.png%3Fa%3D1%26b%3D2');
  });

  it('原生未登录携带邀请码去原生登录，未发起加入请求', async () => {
    const p = setup({ app: true, token: '' }); p.load({ code: 'school' }); await settle();
    expect(p.login).toHaveBeenCalledExactlyOnceWith('/subpackages/pages/login/login', spaceInvitePageUrl('school'));
    expect(p.info).not.toHaveBeenCalled(); expect(p.join).not.toHaveBeenCalled();
  });

  it.each(['4010', '4011'])('登录过期 %s 保留原邀请，不进入群聊', async code => {
    const p = setup(); p.info.mockResolvedValue({ code }); p.load({ code: 'school' }); await settle();
    expect(p.login).toHaveBeenCalledWith('/subpackages/pages/login/login', spaceInvitePageUrl('school'));
    expect(p.join).not.toHaveBeenCalled(); expect(p.enter).not.toHaveBeenCalled();
  });

  it.each(['Expired', 'Disabled'])('失效邀请 %s 不执行写操作', async status => {
    const p = setup({ info: { ...active, status } }); p.load({ code: 'school' }); await settle();
    expect(p.state.value).toBe(status === 'Expired' ? 'expired' : 'disabled');
    expect(p.join).not.toHaveBeenCalled(); expect(p.enter).not.toHaveBeenCalled();
  });

  it('已有成员跳过加入，直接进入团队群', async () => {
    const p = setup({ info: { ...active, joined: true } }); p.load({ code: 'school' }); await settle();
    expect(p.join).not.toHaveBeenCalled(); expect(p.enter).toHaveBeenCalledOnce(); expect(p.redirect).toHaveBeenCalledOnce();
  });

  it('加入网络失败可重试，加入成功但进入失败不重复加入', async () => {
    const p = setup(); p.join.mockRejectedValueOnce(new Error('join offline'));
    p.load({ code: 'school' }); await settle();
    expect(p.state.value).toBe('error'); expect(p.enter).not.toHaveBeenCalled();
    p.enter.mockRejectedValueOnce(new Error('enter offline'));
    await p.continueInvite(); expect(p.state.value).toBe('error'); expect(p.redirect).not.toHaveBeenCalled();
    await p.continueInvite();
    expect(p.join).toHaveBeenCalledTimes(2); expect(p.enter).toHaveBeenCalledTimes(2); expect(p.redirect).toHaveBeenCalledOnce();
  });

  it('卸载后忽略旧响应，重复触发不重复提交', async () => {
    const p = setup(); let resolve!: (value: unknown) => void;
    p.info.mockReturnValue(new Promise(done => { resolve = done; }));
    p.load({ code: 'school' }); await p.continueInvite();
    expect(p.info).toHaveBeenCalledOnce(); p.unload(); resolve(ok(active)); await settle();
    expect(p.join).not.toHaveBeenCalled(); expect(p.redirect).not.toHaveBeenCalled();
  });
});
