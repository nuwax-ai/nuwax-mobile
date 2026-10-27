import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadUtsClass } from "./runtimeHarness";

// UTS `Number.toInt()` 的 Node 垫片（Kotlin 侧 View.scrollTo(Int, Int) 要求显式转换）
(Number.prototype as any).toInt = function (this: number): number { return Math.trunc(this); };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function fixture() {
  let contentTop = 80;
  let listener: any;
  let scrollY = 35; // 原生滚动真值（view 持有；body.scrollTop 为其代理——断言面不变）
  const observer = { isAlive: () => true, addOnPreDrawListener: (v: any) => listener = v, removeOnPreDrawListener: vi.fn() };
  const view = {
    getViewTreeObserver: () => observer,
    invalidate: vi.fn(),
    getScrollY: () => scrollY,
    scrollTo: (_x: number, y: number) => { scrollY = y; },
  };
  const body = {
    get scrollTop() { return scrollY; },
    set scrollTop(v: number) { scrollY = v; },
    getBoundingClientRect: () => ({ top: 100 }),
    getAndroidView: () => view,
  };
  const anchor = { getBoundingClientRect: () => ({ top: 100 + contentTop - scrollY }) };
  const preserve = loadUtsClass("utils/im/imPrependAnchor.uts", "preserveImPrependAnchor", {
    uni: { getElementById: (id: string) => id === 'body' ? body : anchor },
  });
  const cancel = preserve('body', 'anchor');
  return { body, observer, view, cancel, draw: () => listener.onPreDraw(), prepend: (height: number) => contentTop += height };
}
it('keeps the current reading offset before drawing prepended messages', () => {
  const f = fixture();
  f.body.scrollTop = 15; // User can still move while the response is pending.
  expect(f.draw()).toBe(true);
  expect(f.body.scrollTop).toBe(15);
  f.prepend(800);
  expect(f.draw()).toBe(false);
  expect(f.body.scrollTop).toBe(815);
  expect(f.view.invalidate).toHaveBeenCalledOnce();
  expect(f.observer.removeOnPreDrawListener).not.toHaveBeenCalled();
  expect(f.draw()).toBe(true);
  f.prepend(200); // A second native layout must also be compensated.
  expect(f.draw()).toBe(false);
  expect(f.body.scrollTop).toBe(1015);
  vi.advanceTimersByTime(1000);
  expect(f.observer.removeOnPreDrawListener).toHaveBeenCalledOnce();
});
it('releases an unchanged or abandoned layout without retaining its views', () => {
  const f = fixture();
  vi.advanceTimersByTime(1000);
  expect(f.observer.removeOnPreDrawListener).toHaveBeenCalledOnce();
  f.cancel();
  expect(f.observer.removeOnPreDrawListener).toHaveBeenCalledOnce();
  const hidden = fixture();
  hidden.cancel(); hidden.prepend(400);
  expect(hidden.draw()).toBe(true);
  expect(hidden.body.scrollTop).toBe(35);
});
