import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadUtsClass } from "./runtimeHarness";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function readFixture() {
  const source = readFileSync("pages/message/chat.uvue", "utf8");
  const code = transformSync(source.slice(source.indexOf("  let readReportTimer"), source.indexOf("  /** 距底余量")), { loader: "ts" }).code;
  let active = true; let current = true;
  const report = vi.fn(async (_conv: string, _seq: number) => ({ code: "ok" }));
  const badge = vi.fn();
  const f = new Function("isChatActive", "isChatCurrent", "apiImReadReport", "refreshImUnreadBadge", `
    let reportedReadSeq = 0;
    const convId = { value: 'a' };
    const apiResCode = r => r.code;
    const SUCCESS_CODE = 'ok';
    ${code}
    return { reportReadIfNeeded, confirmed: () => reportedReadSeq };
  `)(() => active, () => current, report, badge);
  return { ...f, report, badge, hide: () => active = false, show: () => active = true, dispose: () => { active = false; current = false; } };
}

describe("IM read lifecycle", () => {
  it("coalesces 100 watermarks and performs no hidden read report", async () => {
    const f = readFixture();
    for (let i = 1; i <= 100; i++) f.reportReadIfNeeded(i);
    await vi.advanceTimersByTimeAsync(150);
    expect(f.report.mock.calls).toEqual([["a", 100]]);
    f.reportReadIfNeeded(200); f.hide();
    await vi.advanceTimersByTimeAsync(150);
    expect(f.report).toHaveBeenCalledTimes(1);
    f.show(); f.reportReadIfNeeded(200);
    await vi.advanceTimersByTimeAsync(150);
    expect(f.report.mock.calls).toEqual([["a", 100], ["a", 200]]);
  });
  it("retries the same watermark after failure and ignores an unloaded response", async () => {
    const f = readFixture();
    f.report.mockRejectedValueOnce(new Error("offline"));
    f.reportReadIfNeeded(100); await vi.advanceTimersByTimeAsync(150);
    expect(f.confirmed()).toBe(0);
    let finish: (v: any) => void = () => {};
    f.report.mockImplementationOnce(() => new Promise(resolve => finish = resolve));
    f.reportReadIfNeeded(100); await vi.advanceTimersByTimeAsync(150);
    f.dispose(); finish({ code: "ok" }); await vi.advanceTimersByTimeAsync(1);
    expect(f.report).toHaveBeenCalledTimes(2);
    expect(f.confirmed()).toBe(0); expect(f.badge).not.toHaveBeenCalled();
  });
  it("serializes in-flight watermarks without losing the newest value", async () => {
    const f = readFixture(); let finish: (v: any) => void = () => {};
    f.report.mockImplementationOnce(() => new Promise(resolve => finish = resolve));
    f.reportReadIfNeeded(10); await vi.advanceTimersByTimeAsync(150);
    f.reportReadIfNeeded(20); f.reportReadIfNeeded(30);
    expect(f.report).toHaveBeenCalledTimes(1);
    finish({ code: "ok" }); await vi.advanceTimersByTimeAsync(1);
    expect(f.report.mock.calls).toEqual([["a", 10], ["a", 30]]);
  });
});

describe("IM cache account boundaries", () => {
  it("limits message windows and discards old-account data", () => {
    let stamp = "a";
    const api = loadUtsClass("utils/im/imChatCache.uts", "({getCachedChatRecords, setCachedChatRecords, getCachedChatScroll, setCachedChatScroll})", { getImSessionStamp: () => stamp });
    api.setCachedChatRecords("1", Array.from({ length: 100 }, (_, i) => ({ msgId: String(i) })));
    expect(api.getCachedChatRecords("1")).toHaveLength(20);
    api.setCachedChatScroll("1", { anchorId: "10", distBottom: 1000 });
    stamp = "b";
    expect(api.getCachedChatRecords("1")).toBeNull();
    expect(api.getCachedChatScroll("1")).toBeFalsy();
    for (let i = 0; i < 4; i++) api.setCachedChatRecords(String(i), [{ msgId: String(i) }]);
    expect(api.getCachedChatRecords("0")).toBeNull();
    expect(api.getCachedChatRecords("3")).toHaveLength(1);
  });
});
