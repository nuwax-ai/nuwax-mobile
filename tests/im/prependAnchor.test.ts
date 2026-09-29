import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadUtsClass } from "./runtimeHarness";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function fixture() {
  let contentTop = 80;
  let listener: any;
  const observer = { isAlive: () => true, addOnPreDrawListener: (v: any) => listener = v, removeOnPreDrawListener: vi.fn() };
  const view = { getViewTreeObserver: () => observer, invalidate: vi.fn() };
  const body = { scrollTop: 35, getBoundingClientRect: () => ({ top: 100 }), getAndroidView: () => view };
  const anchor = { getBoundingClientRect: () => ({ top: 100 + contentTop - body.scrollTop }) };
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
