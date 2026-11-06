import { describe, expect, it } from "vitest";
import { CallSnapshot, CallStateStore } from "../../utils/voip/callState.uts";

function snapshot(overrides: Partial<CallSnapshot> = {}) {
  return Object.assign(new CallSnapshot(), { callId: "c1", convId: "9007199254740993123", version: 1,
    callerId: "alice", calleeId: "bob", callerDeviceId: "a1", expiresAt: 45_000 }, overrides);
}

describe("phone call state", () => {
  it("rejects malformed versions and expired invitations even for the current call", () => {
    const store = new CallStateStore();
    for (const version of [NaN, Infinity, -1, 0, 1.5]) expect(store.apply(snapshot({ version }), 0, "bob", 1)).toBe(false);
    expect(store.apply(snapshot(), 0, "bob", 1)).toBe(true);
    expect(store.apply(snapshot({ version: 2, expiresAt: 0 }), 0, "bob", 2)).toBe(false);
  });
  it("deduplicates online/push and rejects out of order/regressing snapshots", () => {
    const store = new CallStateStore();
    expect(store.apply(snapshot(), 0, "bob", 1)).toBe(true);
    expect(store.apply(snapshot(), 0, "bob", 1)).toBe(false);
    expect(store.apply(snapshot({ version: 3, state: "active" }), 0, "bob", 2)).toBe(true);
    expect(store.apply(snapshot({ version: 2, state: "connecting" }), 0, "bob", 3)).toBe(false);
    expect(store.apply(snapshot({ version: 4 }), 0, "bob", 3)).toBe(false);
  });
  it("does not resurrect ended calls after a later call", () => {
    const store = new CallStateStore();
    store.apply(snapshot(), 0, "bob", 1);
    store.endLocal("cancelled", 2);
    expect(store.apply(snapshot({ version: 9 }), 0, "bob", 3)).toBe(false);
    store.apply(snapshot({ callId: "c2" }), 0, "bob", 4);
    store.endLocal("ended", 5);
    expect(store.apply(snapshot({ version: 10 }), 0, "bob", 6)).toBe(false);
  });
  it("reserves one call and drops expired/unrelated invitations", () => {
    const store = new CallStateStore();
    expect(store.apply(snapshot(), 0, "mallory", 1)).toBe(false);
    expect(store.apply(snapshot(), 0, "bob", 45_000)).toBe(false);
    store.apply(snapshot(), 0, "bob", 1);
    expect(store.apply(snapshot({ callId: "c2" }), 0, "bob", 2)).toBe(false);
  });
  it("does not display active until both business and media are ready", () => {
    const store = new CallStateStore();
    store.apply(snapshot({ state: "active" }), 0, "bob", 1);
    expect(store.phase("bob")).toBe("connecting");
    store.mediaConnected = true;
    expect(store.phase("bob")).toBe("connecting");
    store.peerMediaReady = true;
    expect(store.phase("bob")).toBe("active");
    store.reconnecting = true;
    expect(store.phase("bob")).toBe("reconnecting");
  });
  it("invalidates old account callbacks and only allows the winning device to publish", () => {
    const store = new CallStateStore();
    store.apply(snapshot({ state: "connecting", acceptedDeviceId: "b2" }), 0, "bob", 1);
    expect(store.ownsMedia("bob", "b1")).toBe(false);
    expect(store.ownsMedia("bob", "b2")).toBe(true);
    expect(store.ownsMedia("alice", "a1")).toBe(true);
    store.reset();
    expect(store.apply(snapshot({ state: "active" }), 0, "bob", 2)).toBe(false);
    expect(store.phase("bob")).toBe("idle");
  });
});
