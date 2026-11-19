import { beforeEach, expect, it, vi } from "vitest";
import {
  BUGLY_ANDROID_TEST_APP_ID,
  BUGLY_IOS_TEST_APP_ID,
  BUGLY_RELEASE_ORIGIN,
  BUGLY_TEST_ORIGIN,
} from "@/constants/bugly.config.uts";
import {
  CRASH_DIAGNOSTICS_CONSENT_KEY,
  restoreInstallScopedStorage,
  snapshotInstallScopedStorage,
} from "@/utils/installScopedStorage.uts";

const fixture = vi.hoisted(() => ({
  buildOrigin: "",
  runtimeOrigin: "",
  platform: "android",
  privacyGranted: true,
  initializeBugly: vi.fn(),
  stopBugly: vi.fn(),
}));
const originChangedEvent = "nuwax:api-base-url-changed";
vi.mock("@/constants/config", () => ({
  API_BASE_URL_CHANGED_EVENT: originChangedEvent,
  getDefaultApiBaseUrl: () => fixture.buildOrigin,
  getApiBaseUrl: () => fixture.runtimeOrigin,
}));
vi.mock("@/utils/appPrivacyConsent", () => ({ hasAppPrivacyConsent: () => fixture.privacyGranted }));
vi.mock("@/uni_modules/nuwax-bugly", () => ({
  getBuglyPlatform: () => fixture.platform,
  initializeBugly: fixture.initializeBugly,
  stopBugly: fixture.stopBugly,
}));

const storage = new Map<string, string>();
const events = new Map<string, () => void>();

beforeEach(() => {
  vi.resetModules();
  storage.clear();
  events.clear();
  fixture.platform = "android";
  fixture.privacyGranted = true;
  fixture.buildOrigin = BUGLY_TEST_ORIGIN;
  fixture.runtimeOrigin = BUGLY_TEST_ORIGIN;
  fixture.initializeBugly.mockReset().mockReturnValue(true);
  fixture.stopBugly.mockReset();
  vi.stubGlobal("uni", {
    getStorageSync: (key: string) => storage.get(key) ?? "",
    setStorageSync: (key: string, value: string) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
    $on: (event: string, callback: () => void) => events.set(event, callback),
  });
});

it("keeps crash diagnostics inert on unsupported platforms", async () => {
  const diagnostics = await import("@/utils/crashDiagnostics.uts");
  storage.set(CRASH_DIAGNOSTICS_CONSENT_KEY, BUGLY_ANDROID_TEST_APP_ID);
  diagnostics.startCrashDiagnostics();
  expect(diagnostics.isCrashDiagnosticsAvailable()).toBe(false);
  expect(diagnostics.isCrashDiagnosticsAllowed()).toBe(false);
  expect(diagnostics.setCrashDiagnosticsAllowed(true)).toBe(false);
  expect(diagnostics.setCrashDiagnosticsAllowed(false)).toBe(false);
  expect(storage.get(CRASH_DIAGNOSTICS_CONSENT_KEY)).toBe(BUGLY_ANDROID_TEST_APP_ID);
  expect(events.size).toBe(0);
  expect(fixture.initializeBugly).not.toHaveBeenCalled();
  expect(fixture.stopBugly).not.toHaveBeenCalled();
});

it("does not reuse trial consent or start until the next cold launch after opt-in", async () => {
  storage.set("nuwax_bugly_pilot_consent", "allowed");
  const before = await import("@/utils/crashDiagnosticsNative.uts");
  expect(before.isCrashDiagnosticsAvailable()).toBe(true);
  expect(before.isCrashDiagnosticsAllowed()).toBe(false);
  before.startCrashDiagnostics();
  expect(before.setCrashDiagnosticsAllowed(true)).toBe(true);
  before.startCrashDiagnostics();
  expect(fixture.initializeBugly).not.toHaveBeenCalled();

  vi.resetModules();
  const after = await import("@/utils/crashDiagnosticsNative.uts");
  after.startCrashDiagnostics();
  after.startCrashDiagnostics();
  expect(fixture.initializeBugly).toHaveBeenCalledExactlyOnceWith(BUGLY_ANDROID_TEST_APP_ID, "testagent.xspaceagi.com", "test");
});

it("requires Android app privacy authorization even with a matching Bugly preference", async () => {
  fixture.privacyGranted = false;
  storage.set(CRASH_DIAGNOSTICS_CONSENT_KEY, BUGLY_ANDROID_TEST_APP_ID);
  const diagnostics = await import("@/utils/crashDiagnosticsNative.uts");
  diagnostics.startCrashDiagnostics();
  expect(diagnostics.isCrashDiagnosticsAvailable()).toBe(false);
  expect(diagnostics.isCrashDiagnosticsAllowed()).toBe(false);
  expect(fixture.initializeBugly).not.toHaveBeenCalled();

  fixture.privacyGranted = true;
  diagnostics.startCrashDiagnostics();
  expect(fixture.initializeBugly).toHaveBeenCalledTimes(1);
});

