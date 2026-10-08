import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import {
  PinnedProjectInfo,
  getWorkspaceDirPolicy,
  resolvePersonalWorkspacePath,
  resolvePinnedConversationSandboxId,
  resolvePinnedProjectComputerId,
  resolveProjectWorkspacePath,
} from "@/types/interfaces/displayRecommend.uts";

// 执行首页真实上框、选择和发送函数，隔离网络与导航，验证完整首条任务链路。
const source = readFileSync("pages/index/index.uvue", "utf8");
function fragment(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < start) throw new Error(`Missing homepage function: ${startMarker}`);
  return source.slice(start, end + endMarker.length);
}
const functions = [
  "resetComputerSelection", "applyPinnedProjectComputer", "handleClearPinnedProject",
  "handleComputerChange", "handleWorkspaceDirSelect", "openHomeWorkspaceDirMenu",
];
const code = transformSync([
  ...functions.map(name => fragment(`  function ${name}(`, "\n  }")),
  fragment("  async function applyPinnedProject(", "\n  }"),
  fragment("  async function handleSendMessage(", "\n  }"),
  ...["isAgentComputerBound", "effectiveHomeComputerId", "showWorkspaceDirBar"].map(
    name => fragment(`  const ${name} = computed(`, "\n  });"),
  ),
  `({${functions.join(",")}, applyPinnedProject, handleSendMessage, isAgentComputerBound, showWorkspaceDirBar});`,
].join("\n"), { loader: "ts" }).code;

function project(id = 509, sandboxId = 417, sandboxType = "Personal", workspacePath = ""): PinnedProjectInfo {
  const value = new PinnedProjectInfo();
  value.projectId = id;
  value.projectType = "NormalProject";
  value.sandboxId = sandboxId;
  value.sandboxType = sandboxType;
  value.workspacePath = workspacePath;
  return value;
}

function setup() {
  const ref = <T>(value: T) => ({ value });
  const computed = (getter: () => unknown) => ({ get value() { return getter(); } });
  const pinnedProject = ref<PinnedProjectInfo | null>(null);
  const context = {
    pinnedProject, pinnedMissedProjectId: 0,
    pinnedNormalProject: computed(() => pinnedProject.value?.projectType === "NormalProject"),
    disablePersonalComputer: computed(() => pinnedProject.value != null && !getWorkspaceDirPolicy(pinnedProject.value.projectType).personalComputer),
    pinnedProjectConfigLoading: ref(false), pinnedProjectConfigSequence: 0,
    activeAgentDetailLoading: ref(false), activeAgentSandboxId: ref(""),
    effectiveTaskAgent: ref(true), activeAgentType: ref("TaskAgent"), activeAllowPrivateSandbox: ref(true),
    activeAgentId: ref(1596), activeAgentName: ref("任务智能体"),
    currentComputerId: ref("-1"), currentComputerName: ref("云端电脑"), workspacePath: ref("/previous/work"),
    workspaceDirMenuVisible: ref(false), workspaceDirSheetVisible: ref(false),
    currentModelId: ref(7), currentModelName: ref("旧模型"), selectedSpaceId: ref(8),
    userPickedCategory: ref(""), categoryScrollInto: ref(""), chatboxCategories: ref([]),
    clearSummonedExpert: vi.fn(), clearRecommendState: vi.fn(), resolvePinnedAgentHit: vi.fn(), callInputRef: vi.fn(),
    apiNormalProjectGetById: vi.fn().mockResolvedValue({ code: "0000", data: {
      sandboxId: 417, sandboxType: "Personal", fileWorkspacePath: "/files/project", agentWorkspacePath: "/work/project",
    } }),
    apiAgentConversationCreate: vi.fn().mockResolvedValue({ code: "0000", data: { id: 9527 } }),
    sending: ref(false), projectCreating: ref(false), ensureLoggedIn: vi.fn().mockResolvedValue(true),
    normalizeSendPayload: (value: unknown) => value, collectAttachments: (value: unknown) => value ?? [],
    tryCreateProjectFlow: vi.fn().mockResolvedValue(false), parseConversationId: (data: { id: number }) => data.id,
    saveDraft: vi.fn(), jumpToAgentDetailPage: vi.fn().mockResolvedValue(undefined), resolveAgentType: () => "TaskAgent",
    apiResCode: (res: any) => res.code, apiResData: (res: any) => res.data, apiResMessage: () => "",
    resObject: (value: unknown) => value, strOf: (value: unknown) => value == null ? "" : String(value),
    numFromAny: (value: unknown, fallback: number) => value == null ? fallback : Number(value),
    resolvePersonalWorkspacePath, resolvePinnedConversationSandboxId, resolvePinnedProjectComputerId, resolveProjectWorkspacePath,
    SUCCESS_CODE: "0000", t: (key: string) => key, uni: { showToast: vi.fn() }, console, computed,
  };
  const handlers = runInNewContext(code, context);
  return { ...context, ...handlers };
}

