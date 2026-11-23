import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApiBaseUrl, setApiBaseUrl } from '@/constants/config.uts';
import { apiImDeviceRegister, revokeManagedImPushBinding } from '@/servers/im.uts';
import { SUCCESS_CODE } from '@/constants/codes.constants';
import { invalidateImSession } from '@/utils/im/imSessionScope.uts';
import { IM_DEVICE_BASE_ID_STORAGE_KEY, IM_PUSH_BINDING_KEY } from '@/utils/installScopedStorage.uts';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/servers/useRequest.uts', () => ({ default: request }));
vi.mock('@/utils/common.uts', () => ({ generateUUID: () => 'fallback-device' }));

const origin = 'https://testagent.xspaceagi.com';
const activeId = 'cb67ff9e-54ee-44ef-a6c0-601fd536cdf5';
const releaseId = 'a4fd618f-48a9-407b-b51b-1875b078ab40';
const storage = new Map<string, unknown>();

beforeEach(() => {
  request.mockReset();
  storage.clear();
  vi.stubGlobal('uni', {
    getStorageSync: (name: string) => storage.get(name),
    setStorageSync: (name: string, value: unknown) => storage.set(name, value),
  });
  invalidateImSession();
  setApiBaseUrl(origin);
  storage.set(IM_DEVICE_BASE_ID_STORAGE_KEY, 'fixture-device');
  storage.set(IM_PUSH_BINDING_KEY, [origin, activeId, '1'].join('\n'));
});

afterEach(() => vi.unstubAllGlobals());

describe('App push binding handoff', () => {
  it('persists the confirmed release and prevents renewal in the outgoing session', async () => {
    request.mockResolvedValueOnce({ code: SUCCESS_CODE,
      data: { registrationId: releaseId, environment: 'test', active: false } });
    expect(await revokeManagedImPushBinding(origin, true, true)).toBe(true);
    expect(request.mock.calls[0][0]).toMatchObject({ method: 'DELETE',
      url: expect.stringMatching(/\/fixture-device[^/]*\/push-binding\?registrationId=/) });
    expect(storage.get(IM_PUSH_BINDING_KEY)).toBe([origin, releaseId, '0'].join('\t'));
    await expect(apiImDeviceRegister('outgoing-cid')).rejects.toThrow('IM device session changed');
    expect(await revokeManagedImPushBinding(origin, false, true)).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('preserves the active receipt when revocation is unconfirmed or belongs to another environment', async () => {
    expect(await revokeManagedImPushBinding(origin, false, true)).toBe(false);
    expect(request).not.toHaveBeenCalled();
    request.mockRejectedValueOnce(new Error('offline'));
    expect(await revokeManagedImPushBinding(origin, true, true)).toBe(false);
    request.mockResolvedValueOnce({ code: SUCCESS_CODE,
      data: { registrationId: releaseId, environment: 'production', active: false } });
    expect(await revokeManagedImPushBinding(origin, true, true)).toBe(false);
    expect(storage.get(IM_PUSH_BINDING_KEY)).toBe([origin, activeId, '1'].join('\n'));
    expect(getApiBaseUrl()).toBe(origin);
  });

  it('blocks ordinary push registration from the signing-out session if the managed release fails', async () => {
    request.mockRejectedValueOnce(new Error('offline'));
    expect(await revokeManagedImPushBinding(origin, true, false, true)).toBe(false);
    await expect(apiImDeviceRegister('outgoing-cid')).rejects.toThrow('IM device session changed');
    expect(request).toHaveBeenCalledOnce();

    invalidateImSession();
    request.mockResolvedValueOnce({ code: SUCCESS_CODE, data: {} });
    await expect(apiImDeviceRegister('incoming-cid')).resolves.toMatchObject({ code: SUCCESS_CODE });
    expect(request.mock.lastCall?.[0]).toMatchObject({ method: 'POST', data: expect.objectContaining({ pushToken: 'incoming-cid' }) });
  });

  it('uses the outgoing origin’s active receipt and preserves a different origin’s release', async () => {
    const production = 'https://agent.nuwax.com';
    const productionRelease = '481ea175-210e-45d3-90d0-0282ab7bca6a';
    const productionRecord = [production, productionRelease, '0'].join('\t');
    storage.set(IM_PUSH_BINDING_KEY, [productionRecord, [origin, activeId, '1'].join('\t')].join('\n'));
    setApiBaseUrl(production);
    expect(await revokeManagedImPushBinding(production, true, true)).toBe(false);
    expect(request).not.toHaveBeenCalled();

    setApiBaseUrl(origin);
    request.mockResolvedValueOnce({ code: SUCCESS_CODE,
      data: { registrationId: releaseId, environment: 'test', active: false } });
    expect(await revokeManagedImPushBinding(origin, true, true)).toBe(true);
    expect(request.mock.calls[0][0].url).toContain(`registrationId=${activeId}`);
    expect(storage.get(IM_PUSH_BINDING_KEY)).toBe([productionRecord, [origin, releaseId, '0'].join('\t')].join('\n'));
  });
});
