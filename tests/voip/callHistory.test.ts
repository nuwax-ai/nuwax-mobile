import { describe, expect, it } from 'vitest';
import { parseVoipHistory } from '../../features/voip/callHistory.uts';

const row = { callId: 'call-1', convId: 'chat', peerName: 'Bob', direction: 'incoming', mediaType: 'audio', startedAt: 100, connectedAt: 0, endedAt: 200, missed: true };
describe('device call history', () => {
  it('keeps display observations and callback conversation without accepting arbitrary URLs', () => {
    const parsed = parseVoipHistory([row, { ...row, callId: 'bad', convId: '../chat' }] as any);
    expect(parsed).toHaveLength(1); expect(parsed[0].convId).toBe('chat'); expect(parsed[0].missed).toBe(true);
  });
  it('deduplicates, bounds the list and rejects malformed times/media', () => {
    expect(parseVoipHistory([row, row, { ...row, callId: 'other', startedAt: 'NaN' }, { ...row, callId: 'invalid', mediaType: 'screen' }] as any)).toHaveLength(1);
    expect(parseVoipHistory(Array.from({ length: 150 }, (_, i) => ({ ...row, callId: `call-${i}` })) as any)).toHaveLength(100);
  });
});
