import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadUtsClass } from "./runtimeHarness";

function clientFixture() {
  const callbacks: Record<string, Function> = {};
  const adapter = {
    connect: vi.fn(), close: vi.fn(), send: vi.fn(() => true), isOpen: () => true,
    onOpen: (f: Function) => callbacks.open = f,
    onClose: (f: Function) => callbacks.close = f,
    onError: (f: Function) => callbacks.error = f,
    onMessage: (f: Function) => callbacks.message = f,
  };
  const emit = vi.fn();
  const sync = vi.fn(async () => ({ data: { messages: [], conversations: [] } }));
  const scope = {
    ACCESS_TOKEN: "token", uni: { getStorageSync: () => "user-a", onNetworkStatusChange: (f: Function) => callbacks.network = f },
    getApiBaseUrl: () => "https://example.test", isAppWebViewEmbedded: () => false,
    applyBearerAuthorization: () => {}, createImWsSocketAdapter: () => adapter,
    getImDeviceId: () => "device", apiImSync: sync, apiResData: (r: any) => r.data,
    apiResCode: () => "0000", SUCCESS_CODE: "0000",
    dispatchImEnvelope: () => {},
    eventBus: { emit }, IM_EVENT: { ConnectionState: "state", MessagesSynced: "batch" },
    IM_WS_PATH: "/ws", IM_DEFAULT_HEARTBEAT_INTERVAL_SEC: 30,
    IM_OP: { CONNECT: 1000, CONNECT_ACK: 1001, PING: 2000, PONG: 2001 },
    IM_PROTOCOL_VERSION: 1, ImEnvelope: class {}, ApiImSyncParams: class {}, ApiImSyncCursor: class {},
    imSafeJsonParse: JSON.parse, imParseEnvelope: (o: any) => o,
    imStringifyEnvelope: JSON.stringify, imClampHeartbeatInterval: () => 30,
    newImReqId: () => "req", imFormatId: String, isRetryableRejectCode: () => true,
  };
  const Client = loadUtsClass("utils/im/imWsClient.uts", "ImWsClientImpl", scope);
  return { client: new Client(), callbacks, adapter, sync, emit };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("IM connection recovery", () => {
  it("retries an error without relying on a subsequent close event", () => {
    const f = clientFixture(); f.client.start();
    f.callbacks.error("failed"); f.callbacks.close(1006, "failed");
    vi.advanceTimersByTime(1000);
    expect(f.adapter.connect).toHaveBeenCalledTimes(2);
  });
  it("times out a stalled handshake", () => {
    const f = clientFixture(); f.client.start();
    vi.advanceTimersByTime(16000);
    expect(f.adapter.connect).toHaveBeenCalledTimes(2);
  });
  it("does no background retries, and coalesces foreground/network recovery", () => {
    const f = clientFixture(); f.client.start(); f.client.pauseKeepalive();
    f.callbacks.close(1006, "background");
    f.callbacks.network({ isConnected: false });
    f.callbacks.network({ isConnected: true });
    vi.advanceTimersByTime(120000);
    expect(f.adapter.connect).toHaveBeenCalledTimes(1);
    f.client.resumeKeepaliveAndReconnect(); f.client.reconnect("network");
    expect(f.adapter.connect).toHaveBeenCalledTimes(2);
  });
  it("detects missing PONG and keeps explicit stop effective", () => {
    const f = clientFixture(); f.client.start(); f.callbacks.open();
    f.callbacks.message(JSON.stringify({ op: 1001, body: {} }));
    vi.advanceTimersByTime(41000);
    expect(f.adapter.connect).toHaveBeenCalledTimes(2);
    f.client.stop(); f.client.resumeKeepaliveAndReconnect(); f.client.reconnect("network");
    vi.advanceTimersByTime(120000);
    expect(f.adapter.connect).toHaveBeenCalledTimes(2);
  });
});

describe("native SocketTask errors", () => {
  it("reports asynchronous send failure once, releases task and ignores late callbacks", () => {
    const handlers: Record<string, Function> = {};
    const task = {
      close: vi.fn(), send: vi.fn((o: any) => handlers.sendFail = o.fail),
      onOpen: (f: Function) => handlers.open = f, onClose: (f: Function) => handlers.close = f,
      onMessage: (f: Function) => handlers.message = f, onError: (f: Function) => handlers.error = f,
    };
    const Adapter = loadUtsClass("utils/im/imWsSocketAdapter.uts", "UniSocketTaskAdapter", {
      uni: { connectSocket: () => task }, IM_WS_SUBPROTOCOL: "im-v1",
    });
    const adapter = new Adapter(); const error = vi.fn(); const close = vi.fn();
    adapter.onError(error); adapter.onClose(close); adapter.connect("wss://test", {});
    expect(adapter.isOpen()).toBe(false); handlers.open();
    expect(adapter.isOpen()).toBe(true); adapter.send("ping");
    handlers.sendFail({ errMsg: "offline" }); handlers.close({ code: 1006 }); handlers.error({ errMsg: "late" });
    expect(error).toHaveBeenCalledTimes(1); expect(close).not.toHaveBeenCalled();
    expect(task.close).toHaveBeenCalledTimes(1); expect(adapter.isOpen()).toBe(false);
  });
});


describe("IM sync cursor and generation", () => {
  it("follows cursors sequentially and stops a nonadvancing cursor", async () => {
    const f = clientFixture();
    f.sync.mockResolvedValue({ data: { messages: [], conversations: [], hasMore: true, nextCursor: { convId: "987654321098765432", afterSeq: 100 } } } as any);
    f.client.start(); f.callbacks.open();
    f.callbacks.message(JSON.stringify({ op: 1001, body: {} }));
    await vi.advanceTimersByTimeAsync(1);
    expect(f.sync).toHaveBeenCalledTimes(2);
    expect((f.sync.mock.calls[1] as any)[0].cursor.convId).toBe("987654321098765432");
    await vi.advanceTimersByTimeAsync(100);
    expect(f.sync).toHaveBeenCalledTimes(2);
  });
  it("drops a sync response after hiding and starts only one replacement on return", async () => {
    const f = clientFixture();
    let finish: (r: any) => void = () => {};
    f.sync.mockImplementationOnce(() => new Promise(resolve => finish = resolve));
    f.client.start(); f.callbacks.open();
    f.callbacks.message(JSON.stringify({ op: 1001, body: {} }));
    f.client.pauseKeepalive(); f.client.resumeKeepaliveAndReconnect(); f.callbacks.open();
    f.callbacks.message(JSON.stringify({ op: 1001, body: {} }));
    expect(f.sync).toHaveBeenCalledTimes(1);
    finish({ data: { messages: [{ msgId: "stale" }] } });
    await vi.advanceTimersByTimeAsync(1);
    expect(f.sync).toHaveBeenCalledTimes(2);
    const batches = f.emit.mock.calls.filter(c => c[0] === "batch");
    expect(batches).toHaveLength(1);
    expect(batches[0][1].records).toEqual([]);
  });
});
