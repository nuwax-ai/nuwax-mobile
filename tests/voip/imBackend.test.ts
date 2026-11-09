import { beforeEach, describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ request: vi.fn(), detail: vi.fn(), contacts: vi.fn(), me: vi.fn(), stamp: 'a' }));
vi.mock('../../servers/useRequest.uts', () => ({ default: f.request }));
vi.mock('../../servers/im.uts', () => ({ apiImConvDetail: f.detail, apiImContacts: f.contacts, apiImWhoami: f.me,
  getImDeviceId: () => 'physical-device', imDevicePlatform: () => 'android' }));
vi.mock('../../utils/apiResponse.uts', () => ({ apiResCode: (r: any) => r?.code, apiResData: (r: any) => r?.data }));
vi.mock('../../utils/im/imSessionScope.uts', () => ({ getImSessionStamp: () => f.stamp }));
import { createImVoipCall, imVoipCapabilities } from '../../servers/voipIm.uts';
const uid = '1987654321098765432', peer = '1987654321098765433', conv = '1987654321098765434';
beforeEach(() => {
  vi.resetAllMocks(); f.stamp = 'a';
  f.detail.mockResolvedValue({ code: '0000', data: { convType: 1, peerUserId: peer, peerName: 'Peer' } });
  f.contacts.mockResolvedValue({ code: '0000', data: { items: [{ userId: peer, subjectType: 1 }] } });
  f.me.mockResolvedValue({ code: '0000', data: { userId: uid } });
  f.request.mockResolvedValue({ code: '0000', data: { name: 'call-c1' } });
});
describe('actual IM backend adapter', () => {
  it('creates only a two-person RTC room, preserving all int64 IDs; native join sends the invitation', async () => {
    const call = await createImVoipCall(conv, 'video', 'c1');
    expect(call).toMatchObject({ protocol: 'im-voip-v1', callId: 'c1', roomName: 'call-c1', msgId: '', convId: conv, callerId: uid, calleeId: peer, mediaType: 'video', state: 'ringing' });
    expect(call.expiresAt).toBeGreaterThan(Date.now() + 59000);
    expect(f.request).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ url: '/api/instant-message/meetings/rtc/rooms', data: { name: 'call-c1', maxParticipants: 2, emptyTimeoutSeconds: 120, platform: 'android', deviceId: 'physical-device' } }));
  });
  it.each([2, 4])('does not enable group/space conversations (%s)', async convType => {
    f.detail.mockResolvedValue({ code: '0000', data: { convType, peerUserId: peer } });
    expect((await imVoipCapabilities(conv)).enabled).toBe(false);
  });
  it.each([2, undefined])('does not advertise agent or unknown subject capabilities (%s)', async subjectType => {
    f.contacts.mockResolvedValue({ code: '0000', data: { items: [{ userId: peer, subjectType }] } });
    expect((await imVoipCapabilities(conv)).audio).toBe(false);
    await expect(createImVoipCall(conv, 'audio', 'c1')).rejects.toThrow('CALL_MEDIA_UNSUPPORTED');
    expect(f.request).not.toHaveBeenCalled();
  });
  it('does not create a room after an account switch during eligibility lookup', async () => {
    f.contacts.mockImplementation(async () => { f.stamp = 'b'; return { code: '0000', data: { items: [{ userId: peer, subjectType: 1 }] } }; });
    await expect(createImVoipCall(conv, 'audio', 'c1')).rejects.toThrow('CALL_SESSION_CHANGED');
    expect(f.request).not.toHaveBeenCalled();
  });
  it('does not turn a failed room creation into a ringing call', async () => {
    f.request.mockResolvedValue({ code: 'IM_10503', data: null });
    await expect(createImVoipCall(conv, 'audio', 'c1')).rejects.toThrow('CALL_SERVICE_UNAVAILABLE');
  });
});
