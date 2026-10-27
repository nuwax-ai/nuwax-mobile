import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { AuthLoadScope, parseAuthIdpList, availableAuthProviders, autoAuthProviderId } from '../utils/authIdp.uts';
import { MOBILE_IDP_ENABLED_TYPES, MOBILE_IDP_ALLOWED_IDS } from '../constants/authIdp.uts';

// 执行组件的实际 script setup，覆盖 mounted 自动发起和手动确认两条入口。
const source = readFileSync('components/idp-login/idp-login.uvue', 'utf8');
const script = source.split('<script setup lang="uts">')[1].split('</script>')[0]
  .replace(/^import .+;\s*$/gm, '');
const code = transformSync(script + '\n({ login, busy });', { loader: 'ts' }).code;
const origin = 'https://tenant.example';

interface Options {
  agreed?: boolean;
  allowAutomatic?: boolean;
  automaticId?: string;
  query?: Record<string, string>;
  recentAttempt?: boolean;
}

async function setup(options: Options = {}) {
  const props = { agreed: options.agreed ?? false, disabled: false, redirectUrl: '/pages/message/chat?convId=123', allowAutomatic: options.allowAutomatic ?? true };
  const order: string[] = [];
  const emit = vi.fn((name: string) => {
    if (name === 'agreed') { props.agreed = true; order.push('agreed'); }
  });
  const beginBrowserIdp = vi.fn(() => { order.push('authorize'); return true; });
  const showModal = vi.fn();
  const storage = new Map<string, string>();
  if (options.recentAttempt) storage.set('NUWAX_IDP_AUTO:' + origin + ':5', String(Date.now()));
  let mount: () => Promise<void> = async () => {};
  const context = {
    ref: <T>(value: T) => ({ value }),
    onMounted: (callback: () => Promise<void>) => { mount = callback; }, onUnmounted: vi.fn(),
    defineProps: () => props, defineEmits: () => emit,
    AuthLoadScope, parseAuthIdpList, availableAuthProviders, autoAuthProviderId,
    MOBILE_IDP_ENABLED_TYPES, MOBILE_IDP_ALLOWED_IDS,
    getApiBaseUrl: () => origin, authBrowserOrigin: () => origin,
    authBrowserQuery: (key: string) => options.query?.[key] ?? null,
    authBrowserUserAgent: () => 'Chrome', canUseBrowserIdp: () => true, beginBrowserIdp,
    apiAuthIdpLoginList: async () => ({ code: '0000', data: { items: [{ id: '5', type: 'CAS', name: '统一认证' }], autoRedirectIdpId: options.automaticId ?? '5' } }),
    apiResCode: (response: any) => response.code, apiResData: (response: any) => response.data, SUCCESS_CODE: '0000',
    useI18n: () => ({ t: (key: string) => key }), emptyI18nParams: () => ({}),
    uni: { showModal }, window: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
  };
  const handlers = runInNewContext(code, context);
  await mount();
  return { props, emit, beginBrowserIdp, showModal, order, ...handlers };
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
    const page = await setup({ allowAutomatic: false });
    page.login('5', false);
    expect(page.showModal).toHaveBeenCalledOnce();
    expect(page.beginBrowserIdp).not.toHaveBeenCalled();
    expect(page.props.agreed).toBe(false);
    page.showModal.mock.calls[0][0].success({ confirm: false });
    expect(page.busy.value).toBe(false);
    expect(page.emit).not.toHaveBeenCalledWith('agreed');
  });

  it('手动认证确认后才勾选并跳转', async () => {
    const page = await setup({ allowAutomatic: false });
    page.login('5', false);
    page.showModal.mock.calls[0][0].success({ confirm: true });
    expect(page.order).toEqual(['agreed', 'authorize']);
    expect(page.beginBrowserIdp).toHaveBeenCalledWith('5', page.props.redirectUrl, false);
  });

  it('手动认证已勾选时直接跳转', async () => {
    const page = await setup({ allowAutomatic: false, agreed: true });
    page.login('5', false);
    expect(page.showModal).not.toHaveBeenCalled();
    expect(page.beginBrowserIdp).toHaveBeenCalledOnce();
  });

  it.each([{ query: { local: '' } }, { query: { idpError: '' } }, { recentAttempt: true }, { automaticId: '999' }])('保留普通登录回退与防循环限制 %j', async options => {
    const page = await setup(options);
    expect(page.props.agreed).toBe(false);
    expect(page.showModal).not.toHaveBeenCalled();
    expect(page.beginBrowserIdp).not.toHaveBeenCalled();
  });
});
