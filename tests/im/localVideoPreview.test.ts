import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function previewResolver(android = true) {
  const source = readFileSync("utils/fileUploader.uts", "utf8");
  let code = source.slice(source.indexOf("export function resolveLocalVideoPreviewPath("), source.indexOf("/** 上传体积闸门"));
  if (!android) code = code.replace(/\/\/ #ifdef APP-ANDROID[\s\S]*?\/\/ #endif/, "");
  const queues = { io: [] as Function[], main: [] as Function[] };
  const cachedPaths = new Map<string, string>();
  const files = new Set<string>();
  const prepare = vi.fn(() => { files.add("/cache/preview.mp4"); return "/cache/preview.mp4"; });
  const scope = {
    localVideoPreviewPaths: cachedPaths,
    File: class { constructor(private path: string) {} exists() { return files.has(this.path); } length() { return files.has(this.path) ? 100 : 0; } },
    prepareUploadFilePath: prepare, generateFileUid: () => "123",
    UTSAndroid: { getDispatcher: (name: "io" | "main") => ({ async: (callback: Function) => queues[name].push(callback) }) },
  };
  const js = transformSync(code.replace("export function", "function"), { loader: "ts" }).code;
  const resolve = new Function("scope", `with(scope){${js};return resolveLocalVideoPreviewPath;}`)(scope);
  return { resolve, prepare, queues, files, cachedPaths };
}

describe("local video playback paths", () => {
  it("copies Android content URI on IO, then resolves on the main thread without uploading", async () => {
    const h = previewResolver();
    const pending = h.resolve("content://media/video/123");
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.queues.io).toHaveLength(1);
    h.queues.io.shift()!(null);
    expect(h.prepare).toHaveBeenCalledWith("content://media/video/123", "preview-123", "mp4");
    expect(h.cachedPaths.size).toBe(0);
    h.queues.main.shift()!(null);
    expect(await pending).toBe("/cache/preview.mp4");
    expect(await h.resolve("content://media/video/123")).toBe("/cache/preview.mp4");
    expect(h.prepare).toHaveBeenCalledOnce();
  });
  it("recreates a cached copy if Android removed it", async () => {
    const h = previewResolver();
    h.cachedPaths.set("content://video/1", "/cache/removed.mp4");
    const pending = h.resolve("content://video/1");
    h.queues.io.shift()!(null);
    h.queues.main.shift()!(null);
    expect(await pending).toBe("/cache/preview.mp4");
    expect(h.prepare).toHaveBeenCalledOnce();
  });
  it("rejects a read failure without returning an unusable content URI", async () => {
    const h = previewResolver();
    h.prepare.mockImplementation(() => { throw new Error("URI permission expired"); });
    const pending = h.resolve("content://video/1");
    const assertion = expect(pending).rejects.toThrow("URI permission expired");
    h.queues.io.shift()!(null);
    h.queues.main.shift()!(null);
    await assertion;
    expect(h.cachedPaths.size).toBe(0);
  });
  it.each(["/data/user/0/app/cache/a.mp4", "file:///data/user/0/app/cache/a.mp4"])("preserves Android ordinary local paths: %s", async path => {
    const h = previewResolver();
    expect(await h.resolve(path)).toBe(path);
    expect(h.prepare).not.toHaveBeenCalled();
  });
  it.each(["/var/mobile/tmp/a.mov", "file://media/Photo/12/a.mp4", "/data/storage/el2/base/cache/a.mp4"])("preserves iOS/Harmony paths: %s", async path => {
    const h = previewResolver(false);
    expect(await h.resolve(path)).toBe(path);
    expect(h.prepare).not.toHaveBeenCalled();
  });
});

