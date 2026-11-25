import { describe, expect, it, vi } from 'vitest';
import { addVoipChatTerminal, parseVoipHistory, readVoipChatTerminals, voipChatEndTranslationKey } from '../../features/voip/callHistory.uts';

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

describe('chat call terminals', () => {
  it('distinguishes decline, cancel and timeout and leaves unknown reasons blank', () => {
    expect(voipChatEndTranslationKey('rejected')).toBe('Mobile.Voip.callDeclined');
    expect(voipChatEndTranslationKey('cancelled')).toBe('Mobile.Voip.cancelled');
    expect(voipChatEndTranslationKey('remoteCancelled')).toBe('Mobile.Voip.cancelled');
    expect(voipChatEndTranslationKey('timeout')).toBe('Mobile.Voip.timeout');
    expect(voipChatEndTranslationKey('unknown')).toBe('');
    expect(addVoipChatTerminal([], 'call-1', 'chat', '')).toBeNull();
  });

  it('keeps only the recent results and replaces the matching conversation and call', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ callId: `call-${i}`, convId: 'chat', reason: 'timeout' }));
    const withOtherChat = addVoipChatTerminal(rows, 'call-1', 'other-chat', 'rejected')!;
    const updated = addVoipChatTerminal(withOtherChat, 'call-1', 'chat', 'remoteCancelled')!;
    expect(updated).toHaveLength(100);
    expect(updated.filter(row => row.callId === 'call-1')).toEqual([
      { callId: 'call-1', convId: 'chat', reason: 'remoteCancelled' },
      { callId: 'call-1', convId: 'other-chat', reason: 'rejected' },
    ]);
  });

  it('reads the requested local history key and ignores missing or malformed records', () => {
    const terminal = { callId: 'call-1', convId: 'chat', reason: 'rejected' };
    const storage = new Map([
      ['current', JSON.stringify([null, terminal, { ...terminal, reason: 'unknown' }, { ...terminal, convId: '../chat' }])],
      ['damaged', '{'],
    ]);
    vi.stubGlobal('uni', { getStorageSync: (key: string) => storage.get(key) });
    try {
      expect(readVoipChatTerminals('current')).toEqual([terminal]);
      expect(readVoipChatTerminals('other-account')).toEqual([]);
      expect(readVoipChatTerminals('damaged')).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
