import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformWithOxc } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import eventBus from "@/utils/eventBus.uts";
import { beginDrawerTitleRead, clearDrawerTitles, getDrawerTitleRevision, protectConversationTitles, recordDrawerTitle, resolveDrawerTitle } from "@/utils/drawerTitleState.uts";
import { captureDrawerTitleContext, DRAWER_TITLE_CHANGED, publishDrawerTitleChange, receiveDrawerTitleChange } from "@/utils/drawerTitleSync.uts";

const bridge = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/utils/system", () => ({ postAppWebViewMessage: bridge.post }));

const tasks = readFileSync("components/conversation-history-list/conversation-history-list.uvue", "utf8");
const drawer = readFileSync("components/project-task-drawer/project-task-drawer.uvue", "utf8");
const container = readFileSync("components/offline-h5-container/offline-h5-container.uvue", "utf8");
const serviceSource = readFileSync("subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts", "utf8");
async function bind(source: string, names: string[], state: Record<string, any>) {
  const functions = names.map(name => {
    const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
    if (start < 0) {
      const callback = source.indexOf(`  const ${name} = `);
      if (callback < 0) throw new Error(name);
      return source.slice(callback, source.indexOf("\n  };", callback) + 5);
    }
    return source.slice(start, source.indexOf("\n  }", start) + 4);
  });
  const { code } = await transformWithOxc(functions.join("\n"), "title-test.ts", { lang: "ts" });
  const api = runInNewContext(`${code}\n({${names.join(",")}})`, state);
  if (api.silentFetchTasks) state.runTaskSilentRefresh = () => api.silentFetchTasks();
  if (api.silentRefreshProjects) state.runProjectSilentRefresh = () => api.silentRefreshProjects();
  return api;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => { clearDrawerTitles(); vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("标题写回保护", () => {
  it("写回前的旧请求、写回后尚未同步的读副本都不能覆盖；确认后接受其它端改名", () => {
    const oldRequest = getDrawerTitleRevision();
    recordDrawerTitle("conversation", 11, "新标题", "");
    const freshRequest = getDrawerTitleRevision();
    expect(resolveDrawerTitle("conversation", 11, "", "旧标题", oldRequest)).toBe("新标题");
    expect(resolveDrawerTitle("conversation", 11, "", "旧标题", freshRequest)).toBe("新标题");
    expect(resolveDrawerTitle("conversation", 11, "", "新标题", freshRequest)).toBe("新标题");
    expect(resolveDrawerTitle("conversation", 11, "", "旧标题", oldRequest)).toBe("新标题");
    expect(resolveDrawerTitle("conversation", 11, "", "另一端的名称", getDrawerTitleRevision())).toBe("另一端的名称");
  });

  it("常规项目和全栈项目同号时不串名，退出后清理覆盖值", () => {
    const revision = getDrawerTitleRevision();
    recordDrawerTitle("project", 3, "常规新名称", "NormalProject");
    expect(resolveDrawerTitle("project", 3, "UserApp", "全栈原名称", revision)).toBe("全栈原名称");
    clearDrawerTitles();
    expect(resolveDrawerTitle("project", 3, "NormalProject", "新账号名称", getDrawerTitleRevision())).toBe("新账号名称");
  });

  it("写回后的较早请求即使晚于确认返回，也不能回滚后续已经读到的标题", () => {
    recordDrawerTitle("conversation", 11, "新标题", "");
    const early = beginDrawerTitleRead();
    const confirming = beginDrawerTitleRead();
    resolveDrawerTitle("conversation", 11, "", "新标题", confirming);
    expect(resolveDrawerTitle("conversation", 11, "", "旧标题", early)).toBe("新标题");
    const latest = beginDrawerTitleRead();
    resolveDrawerTitle("conversation", 11, "", "另一端修改", latest);
    expect(resolveDrawerTitle("conversation", 11, "", "新标题", confirming)).toBe("另一端修改");
  });

  it("H5 发出本地事件并携带宿主作用域；换账号后丢弃旧命名结果", () => {
    vi.stubGlobal("window", { location: { hash: "#/chat?drawerTitleScope=account-scope-7" } });
    const listener = vi.fn();
    eventBus.on(DRAWER_TITLE_CHANGED, listener);
    try {
      const context = captureDrawerTitleContext();
      publishDrawerTitleChange("conversation", 11, "新标题", "", context);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(bridge.post).toHaveBeenCalledWith(expect.objectContaining({ scopeKey: "account-scope-7", id: 11, title: "新标题" }));
      window.location.hash = "#/chat?conversationId=12";
      expect(captureDrawerTitleContext().scope).toBe("account-scope-7");
      uni.setStorageSync("ACCESS_TOKEN", "changed-session");
      publishDrawerTitleChange("conversation", 11, "旧账号结果", "", context);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally { eventBus.off(DRAWER_TITLE_CHANGED, listener); }
  });

  it("原生拒绝旧账号桥消息，接收当前账号消息", () => {
    const payload = { kind: "project", id: 3, title: "项目新名", projectType: "NormalProject", scopeKey: "old" };
    const revision = getDrawerTitleRevision();
    receiveDrawerTitleChange(payload, "current");
    expect(getDrawerTitleRevision()).toBe(revision);
    payload.scopeKey = "current";
    receiveDrawerTitleChange(payload, "current");
    expect(resolveDrawerTitle("project", 3, "NormalProject", "旧名", revision)).toBe("项目新名");
  });
});

function taskState(rows: Record<string, any>[], request: any) {
  return {
    props: { isLoggedIn: true, isVisible: true, allowSilentRefresh: false },
    taskDataGeneration: 0, conversationList: { value: rows }, conversationRequestPromise: null,
    taskSilentRefreshPending: false, ConversationListParams: class {}, SILENT_HEAD_SIZE: 10,
    SUCCESS_CODE: 0, apiResCode: (r: any) => r.code, apiResData: (r: any) => r.data,
    normalizeConversationList: (r: any) => r, beginDrawerTitleRead, protectConversationTitles,
    apiAgentConversationList: request, console, setTimeout,
  };
}
const taskFunctions = ["toNum", "updateConversationItem", "mergeConversationHead", "mergeConversationTitles", "flushPendingTaskRefresh", "silentFetchTasks"];

describe("滚动与请求时序", () => {
  it("下滚时更新超过头10条的标题，保留行顺序、数量和标记", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, topic: "旧标题", pinned: false }));
    const state = taskState(rows, vi.fn(async () => ({ code: 0, data: [
      { id: 30, topic: "新增行" }, { id: 15, topic: "第15条新标题", pinned: true },
    ] })));
    const api = await bind(tasks, taskFunctions, state);
    await api.silentFetchTasks();
    expect(state.apiAgentConversationList.mock.calls[0][0].limit).toBe(20);
    expect(state.conversationList.value.map(row => row.id)).toEqual(rows.map(row => row.id));
    expect(state.conversationList.value[14]).toEqual({ id: 15, topic: "第15条新标题", pinned: false });
  });

  it("忙碌时多个刷新合并为一次补刷，旧回包不能回滚刚写入的标题", async () => {
    const first = deferred<any>();
    const second = deferred<any>();
    const request = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const state = taskState([{ id: 11, topic: "旧标题" }], request);
    const api = await bind(tasks, taskFunctions, state);
    const pending = api.silentFetchTasks();
    recordDrawerTitle("conversation", 11, "新标题", "");
    state.conversationList.value[0].topic = "新标题";
    await api.silentFetchTasks();
    await api.silentFetchTasks();
    first.resolve({ code: 0, data: [{ id: 11, topic: "旧标题" }] });
    await pending;
    expect(state.conversationList.value[0].topic).toBe("新标题");
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    second.resolve({ code: 0, data: [{ id: 11, topic: "新标题" }] });
    await vi.waitFor(() => expect(state.conversationRequestPromise).toBeNull());
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("项目刷新跨页期间完成命名，已有项目/子会话原地更新，保留展开态和游标", async () => {
    const page = deferred<any>();
    const state = {
      props: { isLoggedIn: true }, projectLoadedOnce: true, projectRequestPromise: null,
      drawerDataVisible: { value: true },
      projectSilentRefreshPending: false, projectNextPage: 2, projectDataGeneration: 0,
      projectGroupsData: [{ key: "NormalProject:3", id: 3, projectType: "NormalProject", name: "旧项目", expanded: true, children: [{ id: 11, name: "旧会话" }] }],
      projectVersion: { value: 0 }, allowSilentRefresh: { value: false },
      beginDrawerTitleRead, resolveDrawerTitle, fetchProjectPage: vi.fn(() => page.promise),
      appendProjectGroupsDedup: (_a: any, b: any) => b, console, setTimeout,
    };
    const original = state.projectGroupsData[0];
    const api = await bind(drawer, ["protectProjectTitles", "mergeProjectTitles", "flushPendingProjectRefresh", "silentRefreshProjects"], state);
    const pending = api.silentRefreshProjects();
    recordDrawerTitle("project", 3, "新项目", "NormalProject");
    recordDrawerTitle("conversation", 11, "新会话", "");
    page.resolve([{ key: "NormalProject:3", id: 3, projectType: "NormalProject", name: "旧项目", expanded: false, children: [{ id: 12, name: "新增会话" }, { id: 11, name: "旧会话" }] }]);
    await pending;
    expect(state.projectGroupsData[0]).toBe(original);
    expect(original).toMatchObject({ name: "新项目", expanded: true, children: [{ id: 11, name: "新会话" }] });
    expect(state.projectNextPage).toBe(2);
  });

  it("批量 WebView 消息逐条同步标题，旧作用域被拦截，且离开回调栈后才发事件", async () => {
    const start = container.indexOf("function handleMessage(");
    const end = container.indexOf("\n// Kotlin", start);
    const { code } = await transformWithOxc(container.slice(start, end), "bridge-test.ts", { lang: "ts" });
    const emit = vi.fn();
    const timers: (() => void)[] = [];
    const fn = runInNewContext(`${code}\nhandleMessage`, {
      session: { requestId: "request-1", scopeKey: "current", accepts: () => true },
      emit, disposed: false, setTimeout: (fn: () => void) => timers.push(fn),
    });
    fn({ detail: { data: [
      { type: "app-drawer-title-changed", scopeKey: "current", id: 11, title: "标题一" },
      { type: "app-drawer-title-changed", scopeKey: "old", id: 12, title: "旧账号" },
      { type: "app-drawer-title-changed", scopeKey: "current", id: 13, title: "标题二" },
    ] } });
    expect(emit).not.toHaveBeenCalled();
    timers.forEach(fn => fn());
    expect(emit.mock.calls.map(call => call[1].title)).toEqual(["标题一", "标题二"]);
  });

  it("重开抽屉保留真实滚动位置，不能误当回到顶部而应用列表重排", async () => {
    const state = {
      drawerVisible: { value: false }, allowSilentRefresh: { value: false }, refreshInFlight: false,
      stickyLastScrollTop: 720, STICKY_TRIGGER_EPS: 1, props: { isLoggedIn: true },
      projectLoadedOnce: true, taskHeaderContentOffset: 300, showFloatingTaskHeader: { value: true },
    };
    const api = await bind(drawer, ["handlePopupVisible"], state);
    api.handlePopupVisible(true);
    expect(state.stickyLastScrollTop).toBe(720);
    expect(state.allowSilentRefresh.value).toBe(false);
  });
});

describe("会话详情期间延后列表查询", () => {
  it("抽屉逻辑上仍打开，但任务页不可见或被 iOS 聊天壳覆盖时，列表不处于可查询状态", async () => {
    const start = drawer.indexOf("  const drawerDataVisible = computed(");
    const expression = drawer.slice(start, drawer.indexOf("\n", start));
    const { code } = await transformWithOxc(`${expression}\ndrawerDataVisible;`, "visibility-test.ts", { lang: "ts" });
    const state = {
      drawerVisible: { value: true }, drawerHostVisible: { value: true }, mainTabBarCovered: { value: false },
      computed: (get: () => boolean) => ({ get value() { return get(); } }),
    };
    const visible = runInNewContext(code, state);
    expect(visible.value).toBe(true);
    state.drawerHostVisible.value = false;
    expect(visible.value).toBe(false);
    state.drawerHostVisible.value = true;
    state.mainTabBarCovered.value = true;
    expect(visible.value).toBe(false);
  });

  it("详情中的会话标题通知只原地更新，关闭期间的补刷保留到重新可见", async () => {
    const first = deferred<any>();
    const request = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ code: 0, data: [{ id: 11, topic: "新标题" }] });
    const state = taskState([{ id: 11, topic: "旧标题" }], request);
    const api = await bind(tasks, [...taskFunctions, "silentRefresh", "onDrawerTitleChanged"], state);
    const pending = api.silentFetchTasks();
    state.props.isVisible = false;
    recordDrawerTitle("conversation", 11, "新标题", "");
    api.onDrawerTitleChanged({ kind: "conversation", id: 11, title: "新标题" });
    expect(state.conversationList.value[0].topic).toBe("新标题");
    first.resolve({ code: 0, data: [{ id: 11, topic: "旧标题" }] });
    await pending;
    expect(request).toHaveBeenCalledTimes(1);
    expect(state.taskSilentRefreshPending).toBe(true);
    state.props.isVisible = true;
    await api.silentFetchTasks();
    expect(request).toHaveBeenCalledTimes(2);
    expect(state.taskSilentRefreshPending).toBe(false);
  });

  it("详情中的项目名称通知只改当前缓存，返回可见抽屉后再查项目列表", async () => {
    const row = { key: "NormalProject:3", id: 3, projectType: "NormalProject", name: "旧项目", children: [] };
    const state = {
      props: { isLoggedIn: true }, drawerDataVisible: { value: false },
      projectGroupsData: [row], projectVersion: { value: 0 }, projectLoadedOnce: false,
      projectRequestPromise: null, projectSilentRefreshPending: false,
      requestProjects: vi.fn(async () => true),
    };
    const api = await bind(drawer, ["silentRefreshProjects", "onDrawerTitleChanged"], state);
    api.onDrawerTitleChanged({ kind: "project", projectType: "NormalProject", id: 3, title: "新项目" });
    expect(row.name).toBe("新项目");
    expect(state.requestProjects).not.toHaveBeenCalled();
    expect(state.projectSilentRefreshPending).toBe(true);
    state.drawerDataVisible.value = true;
    await api.silentRefreshProjects();
    expect(state.requestProjects).toHaveBeenCalledTimes(1);
  });

  it.each(["other-page", "chat-cover"])("任务页预取也受实际页面可见性约束，%s", async mode => {
    const state = {
      props: { isLoggedIn: true }, drawerHostVisible: { value: mode != "other-page" },
      mainTabBarCovered: { value: mode == "chat-cover" },
      requestProjects: vi.fn(), prefetchConversationList: vi.fn(),
    };
    const api = await bind(drawer, ["preloadDrawerData"], state);
    await api.preloadDrawerData();
    expect(state.requestProjects).not.toHaveBeenCalled();
    expect(state.prefetchConversationList).not.toHaveBeenCalled();
  });
});

