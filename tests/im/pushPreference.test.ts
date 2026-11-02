import {beforeEach, expect, it, vi} from 'vitest';

const fixture=vi.hoisted(()=>({origin:'https://service-a.example', request:vi.fn()}));
vi.mock('@/constants/config',()=>({getApiBaseUrl:()=>fixture.origin}));
vi.mock('@/servers/useRequest',()=>({default:fixture.request}));
vi.mock('@/utils/common',()=>({generateUUID:()=> 'fixture-device'}));
vi.mock('@/uni_modules/nuwax-device-identity',()=>({getStableDeviceBaseId:()=> 'fixture-device'}));
vi.mock('@/utils/eventBus',()=>({default:{emit:vi.fn()}}));

let storage:Map<string,unknown>;
beforeEach(()=>{
 vi.resetModules();fixture.origin='https://service-a.example';fixture.request.mockReset();
 storage=new Map([['ACCESS_TOKEN','fixture-token-a'],['ACCESS_TOKEN_ORIGIN',fixture.origin]]);
 vi.stubGlobal('uni',{getStorageSync:(k:string)=>storage.get(k)??'',setStorageSync:(k:string,v:unknown)=>storage.set(k,v),removeStorageSync:(k:string)=>storage.delete(k),getSystemInfoSync:()=>({appVersion:'fixture',osVersion:'fixture'})});
 fixture.request.mockImplementation(async (r:any)=>({code:'0000',data:r.url.endsWith('/users/me')?{userId:'7'}:{deviceId:'fixture-device'}}));
});
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}

it('NW329 preference survives token rotation/logout but is isolated by user and service',async()=>{
 const p=await import('@/utils/im/imPushPreference.uts');
 expect(p.readImPushEnabled()).toBe(false);expect(p.bindImPushPreferenceUser('7')).toBe(true);expect(p.readImPushEnabled()).toBe(true);
 p.writeImPushEnabled(false);storage.set('ACCESS_TOKEN','rotated-token');expect(p.hasImPushPreferenceUser()).toBe(false);
 p.bindImPushPreferenceUser('7');expect(p.readImPushEnabled()).toBe(false);
 p.bindImPushPreferenceUser('8');expect(p.readImPushEnabled()).toBe(true);
 fixture.origin='https://service-b.example';expect(p.bindImPushPreferenceUser('7')).toBe(false);
 storage.set('ACCESS_TOKEN_ORIGIN',fixture.origin);p.bindImPushPreferenceUser('7');expect(p.readImPushEnabled()).toBe(true);
 const scoped=await import('@/utils/installScopedStorage.uts');const snapshot=scoped.snapshotInstallScopedStorage();storage.clear();scoped.restoreInstallScopedStorage(snapshot);
 fixture.origin='https://service-a.example';storage.set('ACCESS_TOKEN','new-login-token');storage.set('ACCESS_TOKEN_ORIGIN',fixture.origin);p.bindImPushPreferenceUser('7');expect(p.readImPushEnabled()).toBe(false);
});

it('NW329 closing push is serialized after an older registration; reconnect and cid refresh remain disabled',async()=>{
 const p=await import('@/utils/im/imPushPreference.uts');const api=await import('@/servers/im.uts');p.bindImPushPreferenceUser('7');
 const pending=deferred<any>();fixture.request.mockImplementationOnce(()=>pending.promise);
 const older=api.apiImDeviceRegister('cid-a');await vi.waitFor(()=>expect(fixture.request).toHaveBeenCalledTimes(1));
 expect(fixture.request.mock.calls[0][0].data.pushEnabled).toBe(true);
 p.writeImPushEnabled(false);const close=api.apiImDeviceRegister('cid-a');expect(fixture.request).toHaveBeenCalledTimes(1);
 pending.resolve({code:'0000',data:{}});await older;await close;await api.apiImDeviceRegister('cid-b');
 expect(fixture.request.mock.calls.slice(1).map(x=>[x[0].data.pushEnabled,x[0].data.pushToken])).toEqual([[false,'cid-a'],[false,'cid-b']]);
});

