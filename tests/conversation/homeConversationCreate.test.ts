import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import {
  PinnedProjectInfo,
  resolvePersonalWorkspacePath,
  resolvePinnedConversationSandboxId,
} from "@/types/interfaces/displayRecommend.uts";

// 执行首页真实发送入口，仅隔离登录、网络、草稿存储与导航等运行时依赖。
const homeSource = readFileSync(
  new URL("../../pages/index/index.uvue", import.meta.url),
  "utf8",
);
const start = homeSource.indexOf("  async function handleSendMessage(");
const end = homeSource.indexOf("  // ── 5.9 抽屉 / 登录 ──", start);
if (start < 0 || end <= start) throw new Error("首页发送入口未找到");
const handlerCode = transformSync(
  `${homeSource.slice(start, end)}\nhandleSendMessage;`,
  { loader: "ts" },
).code;

function setup(computerId = "403", path = "/tmp/mobile-project", project: PinnedProjectInfo | null = null, boundComputerId = "") {
  const context = {
    sending: { value: false },
    projectCreating: { value: false },
    normalizeSendPayload: (value: unknown) => value,
    strOf: (value: unknown) => value == null ? "" : String(value),
    collectAttachments: (value: unknown) => value ?? [],
    ensureLoggedIn: vi.fn().mockResolvedValue(true),
    activeAgentId: { value: 1596 },
    activeAgentName: { value: "任务智能体" },
    activeAgentDetailLoading: { value: false },
    pinnedProjectConfigLoading: { value: false },
    isAgentComputerBound: { value: boundComputerId.length > 0 },
    activeAgentSandboxId: { value: boundComputerId },
    pinnedProject: { value: project },
    currentComputerId: { value: computerId },
    workspacePath: { value: path },
    tryCreateProjectFlow: vi.fn().mockResolvedValue(false),
    resolvePinnedConversationSandboxId,
    resolvePersonalWorkspacePath,
    apiAgentConversationCreate: vi.fn().mockResolvedValue({ code: "0000", data: { id: 9527 } }),
    apiResCode: (res: { code: string }) => res.code,
    apiResData: (res: { data: unknown }) => res.data,
    apiResMessage: (res: { message?: string }) => res.message ?? "",
    SUCCESS_CODE: "0000",
    parseConversationId: (data: { id: number }) => data.id,
    saveDraft: vi.fn(),
    jumpToAgentDetailPage: vi.fn().mockResolvedValue(undefined),
    resolveAgentType: () => "TaskAgent",
    t: (key: string) => key,
    uni: { showToast: vi.fn() },
    console,
  };
  const send = runInNewContext(handlerCode, context) as (payload: Record<string, unknown>) => Promise<void>;
  return { ...context, send };
}