it("keeps iOS consent across logout and stops capture when consent is withdrawn", async () => {
  fixture.platform = "ios";
  storage.set(CRASH_DIAGNOSTICS_CONSENT_KEY, BUGLY_IOS_TEST_APP_ID);
  const diagnostics = await import("@/utils/crashDiagnosticsNative.uts");
  diagnostics.startCrashDiagnostics();
  expect(fixture.initializeBugly).toHaveBeenCalledExactlyOnceWith(BUGLY_IOS_TEST_APP_ID, "testagent.xspaceagi.com", "test");
  const snapshot = snapshotInstallScopedStorage();
  storage.clear();
  restoreInstallScopedStorage(snapshot);
  expect(diagnostics.isCrashDiagnosticsAllowed()).toBe(true);

  expect(diagnostics.setCrashDiagnosticsAllowed(false)).toBe(true);
  expect(diagnostics.isCrashDiagnosticsAllowed()).toBe(false);
  expect(fixture.stopBugly).toHaveBeenCalledTimes(1);

  vi.resetModules();
  (await import("@/utils/crashDiagnosticsNative.uts")).startCrashDiagnostics();
  expect(fixture.initializeBugly).toHaveBeenCalledTimes(1);
});

it("stops on a service change and waits for a cold launch on returning", async () => {
  storage.set(CRASH_DIAGNOSTICS_CONSENT_KEY, BUGLY_ANDROID_TEST_APP_ID);
  const diagnostics = await import("@/utils/crashDiagnosticsNative.uts");
  diagnostics.startCrashDiagnostics();
  fixture.runtimeOrigin = "https://enterprise.example";
  events.get(originChangedEvent)?.();
  expect(diagnostics.isCrashDiagnosticsAvailable()).toBe(false);
  expect(diagnostics.setCrashDiagnosticsAllowed(true)).toBe(false);
  expect(fixture.stopBugly).toHaveBeenCalledTimes(1);

  fixture.runtimeOrigin = BUGLY_TEST_ORIGIN;
  events.get(originChangedEvent)?.();
  expect(diagnostics.isCrashDiagnosticsAllowed()).toBe(true);
  diagnostics.startCrashDiagnostics();
  expect(fixture.initializeBugly).toHaveBeenCalledTimes(1);
});

it("cannot use test consent for the iOS or unconfigured production project", async () => {
  fixture.platform = "ios";
  storage.set(CRASH_DIAGNOSTICS_CONSENT_KEY, BUGLY_ANDROID_TEST_APP_ID);
  const test = await import("@/utils/crashDiagnosticsNative.uts");
  test.startCrashDiagnostics();
  expect(test.isCrashDiagnosticsAllowed()).toBe(false);

  vi.resetModules();
  fixture.buildOrigin = BUGLY_RELEASE_ORIGIN;
  const release = await import("@/utils/crashDiagnosticsNative.uts");
  expect(release.isCrashDiagnosticsAvailable()).toBe(false);
  fixture.runtimeOrigin = BUGLY_RELEASE_ORIGIN;
  expect(release.isCrashDiagnosticsAvailable()).toBe(false);
  release.startCrashDiagnostics();
  expect(fixture.initializeBugly).not.toHaveBeenCalled();
});

it("uses the configured production project only with its own consent", async () => {
  const releaseAppId = "release-app-fixture";
  vi.doMock("@/constants/bugly.config", async (importOriginal) => ({
    ...await importOriginal<typeof import("@/constants/bugly.config.uts")>(),
    BUGLY_ANDROID_RELEASE_APP_ID: releaseAppId,
  }));
  try {
    fixture.buildOrigin = BUGLY_RELEASE_ORIGIN;
    fixture.runtimeOrigin = BUGLY_RELEASE_ORIGIN;
    storage.set(CRASH_DIAGNOSTICS_CONSENT_KEY, BUGLY_ANDROID_TEST_APP_ID);
    const diagnostics = await import("@/utils/crashDiagnosticsNative.uts");
    expect(diagnostics.isCrashDiagnosticsAvailable()).toBe(true);
    diagnostics.startCrashDiagnostics();
    expect(fixture.initializeBugly).not.toHaveBeenCalled();

    expect(diagnostics.setCrashDiagnosticsAllowed(true)).toBe(true);
    expect(storage.get(CRASH_DIAGNOSTICS_CONSENT_KEY)).toBe(releaseAppId);
    vi.resetModules();
    (await import("@/utils/crashDiagnosticsNative.uts")).startCrashDiagnostics();
    expect(fixture.initializeBugly).toHaveBeenCalledExactlyOnceWith(releaseAppId, "agent.nuwax.com", "production");
  } finally {
    vi.doUnmock("@/constants/bugly.config");
  }
});

