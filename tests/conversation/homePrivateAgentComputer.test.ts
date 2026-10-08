import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync("pages/index/index-content.uvue", "utf8");
function fragment(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Missing homepage fragment: ${startMarker}`);
  return source.slice(start, end + endMarker.length);
}
const code = transformSync([
  fragment("  const isAgentComputerBound = computed(", "\n  });"),
  fragment("  const effectiveHomeComputerId = computed(", "\n  });"),
  fragment("  const showWorkspaceDirBar = computed(", "\n  });"),
  fragment("  function handleWorkspaceDirSelect(", "\n  }"),
  fragment("  function openHomeWorkspaceDirMenu(", "\n  }"),
  fragment("  function handleComputerChange(", "\n  }"),
  fragment("  async function loadActiveAgentDetail(", "\n  }"),
  "({isAgentComputerBound, effectiveHomeComputerId, showWorkspaceDirBar, handleWorkspaceDirSelect, openHomeWorkspaceDirMenu, handleComputerChange, loadActiveAgentDetail});",
].join("\n"), { loader: "ts" }).code;

function setup(sandboxId: unknown = "366") {
  const ref = <T>(value: T) => ({ value });
  const context = {
    pinnedNormalProject: ref(false), pinnedProject: ref(null), disablePersonalComputer: ref(false),
    pinnedProjectConfigLoading: ref(false),
    effectiveTaskAgent: ref(true), activeAgentType: ref("TaskAgent"),
    activeAgentId: ref(7), activeRecId: ref(null),
    activeAgentDetailSequence: 0, activeAgentDetailLoading: ref(false),
    activeAgentSandboxId: ref(""), activeAllowPrivateSandbox: ref(true),
    activeAllowOtherModel: ref(true), activeAllowChooseMode: ref(1),
    activeDetailAgentType: ref("TaskAgent"), activeManualComponents: ref([]), activeGuideQuestions: ref([]),
    recommendAllowAtSkill: ref(1), recommendEnableVersionControl: ref(0),
    defaultAgentId: ref(0), defaultAgentName: ref(""), defaultAgentType: ref("ChatBot"), defaultEnableVersionControl: ref(0),
    summonedExpertId: ref(7), currentComputerId: ref("403"), currentComputerName: ref("上一台电脑"),
    workspacePath: ref("/tmp/previous-agent"), workspaceDirMenuVisible: ref(true), workspaceDirSheetVisible: ref(true),
    apiPublishedAgentInfo: vi.fn().mockResolvedValue({ code: "0000", data: { sandboxId, type: "TaskAgent", allowPrivateSandbox: 1 } }),
    apiResCode: (res: any) => res.code, apiResData: (res: any) => res.data,
    resObject: (value: unknown) => value,
    strOf: (value: unknown) => value == null ? "" : String(value),
    numFromAny: (value: unknown, fallback: number) => value == null ? fallback : Number(value),
    objectRows: (value: unknown) => Array.isArray(value) ? value : [],
    parseHomeGuideQuestions: () => [], HomeManualComponent: class {},
    SUCCESS_CODE: "0000", t: (key: string) => key,
    computed: (getter: () => unknown) => ({ get value() { return getter(); } }),
  };
  const handlers = runInNewContext(code, context);
  return { ...context, ...handlers };
}

describe("首页私人智能体的固定电脑与目录", () => {
  it.each(["366", 366, "private-computer"])("从详情固定电脑 %s，仍允许在绑定电脑上选择目录", async (sandboxId) => {
    const page = setup(sandboxId);
    await page.loadActiveAgentDetail(7, null);
    expect(page.apiPublishedAgentInfo).toHaveBeenCalledTimes(1);
    expect(page.activeAgentSandboxId.value).toBe(String(sandboxId));
    expect(page.isAgentComputerBound.value).toBe(true);
    expect(page.effectiveHomeComputerId.value).toBe(String(sandboxId));
    expect(page.showWorkspaceDirBar.value).toBe(true);
    expect(page.workspacePath.value).toBe("");
    expect(page.workspaceDirMenuVisible.value).toBe(false);
    expect(page.workspaceDirSheetVisible.value).toBe(false);
    page.handleWorkspaceDirSelect("/tmp/private-workspace");
    page.openHomeWorkspaceDirMenu();
    page.handleComputerChange("-1", "云端电脑");
    expect(page.workspacePath.value).toBe("/tmp/private-workspace");
    expect(page.workspaceDirMenuVisible.value).toBe(true);
    expect(page.effectiveHomeComputerId.value).toBe(String(sandboxId));
    expect(page.currentComputerId.value).toBe("403");
    expect(page.currentComputerName.value).toBe("Mobile.CreateHub.selectComputer");
    expect(page.activeAgentDetailLoading.value).toBe(false);
    page.handleWorkspaceDirSelect("");
    expect(page.workspacePath.value).toBe("");
  });

  it("之前选云端电脑时，也能在私人智能体绑定的个人电脑上选目录", async () => {
    const page = setup("366");
    page.currentComputerId.value = "-1";
    page.apiPublishedAgentInfo.mockResolvedValue({ code: "0000", data: { sandboxId: "366", type: "TaskAgent", allowPrivateSandbox: 0 } });
    await page.loadActiveAgentDetail(7, null);
    expect(page.effectiveHomeComputerId.value).toBe("366");
    expect(page.showWorkspaceDirBar.value).toBe(true);
    page.handleWorkspaceDirSelect("/tmp/private-workspace");
    expect(page.workspacePath.value).toBe("/tmp/private-workspace");
  });

  it.each(["", "-1", "0", null])("未绑定或云端哨兵 %s 仍允许自选电脑和目录", async (sandboxId) => {
    const page = setup(sandboxId);
    await page.loadActiveAgentDetail(7, null);
    expect(page.isAgentComputerBound.value).toBe(false);
    page.handleComputerChange("404", "自选电脑");
    page.handleWorkspaceDirSelect("/tmp/new-workspace");
    expect(page.currentComputerId.value).toBe("404");
    expect(page.workspacePath.value).toBe("/tmp/new-workspace");
  });

  it("常规项目上框仍使用项目自选电脑和目录", async () => {
    const page = setup();
    page.pinnedNormalProject.value = true;
    await page.loadActiveAgentDetail(7, null);
    expect(page.isAgentComputerBound.value).toBe(false);
    expect(page.showWorkspaceDirBar.value).toBe(true);
    expect(page.workspacePath.value).toBe("/tmp/previous-agent");
  });

  it("绑定电脑与之前自选电脑相同时仍清目录，并保留已解析的电脑名称", async () => {
    const page = setup("403");
    page.currentComputerName.value = "相同的电脑";
    await page.loadActiveAgentDetail(7, null);
    expect(page.isAgentComputerBound.value).toBe(true);
    expect(page.workspacePath.value).toBe("");
    expect(page.currentComputerName.value).toBe("相同的电脑");
  });

  it("快速 A → B → A 切换时，旧 A 响应不能覆盖新的绑定或提前结束加载", async () => {
    const page = setup();
    const resolvers: Array<(response: unknown) => void> = [];
    page.apiPublishedAgentInfo.mockImplementation(() => new Promise(resolve => resolvers.push(resolve)));
    const first = page.loadActiveAgentDetail(7, null);
    page.activeAgentId.value = 8;
    const middle = page.loadActiveAgentDetail(8, null);
    page.activeAgentId.value = 7;
    const last = page.loadActiveAgentDetail(7, null);
    resolvers[0]({ code: "0000", data: { sandboxId: "old-A" } });
    await first;
    expect(page.activeAgentSandboxId.value).toBe("");
    expect(page.activeAgentDetailLoading.value).toBe(true);
    resolvers[2]({ code: "0000", data: { sandboxId: "new-A", type: "TaskAgent", allowPrivateSandbox: 1 } });
    await last;
    resolvers[1]({ code: "0000", data: { sandboxId: "old-B" } });
    await middle;
    expect(page.activeAgentSandboxId.value).toBe("new-A");
    expect(page.activeAgentDetailLoading.value).toBe(false);
  });
});
