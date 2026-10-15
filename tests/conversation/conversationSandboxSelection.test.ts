import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import {
  isPersistedConversationMessageId,
  resolveBoundComputerUnavailableKey,
  resolveBoundConversationComputerId,
  resolveConversationComputerId,
  resolveHomeComputerId,
} from "@/components/conversation-input/conversationInputOptions.uts";

const source = readFileSync("subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts", "utf8");
const pageSource = readFileSync("subpackages/pages/chat-conversation-component/chat-conversation-component.uvue", "utf8");
function method(name: string, async = false) {
  const start = source.indexOf(`  ${async ? "async " : ""}${name}(`);
  const end = source.indexOf("\n  }", start);
  if (start < 0 || end < start) throw new Error(`Missing method: ${name}`);
  return source.slice(start, end + 4);
}
const code = transformSync(`class Service {
  sandboxListRequestVersion = 0;
  streamGeneration = 0;
  ${method("resetSandboxSelection")}
  ${method("handleGetSandboxList", true)}
  ${method("handleSelectSandbox", true)}
  ${method("handleSendMessage", true)}
}; Service;`, { loader: "ts" }).code;
const lockStart = pageSource.indexOf("  const isSandboxLocked = computed(");
const lockEnd = pageSource.indexOf("\n  });", lockStart);
const lockCode = transformSync(pageSource.slice(lockStart, lockEnd + 7) + "\nisSandboxLocked;", { loader: "ts" }).code;
const ref = <T>(value: T) => ({ value });
function response(saved = "-1", ids = ["-1", "403", "404"]) {
  return { code: "0000", data: { sandboxes: ids.map(sandboxId => ({ sandboxId })), agentSelected: { 7: saved } } };
}
function setup(savedId: string | null = null, agentBinding = "-1") {
  const load = vi.fn().mockResolvedValue(response());
  const save = vi.fn().mockResolvedValue({ code: "0000" });
  const Service = runInNewContext(code, {
    apiGetSandboxList: load, apiUpdateSelectedSandbox: save,
    apiResCode: (r: any) => r.code, apiResData: (r: any) => r.data, SUCCESS_CODE: "0000",
    parseSandboxList: (v: any) => v, parseAgentSelectedSandbox: (v: any) => v,
    resolveBoundComputerUnavailableKey, resolveBoundConversationComputerId,
    resolveConversationComputerId, resolveHomeComputerId,
    UTSJSONObject: class {}, t: (key: string) => key, console,
    uni: { $emit: vi.fn(), showToast: vi.fn() },
    AgentDetailUtils: { toSendMessageParamsObject: (v: any) => v },
    stopAllSpeechPlayback: vi.fn(), chatService: { abort: vi.fn() }, bumpPollGeneration: vi.fn(),
    location: { href: "/?conversationId=9527" }, generateUniqueId: () => "local-message",
    AssistantRoleEnum: { USER: "USER", ASSISTANT: "ASSISTANT" },
    MessageModeEnum: { CHAT: "CHAT" }, MessageTypeEnum: { USER: "USER", ASSISTANT: "ASSISTANT" },
    MessageStatusEnum: { Loading: "Loading", Incomplete: "Incomplete", Complete: "Complete" },
    createMessageInfoFromAny: (v: any) => v,
  });
  const service = new Service();
  const data = {
    isTempChat: ref(false), conversationId: ref(9527), agentId: ref(7),
    conversationInfo: ref<any>({ id: 9527, sandboxServerId: savedId }),
    agentInfo: ref<any>({ sandboxId: agentBinding, hasPermission: true }),
    currentSandboxId: ref(""), sandboxList: ref<any[]>([]), agentSelectedSandbox: ref({}),
    sandboxSelectionStarted: ref(false), hasChangedSandboxInEmptyConversation: ref(false),
    isSandboxSwitchDisabled: ref(false), isSandboxUnavailable: ref(false), sandboxDisabledText: ref(""),
    isConversationActive: ref(false), isSendMessageRef: ref(false), messageList: ref<any[]>([]),
    chatSuggestList: ref([]), urlOtherParams: ref(null), messageIdRef: ref(""), currentConversationRequestId: ref(""),
    localCalledTrialCount: ref(0), streamingAssistantMessageId: ref(""), streamingAssistantText: ref(""), currentModelId: ref(0),
  };
  service.data = data;
  service.agentField = (key: string) => data.agentInfo.value[key];
  service.endStreamListDraft = vi.fn(); service.abortSubConversation = vi.fn(); service.clearStreamingAssistantText = vi.fn();
  service.handleConversation = vi.fn();
  const lock = runInNewContext(lockCode, {
    data, resolveBoundConversationComputerId, readAgentInfoField: (info: any, key: string) => info?.[key],
    computed: (get: () => unknown) => ({ get value() { return get(); } }),
  });
  return { service, data, load, save, lock };
}

