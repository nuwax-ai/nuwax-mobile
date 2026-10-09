import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getNormalProject: vi.fn(),
  updateNormalProject: vi.fn(),
  getUserApp: vi.fn(),
  updateUserApp: vi.fn(),
  generateInfo: vi.fn(),
}));

vi.mock("@/servers/project", () => ({
  apiNormalProjectGetById: api.getNormalProject,
  apiNormalProjectUpdate: api.updateNormalProject,
  apiUserAppGetById: api.getUserApp,
  apiUserAppUpdate: api.updateUserApp,
  apiAgentGenerateInfo: api.generateInfo,
}));

let ensureProjectNameFromPrompt: typeof import("@/utils/projectNameBootstrap.uts").ensureProjectNameFromPrompt;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  api.getNormalProject.mockResolvedValue({ code: "0000", data: { id: 111, nameDefined: false } });
  api.getUserApp.mockResolvedValue({ code: "0000", data: { id: 222, nameDefined: false } });
  api.generateInfo.mockResolvedValue({
    code: "0000", data: { name: "  目录任务项目  ", description: "根据首条消息生成的描述", iconUrl: "/project-icon.png" },
  });
  api.updateNormalProject.mockResolvedValue({ code: "0000" });
  api.updateUserApp.mockResolvedValue({ code: "0000" });
  ensureProjectNameFromPrompt = (await import("@/utils/projectNameBootstrap.uts")).ensureProjectNameFromPrompt;
});

// 执行会话组件真实发送入口及项目识别逻辑，保留真实命名工具，只隔离网络、声音和滚动。
const source = readFileSync(new URL(
  "../../subpackages/pages/chat-conversation-component/chat-conversation-component.uvue", import.meta.url,
), "utf8");

function fragment(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end <= start) throw new Error(`未找到会话命名代码：${startMarker}`);
  return source.slice(start, end);
}

const handlerCode = transformSync([
  fragment("  function readPositiveNumber(", "  function captureProjectChatQuery("),
  fragment("  function readNormalProjectIdFromConversation(", "  // ==================== 干预审批"),
  fragment("  const handleSendMessage = ", "  sendInterventionResumeMessage = handleSendMessage;"),
  "handleSendMessage;",
].join("\n"), { loader: "ts" }).code;

function setup(
  info: Record<string, unknown> | null = { id: 9527, devTargetType: "NormalProject", devTargetId: 111 },
  pType = "", routeProjectId = 0,
) {
  const pending: Promise<void>[] = [];
  const context = {
    conversationInfo: { value: info },
    conversationId: { value: 9527 as number | null },
    projectChatPType: pType,
    projectChatId: routeProjectId,
    ensureProjectNameFromPrompt: (type: string, id: number, prompt: string) => {
      const request = ensureProjectNameFromPrompt(type, id, prompt);
      pending.push(request);
      return request;
    },
    data: {
      urlOtherParams: { value: null }, chatSuggestList: { value: [] },
      autoToLastMsg: { value: false }, needSetLockAutoToLastMsg: { value: false },
      isSendMessageRef: { value: false }, isStoppingConversation: { value: false },
    },
    props: { isTempChat: false },
    AgentDetailUtils: { toSendMessageParamsObject: (payload: Record<string, unknown>) => ({ ...payload }) },
    getConvSetVariableParams: () => ({}),
    service: { abortSubConversation: vi.fn(), handleSendMessage: vi.fn() },
    ttsWebSocketPlayer: { unlockInGesture: vi.fn() },
    asrWebSocketClient: { disableWarmupAndDisconnect: vi.fn() },
    interruptStreamSpeakPlayback: vi.fn(), streamSpeakAllowed: false,
    scrollToLastMsgAfterSend: vi.fn(), resumeStreamSpeakAllowance: vi.fn(),
    streamingAssistantMessageId: { value: "" }, ensureHeadlessStreamSpeak: vi.fn(),
  };
  const send = runInNewContext(handlerCode, context) as (payload: Record<string, unknown>) => void;
  return { ...context, send, waitForNameSync: () => Promise.all(pending) };
}

