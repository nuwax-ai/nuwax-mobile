import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync("pages/message/message.uvue", "utf8");
function extract(name: string, async = false) {
  const start = source.indexOf(`  ${async ? "async " : ""}function ${name}(`);
  return source.slice(start, source.indexOf("\n  }", start) + 4);
}
function fixture() {
  const row = { convId: "a", lastMsgAt: 100, lastMsgDigest: "latest", unreadCount: 3 };
  const scheduleConvRefresh = vi.fn(); const bumpRowToTop = vi.fn();
  let finish: (v: any) => void = () => {};
  const api = vi.fn(() => new Promise(resolve => finish = resolve));
  const scope = {
    scheduleConvRefresh, bumpRowToTop,
    findConvRowById: () => row,
    isAppInBackground: () => false,
    readString: (o: any, k: string) => `${o[k] ?? ""}`,
    readNumber: (o: any, k: string, fallback: number) => o[k] ?? fallback,
    getImSessionStamp: () => "a", hasAccessToken: () => true,
    apiImConversations: api, apiResCode: () => "ok", parseConvRecords: (r: any) => r.rows,
    resolveConvRowsIcons: vi.fn(),
  };
  const code = transformSync(extract("handleImMessageReceived") + extract("loadConversations", true), { loader: "ts" }).code;
  const handlers = new Function(...Object.keys(scope), `
    let messagePageVisible = true, messagePageDisposed = false, convRevision = 0, convRefreshOwed = false;
    const messagePageSession = 'a', CONV_PAGE_SIZE = 50, SUCCESS_CODE = 'ok';
    const conversations = {value: ['original']}, convLoading = {value: false}, convLoadingMore = {value: false};
    const convLoaded = {value: true}, convFailed = {value: false}, convHasMore = {value: false}, nextCursor = {value: ''};
    const seenMessageIds = new Set(), seenMessageOrder = [];
    ${code}
    return { handleImMessageReceived, loadConversations, rows: () => conversations.value, hide: () => messagePageVisible = false };
  `)(...Object.values(scope));
  return { row, ...handlers, scheduleConvRefresh, bumpRowToTop, finish: (v: any) => finish(v) };
}

describe("conversation recovery ordering", () => {
  it("does not increment unread or regress previews for duplicate/older messages", () => {
    const f = fixture();
    f.handleImMessageReceived({ convId: "a", msgId: "old", sendTime: 90, digest: "old" });
    f.handleImMessageReceived({ convId: "a", msgId: "old", sendTime: 90, digest: "old" });
    expect(f.row.lastMsgDigest).toBe("latest"); expect(f.row.unreadCount).toBe(3);
    expect(f.scheduleConvRefresh).toHaveBeenCalledTimes(1);
    f.hide();
    f.handleImMessageReceived({ convId: "a", msgId: "new", sendTime: 200, digest: "new" });
    expect(f.row.lastMsgDigest).toBe("latest"); expect(f.bumpRowToTop).not.toHaveBeenCalled();
  });
  it("discards an HTTP snapshot when a newer event arrives while it is in flight", async () => {
    const f = fixture(); const pending = f.loadConversations();
    f.handleImMessageReceived({ convId: "a", msgId: "new", sendTime: 200, digest: "new" });
    f.finish({ rows: ["stale"] }); await pending;
    expect(f.rows()).toEqual(["original"]);
    expect(f.row.lastMsgDigest).toBe("new");
    expect(f.scheduleConvRefresh).toHaveBeenCalled();
  });
});
