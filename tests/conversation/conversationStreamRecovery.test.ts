import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { transformSync } from "esbuild";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/servers/conversation", () => ({ apiAgentConversation: vi.fn() }));
import { apiAgentConversation } from "@/servers/conversation";
import { destroyConversationPolling, startConversationPolling } from "@/subpackages/hooks/useConversationStatusPolling.uts";

const detail = vi.mocked(apiAgentConversation);
const response = (status: string, code = "0000") => ({
  code,
  data: { taskStatus: status, messageList: [{ role: "USER" }] },
}) as Awaited<ReturnType<typeof apiAgentConversation>>;

afterEach(() => {
  destroyConversationPolling();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  detail.mockReset();
});

function mockDocument() {
  vi.stubGlobal("document", { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
}

it("原生回前台会把首次进入后台的时间传给 WebView", () => {
  vi.useFakeTimers();
  const source = readFileSync("utils/appLifecycle.uts", "utf8").replace(/^export /gm, "");
  const code = transformSync(source, { loader: "ts" }).code;
  const emit = vi.fn();
  const { setAppInBackground, buildAppForegroundWebViewEvent } = runInNewContext(
    `${code}\n({ setAppInBackground, buildAppForegroundWebViewEvent });`, { Date, uni: { $emit: emit } },
  );
  const hiddenAt = Date.now();
  setAppInBackground(false);
  setAppInBackground(true);
  vi.setSystemTime(hiddenAt + 1000);
  setAppInBackground(true);
  vi.setSystemTime(hiddenAt + 180_000);
  setAppInBackground(false);
  expect(emit).toHaveBeenCalledExactlyOnceWith("nuwax:app-foreground", hiddenAt);
  const dispatchEvent = vi.fn();
  runInNewContext(buildAppForegroundWebViewEvent(hiddenAt), { window: { dispatchEvent }, CustomEvent });
  expect(dispatchEvent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: "nuwax:app-foreground", detail: hiddenAt }));
});

it("详情失败和非终态都不会结束前台待恢复会话", async () => {
  vi.useFakeTimers();
  mockDocument();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  detail.mockResolvedValueOnce(response("COMPLETE"))
    .mockResolvedValueOnce(response("", "5030"))
    .mockResolvedValueOnce(response("CREATE"))
    .mockResolvedValue(response("COMPLETE"));
  const terminal = vi.fn();
  startConversationPolling(1, vi.fn(), () => false, () => false, terminal, () => 1, () => true);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(terminal).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(terminal).toHaveBeenCalledExactlyOnceWith(1, response("COMPLETE"));
});

it("换会话后丢弃旧轮询返回的执行态，用新详情续接", async () => {
  vi.useFakeTimers();
  mockDocument();
  let resolveOld!: (value: ReturnType<typeof response>) => void;
  detail.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValue(response("EXECUTING"));
  const executing = vi.fn();
  startConversationPolling(1, executing, () => false, () => false, vi.fn());
  startConversationPolling(2, executing, () => false, () => false, vi.fn());
  resolveOld(response("EXECUTING"));
  await vi.advanceTimersByTimeAsync(0);
  expect(executing).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(executing).toHaveBeenCalledExactlyOnceWith(2, response("EXECUTING"));
});

it("H5 SSE 将一次网络错误通知一次且不重发 POST", async () => {
  mockDocument();
  vi.stubGlobal("window", { clearTimeout, setTimeout });
  const source = readFileSync("servers/useRequest.uts", "utf8");
  const start = source.indexOf("export function createSSEConnection");
  const end = source.indexOf("  // #endif", start);
  const connect = transformSync(source.slice(start, end).replace(/^export /, "") + "\n}", { loader: "ts" }).code;
  const fetch = vi.fn().mockRejectedValue(new Error("simulated network loss"));
  const createConnection = runInNewContext(`${connect}\ncreateSSEConnection`, {
    AbortController, window: { location: { hash: "" } }, uni: { getStorageSync: () => "zh" },
    I18N_LANG_STORAGE_KEY: "lang", DEFAULT_LANG: "zh", COMMON_HEADERS: {},
    UTSJSONObject: class { constructor(data: object) { Object.assign(this, data); } },
    applyXClientTypeHeader() {}, orObject: (a: unknown, b: unknown) => a ?? b,
    orString: (a: string, b: string) => a || b,
    fetchEventSource: (url: string, options: Parameters<typeof fetchEventSource>[1]) =>
      fetchEventSource(url, { ...options, fetch }),
  });
  const onError = vi.fn();
  createConnection({ url: "https://example.invalid", method: "POST", onError });
  await new Promise(setImmediate);
  expect(onError).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("H5 空闲超时会取消 Fetch 连接再通知续接", () => {
  const source = readFileSync("utils/streamRequest.uts", "utf8");
  const methods = ["private handleTimeout", "abort"].map(name => {
    const start = source.indexOf(`  ${name}():`);
    return source.slice(start, source.indexOf("\n  }", start) + 4);
  });
  const code = transformSync(`class Stream {\n${methods.join("\n")}\n}\nStream;`, { loader: "ts" }).code;
  const Stream = runInNewContext(code, { isAppInBackground: () => false, uni: { showToast() {} }, t: (key: string) => key });
  const controller = new AbortController();
  const timeoutCallback = vi.fn(() => expect(controller.signal.aborted).toBe(true));
  const stream = Object.assign(new Stream(), {
    abortController: controller, lastChunkReceivedTime: Date.now() - 60_000, timeoutCallback,
    resetSseDispatchQueue() {}, clearTimeoutMonitor() {}, releaseRequestTask() {},
  });
  stream.handleTimeout();
  expect(timeoutCallback).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^idle_timeout idleMs=/));
});
