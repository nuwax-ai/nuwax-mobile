import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";

const source = readFileSync("subpackages/pages/chat-conversation-component/components/agent-subscription-modal/agent-subscription-modal.uvue", "utf8");

function fragment(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Missing subscription fragment: ${startMarker}`);
  return source.slice(start, end);
}

function fixture(expertName = "收费专家") {
  vi.useFakeTimers();
  const emit = vi.fn(), fetchPlans = vi.fn(), refreshExpertDetail = vi.fn();
  const unmountCallbacks: Array<() => void> = [];
  const popups: Array<{ $callMethod: ReturnType<typeof vi.fn> }> = [];
  let renderedSession = -1;
  let state: any;
  const render = () => {
    const mounted = state.modalMounted == null || state.modalMounted.value;
    const session = state.modalSession?.value ?? 0;
    if (!mounted) {
      state.modalRef.value = null;
      renderedSession = -1;
    } else if (renderedSession !== session) {
      const popup = { $callMethod: vi.fn((method: string) => state.handleUpdateVisible(method === "open")) };
      popups.push(popup);
      state.modalRef.value = popup;
      renderedSession = session;
    }
  };
  const ref = (value: unknown) => ({ value });
  const scope = {
    ref, props: { expertName }, defineEmits: () => emit,
    nextTick: async () => { render(); },
    onUnmounted: (callback: () => void) => unmountCallbacks.push(callback),
    setTimeout, clearTimeout, fetchPlans, refreshExpertDetail, measureExpertDrawer: vi.fn(),
    detailSubscribed: ref(true), detailPaymentRequired: ref(false),
    detailTrialCount: ref(5), detailCalledTrialCount: ref(3), summonChecking: ref(true),
    windowWidthPx: ref(375), expertDrawerHeightPx: ref(400), expertPlansHeightPx: ref(250),
    uni: { getWindowInfo: () => ({ windowWidth: 375, windowHeight: 800 }) },
  };
  const script = [
    fragment("  const emit = defineEmits(", "  const loading = "),
    fragment("  const callModalMethod = ", "  /** 关闭订阅计划弹框。 */"),
    fragment("  const close = ", "  const refreshExpertDetail = "),
    fragment("  const open = ", "  defineExpose("),
    "return {open, close, handleUpdateVisible, modalRef,",
    "modalMounted: typeof modalMounted === 'undefined' ? null : modalMounted,",
    "modalSession: typeof modalSession === 'undefined' ? null : modalSession,",
    "handleAfterLeave: typeof handleAfterLeave === 'undefined' ? () => {} : handleAfterLeave};",
  ].join("\n");
  const code = transformSync(script, { loader: "ts" }).code;
  state = new Function(...Object.keys(scope), code)(...Object.values(scope));
  render();
  return { ...scope, emit, state, popups, render, unmountCallbacks };
}

afterEach(() => vi.useRealTimers());

describe("专家付费弹窗关闭后重开", () => {
  it("关闭按钮收起后释放弹层，再点同一专家使用新的弹层并重新加载", async () => {
    const f = fixture();
    await f.state.open();
    const first = f.state.modalRef.value;
    f.state.close();
    expect(first.$callMethod).toHaveBeenLastCalledWith("close");
    expect(f.state.modalRef.value).toBe(first);
    f.state.handleAfterLeave(); f.render();
    expect(f.state.modalRef.value).toBeNull();
    await f.state.open();
    expect(f.state.modalRef.value).not.toBe(first);
    expect(f.state.modalRef.value.$callMethod).toHaveBeenCalledExactlyOnceWith("open");
    expect(f.fetchPlans).toHaveBeenCalledTimes(2);
    expect(f.refreshExpertDetail).toHaveBeenCalledTimes(2);
    expect(f.emit.mock.calls).toEqual([["update-visible", true], ["update-visible", false], ["update-visible", true]]);
  });

  it("遮罩或返回关闭也释放容器，缺少 afterleave 时按动画结束时间兜底", async () => {
    const f = fixture();
    await f.state.open();
    f.state.handleUpdateVisible(false);
    await vi.advanceTimersByTimeAsync(349); f.render();
    expect(f.state.modalRef.value).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1); f.render();
    expect(f.state.modalRef.value).toBeNull();
    await f.state.open();
    expect(f.state.modalRef.value.$callMethod).toHaveBeenCalledExactlyOnceWith("open");
    expect(f.unmountCallbacks).toHaveLength(1);
  });

  it("关闭动画中重开不会被旧关闭定时器或离场通知收起", async () => {
    const f = fixture();
    await f.state.open();
    const first = f.state.modalRef.value;
    f.state.close();
    await f.state.open();
    const reopened = f.state.modalRef.value;
    expect(reopened).not.toBe(first);
    f.state.handleAfterLeave();
    await vi.advanceTimersByTimeAsync(500); f.render();
    expect(f.state.modalRef.value).toBe(reopened);
    expect(f.emit.mock.calls.at(-1)).toEqual(["update-visible", true]);
  });

  it("快速连续打开只加载最后一次，切换专家也重建容器", async () => {
    const f = fixture();
    await Promise.all([f.state.open(), f.state.open()]);
    expect(f.fetchPlans).toHaveBeenCalledTimes(1);
    expect(f.refreshExpertDetail).toHaveBeenCalledTimes(1);
    const first = f.state.modalRef.value;
    f.props.expertName = "另一位收费专家";
    await f.state.open();
    expect(f.state.modalRef.value).not.toBe(first);
    expect(f.detailSubscribed.value).toBe(false);
    expect(f.detailPaymentRequired.value).toBe(true);
    expect(f.detailTrialCount.value).toBe(0);
    expect(f.detailCalledTrialCount.value).toBe(0);
  });

  it("技能及普通订阅弹窗沿用原来的容器生命周期", async () => {
    const f = fixture("");
    await f.state.open();
    const first = f.state.modalRef.value;
    f.state.close(); f.state.handleAfterLeave();
    await vi.advanceTimersByTimeAsync(500); f.render();
    await f.state.open();
    expect(f.state.modalRef.value).toBe(first);
  });

  it("订阅组件卸载时清理尚未完成的关闭兜底", async () => {
    const f = fixture();
    await f.state.open(); f.state.close();
    expect(vi.getTimerCount()).toBe(1);
    f.unmountCallbacks.forEach((callback) => callback());
    expect(vi.getTimerCount()).toBe(0);
  });
});
