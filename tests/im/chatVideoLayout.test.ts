import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// 执行 Android UTS 模块的真实守卫，原生视图树/绘制观察器仅作行为模拟。
const source = readFileSync("utils/androidChatVideoLayout.uts", "utf8")
  .replace(/^import .+;$/gm, "").replace(/\bexport /g, "").replace(/\.toInt\(\)/g, "");
const code = transformSync(source, { loader: "ts" }).code;

function harness() {
  const listeners = new Set<any>();
  const observer = {
    isAlive: () => true,
    addOnPreDrawListener: (guard: unknown) => listeners.add(guard),
    removeOnPreDrawListener: vi.fn((guard: unknown) => listeners.delete(guard)),
  };
  class View {
    width = 662; height = 497; attached = true; layoutRequested = false;
    parent: View | null = null;
    getWidth() { return this.width; }
    getHeight() { return this.height; }
    getParent() { return this.parent; }
    isAttachedToWindow() { return this.attached; }
    isLayoutRequested() { return this.layoutRequested; }
    getViewTreeObserver() { return observer; }
    invalidate = vi.fn();
    requestLayout = vi.fn(() => { this.layoutRequested = true; });
  }
  class ViewGroup extends View {
    children: View[] = [];
    getChildCount() { return this.children.length; }
    getChildAt(i: number) { return this.children[i]; }
    add(view: View) { this.children.push(view); view.parent = this; }
  }
  class TextureView extends View {}
  const inline = new ViewGroup();
  const root = new ViewGroup();
  const inner = new ViewGroup();
  const texture = new TextureView();
  inline.add(root); root.add(inner); inner.add(texture);
  const fullscreenHost = new ViewGroup();
  const setProperty = vi.fn();
  const element = {
    parentElement: { getAndroidView: () => inline, getBoundingClientRect: () => ({ width: inline.width / 3.31, height: inline.height / 3.31 }) },
    getAndroidView: () => texture, // 真实 video API 返回纹理，非被全屏搬动的 root。
    style: { setProperty },
  };
  const api = new Function("View", "ViewGroup", "TextureView", "ref", `${code};return {prepareAndroidChatVideoInlineLayout,cancelAndroidChatVideoInlineLayout,confirmAndroidChatVideoControls,androidChatVideoControlsPlayerId,androidChatVideoHiddenBarPlayerId};`)(View, ViewGroup, TextureView, (value: unknown) => ({ value }));
  return {
    inline, root, texture, element, setProperty, observer, listeners,
    confirm: (fullscreen: boolean) => api.confirmAndroidChatVideoControls("chatVideoPlayer-42", fullscreen),
    controls: api.androidChatVideoControlsPlayerId, hiddenBar: api.androidChatVideoHiddenBarPlayerId,
    arm: (id = "chatVideoPlayer-42") => api.prepareAndroidChatVideoInlineLayout(id, element),
    cancel: (id = "") => api.cancelAndroidChatVideoInlineLayout(id),
    draw: () => [...listeners].map(guard => guard.onPreDraw()),
    enter: () => { root.parent = fullscreenHost; root.width = texture.width = 1200; root.height = texture.height = 2640; },
    exit: () => {
      root.parent = inline; root.height = texture.height = 497;
      // 返回首拍先关闭系统条并拒绝绘制，下一拍再评估布局。
      expect([...listeners].map(guard => guard.onPreDraw())).toEqual([false]);
      expect(api.androidChatVideoControlsPlayerId.value).toBe("");
    },
    layout: () => { root.width = texture.width = inline.width; root.height = texture.height = inline.height; root.layoutRequested = false; },
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it("allows normal inline and fullscreen draws without changing dimensions", () => {
  const h = harness(); h.arm();
  expect(h.draw()).toEqual([true]);
  h.enter();
  expect(h.draw()).toEqual([true]);
  vi.advanceTimersByTime(1500);
  expect(h.listeners.size).toBe(1); // 不因入口看门狗打断真正的全屏。
  expect(h.setProperty).not.toHaveBeenCalled();
});

it.each([[662, 497], [497, 373]])("blocks the wrong return frame until both container and texture match %s × %s", (width, height) => {
  const h = harness(); h.inline.width = width; h.inline.height = height;
  h.arm(); h.enter(); h.draw(); h.exit();
  expect(h.draw()).toEqual([false]);
  expect(h.setProperty).toHaveBeenCalledWith("width", `${width / 3.31}px`);
  expect(h.setProperty).toHaveBeenCalledWith("height", `${height / 3.31}px`);
  h.root.width = width; h.root.height = height; h.root.layoutRequested = false;
  expect(h.draw()).toEqual([false]); // 外层先完成、纹理还未完成时仍不放行。
  expect(h.setProperty).toHaveBeenCalledTimes(2); // 桥接待完成期间不反复写同一份样式。
  h.layout();
  expect(h.draw()).toEqual([true]);
  expect(h.listeners.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("does not delay or mutate a return that the framework restored correctly", () => {
  const h = harness(); h.arm(); h.enter(); h.draw(); h.exit(); h.layout();
  expect(h.draw()).toEqual([true]);
  expect(h.setProperty).not.toHaveBeenCalled();
});

it("releases the draw veto within 250ms if native layout never catches up", () => {
  const h = harness(); h.arm(); h.enter(); h.draw(); h.exit(); h.draw();
  vi.advanceTimersByTime(250);
  expect(h.listeners.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("releases a failed entry and detached page without leaving observers", () => {
  const h = harness(); h.arm();
  vi.advanceTimersByTime(1500);
  expect(h.listeners.size).toBe(0);
  h.arm(); h.inline.attached = false;
  expect(h.draw()).toEqual([true]);
  expect(h.listeners.size).toBe(0);
});

it("cancels old work on rapid reentry and cleans up only the owning bar", () => {
  const h = harness(); h.arm(); h.enter(); h.draw(); h.exit(); h.draw();
  h.arm("chatVideoPlayer-next");
  expect(h.listeners.size).toBe(1);
  h.cancel("chatVideoPlayer-42");
  expect(h.listeners.size).toBe(1);
  h.enter();
  expect(h.draw()).toEqual([true]);
  h.cancel(); // 页面隐藏或卸载。
  expect(h.listeners.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("leaves other video entry points alone", () => {
  const h = harness(); h.arm("mfdVideoPlayer-42");
  expect(h.listeners.size).toBe(0);
});

it("fails open if the platform rejects a style write", () => {
  const h = harness(); h.arm(); h.enter(); h.draw(); h.exit();
  h.setProperty.mockImplementation(() => { throw new Error("disposed"); });
  expect(h.draw()).toEqual([true]);
  expect(h.listeners.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});


it("hides inline controls before entry and keeps them hidden until the return layout is ready", () => {
  const h = harness(); h.arm();
  expect(h.hiddenBar.value).toBe("chatVideoPlayer-42");
  expect(h.controls.value).toBe("");
  h.draw();
  expect(h.controls.value).toBe("");
  h.enter(); h.draw();
  expect(h.controls.value).toBe("chatVideoPlayer-42");
  h.exit();
  expect(h.hiddenBar.value).toBe("chatVideoPlayer-42");
  expect(h.draw()).toEqual([false]);
  h.layout(); h.draw();
  expect(h.controls.value).toBe("");
  expect(h.hiddenBar.value).toBe("");
});

it("restores the inline bar after cancelled or unsuccessful entry", () => {
  const h = harness(); h.arm(); h.cancel();
  expect(h.hiddenBar.value).toBe("");
  expect(h.controls.value).toBe("");
  h.arm(); vi.advanceTimersByTime(1500);
  expect(h.hiddenBar.value).toBe("");
  expect(h.controls.value).toBe("");
});

it("keeps native fullscreen controls available when no layout guard could be installed", () => {
  const h = harness();
  h.confirm(true);
  expect(h.controls.value).toBe("chatVideoPlayer-42");
  h.confirm(false);
  expect(h.controls.value).toBe("");
  h.confirm(true); h.cancel();
  expect(h.controls.value).toBe("");
});
