import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { expect, it, vi } from 'vitest';

function fixture(cached: unknown[] | null) {
  const source = readFileSync('pages/message/chat.uvue', 'utf8');
  const code = transformSync(source.slice(source.indexOf('  async function settleAfterSync('), source.indexOf('  function handleRetry(')), { loader: 'ts' }).code;
  const bottom = vi.fn();
  const history = vi.fn(async () => {});
  let finish: () => void = () => {};
  const sync = vi.fn(() => new Promise<void>(resolve => finish = resolve));
  const create = new Function('getCachedChatRecords', 'scrollToBottom', 'loadHistory', 'silentSyncLatest', `
    let entryFollowLatest = true;
    const loading={value:false}, loadFailed={value:false}, messages={value:[]}, hasMore={value:false}, listSettled={value:false}, convId={value:'a'};
    const MSG_PAGE_SIZE=20;
    const resetChatAttachments=()=>{}, mergeSyncedMessages=()=>{}, collectChatAttachments=()=>{}, reportReadIfNeeded=()=>{}, refreshReadStatus=()=>{}, maxSeq=()=>100, isChatCurrent=()=>true;
    ${code}
    return {initHistory, userTookOver:()=>{entryFollowLatest=false;}};
  `);
  return { ...create(() => cached, bottom, history, sync), bottom, history, finish: () => finish() };
}
it('opens cached chats at the latest message, then follows fresh sync', async () => {
  const f = fixture([{msgId:'cached'}]);
  await f.initHistory();
  expect(f.bottom).toHaveBeenCalledTimes(1);
  expect(f.history).not.toHaveBeenCalled();
  f.finish(); await Promise.resolve();
  expect(f.bottom).toHaveBeenCalledTimes(2);
});
it('does not let a late initial sync override scrolling or a message jump', async () => {
  const f = fixture([{msgId:'cached'}]);
  await f.initHistory(); f.userTookOver(); f.finish(); await Promise.resolve();
  expect(f.bottom).toHaveBeenCalledTimes(1);
});
it('opens uncached chats at the latest page', async () => {
  const f = fixture(null);
  await f.initHistory();
  expect(f.history).toHaveBeenCalledWith(0);
  expect(f.bottom).toHaveBeenCalledOnce();
});
