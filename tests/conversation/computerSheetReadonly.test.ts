import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import { resolveHomeComputerId } from "@/components/conversation-input/conversationInputOptions.uts";

const inputSource = readFileSync("components/conversation-input/conversation-input.uvue", "utf8");
const sheetSource = readFileSync("components/conversation-input/computer-select-sheet/computer-select-sheet.uvue", "utf8");

function fragment(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Missing source fragment: ${startMarker}`);
  return source.slice(start, end + endMarker.length);
}

function execute(source: string, scope: Record<string, unknown>, result: string): any {
  const code = transformSync(source, { loader: "ts" }).code;
  return new Function(...Object.keys(scope), `${code}; return ${result};`)(...Object.values(scope));
}

function inputFixture(scene: string, locked: boolean, unavailable = false) {
  const props = { scene, readonly: false, isSandboxSwitchDisabled: locked, isSandboxUnavailable: unavailable };
  const computerSheetVisible = { value: false };
  const selectedComputerId = { value: "366" }, selectedComputerName = { value: "我的电脑" };
  const emit = vi.fn();
  const code = [
    fragment(inputSource, "  const computerSelectionReadonly = computed(", "\n  });"),
    fragment(inputSource, "  function openHomeComputerSheet(", "\n  }"),
    fragment(inputSource, "  const handleComputerSelect = ", "\n  };"),
    fragment(inputSource, "  const handleComputerSync = ", "\n  };"),
    fragment(inputSource, "  const handleComputerNameSync = ", "\n  };"),
  ].join("\n");
  const handlers = execute(code, {
    props, computerSheetVisible, selectedComputerId, selectedComputerName, emit,
    isHomeScene: { value: scene === "home" },
    computed: (getter: () => unknown) => ({ get value() { return getter(); } }),
  }, "{openHomeComputerSheet, handleComputerSelect, handleComputerSync, handleComputerNameSync, computerSelectionReadonly}");
  return { ...handlers, props, computerSheetVisible, selectedComputerId, selectedComputerName, emit };
}

function sheetFixture(readonly: boolean, savedId = "-1", currentValue = "366") {
  const props = { readonly, autoSelect: true, currentValue, agentId: 7, visible: false };
  const emit = vi.fn(), save = vi.fn().mockResolvedValue({ code: "0000" });
  const script = sheetSource.split('<script setup lang="uts">')[1].split("</script>")[0]
    .replace(/^\s*import .*;\s*$/gm, "");
  const state = execute(script, {
    defineProps: () => props, withDefaults: (value: unknown) => value, defineEmits: () => emit,
    ref: (value: unknown) => ({ value }), watch() {},
    UTSJSONObject: class {}, resolveHomeComputerId,
    apiGetSandboxList: async () => ({ code: "0000", data: {
      sandboxes: [
        { sandboxId: "-1", name: "云端电脑", description: "" },
        { sandboxId: "366", name: "我的电脑", description: "个人工作目录" },
      ], agentSelected: { 7: savedId },
    } }),
    apiUpdateSelectedSandbox: save, apiResCode: (res: any) => res.code, apiResData: (res: any) => res.data,
    SUCCESS_CODE: "0000", tRaw: (key: string) => key, emptyI18nParams: () => ({}),
    uni: { showToast: vi.fn() }, console,
  }, "{loadComputers, selectItem, syncSelection, computers, popupRef}");
  const popup = vi.fn(); state.popupRef.value = { $callMethod: popup };
  return { ...state, props, emit, save, popup };
}

describe("conversation computer inspection", () => {
  it.each([false, true])("opens a locked conversation computer list, including unavailable=%s", (unavailable) => {
    const f = inputFixture("conversation", true, unavailable);
    f.openHomeComputerSheet();
    expect(f.computerSheetVisible.value).toBe(true);
    f.handleComputerSelect("-1", "云端电脑");
    f.handleComputerSync("-1", "云端电脑");
    expect(f.selectedComputerId.value).toBe("366");
    expect(f.selectedComputerName.value).toBe("我的电脑");
    expect(f.emit).not.toHaveBeenCalled();
  });

  it("opens the homepage computer list for inspection while a private-agent binding stays locked", () => {
    const locked = inputFixture("home", true);
    locked.openHomeComputerSheet();
    expect(locked.computerSheetVisible.value).toBe(true);
    locked.handleComputerSelect("-1", "云端电脑");
    locked.handleComputerSync("-1", "云端电脑");
    expect(locked.selectedComputerId.value).toBe("366");
    expect(locked.emit).not.toHaveBeenCalled();
    const editable = inputFixture("home", false);
    editable.openHomeComputerSheet();
    editable.handleComputerSelect("-1", "云端电脑");
    expect(editable.selectedComputerId.value).toBe("-1");
    expect(editable.emit.mock.calls).toEqual([
      ["onSandboxChange", "-1"], ["onComputerChange", "-1", "云端电脑"],
    ]);
  });

  it("loads a read-only list without consuming agent memory or sending selection requests", async () => {
    const f = sheetFixture(true, "offline-old-computer");
    await f.loadComputers();
    expect(f.computers.value.map((item: any) => item.sandboxId)).toEqual(["-1", "366"]);
    await f.selectItem(f.computers.value[0]);
    await f.selectItem(f.computers.value[1]);
    expect(f.props.currentValue).toBe("366");
    expect(f.emit.mock.calls).toEqual([["syncName", "366", "我的电脑"]]);
    expect(f.save).not.toHaveBeenCalled();
    expect(f.popup).not.toHaveBeenCalled();
  });

  it("updates only the bound computer name and ignores stale computer metadata", () => {
    const f = inputFixture("home", true);
    f.handleComputerNameSync("366", "私人智能体的电脑");
    f.handleComputerNameSync("-1", "云端电脑");
    f.openHomeComputerSheet();
    expect(f.selectedComputerName.value).toBe("私人智能体的电脑");
    expect(f.selectedComputerId.value).toBe("366");
    expect(f.computerSheetVisible.value).toBe(true);
    expect(f.emit).not.toHaveBeenCalled();
  });

  it("keeps an offline private-agent binding instead of falling back to remembered cloud", async () => {
    const f = sheetFixture(true, "-1", "offline-private-computer");
    await f.loadComputers();
    expect(f.emit.mock.calls).toEqual([
      ["syncName", "offline-private-computer", "Mobile.Sandbox.personalUnavailable"],
    ]);
    expect(f.props.currentValue).toBe("offline-private-computer");
    expect(f.save).not.toHaveBeenCalled();
  });

  it("allows normal selection but blocks a row when the conversation becomes locked while open", async () => {
    const f = sheetFixture(false);
    await f.loadComputers(); f.emit.mockClear();
    await f.selectItem(f.computers.value[0]);
    expect(f.emit.mock.calls).toEqual([["select", "-1", "云端电脑"]]);
    expect(f.save.mock.calls).toEqual([["7", "-1"]]);
    f.emit.mockClear(); f.save.mockClear();
    f.props.readonly = true;
    await f.selectItem(f.computers.value[0]); f.syncSelection();
    expect(f.emit).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  });
});