describe("项目上框新建任务的电脑与工作目录", () => {
  it("列表未带目录时读取一次详情，默认继承项目电脑与 agent 执行目录并发送", async () => {
    const page = setup();
    await page.applyPinnedProject(project());
    expect(page.apiNormalProjectGetById).toHaveBeenCalledTimes(1);
    expect(page.apiNormalProjectGetById).toHaveBeenCalledWith(509);
    expect(page.currentComputerId.value).toBe("417");
    expect(page.workspacePath.value).toBe("/work/project");
    expect(page.showWorkspaceDirBar.value).toBe(true);
    await page.handleSendMessage({ messageInfo: "项目任务" });
    expect(page.apiAgentConversationCreate).toHaveBeenCalledTimes(1);
    expect(page.apiAgentConversationCreate).toHaveBeenCalledWith({
      agentId: 1596, devMode: false, projectId: 509, projectType: "NormalProject",
      sandboxId: 417, workspacePath: "/work/project",
    });
  });

  it("每次点击同一项目创建任务都恢复项目配置，之后允许修改并发送", async () => {
    const page = setup();
    await page.applyPinnedProject(project());
    page.activeAgentSandboxId.value = "366";
    page.handleComputerChange("other-personal", "另一台电脑");
    expect(page.workspacePath.value).toBe("");
    page.handleWorkspaceDirSelect("/work/changed");
    await page.applyPinnedProject(project());
    expect(page.apiNormalProjectGetById).toHaveBeenCalledTimes(2);
    expect(page.currentComputerId.value).toBe("417");
    expect(page.workspacePath.value).toBe("/work/project");
    expect(page.clearSummonedExpert).toHaveBeenCalledTimes(1);
    expect(page.clearRecommendState).toHaveBeenCalledTimes(1);
    page.handleComputerChange("other-personal", "另一台电脑");
    page.handleWorkspaceDirSelect("/work/changed");
    expect(page.currentComputerId.value).toBe("other-personal");
    expect(page.workspacePath.value).toBe("/work/changed");
    expect(page.isAgentComputerBound.value).toBe(false);
    await page.handleSendMessage({ messageInfo: "修改后的项目任务", sandboxId: "other-personal" });
    expect(page.apiAgentConversationCreate).toHaveBeenCalledWith({
      agentId: 1596, devMode: false, projectId: 509, projectType: "NormalProject",
      sandboxId: "other-personal", workspacePath: "/work/changed",
    });
  });

  it("云端项目的实际沙箱 ID 映射为云电脑，用户仍可切换个人电脑并选择目录", async () => {
    const page = setup();
    page.apiNormalProjectGetById.mockResolvedValue({ code: "0000", data: {
      sandboxId: 333, sandboxType: "Cloud", agentWorkspacePath: "/container/project",
    } });
    await page.applyPinnedProject(project(314, 333, "Cloud"));
    expect(page.currentComputerId.value).toBe("-1");
    expect(page.workspacePath.value).toBe("");
    await page.handleSendMessage({ messageInfo: "云端项目任务" });
    expect(page.apiAgentConversationCreate).toHaveBeenCalledWith({
      agentId: 1596, devMode: false, projectId: 314, projectType: "NormalProject", sandboxId: -1,
    });
    page.handleComputerChange("417", "我的电脑");
    page.handleWorkspaceDirSelect("/work/changed");
    expect(page.workspacePath.value).toBe("/work/changed");
  });

  it("默认配置加载期间不能发送或修改电脑目录，完成后允许使用默认目录", async () => {
    const page = setup();
    let finish!: (response: any) => void;
    page.apiNormalProjectGetById.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const loading = page.applyPinnedProject(project());
    expect(page.pinnedProjectConfigLoading.value).toBe(true);
    page.handleComputerChange("other", "另一台电脑");
    page.handleWorkspaceDirSelect("/work/changed");
    await page.handleSendMessage({ messageInfo: "未加载完成" });
    expect(page.currentComputerId.value).toBe("417");
    expect(page.workspacePath.value).toBe("");
    expect(page.apiAgentConversationCreate).not.toHaveBeenCalled();
    finish({ code: "0000", data: { sandboxId: 417, sandboxType: "Personal", agentWorkspacePath: "/work/project" } });
    await loading;
    page.handleWorkspaceDirSelect("");
    await page.handleSendMessage({ messageInfo: "使用默认目录" });
    expect(page.apiAgentConversationCreate).toHaveBeenCalledWith({
      agentId: 1596, devMode: false, projectId: 509, projectType: "NormalProject", sandboxId: 417,
    });
  });

  it("项目 A → B → A 的旧详情不会覆盖新配置或提前结束加载", async () => {
    const page = setup();
    const finishes: Array<(response: any) => void> = [];
    page.apiNormalProjectGetById.mockImplementation(() => new Promise(resolve => finishes.push(resolve)));
    const first = page.applyPinnedProject(project(509));
    const second = page.applyPinnedProject(project(506));
    const last = page.applyPinnedProject(project(509));
    finishes[0]({ code: "0000", data: { sandboxId: 403, agentWorkspacePath: "/old/A" } });
    await first;
    expect(page.pinnedProjectConfigLoading.value).toBe(true);
    finishes[2]({ code: "0000", data: { sandboxId: 417, agentWorkspacePath: "/new/A" } });
    await last;
    finishes[1]({ code: "0000", data: { sandboxId: 403, agentWorkspacePath: "/old/B" } });
    await second;
    expect(page.currentComputerId.value).toBe("417");
    expect(page.workspacePath.value).toBe("/new/A");
    expect(page.pinnedProjectConfigLoading.value).toBe(false);
  });

  it("移除上框后忽略晚到详情，恢复普通首页", async () => {
    const page = setup();
    let finish!: (response: any) => void;
    page.apiNormalProjectGetById.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const loading = page.applyPinnedProject(project());
    page.handleClearPinnedProject();
    finish({ code: "0000", data: { sandboxId: 417, agentWorkspacePath: "/old/project" } });
    await loading;
    expect(page.pinnedProject.value).toBeNull();
    expect(page.currentComputerId.value).toBe("-1");
    expect(page.workspacePath.value).toBe("");
    expect(page.pinnedProjectConfigLoading.value).toBe(false);
  });

  it("同号不同类型属于不同项目，全栈项目保留云端策略", async () => {
    const page = setup();
    await page.applyPinnedProject(project());
    const app = project();
    app.projectType = "UserApp";
    await page.applyPinnedProject(app);
    expect(page.currentComputerId.value).toBe("-1");
    expect(page.workspacePath.value).toBe("");
    expect(page.showWorkspaceDirBar.value).toBe(false);
    expect(page.apiNormalProjectGetById).toHaveBeenCalledTimes(1);
  });

  it("详情无数据时保留列表已携带的配置并结束加载", async () => {
    const page = setup();
    page.apiNormalProjectGetById.mockResolvedValue({ code: "0000", data: null });
    await page.applyPinnedProject(project(509, 417, "Personal", "/list/project"));
    expect(page.currentComputerId.value).toBe("417");
    expect(page.workspacePath.value).toBe("/list/project");
    expect(page.pinnedProjectConfigLoading.value).toBe(false);
  });
});