function previewPage() {
  const source = readFileSync("subpackages/pages/im-video-preview/im-video-preview.uvue", "utf8");
  const script = source.split('<script setup lang="uts">')[1].split("</script>")[0]
    .replace(/^\s*import .+;\s*$/gm, "")
    .replace(/\/\/ #ifdef MP-WEIXIN[\s\S]*?\/\/ #endif/g, "");
  const hooks: Record<string, Function> = {};
  let finish: (path: string) => void = () => {};
  const scope = {
    ref: (value: any) => ({ value }),
    nextTick: (callback: Function) => { callback(); },
    onLoad: (f: Function) => { hooks.load = f; }, onReady: (f: Function) => { hooks.ready = f; },
    onHide: (f: Function) => { hooks.hide = f; }, onUnload: (f: Function) => { hooks.unload = f; },
    onShow: (f: Function) => { hooks.show = f; },
    emptyI18nParams: () => ({}), t: (key: string) => key,
    uni: { getElementById: vi.fn((): any => null), showToast: vi.fn() },
    resolveLocalVideoPreviewPath: vi.fn(() => new Promise<string>(resolve => { finish = resolve; })),
  };
  const js = transformSync(script, { loader: "ts" }).code;
  const state = new Function("scope", `with(scope){${js};return {src,ready,loading,preparePreviewPlayer};}`)(scope);
  return { state, hooks, scope, finish: (path: string) => finish(path) };
}

describe("staged video preview lifecycle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([
    "content://com.android.providers.media.documents/document/video%3A161040",
    "content://com.android.providers.media.documents/document/primary%3AMovies%2F100%25.mp4",
    "/var/mobile/tmp/视频 100%25.mov",
  ])("preserves the authorized URI after the router decodes its query: %s", path => {
    const h = previewPage();
    h.hooks.load({ src: decodeURIComponent(encodeURIComponent(path)) });
    expect(h.scope.resolveLocalVideoPreviewPath).toHaveBeenCalledWith(path);
  });

  it("also preserves URI escapes when a platform supplies an encoded query value", () => {
    const h = previewPage();
    const path = "content://com.android.providers.media.documents/document/video%3A161040";
    h.hooks.load({ src: encodeURIComponent(path) });
    expect(h.scope.resolveLocalVideoPreviewPath).toHaveBeenCalledWith(path);
  });

  it("waits for a playable file before mounting and leaves playback to the user", async () => {
    const h = previewPage();
    const player = { pause: vi.fn(), play: vi.fn() };
    h.scope.uni.getElementById.mockReturnValue(player);
    h.hooks.load({ src: encodeURIComponent("content://video/123") });
    h.hooks.ready();
    expect(h.state.loading.value).toBe(true);
    expect(h.state.src.value).toBe("");
    h.finish("/cache/preview.mp4");
    await Promise.resolve();
    expect(h.state.src.value).toBe("/cache/preview.mp4");
    expect(h.state.loading.value).toBe(false);
    expect(player.play).not.toHaveBeenCalled();
    h.hooks.hide();
    expect(player.pause).toHaveBeenCalledOnce();
  });

  it("does not query a destroyed native page or clear the last frame on unload", async () => {
    const h = previewPage();
    const player = { pause: vi.fn() };
    h.scope.uni.getElementById.mockReturnValue(player);
    h.hooks.load({ src: "/cache/a.mp4" });
    h.hooks.ready();
    h.finish("/cache/a.mp4");
    await Promise.resolve();
    h.hooks.hide();
    expect(player.pause).toHaveBeenCalledOnce();
    h.scope.uni.getElementById.mockClear().mockImplementation(() => { throw new Error("document destroyed"); });
    expect(() => h.hooks.unload()).not.toThrow();
    vi.runAllTimers();
    expect(h.scope.uni.getElementById).not.toHaveBeenCalled();
    expect(h.state.src.value).toBe("/cache/a.mp4");
    expect(h.state.ready.value).toBe(true);
  });

  it("does not mount or show errors when the pending copy finishes after unloading", async () => {
    const h = previewPage();
    h.hooks.load({ src: encodeURIComponent("content://video/123") });
    h.hooks.unload();
    h.finish("/cache/preview.mp4");
    await Promise.resolve();
    expect(h.state.src.value).toBe("");
    expect(h.scope.uni.getElementById).not.toHaveBeenCalled();
    expect(h.scope.uni.showToast).not.toHaveBeenCalled();
  });
});
