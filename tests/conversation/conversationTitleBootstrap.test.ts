import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ update: vi.fn(), detail: vi.fn(), post: vi.fn() }));
vi.mock("@/servers/conversation", () => ({ apiAgentConversationUpdate: api.update, apiAgentConversation: api.detail }));
vi.mock("@/utils/system", () => ({ postAppWebViewMessage: api.post }));

let title: typeof import("@/utils/conversationTitleBootstrap.uts");
let sync: typeof import("@/utils/drawerTitleSync.uts");
let eventBus: typeof import("@/utils/eventBus.uts").default;
let versions: typeof import("@/utils/drawerTitleState.uts");
const unnamed = { id: 11, topic: "新会话", topicUpdated: 0, messageList: [
  { role: "USER", type: "GUID", text: "预置问题" },
  { role: "ASSISTANT", text: "欢迎使用" },
  { role: "USER", type: "CHAT", text: "  整理文档  " },
  { role: "USER", type: "CHAT", text: "继续" },
] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.resetAllMocks();
  api.update.mockResolvedValue({ code: "0000", data: { id: 11, topic: "文档整理", topicUpdated: 1 } });
  api.detail.mockResolvedValue({ code: "0000", data: unnamed });
  title = await import("@/utils/conversationTitleBootstrap.uts");
  sync = await import("@/utils/drawerTitleSync.uts");
  versions = await import("@/utils/drawerTitleState.uts");
  eventBus = (await import("@/utils/eventBus.uts")).default;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const source = readFileSync("subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts", "utf8");
function method(name: string) {
  const start = source.indexOf(`  async ${name}(`);
  if (start < 0) throw new Error(name);
  return source.slice(start, source.indexOf("\n  }", start) + 4);
}
function streamService() {
  const flow = deferred<void>();
  let chunk!: (value: string) => void;
  const send = vi.fn((_params, onChunk, _complete, _error, _temp, _timeout, started) => {
    chunk = onChunk;
    started();
    return flow.promise;
  });
  const Service = runInNewContext(transformSync(`class Service { ${method("handleConversation")} ${method("handleUpdateTopic")} }; Service`, { loader: "ts" }).code, {
    chatService: { sendMessage: send }, isStreamPerfMockEnabled: () => false,
    perfResetSseEventCounters: vi.fn(), perfRecordSseEvent: vi.fn(),
    readRawField: (v: any, k: string) => v?.[k], isAcpPermissionEvent: () => false, isMcpAskToolCallEvent: () => false,
    ensureConversationTitleFromPrompt: title.ensureConversationTitleFromPrompt,
    firstUserTitlePrompt: title.firstUserTitlePrompt,
  });
  const service = new Service();
  service.data = {
    chatSuggestList: { value: [] }, streamingAssistantText: { value: "" }, streamingAssistantMessageId: { value: "" },
    conversationInfo: { value: unnamed }, conversationId: { value: 11 }, needUpdateTopicRef: { value: false },
    messageList: { value: unnamed.messageList },
  };
  service.streamGeneration = 0;
  service.endStreamListDraft = vi.fn();
  service.handleChangeMessageList = vi.fn();
  return { service, send, flow, chunk: (value: string) => chunk(value) };
}

describe("会话自动命名独立于 SSE", () => {
  it("chat 发起就生成，未收到任何 SSE 也不等待；后续正文不会重复生成", async () => {
    const s = streamService();
    const projectStarted = vi.fn();
    const flow = s.service.handleConversation({ conversationId: 11, message: "继续" }, "assistant", false, null, projectStarted);
    expect(s.send).toHaveBeenCalledTimes(1);
    expect(api.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 11, firstMessage: "整理文档" }));
    expect(s.service.handleChangeMessageList).not.toHaveBeenCalled();
    expect(projectStarted).toHaveBeenCalledTimes(1);
    s.chunk(JSON.stringify({ data: { text: "开始输出" } }));
    s.chunk(JSON.stringify({ data: { text: "继续输出" } }));
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(s.service.handleChangeMessageList).toHaveBeenCalledTimes(2);
    s.flow.resolve();
    await flow;
  });

  it("临时会话不生成标题或项目信息", async () => {
    const s = streamService();
    const started = vi.fn();
    const flow = s.service.handleConversation({ message: "临时消息" }, "assistant", true, null, started);
    expect(api.update).not.toHaveBeenCalled();
    expect(started).not.toHaveBeenCalled();
    s.flow.resolve();
    await flow;
  });

  it("续接仅补偿未命名会话，使用历史第一条用户正文，不依赖 needUpdateTopicRef", async () => {
    await title.ensureConversationTitleFromDetail(unnamed);
    await title.ensureConversationTitleFromDetail(unnamed);
    await title.ensureConversationTitleFromPrompt(11, "第二条消息", unnamed);
    expect(api.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ firstMessage: "整理文档" }));
    await title.ensureConversationTitleFromDetail({ ...unnamed, id: 12, topic: "自定义名称", topicUpdated: "1" });
    expect(api.update).toHaveBeenCalledTimes(1);
  });

  it("并发发送、进页和续接只共用一个命名请求，失败退避后重试", async () => {
    api.update.mockRejectedValueOnce(new Error("network"));
    const a = title.ensureConversationTitleFromDetail(unnamed);
    const b = title.ensureConversationTitleFromPrompt(11, "继续", unnamed);
    await vi.runAllTimersAsync();
    await Promise.all([a, b]);
    expect(api.update).toHaveBeenCalledTimes(2);
    expect(api.detail).toHaveBeenCalledTimes(1);
    expect(api.update.mock.calls[1][0].firstMessage).toBe("整理文档");
    await title.ensureConversationTitleFromDetail(unnamed);
    expect(api.update).toHaveBeenCalledTimes(2);
  });

  it("标题回包为空也算失败，三次失败后仍可在下次续接重新补偿", async () => {
    api.update.mockResolvedValue({ code: "0000", data: { topic: null } });
    const failed = title.ensureConversationTitleFromDetail(unnamed);
    await vi.runAllTimersAsync();
    await failed;
    expect(api.update).toHaveBeenCalledTimes(3);
    api.update.mockResolvedValue({ code: "0000", data: { topic: "恢复成功", topicUpdated: 1 } });
    await title.ensureConversationTitleFromDetail(unnamed);
    expect(api.update).toHaveBeenCalledTimes(4);
  });

  it("默认标题伴随 topicUpdated=0 时不能误判为命名成功", async () => {
    api.update.mockResolvedValueOnce({ code: "0000", data: { topic: "新会话", topicUpdated: 0 } });
    const task = title.ensureConversationTitleFromDetail(unnamed);
    await vi.runAllTimersAsync();
    await task;
    expect(api.update).toHaveBeenCalledTimes(2);
  });

  it("写入成功但回包丢失，重试先读详情，不能再次生成或覆盖已命名标题", async () => {
    api.update.mockRejectedValueOnce(new Error("lost response"));
    api.detail.mockResolvedValue({ code: "0000", data: { id: 11, topic: "已成功的标题", topicUpdated: 1 } });
    const notice = vi.fn();
    eventBus.on(sync.DRAWER_TITLE_CHANGED, notice);
    const task = title.ensureConversationTitleFromDetail(unnamed);
    await vi.runAllTimersAsync();
    await task;
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(notice).toHaveBeenCalledWith(expect.objectContaining({ id: 11, title: "已成功的标题" }));
  });

  it("切账号后不再重试，旧账号回包也不会发布到新账号", async () => {
    const response = deferred<any>();
    api.update.mockReturnValueOnce(response.promise);
    const notice = vi.fn();
    eventBus.on(sync.DRAWER_TITLE_CHANGED, notice);
    const task = title.ensureConversationTitleFromDetail(unnamed);
    (await import("@/utils/im/imSessionScope.uts")).invalidateImSession();
    response.resolve({ code: "0000", data: { topic: "旧账号标题" } });
    await task;
    await vi.runAllTimersAsync();
    expect(notice).not.toHaveBeenCalled();
    expect(api.update).toHaveBeenCalledTimes(1);
  });

  it("宿主支持后台命名时只委托，普通 H5 或桥发送失败时在本端执行", async () => {
    vi.resetModules();
    vi.stubGlobal("window", { location: { hash: "#/chat?drawerTitleScope=current&drawerTitleBootstrap=1" } });
    api.post.mockReturnValue(true);
    const delegated = await import("@/utils/conversationTitleBootstrap.uts");
    await delegated.ensureConversationTitleFromDetail(unnamed);
    expect(api.post).toHaveBeenCalledWith(expect.objectContaining({ type: "app-title-bootstrap", id: 11, scopeKey: "current" }));
    expect(api.update).not.toHaveBeenCalled();
    api.post.mockReturnValue(false);
    await delegated.ensureConversationTitleFromDetail(unnamed);
    expect(api.update).toHaveBeenCalledTimes(1);
  });
});

