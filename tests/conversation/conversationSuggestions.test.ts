import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 执行真实 live/sub 完成入口，只隔离网络、语音与消息渲染。
const source = readFileSync("subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts", "utf8");
function method(name: string) {
  const start = source.search(new RegExp(`  (?:private )?(?:async )?${name}\\(`));
  const end = source.indexOf("\n  }", start);
  if (start < 0 || end <= start) throw new Error(`Missing method: ${name}`);
  return source.slice(start, end + 4);
}
const builders = source.slice(source.indexOf("class _ConversationChatSuggestParams "), source.indexOf("function isStreamTerminalSsePayload("));
const code = transformSync(`${builders}
class Service {
  streamGeneration = 1;
  chatSuggestRequestVersion = 0;
  isSubscribed = false;
  subStreamRequest = null;
  ${["handleStreamComplete", "refreshChatSuggest", "handleSubConversation", "abortSubConversation"].map(method).join("\n")}
}; Service;`, { loader: "ts" }).code;
const ref = <T>(value: T) => ({ value });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

function setup(enabled = true) {
  const suggest = vi.fn().mockResolvedValue({ code: "0000", data: ["下一步做什么？"] });
  const configs: any[] = [];
  const warn = vi.fn();
  const Service = runInNewContext(code, {
    console: { warn, error: vi.fn() }, setTimeout,
    MessageTypeEnum: { USER: "USER", ASSISTANT: "ASSISTANT" },
    MessageStatusEnum: { Loading: "Loading", Complete: "Complete" },
    MessageModeEnum: { CHAT: "CHAT" }, AssistantRoleEnum: { ASSISTANT: "ASSISTANT" },
    ConversationEventTypeEnum: { ERROR: "ERROR" }, OpenCloseEnum: { Open: "Open", Close: "Close" },
    TaskStatus: { EXECUTING: "EXECUTING", COMPLETE: "COMPLETE", FAILED: "FAILED" },
    SUCCESS_CODE: "0000", ACCESS_TOKEN: "token", API_HEADERS: {},
    UTSJSONObject: class { constructor(value: unknown) { Object.assign(this, value); } },
    StreamRequestConfig: class {},
    StreamRequest: class {
      abort = vi.fn();
      async request(config: unknown) { configs.push(config); }
    },
    apiResCode: (r: any) => r?.["code"], apiResData: (r: any) => r?.["data"],
    ensureConversationTitleFromDetail: vi.fn(), isTurnUserReadyFromMessageInfoList: () => true,
    canReuseAssistantOnSubResume: () => false, createMessageInfoFromAny: (v: unknown) => v,
    generateUniqueId: () => "resumed-answer", getApiBaseUrl: () => "https://test.invalid",
    uni: { getStorageSync: () => "" }, applyBearerAuthorization: vi.fn(), applyXClientTypeHeader: vi.fn(),
    chatService: { isCurrentlyStreaming: false }, readRawField: (v: any, key: string) => v?.[key],
    AgentDetailUtils: { utsObjToRecord: (v: unknown) => v },
    readMessageText: (v: any) => v.text ?? "", isAppInBackground: () => false,
    isAcpPermissionEvent: () => false, isMcpAskToolCallEvent: () => false,
    apiAgentConversationChatSuggest: suggest, extractTaskResult: () => ({ hasTaskResult: false }),
  });
  const service = new Service();
  const data = {
    isTempChat: ref(false), isSuggest: ref(enabled), chatSuggestList: ref<any[]>([]), isConversationActive: ref(true),
    streamingAssistantMessageId: ref("answer"), streamingAssistantText: ref("回复内容"),
    messageList: ref<any[]>([{ id: "user", messageType: "USER", text: "你好" }, { id: "answer", messageType: "ASSISTANT", text: "回复内容" }]),
    conversationId: ref(9527), messageIdRef: ref("answer"),
  };
  service.data = data;
  for (const name of ["endStreamListDraft", "safeEmitStreamSpeakFeed", "persistLastAssistantSpeakableText", "markConversationTaskCompleteIfExecuting", "clearStreamingAssistantText", "sealStreamingAssistantBeforeClear", "finalizeTerminalAssistantMessage"]) {
    service[name] = vi.fn();
  }
  service.hydrateCompletedOpenUiIfNeeded = vi.fn().mockResolvedValue(undefined);
  service.handleQueryConversation = vi.fn().mockResolvedValue(undefined);
  service.handleChangeMessageList = vi.fn((event: any) => {
    const last = data.messageList.value[data.messageList.value.length - 1];
    if (event.eventType == "FINAL_RESULT") last.finalResult = event.data;
    last.text = "续接后的完整回复";
  });
  async function subscribe(status = "EXECUTING", openSuggest = enabled ? "Open" : "Close") {
    await service.handleSubConversation(9527, null, {
      code: "0000", data: { id: 9527, taskStatus: status, agent: { openSuggest } },
    }, true);
    return configs[configs.length - 1];
  }
  return { service, data, suggest, configs, subscribe, warn };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("回复完成后的用户问题建议", () => {
  it("普通发送按开关请求建议，保留原始请求参数", async () => {
    const f = setup();
    await f.service.handleStreamComplete({ conversationId: 9527, message: "你好", sandboxId: "403" }, false);
    expect(f.suggest).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ conversationId: 9527, message: "你好", sandboxId: "403" }));
    expect(f.data.chatSuggestList.value).toEqual(["下一步做什么？"]);
    await vi.runAllTimersAsync();
    expect(f.data.isConversationActive.value).toBe(false);

    const closed = setup(false);
    await closed.service.handleStreamComplete({ conversationId: 9527 }, false);
    expect(closed.suggest).not.toHaveBeenCalled();
  });

  it("续接采用详情中的 Open 配置，收到结束事件后只请求一次建议", async () => {
    const f = setup(false);
    const config = await f.subscribe("EXECUTING", "Open");
    expect(f.suggest).not.toHaveBeenCalled();
    config.onChunk({ type: "content", data: JSON.stringify({ eventType: "FINAL_RESULT", data: { success: true } }) });
    config.onComplete();
    config.onComplete();
    await vi.runAllTimersAsync();
    expect(f.service.handleChangeMessageList).toHaveBeenCalledTimes(1);
    expect(f.suggest).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ conversationId: 9527 }));
    expect(f.data.chatSuggestList.value).toEqual(["下一步做什么？"]);
    expect(f.data.isConversationActive.value).toBe(false);
  });

  it("详情已关闭建议时，续接完成也不生成建议", async () => {
    const f = setup(true);
    const config = await f.subscribe("EXECUTING", "Close");
    config.onComplete();
    expect(f.data.isSuggest.value).toBe(false);
    expect(f.suggest).not.toHaveBeenCalled();
  });

  it.each(["COMPLETE", "FAILED"])("订阅前任务已变为 %s 时仅成功完成补建议", async status => {
    const f = setup();
    await f.subscribe(status);
    expect(f.configs).toHaveLength(0);
    expect(f.suggest).toHaveBeenCalledTimes(status == "COMPLETE" ? 1 : 0);
  });

  it.each(["error-event", "onError", "onTimeout", "abort"])("%s 后的完成回调不误生成建议", async reason => {
    const f = setup();
    const config = await f.subscribe();
    if (reason == "error-event") {
      config.onChunk({ type: "content", data: JSON.stringify({ eventType: "ERROR", data: { message: "失败" } }) });
    } else if (reason == "abort") {
      f.service.abortSubConversation();
    } else {
      config[reason](new Error("network"));
    }
    config.onComplete();
    expect(f.suggest).not.toHaveBeenCalled();
  });

  it("临时会话继续跳过建议生成", async () => {
    const f = setup();
    f.data.isTempChat.value = true;
    await f.service.handleStreamComplete({ chatKey: "test" }, true);
    await f.service.refreshChatSuggest({ conversationId: 9527 }, 1);
    expect(f.suggest).not.toHaveBeenCalled();
  });

  it.each(["new-turn", "switch-conversation", "disabled", "abort"])("建议晚返回时丢弃 %s 前的旧结果", async change => {
    const f = setup();
    const response = deferred<any>();
    f.suggest.mockReturnValueOnce(response.promise);
    const loading = f.service.refreshChatSuggest({ conversationId: 9527 }, 1);
    if (change == "new-turn") f.service.streamGeneration++;
    if (change == "switch-conversation") f.data.conversationId.value = 9528;
    if (change == "disabled") f.data.isSuggest.value = false;
    if (change == "abort") f.service.abortSubConversation();
    response.resolve({ code: "0000", data: ["旧建议"] });
    await loading;
    expect(f.data.chatSuggestList.value).toEqual([]);
  });

  it("OpenUI 回补等待期间进入新轮次，不再发出旧轮次的建议请求", async () => {
    const f = setup();
    const hydrate = deferred<void>();
    f.service.hydrateCompletedOpenUiIfNeeded.mockReturnValue(hydrate.promise);
    const done = f.service.handleStreamComplete({ conversationId: 9527 }, false);
    f.service.streamGeneration++;
    hydrate.resolve();
    await done;
    expect(f.suggest).not.toHaveBeenCalled();
  });

  it("较旧的请求晚返回时不能覆盖同会话的新建议", async () => {
    const f = setup();
    const old = deferred<any>();
    f.suggest.mockReturnValueOnce(old.promise);
    const first = f.service.refreshChatSuggest({ conversationId: 9527 }, 1);
    await f.service.refreshChatSuggest({ conversationId: 9527 }, 1);
    old.resolve({ code: "0000", data: ["旧建议"] });
    await first;
    expect(f.data.chatSuggestList.value).toEqual(["下一步做什么？"]);
  });

  it("建议接口失败不打断回复收尾，业务失败也不覆盖已有建议", async () => {
    const f = setup();
    f.suggest.mockRejectedValueOnce(new Error("network"));
    await f.service.handleStreamComplete({ conversationId: 9527 }, false);
    await vi.runAllTimersAsync();
    expect(f.data.isConversationActive.value).toBe(false);
    expect(f.warn).toHaveBeenCalledTimes(1);
    f.data.chatSuggestList.value = ["已有建议"];
    f.suggest.mockResolvedValueOnce({ code: "5000", data: ["失败响应"] });
    await f.service.refreshChatSuggest({ conversationId: 9527 }, 1);
    expect(f.data.chatSuggestList.value).toEqual(["已有建议"]);
  });
});
