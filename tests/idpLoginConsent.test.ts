import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { AuthLoadScope, parseAuthIdpList, availableAuthProviders, autoAuthProviderId } from '../utils/authIdp.uts';

// 执行组件的实际 script setup，覆盖 mounted 自动发起和手动确认两条入口。
const source = readFileSync('components/idp-login/idp-login.uvue', 'utf8');
const script = source.split('<script setup lang="uts">')[1].split('</script>')[0]
  .replace(/^import .+;\s*$/gm, '');
const code = transformSync(script + '\n({ login, busy, errorText });', { loader: 'ts' }).code;
const origin = 'https://tenant.example';

interface Options {
  agreed?: boolean;
  automaticId?: string;
  query?: Record<string, string>;
  recentAttempt?: boolean;
  disabled?: boolean;
  navigationFailure?: boolean;
  storageUnavailable?: boolean;
  items?: unknown;
}

async function setup(options: Options = {}) {
  const props = { agreed: options.agreed ?? false, disabled: options.disabled ?? false, redirectUrl: '/pages/message/chat?convId=123' };
  const order: string[] = [];
  const emit = vi.fn((name: string) => {
    if (name === 'agreed') { props.agreed = true; order.push('agreed'); }
  });
  const beginBrowserIdp = vi.fn(() => { order.push('authorize'); return !options.navigationFailure; });
  const showModal = vi.fn();
  const storage = new Map<string, string>();
  if (options.recentAttempt) storage.set('NUWAX_IDP_AUTO:' + origin + ':5', String(Date.now()));
  let mount: () => Promise<void> = async () => {};
  let disabledChanged: () => void = () => {};
  let shown: () => void = () => {};
  let hidden: () => void = () => {};
  const browserEvents = new Map<string, (event: { persisted: boolean }) => void>();
  const readStorage = vi.fn((key: string) => {
    if (options.storageUnavailable) throw new Error('storage unavailable');
    return storage.get(key) ?? null;
  });
  const context = {
    ref: <T>(value: T) => ({ value }),
    onMounted: (callback: () => Promise<void>) => { mount = callback; }, onUnmounted: vi.fn(),
    onShow: (callback: () => void) => { shown = callback; }, onHide: (callback: () => void) => { hidden = callback; },
    watch: (read: () => boolean, callback: (value: boolean) => void) => { disabledChanged = () => callback(read()); },
    defineProps: () => props, defineEmits: () => emit,
    AuthLoadScope, parseAuthIdpList, availableAuthProviders, autoAuthProviderId,
    getApiBaseUrl: () => origin, authBrowserOrigin: () => origin,
    authBrowserQuery: (key: string) => options.query?.[key] ?? null,
    authBrowserUserAgent: () => 'Chrome', canUseBrowserIdp: () => true, beginBrowserIdp,
    apiAuthIdpLoginList: async () => ({ code: '0000', data: { items: options.items === undefined ? [{ id: '5', type: 'CAS', name: '统一认证' }] : options.items, autoRedirectIdpId: options.automaticId ?? '5' } }),
    apiResCode: (response: any) => response.code, apiResData: (response: any) => response.data, SUCCESS_CODE: '0000',
    useI18n: () => ({ t: (key: string) => key }), emptyI18nParams: () => ({}),
    uni: { showModal }, window: {
      addEventListener: (name: string, callback: (event: { persisted: boolean }) => void) => browserEvents.set(name, callback),
      removeEventListener: (name: string) => browserEvents.delete(name),
    },
    sessionStorage: { getItem: readStorage, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
  };
  const handlers = runInNewContext(code, context);
  await mount();
  return { props, emit, beginBrowserIdp, showModal, order, storage, readStorage,
    // VM 与测试运行器分属不同 Promise realm，等本轮微任务全部完成再观察结果。
    show: async () => { shown(); await new Promise<void>(resolve => setImmediate(resolve)); }, hide: () => hidden(),
    browserRestore: async () => {
      browserEvents.get('pagehide')?.({ persisted: true });
      browserEvents.get('pageshow')?.({ persisted: true });
      await new Promise<void>(resolve => setImmediate(resolve));
    },
    setDisabled: (value: boolean) => { props.disabled = value; disabledChanged(); }, ...handlers };
}

describe('H5 统一认证的协议确认', () => {
  it('自动认证先勾选同意，再直接跳转，不等待确认弹窗', async () => {
    const page = await setup();
    expect(page.props.agreed).toBe(true);
    expect(page.showModal).not.toHaveBeenCalled();
    expect(page.beginBrowserIdp).toHaveBeenCalledWith('5', page.props.redirectUrl, true);
    expect(page.order).toEqual(['agreed', 'authorize']);
  });

  it('手动认证未勾选时等待确认，拒绝后恢复普通登录', async () => {
    const page = await setup({ automaticId: '' });
    page.login('5', false);
    expect(page.showModal).toHaveBeenCalledOnce();
    expect(page.beginBrowserIdp).not.toHaveBeenCalled();
    expect(page.props.agreed).toBe(false);
    page.showModal.mock.calls[0][0].success({ confirm: false });
    expect(page.busy.value).toBe(false);
    expect(page.emit).not.toHaveBeenCalledWith('agreed');
  });

  it('手动认证确认后才勾选并跳转', async () => {
    const page = await setup({ automaticId: '' });
    page.login('5', false);
    page.showModal.mock.calls[0][0].success({ confirm: true });
    expect(page.order).toEqual(['agreed', 'authorize']);
    expect(page.beginBrowserIdp).toHaveBeenCalledWith('5', page.props.redirectUrl, false);
  });

  it('手动认证已勾选时直接跳转', async () => {
    const page = await setup({ automaticId: '', agreed: true });
    page.login('5', false);
    expect(page.showModal).not.toHaveBeenCalled();
    expect(page.beginBrowserIdp).toHaveBeenCalledOnce();
  });

  it('本地表单 disabled 不覆盖服务端自动配置，且同次展示只发起一次', async () => {
    const page = await setup({ disabled: true });
    expect(page.storage.size).toBe(0);
    expect(page.beginBrowserIdp).toHaveBeenCalledOnce();
    page.setDisabled(false);
    expect(page.props.agreed).toBe(true);
    expect(page.beginBrowserIdp).toHaveBeenCalledOnce();
    page.setDisabled(true);
    page.setDisabled(false);
    expect(page.beginBrowserIdp).toHaveBeenCalledOnce();
  });

  it('跳转未发起时解除加载，不在同次展示内自动反复重试', async () => {
    const page = await setup({ navigationFailure: true });
    expect(page.busy.value).toBe(false);
    expect(page.errorText.value).toBe('Mobile.Auth.idpUnavailable');
    expect(page.storage.size).toBe(0);
    page.setDisabled(true);
    page.setDisabled(false);
    expect(page.beginBrowserIdp).toHaveBeenCalledOnce();
  });

  it.each([{ recentAttempt: true }, { storageUnavailable: true }])('自动跳转不依赖 sessionStorage 或旧尝试标识 %j', async options => {
    const page = await setup(options);
    expect(page.beginBrowserIdp).toHaveBeenCalledOnce();
    expect(page.readStorage).not.toHaveBeenCalled();
  });

  it('第三方返回后重新进入登录页时再次自动跳转', async () => {
    const page = await setup();
    page.hide();
    await page.show();
    expect(page.beginBrowserIdp).toHaveBeenCalledTimes(2);
    await page.show();
    expect(page.beginBrowserIdp).toHaveBeenCalledTimes(2);
  });

  it('浏览器后退恢复登录页时重新自动跳转', async () => {
    const page = await setup();
    await page.browserRestore();
    expect(page.beginBrowserIdp).toHaveBeenCalledTimes(2);
    await page.show();
    expect(page.beginBrowserIdp).toHaveBeenCalledTimes(2);
  });

  it('未配置自动认证时，空 idpError 仍提供错误提示', async () => {
    const page = await setup({ automaticId: '', query: { idpError: '' } });
    expect(page.errorText.value).toBe('Mobile.Auth.idpSessionFailed');
    expect(page.beginBrowserIdp).not.toHaveBeenCalled();
  });

  it.each([{ query: { local: '' } }, { query: { local: '1' } }, { query: { idpError: '' } }, { query: { idpError: 'failed' } }, { automaticId: '999', items: [] }, { items: null }, { items: [{ id: '5', type: 'WECHAT', wechatMode: 'OA' }] }])('自动配置不被本地参数或手动展示过滤覆盖 %j', async options => {
    const page = await setup(options);
    expect(page.props.agreed).toBe(true);
    expect(page.showModal).not.toHaveBeenCalled();
    expect(page.beginBrowserIdp).toHaveBeenCalledWith(options.automaticId ?? '5', page.props.redirectUrl, true);
    await page.browserRestore();
    expect(page.beginBrowserIdp).toHaveBeenCalledTimes(2);
  });

  it.each([{ automaticId: '' }, { automaticId: '../5' }])('服务端未配置或 ID 格式无效才保留普通表单 %j', async options => {
    const page = await setup(options);
    expect(page.props.agreed).toBe(false);
    expect(page.showModal).not.toHaveBeenCalled();
    expect(page.beginBrowserIdp).not.toHaveBeenCalled();
    await page.browserRestore();
    expect(page.beginBrowserIdp).not.toHaveBeenCalled();
  });
});