describe("新建会话开始输出后退出，再打开抽屉", () => {
  it("退页后命名仍完成，隐藏期间不拉列表；重开抽屉保留位置和新标题", async () => {
    const drawerSource = readFileSync("components/conversation-history-list/conversation-history-list.uvue", "utf8");
    const names = ["toNum", "updateConversationItem", "mergeConversationHead", "mergeConversationTitles", "flushPendingTaskRefresh", "silentFetchTasks", "silentRefresh", "onDrawerTitleChanged"];
    const fragments = names.map(name => {
      const start = drawerSource.search(new RegExp(`  (?:async )?function ${name}\\(`));
      if (start >= 0) return drawerSource.slice(start, drawerSource.indexOf("\n  }", start) + 4);
      const callback = drawerSource.indexOf(`  const ${name} = `);
      return drawerSource.slice(callback, drawerSource.indexOf("\n  };", callback) + 5);
    });
    const listRequest = vi.fn(async () => ({ code: "0000", data: [{ id: 11, topic: "新会话" }] }));
    const row = { id: 11, topic: "新会话", pinned: false };
    const rows = [row];
    const state = {
      props: { isLoggedIn: true, isVisible: false, allowSilentRefresh: false },
      taskDataGeneration: 0, conversationList: { value: rows }, conversationRequestPromise: null,
      taskSilentRefreshPending: false, ConversationListParams: class {}, SILENT_HEAD_SIZE: 10,
      SUCCESS_CODE: "0000", apiResCode: (r: any) => r.code, apiResData: (r: any) => r.data,
      normalizeConversationList: (r: any) => r, beginDrawerTitleRead: versions.beginDrawerTitleRead,
      protectConversationTitles: versions.protectConversationTitles,
      apiAgentConversationList: listRequest, console, setTimeout,
    };
    const drawer = runInNewContext(transformSync(`${fragments.join("\n")}\n({${names.join(",")}})`, { loader: "ts" }).code, state);
    eventBus.on(sync.DRAWER_TITLE_CHANGED, drawer.onDrawerTitleChanged);
    const response = deferred<any>();
    api.update.mockReturnValueOnce(response.promise);

    // chat 发起、正文可见，标题请求尚未返回。
    const s = streamService();
    const live = s.service.handleConversation({ conversationId: 11, message: "整理文档" }, "assistant", false, null);
    expect(api.update).toHaveBeenCalledTimes(1);
    s.chunk(JSON.stringify({ data: { text: "正在整理" } }));
    expect(s.service.handleChangeMessageList).toHaveBeenCalledTimes(1);
    expect(row.topic).toBe("新会话");

    // 退出详情只结束消息流；命名由 App 模块持有，继续完成。
    s.flow.resolve();
    await live;
    response.resolve({ code: "0000", data: { id: 11, topic: "文档整理", topicUpdated: 1 } });
    await vi.runAllTimersAsync();
    expect(row.topic).toBe("文档整理");
    expect(listRequest).not.toHaveBeenCalled();
    expect(state.taskSilentRefreshPending).toBe(true);

    // 返回任务页后才刷新；副本还返回旧标题也不能回滚，列表身份不变。
    state.props.isVisible = true;
    await drawer.silentFetchTasks();
    expect(listRequest).toHaveBeenCalledTimes(1);
    expect(state.conversationList.value.map((item: any) => item.id)).toEqual(rows.map(item => item.id));
    expect(state.conversationList.value[0]).toBe(row);
    expect(row.topic).toBe("文档整理");
    expect(api.update).toHaveBeenCalledTimes(1);
  });

  it("App 宿主接收命名请求后独立执行，忽略旧账号请求", async () => {
    const adapter = readFileSync("components/offline-h5-container/offline-h5-project.uts", "utf8");
    const start = adapter.indexOf("export function handleProjectOfflineH5TitleBootstrap(");
    const end = adapter.indexOf("\n}", start) + 2;
    const jobs: Promise<unknown>[] = [];
    const fn = runInNewContext(transformSync(adapter.slice(start, end).replace("export ", "") + "\nhandleProjectOfflineH5TitleBootstrap;", { loader: "ts" }).code, {
      getOfflineH5ScopeKey: () => "current",
      ensureConversationTitleFromPrompt: (...args: Parameters<typeof title.ensureConversationTitleFromPrompt>) => { jobs.push(title.ensureConversationTitleFromPrompt(...args)); },
      ensureProjectNameFromPrompt: vi.fn(),
    });
    fn({ kind: "conversation", id: 11, prompt: "整理文档", scopeKey: "old" });
    expect(api.update).not.toHaveBeenCalled();
    fn({ kind: "conversation", id: 11, prompt: "整理文档", scopeKey: "current" });
    fn({ kind: "conversation", id: 11, prompt: "重复桥消息", scopeKey: "current" });
    await Promise.all(jobs);
    expect(api.update).toHaveBeenCalledTimes(1);
  });
});

