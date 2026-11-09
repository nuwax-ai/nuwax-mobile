import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 按平台执行真实 UTS 函数；原生播放器和页面栈由 mock 提供，不替代真机验证。
function platformCode(source: string, platform: string): string {
  const active = new Set(["APP", `APP-${platform.toUpperCase()}`]);
  const stack = [true];
  return source.split("\n").filter(line => {
    const directive = line.match(/^\s*\/\/ #(ifdef|ifndef) (.+)$/);
    if (directive) {
      const matched = directive[2].split("||").some(name => active.has(name.trim()));
      stack.push(stack[stack.length - 1] && (directive[1] == "ifdef" ? matched : !matched));
      return false;
    }
    if (/^\s*\/\/ #endif/.test(line)) { stack.pop(); return false; }
    return stack[stack.length - 1];
  }).join("\n");
}

function harness(platform = "android", disabled = false) {
  const player = { requestFullScreen: vi.fn(), exitFullScreen: vi.fn(), play: vi.fn(), pause: vi.fn(), seek: vi.fn() };
  const style: Record<string, unknown> = { disableSwipeBack: disabled };
  const page = {
    route: "pages/message/chat",
    getPageStyle: () => style,
    setPageStyle: vi.fn((value: object) => Object.assign(style, value)),
  };
  const scope: any = {
    ref: (value: unknown) => ({ value }),
    getCurrentPages: () => [page],
    uni: { getElementById: vi.fn(() => player), navigateTo: vi.fn(), navigateBack: vi.fn() },
  };
  const source = platformCode(readFileSync("utils/chatVideoControl.uts", "utf8"), platform)
    .replace(/^import .+;$/gm, "").replace(/\bexport /g, "");
  const js = transformSync(source, { loader: "ts" }).code;
  const control = new Function("scope", `with(scope){${js};return {
    beginChatVideoFullscreen,confirmChatVideoFullscreen,setChatVideoFullscreen,isChatVideoFullscreen,
    exitChatVideoFullscreenOnBack,startChatVideoBackSwipe,finishChatVideoBackSwipe
  };}`)(scope);
  Object.assign(scope, control, {
    fullscreenRequestPending: false, barDisposed: false,
    props: { playerId: "chatVideoPlayer-42" },
    playerElement: () => player,
    traceChatVideo: vi.fn(),
    nextTick: () => Promise.resolve(),
  });
  const bar = readFileSync("components/chat-video-bar/chat-video-bar.uvue", "utf8");
  const toggleBody = bar.slice(bar.indexOf("  async function toggleFullscreen("), bar.indexOf("  function clampedRatio("));
  const platformToggle = platformCode(toggleBody, platform);
  const toggle = new Function("scope", `with(scope){${transformSync(platformToggle, { loader: "ts" }).code};return toggleFullscreen;}`)(scope);
  const chat = readFileSync("pages/message/chat.uvue", "utf8");
  const backStart = chat.indexOf("  onBackPress(");
  const backBody = chat.slice(backStart, chat.indexOf("\n  });", backStart) + 6);
  let back: (options: { from: string }) => boolean = () => { throw new Error("onBackPress not registered"); };
  new Function("scope", `with(scope){${transformSync(backBody, { loader: "ts" }).code}}`)({
    onBackPress: (callback: (options: { from: string }) => boolean) => {
      if (callback.length != 1) throw new Error("onBackPress requires an OnBackPressOptions parameter");
      back = callback;
    }, ...control,
  });
  return { scope, control, toggle, back: () => back({ from: "backbutton" }), player, page, style };
}

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("native chat video fullscreen", () => {
  it.each(["android", "ios", "harmony"])("%s reuses the inline player and starts it without opening a new page", async platform => {
    const h = harness(platform);
    await h.toggle();
    if (platform == "android") vi.advanceTimersByTime(180);
    expect(h.player.requestFullScreen).toHaveBeenCalledExactlyOnceWith({ direction: 0 });
    expect(h.player.play).toHaveBeenCalledOnce();
    expect(h.player.seek).not.toHaveBeenCalled();
    expect(h.player.pause).not.toHaveBeenCalled();
    expect(h.scope.uni.navigateTo).not.toHaveBeenCalled();
    expect(h.scope.uni.navigateBack).not.toHaveBeenCalled();
  });

  it("ignores a duplicate fullscreen tap while controls are being committed", async () => {
    const h = harness();
    await Promise.all([h.toggle(), h.toggle()]);
    vi.advanceTimersByTime(180);
    expect(h.player.requestFullScreen).toHaveBeenCalledOnce();
  });

  it("cancels entry if the control is unmounted while awaiting its render", async () => {
    const h = harness("ios");
    const pending = h.toggle();
    h.scope.barDisposed = true;
    await pending;
    expect(h.player.requestFullScreen).not.toHaveBeenCalled();
    expect(h.style.disableSwipeBack).toBe(false);
    expect(h.control.isChatVideoFullscreen()).toBe(false);
  });

  it("restores iOS gestures if the native fullscreen request fails", async () => {
    const h = harness("ios");
    h.player.requestFullScreen.mockImplementation(() => { throw new Error("request failed"); });
    await h.toggle();
    vi.advanceTimersByTime(180);
    expect(h.scope.fullscreenRequestPending).toBe(false);
    expect(h.control.isChatVideoFullscreen()).toBe(false);
    expect(h.style.disableSwipeBack).toBe(false);
  });

  it("exits an already fullscreen player through its native controls", async () => {
    const h = harness("ios");
    h.control.beginChatVideoFullscreen("chatVideoPlayer-42");
    h.control.confirmChatVideoFullscreen(true, "chatVideoPlayer-42");
    await h.toggle();
    expect(h.player.exitFullScreen).toHaveBeenCalledOnce();
    expect(h.player.requestFullScreen).not.toHaveBeenCalled();
  });
});

describe("back gestures stay on the chat page while fullscreen", () => {
  it.each(["android", "ios"])("%s consumes back only until native fullscreen exits", platform => {
    const h = harness(platform);
    expect(h.back()).toBe(false);
    h.control.beginChatVideoFullscreen("chatVideoPlayer-42");
    h.control.confirmChatVideoFullscreen(true, "chatVideoPlayer-42");
    expect(h.back()).toBe(true);
    expect(h.scope.uni.getElementById).toHaveBeenCalledWith("chatVideoPlayer-42");
    expect(h.player.exitFullScreen).toHaveBeenCalledOnce();
    expect(h.control.isChatVideoFullscreen()).toBe(true);
    expect(h.player.pause).not.toHaveBeenCalled();
    expect(h.player.seek).not.toHaveBeenCalled();
    expect(h.scope.uni.navigateBack).not.toHaveBeenCalled();
    h.control.confirmChatVideoFullscreen(false, "chatVideoPlayer-42");
    expect(h.back()).toBe(false);
  });

  it("restores the previous iOS page swipe setting after native exit", () => {
    const h = harness("ios");
    h.control.beginChatVideoFullscreen("chatVideoPlayer-42");
    expect(h.style.disableSwipeBack).toBe(true);
    h.control.confirmChatVideoFullscreen(true, "chatVideoPlayer-42");
    h.back();
    expect(h.style.disableSwipeBack).toBe(true);
    h.control.confirmChatVideoFullscreen(false, "chatVideoPlayer-42");
    expect(h.style.disableSwipeBack).toBe(false);
  });

  it("does not enable a page swipe that was already disabled", () => {
    const h = harness("ios", true);
    h.control.beginChatVideoFullscreen("chatVideoPlayer-42");
    h.control.confirmChatVideoFullscreen(true, "chatVideoPlayer-42");
    h.control.setChatVideoFullscreen(false);
    expect(h.style.disableSwipeBack).toBe(true);
  });

  it("releases the iOS page guard when fullscreen entry times out", () => {
    const h = harness("ios");
    h.control.beginChatVideoFullscreen("chatVideoPlayer-42");
    vi.advanceTimersByTime(1500);
    expect(h.style.disableSwipeBack).toBe(false);
    expect(h.back()).toBe(false);
  });

  it("iOS left-edge right swipe exits fullscreen once without navigation", () => {
    const h = harness("ios");
    h.control.beginChatVideoFullscreen("chatVideoPlayer-42");
    h.control.confirmChatVideoFullscreen(true, "chatVideoPlayer-42");
    h.control.startChatVideoBackSwipe({ touches: [{ clientX: 12, clientY: 180 }] });
    const end = { type: "touchend", changedTouches: [{ clientX: 125, clientY: 195 }] };
    h.control.finishChatVideoBackSwipe(end);
    h.control.finishChatVideoBackSwipe(end);
    expect(h.player.exitFullScreen).toHaveBeenCalledOnce();
    expect(h.scope.uni.navigateBack).not.toHaveBeenCalled();
  });

  it.each([
    [100, 220, 190, "touchend", 100], // 从中间拖进度
    [12, 30, 190, "touchend", 100], // 点击/小幅移动
    [12, 125, 400, "touchend", 100], // 纵向手势
    [12, 125, 190, "touchcancel", 100], // 手势被取消
    [12, 125, 190, "touchend", 1300], // 长按后拖动
  ])("does not interpret an unrelated touch as back: %j", (x, endX, endY, type, elapsed) => {
    const h = harness("ios");
    h.control.beginChatVideoFullscreen("chatVideoPlayer-42");
    h.control.confirmChatVideoFullscreen(true, "chatVideoPlayer-42");
    h.control.startChatVideoBackSwipe({ touches: [{ clientX: x, clientY: 180 }] });
    vi.advanceTimersByTime(Number(elapsed));
    h.control.finishChatVideoBackSwipe({ type, changedTouches: [{ clientX: endX, clientY: endY }] });
    expect(h.player.exitFullScreen).not.toHaveBeenCalled();
  });

  it("does not change Harmony back handling or page gestures", () => {
    const h = harness("harmony");
    h.control.beginChatVideoFullscreen("chatVideoPlayer-42");
    expect(h.back()).toBe(false);
    expect(h.page.setPageStyle).not.toHaveBeenCalled();
    expect(h.player.exitFullScreen).not.toHaveBeenCalled();
  });
});
