import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";

const composerSource = readFileSync("components/conversation-input/conversation-input.uvue", "utf8");
const homeSource = readFileSync("pages/index/index-content.uvue", "utf8");
const listSource = readFileSync("components/expert-list-view/expert-list-view.uvue", "utf8");
const popupSource = readFileSync("components/conversation-input/expert-quick-popup/expert-quick-popup.uvue", "utf8");
const atomicSource = readFileSync("utils/editorAtomicReplacement.uts", "utf8");

function fragment(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Missing expert keyboard fragment: ${startMarker}`);
  return source.slice(start, end);
}

function platformCode(source: string, platform: string): string {
  const platforms = new Set(platform.startsWith("APP-") ? ["APP", platform] : platform === "MP-WEIXIN" ? ["MP", platform] : ["H5", "WEB"]);
  const active: boolean[] = [];
  return source.split("\n").filter(line => {
    const start = line.match(/^\s*\/\/\s*#(ifdef|ifndef)\s+(.+)$/);
    if (start) {
      const enabled = start[2].split("||").some(term => term.split("&&").every(token => platforms.has(token.trim())));
      active.push(start[1] === "ifdef" ? enabled : !enabled);
      return false;
    }
    if (/^\s*\/\/\s*#endif\b/.test(line)) { active.pop(); return false; }
    return active.every(Boolean);
  }).join("\n");
}

function fixture(platform = "APP-ANDROID") {
  const order: string[] = [], ticks: Array<() => void> = [];
  const replacements: Array<() => void> = [];
  let handlers: any;
  const readonlyExpression = composerSource.match(/:read-only="([^"]+)"/)![1];
  const readOnly = new Function("wholeDisabledVal", "editorReadonlyVal", "androidEditorDefocus", `return ${readonlyExpression};`);
  const focusEditor = () => {
    if (!readOnly(handlers.wholeDisabledVal.value, handlers.editorReadonlyVal?.value, false)) handlers.onInputFocus();
  };
  const nativeFocus = vi.fn(focusEditor), webFocus = vi.fn(focusEditor), textareaFocus = vi.fn(focusEditor);
  const blur = vi.fn(() => order.push("blur")), hideKeyboard = vi.fn(() => order.push("hide-keyboard"));
  const scope = {
    isInputFocused: { value: true },
    expertSheetVisible: { value: false }, pendingExpertPayment: { value: null },
    isAtTrigger: { value: true }, atCursorIndex: { value: 3 },
    messageInfo: { value: "@专家" }, isHomeScene: { value: true },
    props: { allowExpertSelection: true, wholeDisabled: false, editorReadonly: null as boolean | null },
    emit: vi.fn(),
    closeQuickPopup: vi.fn(() => order.push("close-list")),
    editorContext: { blur }, inputRef: { value: { blur, focus: textareaFocus } },
    resolveEditorElement: () => ({ focus: nativeFocus }), androidEditorDefocus: { value: false },
    document: {
      activeElement: { blur }, getElementById: () => ({ contains: () => true }),
      // 新 SDK 的 editor 根节点本身是 ql-container，没有内层 ql-container。
      querySelector: (selector: string) => selector === "#chat-input-editor .ql-container" ? null : ({ __quill: { focus: webFocus } }),
    },
    computed: (getter: () => unknown) => ({ get value() { return getter(); } }),
    installComposerObserver: vi.fn(), measureHomeInputBaseBottom: vi.fn(),
    startAndroidImePolling: vi.fn(), stopAndroidImePolling: vi.fn(), homeInputBaseBottom: -1,
    keyboardHeight: { value: 320 }, homeKeyboardOffset: { value: 0 }, showExtraContainer: { value: false },
    quickPopupVisible: { value: true }, quickPopupMode: { value: "expert" },
    quickPopupBlurTimer: null, quickPopupFocusTimer: null, skipCloseExtraOnBlur: false,
    setTimeout: vi.fn(() => 1), clearTimeout: vi.fn(),
    replaceQuickTriggerAtomically: vi.fn((_mode, _mention, done) => replacements.push(done)),
    removeQuickTriggerText: vi.fn((_mode, done) => replacements.push(done)),
    uni: { hideKeyboard }, nextTick: (callback: () => void) => ticks.push(callback),
    expertPaymentModalRef: { value: { $callMethod: vi.fn(() => order.push("open-payment")) } },
    console: { log() {} },
  };
  const script = [
    atomicSource.slice(atomicSource.indexOf("export function resolveWebComposerQuill")).replace("export function", "function"),
    fragment(composerSource, "  const focusChatInput = ", "  // 文档"),
    fragment(composerSource, "  const wholeDisabledVal = ", "  const pageHomeIndexVal = "),
    fragment(composerSource, "  const blurChatInput = ", "  /** 切换输入方式"),
    fragment(composerSource, "  const onInputFocus = ", "  // 切换额外功能栏"),
    fragment(composerSource, "  const handleExpertSelect = ", "  const handleExpertPaymentRequired = "),
    fragment(composerSource, "  const handleExpertPaymentRequired = ", "  const handleHomeSkillSelect = "),
    fragment(composerSource, "  const applyQuickPopupSelection = ", "  const handleQuickSkillPaymentSelect = "),
    fragment(composerSource, "  const handleExpertSheetClose = ", "  const handleApprovalChange = "),
    "return {handleExpertPaymentRequired, handleExpertSelect, handleExpertSheetClose, handleQuickPopupSelect, focusChatInput, onInputFocus, onInputBlur, wholeDisabledVal, editorReadonlyVal: typeof editorReadonlyVal !== 'undefined' ? editorReadonlyVal : undefined};",
  ].join("\n");
  const code = transformSync(platformCode(script, platform), { loader: "ts" }).code;
  handlers = new Function(...Object.keys(scope), code)(...Object.values(scope));
  const flush = () => { while (ticks.length) ticks.shift()!(); };
  const finishReplacement = () => { scope.isAtTrigger.value = false; while (replacements.length) replacements.shift()!(); };
  const applyHomeState = (overrides: Record<string, unknown> = {}) => {
    const page = { sending: false, projectCreating: false, activeAgentDetailLoading: true, pinnedProjectConfigLoading: false, summonedExpertId: 42, ...overrides };
    const evaluate = (name: string) => {
      const expression = homeSource.match(new RegExp(`:${name}="([^"]+)"`))?.[1];
      return expression == null ? null : new Function(...Object.keys(page), `return ${expression};`)(...Object.values(page));
    };
    scope.props.wholeDisabled = evaluate("whole-disabled");
    scope.props.editorReadonly = evaluate("editor-readonly");
  };
  const listEmit = vi.fn((event: string, item: unknown) => {
    if (event === "select") popup.handleSelect(item);
    else if (event === "payment-required") popup.handlePaymentRequired(item);
  });
  const popupCode = fragment(popupSource, "  function handleSelect(", "  function handleFileSelect(") + "return {handleSelect, handlePaymentRequired};";
  const popup = new Function("props", "emit", transformSync(popupCode, { loader: "ts" }).code)(
    { mode: "expert" }, (event: string, item: unknown) => {
      if (event === "select") handlers.handleQuickPopupSelect(item);
      else if (event === "payment-required") handlers.handleExpertPaymentRequired(item);
      else if (event === "close") scope.closeQuickPopup();
    },
  );
  const apiPublishedAgentInfo = vi.fn().mockResolvedValue({ code: "0000", data: { paymentRequired: false } });
  const listCode = fragment(listSource, "  function emitSelection(", "  function loadTenantSubscriptionFlag(") + "return handleItemSelect;";
  const pick = new Function("emit", "toPayload", "subscriptionEnabled", "apiPublishedAgentInfo", "apiResCode", "apiResData", "SUCCESS_CODE", transformSync(listCode, { loader: "ts" }).code)(
    listEmit, (item: unknown) => item, true, apiPublishedAgentInfo, (res: any) => res.code, (res: any) => res.data, "0000",
  );
  return { ...scope, handlers, order, ticks, flush, finishReplacement, applyHomeState, pick, apiPublishedAgentInfo,
    nativeFocus, webFocus, textareaFocus, blur, hideKeyboard, isEditorReadonly: () => readOnly(handlers.wholeDisabledVal.value, handlers.editorReadonlyVal?.value, false) };
}