it('NW329 stale identity lookup and queued registrations cannot bind to another login',async()=>{
 const api=await import('@/servers/im.uts');const p=await import('@/utils/im/imPushPreference.uts');const pending=deferred<any>();
 fixture.request.mockImplementationOnce(()=>pending.promise);const lookup=api.ensureImPushPreferenceUser();
 storage.set('ACCESS_TOKEN','account-b-token');pending.resolve({code:'0000',data:{userId:'7'}});
 expect(await lookup).toBe(false);expect(p.hasImPushPreferenceUser()).toBe(false);
 p.bindImPushPreferenceUser('8');const held=deferred<any>();fixture.request.mockImplementationOnce(()=>held.promise);
 const first=api.apiImDeviceRegister('cid');await vi.waitFor(()=>expect(fixture.request).toHaveBeenCalledTimes(2));
 const queued=api.apiImDeviceRegister('cid').catch(e=>e.message);storage.set('ACCESS_TOKEN','account-c-token');held.resolve({code:'0000',data:{}});await first;
 expect(await queued).toBe('IM device session changed');expect(fixture.request).toHaveBeenCalledTimes(2);
});

it('NW329 identity failure does not silently disable an existing server registration',async()=>{
 const api=await import('@/servers/im.uts');fixture.request.mockResolvedValueOnce({code:'IM_90002',data:null});
 await expect(api.apiImDeviceRegister('cid')).rejects.toThrow('IM push identity unavailable');
 expect(fixture.request).toHaveBeenCalledTimes(1);expect(fixture.request.mock.calls[0][0].url).toContain('/users/me');
});

it('NW329 a legacy token without origin is confirmed by users/me and keeps default notifications enabled',async()=>{
 storage.delete('ACCESS_TOKEN_ORIGIN');const api=await import('@/servers/im.uts');const p=await import('@/utils/im/imPushPreference.uts');
 expect(await api.ensureImPushPreferenceUser()).toBe(true);expect(p.readImPushEnabled()).toBe(true);
 expect(fixture.request.mock.calls[0][0].url).toContain('/users/me');await api.apiImDeviceRegister('cid');
 expect(fixture.request.mock.calls[1][0].data.pushEnabled).toBe(true);
});
it('NW329 legacy-token whoami from a previous service cannot bind to the new service',async()=>{
 storage.delete('ACCESS_TOKEN_ORIGIN');const api=await import('@/servers/im.uts');const p=await import('@/utils/im/imPushPreference.uts');const pending=deferred<any>();
 fixture.request.mockImplementationOnce(()=>pending.promise);const lookup=api.ensureImPushPreferenceUser();expect(fixture.request).toHaveBeenCalledTimes(1);fixture.origin='https://service-b.example';
 pending.resolve({code:'0000',data:{userId:'7'}});expect(await lookup).toBe(false);expect(p.hasImPushPreferenceUser()).toBe(false);
});

it('NW329 queued legacy-token registration is invalidated when only the service changes',async()=>{
 storage.delete('ACCESS_TOKEN_ORIGIN');const api=await import('@/servers/im.uts');const p=await import('@/utils/im/imPushPreference.uts');p.bindImPushPreferenceUser('7');
 const held=deferred<any>();fixture.request.mockImplementationOnce(()=>held.promise);const first=api.apiImDeviceRegister('cid');
 await vi.waitFor(()=>expect(fixture.request).toHaveBeenCalledTimes(1));const queued=api.apiImDeviceRegister('cid').catch(e=>e.message);
 fixture.origin='https://service-b.example';held.resolve({code:'0000',data:{}});await first;
 expect(await queued).toBe('IM device session changed');expect(fixture.request).toHaveBeenCalledTimes(1);
});