it("reports a switched service under the same team project and the new domain on cold launch", async () => {
  const releaseAppId = "release-app-fixture";
  vi.doMock("@/constants/bugly.config", async (importOriginal) => ({
    ...await importOriginal<typeof import("@/constants/bugly.config.uts")>(),
    BUGLY_ANDROID_RELEASE_APP_ID: releaseAppId,
  }));
  try {
    fixture.buildOrigin = BUGLY_RELEASE_ORIGIN;
    fixture.runtimeOrigin = "https://AGENT.NUWAX.COM:443";
    storage.set(CRASH_DIAGNOSTICS_CONSENT_KEY, releaseAppId);
    const production = await import("@/utils/crashDiagnosticsNative.uts");
    production.startCrashDiagnostics();
    expect(fixture.initializeBugly).toHaveBeenCalledExactlyOnceWith(releaseAppId, "agent.nuwax.com", "production");

    fixture.runtimeOrigin = BUGLY_TEST_ORIGIN;
    events.get(originChangedEvent)?.();
    expect(fixture.stopBugly).toHaveBeenCalledTimes(1);
    expect(production.isCrashDiagnosticsAllowed()).toBe(true);
    production.startCrashDiagnostics();
    expect(fixture.initializeBugly).toHaveBeenCalledTimes(1);

    vi.resetModules();
    (await import("@/utils/crashDiagnosticsNative.uts")).startCrashDiagnostics();
    expect(fixture.initializeBugly).toHaveBeenLastCalledWith(releaseAppId, "testagent.xspaceagi.com", "test");
  } finally {
    vi.doUnmock("@/constants/bugly.config");
  }
});

it.each([
  BUGLY_RELEASE_ORIGIN,
  "http://testagent.xspaceagi.com",
  "https://testagent.xspaceagi.com:8443",
  "https://testagent.xspaceagi.com.enterprise.example",
])("keeps the pilot SDK disabled for %s", async (origin) => {
  fixture.runtimeOrigin = origin;
  storage.set(CRASH_DIAGNOSTICS_CONSENT_KEY, BUGLY_ANDROID_TEST_APP_ID);
  const diagnostics = await import("@/utils/crashDiagnosticsNative.uts");
  expect(diagnostics.isCrashDiagnosticsAvailable()).toBe(false);
  expect(diagnostics.isCrashDiagnosticsAllowed()).toBe(false);
  diagnostics.startCrashDiagnostics();
  expect(fixture.initializeBugly).not.toHaveBeenCalled();
});

it("stops team reporting when an enterprise login activates a tenant domain", async () => {
  const releaseAppId = "release-app-fixture";
  vi.doMock("@/constants/bugly.config", async (importOriginal) => ({
    ...await importOriginal<typeof import("@/constants/bugly.config.uts")>(),
    BUGLY_ANDROID_RELEASE_APP_ID: releaseAppId,
  }));
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    fixture.buildOrigin = BUGLY_RELEASE_ORIGIN;
    fixture.runtimeOrigin = BUGLY_RELEASE_ORIGIN;
    storage.set(CRASH_DIAGNOSTICS_CONSENT_KEY, releaseAppId);
    const before = await import("@/utils/crashDiagnosticsNative.uts");
    before.startCrashDiagnostics();
    expect(fixture.initializeBugly).toHaveBeenCalledExactlyOnceWith(releaseAppId, "agent.nuwax.com", "production");

    fixture.runtimeOrigin = "https://tenant.example.com";
    events.get(originChangedEvent)?.();
    expect(fixture.stopBugly).toHaveBeenCalledTimes(1);
    expect(before.isCrashDiagnosticsAvailable()).toBe(false);
    expect(before.isCrashDiagnosticsAllowed()).toBe(false);
    expect(before.setCrashDiagnosticsAllowed(true)).toBe(false);
    expect(storage.get(CRASH_DIAGNOSTICS_CONSENT_KEY)).toBe(releaseAppId);

    vi.resetModules();
    log.mockClear();
    const after = await import("@/utils/crashDiagnosticsNative.uts");
    after.startCrashDiagnostics();
    after.startCrashDiagnostics();
    expect(fixture.initializeBugly).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledExactlyOnceWith("[CrashDiagnostics] init_skipped reason=service_not_enabled");
  } finally {
    log.mockRestore();
    vi.doUnmock("@/constants/bugly.config");
  }
});