describe("首页选择个人电脑与工作目录后创建会话", () => {
  it.each([
    { name: "个人电脑指定目录", selected: "403", current: "-1", path: "/tmp/mobile-project", sandboxId: 403, workspacePath: "/tmp/mobile-project" },
    { name: "非数字电脑 ID", selected: "sb-a1b2c3", current: "-1", path: "/tmp/mobile-project", sandboxId: "sb-a1b2c3", workspacePath: "/tmp/mobile-project" },
    { name: "发送载荷未带电脑时沿用当前选择", selected: "", current: "403", path: "/tmp/mobile-project", sandboxId: 403, workspacePath: "/tmp/mobile-project" },
    { name: "个人电脑默认目录", selected: "403", current: "403", path: "", sandboxId: 403, workspacePath: undefined },
    { name: "云电脑不带旧目录", selected: "-1", current: "403", path: "/tmp/mobile-project", sandboxId: -1, workspacePath: undefined },
    { name: "未选电脑回退云电脑", selected: "", current: "", path: "/tmp/mobile-project", sandboxId: -1, workspacePath: undefined },
  ])("$name：只创建一次并保留首条消息交接", async ({ selected, current, path, sandboxId, workspacePath }) => {
    const page = setup(current, path);
    const payload = { messageInfo: "开始任务", sandboxId: selected, files: [{ url: "/file.txt" }], skillIds: [7], modelId: 8 };
    await page.send(payload);

    expect(page.apiAgentConversationCreate).toHaveBeenCalledTimes(1);
    const params = page.apiAgentConversationCreate.mock.calls[0][0];
    expect(params).toEqual({
      agentId: 1596,
      devMode: false,
      sandboxId,
      ...(workspacePath ? { workspacePath } : {}),
    });
    expect(page.saveDraft).toHaveBeenCalledWith(
      1596, 9527, "开始任务", payload.files, payload, selected || current || "-1", workspacePath ?? "",
    );
    expect(page.jumpToAgentDetailPage).toHaveBeenCalledWith(1596, 9527, "TaskAgent", "任务智能体");
    expect(page.sending.value).toBe(false);
  });

  it("已有常规项目继续绑定该项目并使用当前电脑", async () => {
    const project = new PinnedProjectInfo();
    project.projectId = 111;
    project.projectType = "NormalProject";
    project.sandboxId = 302;
    const page = setup("403", "/tmp/mobile-project", project);
    await page.send({ messageInfo: "开始任务", sandboxId: "403" });
    expect(page.apiAgentConversationCreate).toHaveBeenCalledTimes(1);
    expect(page.apiAgentConversationCreate).toHaveBeenCalledWith({
      agentId: 1596, devMode: false, projectId: 111, projectType: "NormalProject",
      sandboxId: 403, workspacePath: "/tmp/mobile-project",
    });
  });

  it("目录被占用时展示后端错误并中止发送和跳转", async () => {
    const page = setup();
    page.apiAgentConversationCreate.mockResolvedValue({ code: "DIRECTORY_OCCUPIED", message: "目录已被占用", data: null });
    await page.send({ messageInfo: "开始任务", sandboxId: "403" });
    expect(page.apiAgentConversationCreate).toHaveBeenCalledTimes(1);
    expect(page.uni.showToast).toHaveBeenCalledWith({ title: "目录已被占用", icon: "none" });
    expect(page.saveDraft).not.toHaveBeenCalled();
    expect(page.jumpToAgentDetailPage).not.toHaveBeenCalled();
    expect(page.sending.value).toBe(false);
  });

  it.each(["366", "private-computer"])("私人智能体绑定 %s：固定电脑并发送用户新选的目录", async (boundComputerId) => {
    const page = setup("403", "/tmp/private-workspace", null, boundComputerId);
    const payload = { messageInfo: "私人任务", sandboxId: "-1", files: [] };
    await page.send(payload);
    expect(page.apiAgentConversationCreate).toHaveBeenCalledTimes(1);
    expect(page.apiAgentConversationCreate).toHaveBeenCalledWith({
      agentId: 1596, devMode: false,
      sandboxId: boundComputerId === "366" ? 366 : boundComputerId,
      workspacePath: "/tmp/private-workspace",
    });
    expect(page.workspacePath.value).toBe("/tmp/private-workspace");
    expect(page.saveDraft).toHaveBeenCalledWith(
      1596, 9527, "私人任务", [], { ...payload, sandboxId: boundComputerId }, boundComputerId, "/tmp/private-workspace",
    );
  });

  it("私人智能体选择默认目录时仍固定电脑，创建请求不带自定义目录", async () => {
    const page = setup("-1", "", null, "366");
    await page.send({ messageInfo: "私人任务", sandboxId: "403" });
    expect(page.apiAgentConversationCreate).toHaveBeenCalledWith({ agentId: 1596, devMode: false, sandboxId: 366 });
  });

  it("私人智能体的绑定确认前不能用上一个电脑创建会话", async () => {
    const page = setup();
    page.activeAgentDetailLoading.value = true;
    await page.send({ messageInfo: "开始任务", sandboxId: "403" });
    expect(page.apiAgentConversationCreate).not.toHaveBeenCalled();
    expect(page.tryCreateProjectFlow).not.toHaveBeenCalled();
  });
});