describe("会话自动命名完成通知", () => {
  it.each([false, true])("写回原会话标题，切换会话后不污染新页面，switched=%s", async switched => {
    const start = serviceSource.indexOf("  async handleUpdateTopic(");
    const end = serviceSource.indexOf("\n  }", start) + 4;
    const { code } = await transformWithOxc(`class Service { ${serviceSource.slice(start, end)} }; Service`, "topic-test.ts", { lang: "ts" });
    const response = deferred<any>();
    const ensure = vi.fn(() => response.promise);
    const Service = runInNewContext(code, {
      ensureConversationTitleFromPrompt: ensure, readRawField: (r: any, key: string) => r?.[key],
    });
    const service = new Service();
    service.data = {
      conversationId: { value: 11 }, conversationInfo: { value: { id: 11, topic: "旧标题" } },
      needUpdateTopicRef: { value: true },
    };
    const pending = service.handleUpdateTopic("11", "首条消息");
    if (switched) {
      service.data.conversationId.value = 12;
      service.data.conversationInfo.value = { id: 12, topic: "另一会话" };
    }
    response.resolve({ topic: "生成的新标题", topicUpdated: 1 });
    await pending;
    expect(ensure).toHaveBeenCalledWith(11, "首条消息", expect.objectContaining({ id: 11 }));
    expect(service.data.conversationInfo.value.topic).toBe(switched ? "另一会话" : "生成的新标题");
    expect(service.data.needUpdateTopicRef.value).toBe(switched);
  });
});