describe("个人电脑指定目录隐式创建常规项目后同步名称", () => {
  it("无 pType 时从当前会话识别项目，用首条消息生成并更新名称、描述和图标", async () => {
    const page = setup();
    const payload = {
      messageInfo: "  整理这个目录里的文档  ", sandboxId: "403", workspacePath: "/tmp/mobile-project",
      files: [{ url: "/file.txt" }], selectedComponents: [{ id: 7, type: "Plugin" }], skillIds: [8], modelId: 9,
    };
    page.send(payload);
    await page.waitForNameSync();

    expect(api.getNormalProject).toHaveBeenCalledExactlyOnceWith(111);
    expect(api.generateInfo).toHaveBeenCalledExactlyOnceWith("整理这个目录里的文档");
    expect(api.updateNormalProject).toHaveBeenCalledTimes(1);
    expect(api.updateNormalProject.mock.calls[0][0]).toMatchObject({
      id: 111, name: "目录任务项目", description: "根据首条消息生成的描述", icon: "/project-icon.png",
    });
    expect(page.service.handleSendMessage).toHaveBeenCalledTimes(1);
    expect(page.service.handleSendMessage.mock.calls[0][0]).toMatchObject(payload);
    expect(api.getUserApp).not.toHaveBeenCalled();
    expect(api.updateUserApp).not.toHaveBeenCalled();
  });

  it("显式常规项目仍用会话项目 ID，不能把路由的智能体 ID 当项目 ID", async () => {
    const page = setup({ id: "9527", devTargetType: "NormalProject", devTargetId: "111" }, "NormalProject", 1596);
    page.send({ messageInfo: "继续项目任务" });
    await page.waitForNameSync();
    expect(api.getNormalProject).toHaveBeenCalledExactlyOnceWith(111);
    expect(api.updateNormalProject.mock.calls[0][0].id).toBe(111);
  });

  it.each([true, "true", "1", "Yes"])("已自定义项目名称 nameDefined=%s 时不覆盖", async nameDefined => {
    api.getNormalProject.mockResolvedValue({ code: "0000", data: { id: 111, nameDefined, name: "用户名称" } });
    const page = setup();
    page.send({ messageInfo: "继续任务" });
    await page.waitForNameSync();
    expect(api.generateInfo).not.toHaveBeenCalled();
    expect(api.updateNormalProject).not.toHaveBeenCalled();
    expect(page.service.handleSendMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    { id: 9527, devTargetType: "NormalProject", devTargetId: 0 },
    { id: 9527, devTargetType: "NormalProject", devTargetId: "invalid" },
    { id: 9527, devTargetId: 111 },
    { id: 9527, devTargetType: "PageApp", devTargetId: 111 },
    { id: 9527, devTargetType: "UserApp", devTargetId: 111 },
    { id: 8888, devTargetType: "NormalProject", devTargetId: 111 },
  ])("缺少项目绑定、其他类型或旧会话详情 %j 时不触发命名", async info => {
    const page = setup(info, "NormalProject", 1596);
    page.send({ messageInfo: "普通消息" });
    await page.waitForNameSync();
    expect(api.getNormalProject).not.toHaveBeenCalled();
    expect(api.generateInfo).not.toHaveBeenCalled();
    expect(api.getUserApp).not.toHaveBeenCalled();
    expect(page.service.handleSendMessage).toHaveBeenCalledTimes(1);
  });

  it("连续发送时同一项目仅生成和回写一次", async () => {
    let resolveDetail!: (result: unknown) => void;
    api.getNormalProject.mockReturnValue(new Promise(resolve => { resolveDetail = resolve; }));
    const page = setup();
    page.send({ messageInfo: "首条消息" });
    page.send({ messageInfo: "第二条消息" });
    resolveDetail({ code: "0000", data: { id: 111, nameDefined: false } });
    await page.waitForNameSync();
    page.send({ messageInfo: "第三条消息" });
    await page.waitForNameSync();
    expect(api.getNormalProject).toHaveBeenCalledTimes(1);
    expect(api.generateInfo).toHaveBeenCalledExactlyOnceWith("首条消息");
    expect(api.updateNormalProject).toHaveBeenCalledTimes(1);
    expect(page.service.handleSendMessage).toHaveBeenCalledTimes(3);
  });

  it("命名失败不阻断消息，后续消息可重试补全", async () => {
    api.updateNormalProject.mockResolvedValueOnce({ code: "UPDATE_FAILED" });
    const page = setup();
    page.send({ messageInfo: "首条消息" });
    await page.waitForNameSync();
    page.send({ messageInfo: "继续任务" });
    await page.waitForNameSync();
    expect(page.service.handleSendMessage).toHaveBeenCalledTimes(2);
    expect(api.updateNormalProject).toHaveBeenCalledTimes(2);
  });

  it("仅发送附件时不生成项目名称", async () => {
    const page = setup();
    page.send({ messageInfo: "  ", files: [{ url: "/file.txt" }] });
    await page.waitForNameSync();
    expect(api.getNormalProject).not.toHaveBeenCalled();
    expect(api.generateInfo).not.toHaveBeenCalled();
    expect(page.service.handleSendMessage).toHaveBeenCalledTimes(1);
  });

  it("全栈应用沿用路由应用 ID 生成项目名称", async () => {
    const page = setup({ id: 9527, devTargetType: "UserApp", devTargetId: 222 }, "UserApp", 222);
    page.send({ messageInfo: "生成网站" });
    await page.waitForNameSync();
    expect(api.getNormalProject).not.toHaveBeenCalled();
    expect(api.getUserApp).toHaveBeenCalledExactlyOnceWith(222);
    expect(api.updateUserApp.mock.calls[0][0]).toMatchObject({ id: 222, name: "目录任务项目" });
  });
});
