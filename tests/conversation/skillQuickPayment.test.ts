import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";

const listSource = readFileSync("components/skill-list-view/skill-list-view.uvue", "utf8");
const popupSource = readFileSync("components/conversation-input/expert-quick-popup/expert-quick-popup.uvue", "utf8");
const composerSource = readFileSync("components/conversation-input/conversation-input.uvue", "utf8");
const modalSource = readFileSync("components/skill-list-view/skill-payment-modal/skill-payment-modal.uvue", "utf8");

function fragment(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Missing skill payment fragment: ${startMarker}`);
  return source.slice(start, end);
}

function evaluate(script: string, scope: Record<string, unknown>): any {
  const code = transformSync(script, { loader: "ts" }).code;
  return new Function(...Object.keys(scope), code)(...Object.values(scope));
}

function listFixture() {
  const emit = vi.fn(), completeAction = vi.fn(), apiPublishedSkillDetail = vi.fn();
  const paid = { targetId: 376, paymentRequired: true, subscribed: false };
  const handlers = evaluate([
    "let paymentHandoffPending = false;",
    fragment(listSource, "  async function runPaymentGate(", "  // 模板内 $event"),
    fragment(listSource, "  function pickHighlight(", "  function refresh("),
    "return { handleSelect, pickHighlight };",
  ].join("\n"), {
    emit, completeAction, apiPublishedSkillDetail,
    props: { externalPayment: true }, subscriptionEnabled: true,
    toPayload: (item: unknown) => item,
    skillHighlightIndex: { value: 0 }, items: { value: [paid] },
  });
  return { emit, completeAction, apiPublishedSkillDetail, paid, handlers };
}

function modalFixture() {
  vi.useFakeTimers();
  const emit = vi.fn(), hideKeyboard = vi.fn();
  const unmount: Array<() => void> = [];
  let resolveDetail: (value: unknown) => void = () => {};
  const apiPublishedSkillDetail = vi.fn(() => new Promise(resolve => { resolveDetail = resolve; }));
  let state: any;
  const modal = { $callMethod: vi.fn((method: string) => state.handleVisibleChange(method === "open")) };
  const script = modalSource.match(/<script setup lang="uts">([\s\S]*?)<\/script>/)![1]
    .replace(/^  import .*;\n/gm, "")
    .replace(/  defineExpose\([\s\S]*$/, "return { open, close, handleVisibleChange, handlePurchaseSuccess, modalRef, modalMounted, pendingItem, targetId };");
  state = evaluate(script, {
    ref: (value: unknown) => ({ value }),
    defineEmits: () => emit,
    onUnmounted: (callback: () => void) => unmount.push(callback),
    nextTick: async () => { if (state.modalMounted.value) state.modalRef.value = modal; },
    apiPublishedSkillDetail, apiResCode: (res: any) => res.code, apiResData: (res: any) => res.data,
    SUCCESS_CODE: "0000", setTimeout, clearTimeout, uni: { hideKeyboard },
  });
  return { state, emit, modal, hideKeyboard, unmount, apiPublishedSkillDetail,
    resolve: (data: unknown) => resolveDetail({ code: "0000", data }) };
}

afterEach(() => vi.useRealTimers());

describe("/ 快捷技能付费", () => {
  it("付费交接后吞掉连续点击，包括原本位于关闭按钮后面的免费技能", () => {
    const f = listFixture();
    f.handlers.handleSelect(f.paid);
    f.handlers.handleSelect(f.paid);
    f.handlers.handleSelect({ targetId: 371, paymentRequired: false, subscribed: false });
    expect(f.emit).toHaveBeenCalledExactlyOnceWith("payment-required", f.paid);
    expect(f.completeAction).not.toHaveBeenCalled();
    expect(f.apiPublishedSkillDetail).not.toHaveBeenCalled();
  });

  it("键盘选择也执行付费门，已订阅技能仍可直接选择", () => {
    const f = listFixture();
    f.handlers.pickHighlight();
    expect(f.emit).toHaveBeenCalledExactlyOnceWith("payment-required", f.paid);
    expect(f.completeAction).not.toHaveBeenCalled();
    const subscribed = listFixture();
    subscribed.handlers.handleSelect({ ...subscribed.paid, subscribed: true });
    expect(subscribed.completeAction).toHaveBeenCalledOnce();
    expect(subscribed.emit).not.toHaveBeenCalled();
  });

  it("技能付费事件先卸载快捷列表，再打开由输入组件持有的弹框", async () => {
    const order: string[] = [];
    const ticks: Array<() => void> = [];
    const item = { targetId: 376 };
    const modal = { $callMethod: vi.fn(() => order.push("open")) };
    const parent = evaluate(
      fragment(composerSource, "  const handleQuickSkillPaymentRequired = ", "  /** 首页快捷浮层选中") +
      "return handleQuickSkillPaymentRequired;", {
        closeQuickPopup: () => order.push("unmount-list"),
        nextTick: (callback: () => void) => ticks.push(callback), skillPaymentModalRef: { value: modal },
      },
    );
    const route = evaluate(
      fragment(popupSource, "  function handlePaymentRequired(", "  function handleFileSelect(") +
      "return handlePaymentRequired;", {
        props: { mode: "skill" }, emit: (event: string, payload: unknown) => {
          if (event === "skill-payment-required") parent(payload);
        },
      },
    );
    route(item);
    expect(order).toEqual(["unmount-list"]);
    ticks.forEach(callback => callback());
    expect(order).toEqual(["unmount-list", "open"]);
    expect(modal.$callMethod).toHaveBeenCalledExactlyOnceWith("open", item);
  });

  it("详情请求和已打开期间连续操作只请求一次，不插入未订阅技能", async () => {
    const f = modalFixture(), item = { targetId: 376, subscribed: false };
    const first = f.state.open(item);
    await f.state.open({ targetId: 351 });
    expect(f.apiPublishedSkillDetail).toHaveBeenCalledExactlyOnceWith(376);
    f.resolve({ paymentRequired: true, subscribed: false });
    await first;
    await f.state.open(item);
    expect(f.modal.$callMethod).toHaveBeenCalledExactlyOnceWith("open");
    expect(f.hideKeyboard).toHaveBeenCalledOnce();
    expect(f.emit).not.toHaveBeenCalled();
  });

  it("关闭后保留弹框组件完成动画，取消不插入，动画结束后可再次打开", async () => {
    const f = modalFixture(), item = { targetId: 376 };
    const first = f.state.open(item);
    f.resolve({ paymentRequired: true, subscribed: false }); await first;
    f.state.close();
    expect(f.state.modalMounted.value).toBe(true);
    expect(f.emit).not.toHaveBeenCalled();
    await f.state.open(item);
    expect(f.apiPublishedSkillDetail).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(350);
    const second = f.state.open(item);
    f.resolve({ paymentRequired: true, subscribed: false }); await second;
    expect(f.apiPublishedSkillDetail).toHaveBeenCalledTimes(2);
    expect(f.modal.$callMethod.mock.calls).toEqual([["open"], ["close"], ["open"]]);
  });

  it("复核已订阅可选择，购买成功也只回填一次", async () => {
    const f = modalFixture(), item = { targetId: 376, subscribed: false };
    const open = f.state.open(item);
    f.resolve({ paymentRequired: true, subscribed: true }); await open;
    expect(f.emit).toHaveBeenCalledExactlyOnceWith("select", { ...item, paymentRequired: true, subscribed: true });
    expect(f.modal.$callMethod).not.toHaveBeenCalled();
    const paid = modalFixture(), paidItem = { targetId: 351, subscribed: false };
    const payOpen = paid.state.open(paidItem);
    paid.resolve({ paymentRequired: true, subscribed: false }); await payOpen;
    paid.state.handlePurchaseSuccess(); paid.state.handlePurchaseSuccess();
    expect(paid.emit).toHaveBeenCalledExactlyOnceWith("select", { ...paidItem, subscribed: true });
  });

  it("请求期间取消或输入组件卸载后，迟到的响应不会重新弹出或插入", async () => {
    for (const cancel of ["close", "unmount"]) {
      const f = modalFixture();
      const pending = f.state.open({ targetId: 376 });
      if (cancel === "close") f.state.close();
      else f.unmount.forEach(callback => callback());
      f.resolve({ paymentRequired: false, subscribed: true }); await pending;
      expect(f.modal.$callMethod).not.toHaveBeenCalled();
      expect(f.emit).not.toHaveBeenCalled();
    }
  });
});
