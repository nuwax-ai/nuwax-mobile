import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";

// 执行页面中的真实处理函数，隔离 uni/UI 副作用；不复制合并算法。
const source = readFileSync("pages/message/chat.uvue", "utf8");
function functionSource(name: string): string {
  const start = source.indexOf(`  function ${name}(`);
  if (start < 0) throw new Error(`Missing ${name}`);
  const end = source.indexOf("\n  }", start);
  return source.slice(start, end + 4);
}
function fixture() {
  const messages = { value: [{ msgId: "old", convId: "a", seq: 1, clientMsgId: "", local: false, revisionAt: 0, revoked: false }] };
  const reportReadIfNeeded = vi.fn();
  const resolveRowMedia = vi.fn();
  const scheduleReadRefresh = vi.fn();
  const scrollToBottom = vi.fn();
  const scope = {
    messages, convId: { value: "a" }, reportReadIfNeeded, resolveRowMedia,
    scheduleReadRefresh, scrollToBottom,
    readString: (obj: any, key: string) => `${obj[key] ?? ""}`,
    readNumber: (obj: any, key: string, fallback: number) => Number(obj[key] ?? fallback),
    readMsgRow: (obj: any) => ({ clientMsgId: "", local: false, revisionAt: Math.max(obj.editTime ?? 0, obj.revokeTime ?? 0), revoked: obj.msgStatus == 2, ...obj }),
    maxSeq: () => messages.value[messages.value.length - 1]?.seq ?? 0,
    isMine: () => false,
    isChatActive: () => true,
    isChatCurrent: () => true,
  };
  const code = transformSync([
    "mergeSyncedMessages", "handleImMessagesSynced", "insertMessageBySeq", "handleImMessageReceived",
  ].map(functionSource).join("\n"), { loader: "ts" }).code;
  const handlers = new Function(...Object.keys(scope), `${code}; return { handleImMessagesSynced, handleImMessageReceived };`)(...Object.values(scope));
  return { ...scope, ...handlers };
}
const record = (seq: number, convId = "a") => ({ msgId: `m${seq}`, convId, seq });

describe("IM recovery batch side effects", () => {
  it("merges 100 unordered messages with one read report and no scrolling", () => {
    const f = fixture();
    const records = Array.from({ length: 100 }, (_, i) => record(101 - i));
    f.handleImMessagesSynced({ records });
    expect(f.messages.value).toHaveLength(101);
    expect(f.messages.value.map((m: any) => m.seq)).toEqual(Array.from({ length: 101 }, (_, i) => i + 1));
    expect(f.reportReadIfNeeded.mock.calls).toEqual([[101]]);
    expect(f.scheduleReadRefresh).toHaveBeenCalledTimes(1);
    expect(f.resolveRowMedia).toHaveBeenCalledTimes(100);
    expect(f.scrollToBottom).not.toHaveBeenCalled();
    f.handleImMessagesSynced({ records });
    expect(f.reportReadIfNeeded).toHaveBeenCalledTimes(1);
    expect(f.scheduleReadRefresh).toHaveBeenCalledTimes(1);
    expect(f.resolveRowMedia).toHaveBeenCalledTimes(100);
  });
  it("filters other conversations and duplicate/empty IDs within a batch", () => {
    const f = fixture();
    f.handleImMessagesSynced({ records: [record(2), record(2), record(99, "b"), { convId: "a", msgId: "", seq: 50 }] });
    expect(f.messages.value.map((m: any) => m.seq)).toEqual([1, 2]);
    expect(f.reportReadIfNeeded.mock.calls).toEqual([[2]]);
    f.handleImMessagesSynced({ records: [] });
    expect(f.reportReadIfNeeded).toHaveBeenCalledTimes(1);
  });
  it("ignores legacy sync replay but preserves realtime insertion and scroll", () => {
    const f = fixture();
    f.handleImMessageReceived({ reqId: "sync-fallback", convId: "a", raw: record(2) });
    expect(f.messages.value).toHaveLength(1);
    expect(f.reportReadIfNeeded).not.toHaveBeenCalled();
    f.handleImMessageReceived({ reqId: "ws", convId: "a", raw: record(2) });
    expect(f.messages.value).toHaveLength(2);
    expect(f.scrollToBottom).toHaveBeenCalledTimes(1);
    expect(f.reportReadIfNeeded.mock.calls).toEqual([[2]]);
  });
});

describe("IM snapshot revisions", () => {
  it("applies edits and revokes, never resurrects a revoked message with an old snapshot", () => {
    const f = fixture();
    f.handleImMessagesSynced({ records: [record(2)] });
    f.handleImMessagesSynced({ records: [{ ...record(2), editTime: 20, bodyText: "edited" }] });
    expect(f.messages.value[1].bodyText).toBe("edited");
    f.handleImMessagesSynced({ records: [{ ...record(2), editTime: 10, bodyText: "old" }] });
    expect(f.messages.value[1].bodyText).toBe("edited");
    f.handleImMessagesSynced({ records: [{ ...record(2), msgStatus: 2, revokeTime: 30 }] });
    f.handleImMessagesSynced({ records: [{ ...record(2), editTime: 40, msgStatus: 1 }] });
    expect(f.messages.value[1].revoked).toBe(true);
  });
  it("reconciles confirmed messages with a local clientMsgId and preserves other drafts at the end", () => {
    const f = fixture();
    f.messages.value.push({ msgId: "temp", convId: "a", seq: 0, clientMsgId: "client", local: true, revisionAt: 0, revoked: false });
    f.messages.value.push({ msgId: "pending", convId: "a", seq: 0, clientMsgId: "pending", local: true, revisionAt: 0, revoked: false });
    f.handleImMessagesSynced({ records: [{ ...record(2), clientMsgId: "client" }] });
    expect(f.messages.value.map((m: any) => m.msgId)).toEqual(["old", "m2", "pending"]);
  });
});