describe("会话容器选择与异步恢复", () => {
  it("空会话已有环境记录仍可连续改选，写回记忆期间发送也采用新选择", async () => {
    const f = setup("403");
    await f.service.handleGetSandboxList();
    expect(f.lock.value).toBe(false);
    let finish!: () => void;
    f.save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const selecting = f.service.handleSelectSandbox("404");
    expect(f.data.currentSandboxId.value).toBe("404");
    await f.service.handleSendMessage({ messageInfo: "开始任务", sandboxId: "403" });
    expect(f.service.handleConversation.mock.calls[0][0].sandboxId).toBe("404");
    finish(); await selecting;
    f.data.isConversationActive.value = false;
    await f.service.handleGetSandboxList();
    expect(f.lock.value).toBe(true);
    expect(f.data.currentSandboxId.value).toBe("404");
    await f.service.handleSelectSandbox("-1");
    expect(f.data.currentSandboxId.value).toBe("404");
  });

  it("列表晚于首页首条消息返回时不能用智能体记忆覆盖当前电脑", async () => {
    const f = setup();
    let finish!: (value: unknown) => void;
    f.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.service.handleGetSandboxList();
    f.data.currentSandboxId.value = "403"; // 首页草稿恢复
    await f.service.handleSendMessage({ messageInfo: "开始任务", sandboxId: "403" });
    finish(response("-1")); await pending;
    expect(f.data.currentSandboxId.value).toBe("403");
    expect(f.lock.value).toBe(true);
    f.data.isConversationActive.value = false;
    await f.service.handleSendMessage({ messageInfo: "继续任务", sandboxId: "-1" });
    expect(f.service.handleConversation.mock.calls[1][0].sandboxId).toBe("403");
  });

  it("历史会话优先自身记录，Agent 新绑定和旧选择不能覆盖", async () => {
    const f = setup("403", "404");
    f.data.currentSandboxId.value = "404"; f.data.sandboxSelectionStarted.value = true;
    await f.service.handleGetSandboxList();
    expect(f.data.currentSandboxId.value).toBe("403");
    expect(f.lock.value).toBe(true);
    await f.service.handleSendMessage({ messageInfo: "继续任务", sandboxId: "404" });
    expect(f.service.handleConversation.mock.calls[0][0].sandboxId).toBe("403");
  });

  it("只有真实 Agent 绑定才锁定空会话，Agent 的云端默认值不锁定", async () => {
    const bound = setup(null, "403"); await bound.service.handleGetSandboxList();
    expect(bound.data.currentSandboxId.value).toBe("403"); expect(bound.lock.value).toBe(true);
    const free = setup(); await free.service.handleGetSandboxList();
    expect(free.lock.value).toBe(false);
    await free.service.handleSelectSandbox("403"); await free.service.handleSelectSandbox("404");
    expect(free.data.currentSandboxId.value).toBe("404"); expect(free.lock.value).toBe(false);
  });

  it("发送后环境尚未回填时保持锁定和等待，不误报不可用或自动选云端", async () => {
    const f = setup(); f.data.sandboxSelectionStarted.value = true;
    await f.service.handleGetSandboxList();
    expect(f.data.currentSandboxId.value).toBe(""); expect(f.lock.value).toBe(true);
    expect(f.data.isSandboxUnavailable.value).toBe(false);
    expect(f.data.sandboxDisabledText.value).toBe("");
  });

  it("历史会话绑定电脑确实缺失时保留绑定并显示不可用", async () => {
    const f = setup("403"); f.data.sandboxSelectionStarted.value = true;
    f.load.mockResolvedValue(response("-1", ["-1"]));
    await f.service.handleGetSandboxList();
    expect(f.data.currentSandboxId.value).toBe("403");
    expect(f.data.isSandboxUnavailable.value).toBe(true);
    expect(f.data.sandboxDisabledText.value).toBe("Mobile.Sandbox.personalUnavailable");
  });

  it("切换会话后丢弃旧响应，清除上个会话的电脑、发送锁和手选状态", async () => {
    const f = setup("403");
    let finish!: (value: unknown) => void;
    f.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const old = f.service.handleGetSandboxList();
    f.data.currentSandboxId.value = "403"; f.data.sandboxSelectionStarted.value = true;
    f.data.hasChangedSandboxInEmptyConversation.value = true;
    f.service.resetSandboxSelection();
    f.data.conversationId.value = 9528; f.data.conversationInfo.value = { id: 9528, sandboxServerId: "-1" };
    await f.service.handleGetSandboxList();
    finish(response("403")); await old;
    expect(f.data.currentSandboxId.value).toBe("-1"); expect(f.lock.value).toBe(false);
    expect(f.data.hasChangedSandboxInEmptyConversation.value).toBe(false);
  });

  it("变量表单和未持久化的开场白不会被当成已发送消息而锁定", () => {
    const f = setup(); f.data.isSendMessageRef.value = true;
    f.data.messageList.value = [{ id: "", role: "ASSISTANT", text: "你好" }];
    expect(f.lock.value).toBe(false);
    expect(["", "0", " "].map(isPersistedConversationMessageId)).toEqual([false, false, false]);
    expect(isPersistedConversationMessageId("123")).toBe(true);
  });

  it("同一会话的旧列表晚到时也不能覆盖最新候选列表和选择", async () => {
    const f = setup();
    const finishes: Array<(value: unknown) => void> = [];
    f.load.mockImplementation(() => new Promise(resolve => finishes.push(resolve)));
    const first = f.service.handleGetSandboxList();
    const last = f.service.handleGetSandboxList();
    finishes[1](response("404", ["-1", "404"])); await last;
    finishes[0](response("403", ["-1", "403"])); await first;
    expect(f.data.currentSandboxId.value).toBe("404");
    expect(f.data.sandboxList.value.map(item => item.sandboxId)).toEqual(["-1", "404"]);
  });
});