describe("ChatService 请求发起通知", () => {
  it("底层请求先发起，再通知命名，不等待首包或流完成；命名异常不打断聊天", async () => {
    const chatSource = readFileSync("utils/chatService.uts", "utf8");
    const start = chatSource.indexOf("  async sendMessage(");
    const end = chatSource.indexOf("\n  }", start) + 4;
    const stream = deferred<void>();
    const request = vi.fn(() => stream.promise);
    const Service = runInNewContext(transformSync(`class Service { ${chatSource.slice(start, end)} }; Service`, { loader: "ts" }).code, {
      getConversationConnectionUrl: () => "/api/agent/conversation/chat", ACCESS_TOKEN: "test-token-key", API_HEADERS: {},
      bootstrapH5AccessTokenFromUrl: vi.fn(), applyBearerAuthorization: vi.fn(), applyXClientTypeHeader: vi.fn(),
      uni: { getStorageSync: () => null }, UTSJSONObject: class { constructor(data: any) { Object.assign(this, data); } },
      StreamRequest: class { request = request; }, StreamRequestConfig: class {}, console: { error: vi.fn() },
    });
    const service = new Service();
    service.abort = vi.fn();
    const onError = vi.fn();
    const started = vi.fn(() => { expect(request).toHaveBeenCalledTimes(1); throw new Error("命名失败"); });
    const task = service.sendMessage({ conversationId: 11, message: "你好" }, vi.fn(), vi.fn(), onError, false, null, started);
    expect(started).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    stream.resolve();
    await task;
  });
});