describe("@ 专家付费时收起键盘", () => {
  it.each(["APP-ANDROID", "APP-IOS", "APP-HARMONY", "H5", "MP-WEIXIN"])("%s 先关闭列表、释放焦点和隐藏键盘，再打开专家付费框", platform => {
    const f = fixture(platform), item = { targetId: 42, name: "付费专家" };
    f.handlers.handleExpertPaymentRequired(item);
    expect(f.isInputFocused.value).toBe(false);
    expect(f.order[0]).toBe("close-list");
    expect(f.order).toContain("blur");
    expect(f.order.at(-1)).toBe("hide-keyboard");
    expect(f.expertPaymentModalRef.value.$callMethod).not.toHaveBeenCalled();
    f.flush();
    expect(f.order.at(-1)).toBe("open-payment");
    expect(f.expertPaymentModalRef.value.$callMethod).toHaveBeenCalledExactlyOnceWith("open", item);
  });

  it("专家触发付费时收起键盘，等待选择面板关闭后打开付费框", () => {
    const f = fixture(), item = { targetId: 42 };
    f.expertSheetVisible.value = true;
    f.handlers.handleExpertPaymentRequired(item);
    expect(f.pendingExpertPayment.value).toBe(item);
    expect(f.expertSheetVisible.value).toBe(false);
    expect(f.hideKeyboard).toHaveBeenCalledOnce();
    expect(f.isInputFocused.value).toBe(false);
    f.handlers.handleExpertSheetClose();
    f.flush();
    expect(f.expertPaymentModalRef.value.$callMethod).toHaveBeenCalledExactlyOnceWith("open", item);
    expect(f.nativeFocus).not.toHaveBeenCalled();
    expect(f.isInputFocused.value).toBe(false);
  });

  it.each(["APP-ANDROID", "APP-IOS", "APP-HARMONY", "H5", "MP-WEIXIN"])("%s 普通关闭专家选择面板继续恢复焦点，不主动收键盘", platform => {
    const f = fixture(platform);
    f.handlers.handleExpertSheetClose();
    expect(f.ticks.length).toBeGreaterThan(0);
    f.flush();
    const focus = platform === "H5" ? f.webFocus : platform === "MP-WEIXIN" ? f.textareaFocus : f.nativeFocus;
    expect(focus).toHaveBeenCalled();
    expect(f.isInputFocused.value).toBe(true);
    expect(f.blur).not.toHaveBeenCalled();
    expect(f.hideKeyboard).not.toHaveBeenCalled();
  });

  it.each(["APP-ANDROID", "APP-IOS", "APP-HARMONY", "H5", "MP-WEIXIN"].flatMap(platform => [false, true].map(subscribed => ({ platform, subscribed }))))("$platform 选择专家前已 blur，已订阅=$subscribed，仍恢复焦点", ({ platform, subscribed }) => {
    const f = fixture(platform), item = { targetId: 42, subscribed };
    f.handlers.onInputBlur();
    expect(f.isInputFocused.value).toBe(false);
    f.emit.mockClear();
    f.handlers.handleExpertSelect(item);
    expect(f.emit).toHaveBeenCalledExactlyOnceWith("onExpertAgentSelect", item);
    f.flush();
    expect(f.isInputFocused.value).toBe(true);
    expect(f.blur).not.toHaveBeenCalled();
    expect(f.hideKeyboard).not.toHaveBeenCalled();
  });

  it.each([
    { name: "免费", paymentRequired: false, subscribed: false },
    { name: "已订阅", paymentRequired: true, subscribed: true },
    { name: "详情复核已订阅", paymentRequired: true, subscribed: false },
  ])("@ 候选 $name 专家：点击失焦、列表分流、异步替换、首页详情加载后恢复输入", async ({ paymentRequired, subscribed }) => {
    const f = fixture();
    f.apiPublishedAgentInfo.mockResolvedValue({ code: "0000", data: { paymentRequired: true, subscribed: true } });
    f.emit.mockImplementation(event => { if (event === "onExpertAgentSelect") f.applyHomeState(); });
    f.handlers.onInputBlur();
    await f.pick({ targetId: 42, paymentRequired, subscribed });
    expect(f.nativeFocus).not.toHaveBeenCalled();
    f.finishReplacement();
    expect(f.props.wholeDisabled).toBe(true); // 发送仍受详情加载限制。
    expect(f.isEditorReadonly()).toBe(false); // 加载专家详情不再强制原生 editor 失焦。
    f.flush();
    expect(f.nativeFocus).toHaveBeenCalledOnce();
    expect(f.isInputFocused.value).toBe(true);
    expect(f.blur).not.toHaveBeenCalled();
    expect(f.hideKeyboard).not.toHaveBeenCalled();
    expect(f.expertPaymentModalRef.value.$callMethod).not.toHaveBeenCalled();
  });

  it("真正需要付费的 @ 专家不执行文本替换和聚焦", async () => {
    const f = fixture();
    f.apiPublishedAgentInfo.mockResolvedValue({ code: "0000", data: { paymentRequired: true, subscribed: false } });
    f.handlers.onInputBlur();
    await f.pick({ targetId: 42, paymentRequired: true, subscribed: false });
    f.finishReplacement();
    f.flush();
    expect(f.replaceQuickTriggerAtomically).not.toHaveBeenCalled();
    expect(f.nativeFocus).not.toHaveBeenCalled();
    expect(f.isInputFocused.value).toBe(false);
    expect(f.hideKeyboard).toHaveBeenCalledOnce();
    expect(f.expertPaymentModalRef.value.$callMethod).toHaveBeenCalledOnce();
  });

  it.each([{ sending: true }, { projectCreating: true }, { pinnedProjectConfigLoading: true }, { summonedExpertId: 0 }])("其他禁用状态仍保持编辑器只读：%j", state => {
    const f = fixture();
    f.applyHomeState(state);
    expect(f.isEditorReadonly()).toBe(true);
  });

  it("未传编辑器独立只读状态的页面沿用原 wholeDisabled 行为", () => {
    const f = fixture();
    f.props.wholeDisabled = true;
    expect(f.isEditorReadonly()).toBe(true);
  });

  it("编辑器失焦失败时仍尝试收起系统键盘", () => {
    const f = fixture();
    f.blur.mockImplementation(() => { throw new Error("editor unavailable"); });
    f.handlers.handleExpertPaymentRequired({ targetId: 42 });
    expect(f.hideKeyboard).toHaveBeenCalledOnce();
    f.flush();
    expect(f.order.at(-1)).toBe("open-payment");
  });
});
