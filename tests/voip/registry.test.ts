import { describe, expect, it } from 'vitest';
import { CallRegistry } from '../../scripts/voip-dev/registry.mjs';

describe('call service contract', () => {
  const create = (r: CallRegistry, requestId = 'r1') => r.create('alice', 'a1', { convId: 'demo-people', mediaType: 'audio', requestId });
  it('derives callee from conversation membership and enforces busy/idempotency', () => {
    const r = new CallRegistry(); const c = create(r);
    expect(create(r)).toEqual(c);
    expect(c.calleeId).toBe('bob');
    expect(() => create(r, 'r2')).toThrow('CALL_BUSY');
    expect(() => r.create('mallory', 'm1', { convId: 'demo-people', mediaType: 'audio', requestId: 'r' })).toThrow('CALL_NOT_FOUND');
    expect(() => r.get(c.callId, 'mallory')).toThrow('CALL_NOT_FOUND');
  });
  it('atomically chooses one accepting device; losers cannot obtain credentials or hang up the call', () => {
    const r = new CallRegistry(); const c = create(r);
    const accept = { action: 'accept', actionId: 'accept', answerMediaType: 'audio' };
    expect(r.action('bob', 'b1', c.callId, accept).acceptedDeviceId).toBe('b1');
    expect(r.action('bob', 'b1', c.callId, accept).version).toBe(2);
    expect(() => r.action('bob', 'b2', c.callId, accept)).toThrow('CALL_ANSWERED_ELSEWHERE');
    expect(() => r.authorizeMedia('bob', 'b2', c.callId)).toThrow('CALL_ANSWERED_ELSEWHERE');
    expect(() => r.action('bob', 'b2', c.callId, { action: 'end', actionId: 'end' })).toThrow('CALL_FORBIDDEN');
    expect(() => r.action('bob', 'b2', c.callId, { action: 'reject', actionId: 'reject' })).toThrow('CALL_ANSWERED_ELSEWHERE');
  });
  it('does not expose credentials before acceptance; active requires both media-ready acknowledgements', () => {
    const r = new CallRegistry(); const c = create(r);
    expect(() => r.authorizeMedia('alice', 'a1', c.callId)).toThrow('CALL_NOT_ACCEPTED');
    r.action('bob', 'b1', c.callId, { action: 'accept', actionId: 'b', answerMediaType: 'audio' });
    const action = { action: 'ready', actionId: 'ready' };
    expect(r.action('alice', 'a1', c.callId, action).state).toBe('connecting');
    expect(r.action('bob', 'b1', c.callId, action).state).toBe('active');
    r.action('alice', 'a1', c.callId, { action: 'end', actionId: 'end' });
    expect(() => r.authorizeMedia('alice', 'a1', c.callId)).toThrow('CALL_NOT_ACCEPTED');
  });
  it('expires ringing calls and will not accept a delayed invitation', () => {
    let now = 1; const r = new CallRegistry({ now: () => now }); const c = create(r);
    now += 45_000;
    expect(() => r.action('bob', 'b1', c.callId, { action: 'accept', actionId: 'b', answerMediaType: 'audio' })).toThrow('CALL_ENDED');
    expect(r.get(c.callId, 'bob').reason).toBe('timeout');
  });
  it('replays only the account events, resyncs unknown cursors, and forbids idempotency-key reuse with another action', () => {
    const r = new CallRegistry(); const c = create(r);
    expect(r.replay('mallory', '')).toEqual([]);
    expect(r.replay('bob', '999')[0].snapshot.callId).toBe(c.callId);
    r.action('alice', 'a1', c.callId, { action: 'cancel', actionId: 'a' });
    expect(r.replay('bob', '1')[0].snapshot.reason).toBe('cancelled');
    expect(() => r.action('alice', 'a1', c.callId, { action: 'end', actionId: 'a' })).toThrow('CALL_IDEMPOTENCY_CONFLICT');
  });
  it('restricts the agent test double to audio', () => {
    const r = new CallRegistry();
    expect(() => r.create('alice', 'a1', { convId: 'demo-agent', mediaType: 'video', requestId: 'r' })).toThrow('CALL_MEDIA_UNSUPPORTED');
  });
});
