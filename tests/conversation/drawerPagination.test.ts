import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformWithOxc } from "vite";
import { describe, expect, it, vi } from "vitest";

const drawer = readFileSync("components/project-task-drawer/project-task-drawer.uvue", "utf8");
const tasks = readFileSync("components/conversation-history-list/conversation-history-list.uvue", "utf8");
const cache = readFileSync("utils/conversationListCache.uts", "utf8");

// 执行组件的真实函数，模拟请求顺序与滚动状态；不模拟原生布局。
async function bind(source: string, names: string[], state: Record<string, any>) {
  const functions = names.map(name => {
    const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
    if (start < 0) throw new Error(`Missing function: ${name}`);
    return source.slice(start, source.indexOf("\n  }", start) + 4);
  });
  const { code } = await transformWithOxc(functions.join("\n"), "drawer-test.ts", { lang: "ts" });
  return runInNewContext(`${code}\n({${names.join(",")}})`, state);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("抽屉分页与刷新", () => {
  it("未打开且没有任务组件实例时也预取项目与任务", async () => {
    const state = {
      props: { isLoggedIn: true }, projectRequestPromise: null, projectLoadedOnce: false,
      requestProjects: vi.fn(async () => true), prefetchConversationList: vi.fn(async () => true),
      taskListRef: { value: null }, callRefMethod: vi.fn(),
    };
    const api = await bind(drawer, ["preloadDrawerData"], state);
    await api.preloadDrawerData();
    expect(state.requestProjects).toHaveBeenCalledTimes(1);
    expect(state.prefetchConversationList).toHaveBeenCalledTimes(1);
    state.props.isLoggedIn = false;
    await api.preloadDrawerData();
    expect(state.prefetchConversationList).toHaveBeenCalledTimes(1);
  });

  it.each(["", "project", "task"])("项目折叠时，吸顶状态 %s 不影响任务分页", async floating => {
    const state = {
      refreshInFlight: false, drawerVisible: { value: true },
      taskSectionCollapsed: { value: false }, projectSectionCollapsed: { value: true },
      floatingHeaderKey: { value: floating }, projectHasMore: true,
      taskListHasMore: { value: true }, taskListRef: { value: {} },
      callRefMethod: vi.fn(), loadMoreProjects: vi.fn(),
    };
    const api = await bind(drawer, ["handleScrollTolower"], state);
    api.handleScrollTolower();
    expect(state.callRefMethod).toHaveBeenCalledWith(state.taskListRef.value, "loadMore");
    expect(state.loadMoreProjects).not.toHaveBeenCalled();
    // 任务到底也不能在视口上方插入项目。
    state.taskListHasMore.value = false;
    api.handleScrollTolower();
    expect(state.loadMoreProjects).not.toHaveBeenCalled();
    state.taskSectionCollapsed.value = true;
    api.handleScrollTolower();
    expect(state.loadMoreProjects).not.toHaveBeenCalled();
    state.projectSectionCollapsed.value = false;
    api.handleScrollTolower();
    expect(state.loadMoreProjects).toHaveBeenCalledTimes(1);
    state.refreshInFlight = true;
    api.handleScrollTolower();
    expect(state.loadMoreProjects).toHaveBeenCalledTimes(1);
  });

  it("刷新等待项目在途页和任务刷新，重复下拉不会提前释放", async () => {
    const page = deferred<boolean>();
    const task = deferred<void>();
    const state = {
      nextTick: () => Promise.resolve(), console,
      taskListRef: { value: { $callMethod: vi.fn(() => task.promise) } },
      projectRequestPromise: page.promise, requestProjects: vi.fn(async () => true),
      refreshInFlight: true, refreshing: { value: true }, allowSilentRefresh: { value: false },
      stickyLastScrollTop: 0, STICKY_TRIGGER_EPS: 1, scheduleMeasureStickyAnchors: vi.fn(),
    };
    const api = await bind(drawer, ["performRefresh", "handleRefresh"], state);
    const pending = api.performRefresh();
    await Promise.resolve();
    api.handleRefresh();
    expect(state.refreshing.value).toBe(true);
    expect(state.requestProjects).not.toHaveBeenCalled();
    page.resolve(true);
    await vi.waitFor(() => expect(state.requestProjects).toHaveBeenCalledTimes(1));
    expect(state.refreshing.value).toBe(true);
    task.resolve();
    await pending;
    expect(state.refreshing.value).toBe(false);
    expect(state.refreshInFlight).toBe(false);
    expect(state.taskListRef.value.$callMethod).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("头部请求完成/失败后仍消费触底事件，失败=%s", async fail => {
    const head = deferred<any>();
    const state = {
      props: { isLoggedIn: true, allowSilentRefresh: true },
      taskDataGeneration: 0,
      conversationList: { value: [{ id: 20 }] }, conversationRequestPromise: null,
      ConversationListParams: class {}, SILENT_HEAD_SIZE: 10, SUCCESS_CODE: 0,
      apiAgentConversationList: vi.fn(() => head.promise), apiResCode: () => 0,
      apiResData: (res: any) => res, normalizeConversationList: (res: any) => res,
      mergeConversationHead: vi.fn(), console: { error: vi.fn() },
      taskLoading: { value: false }, taskHasMore: { value: true }, requestTasks: vi.fn(async () => true),
    };
    const api = await bind(tasks, ["silentFetchTasks", "loadMore"], state);
    const updating = api.silentFetchTasks();
    const paging = api.loadMore();
    expect(state.requestTasks).not.toHaveBeenCalled();
    // 请求发出后开始向下滚动：旧回包不能重排头部。
    state.props.allowSilentRefresh = false;
    if (fail) head.reject(new Error("offline"));
    else head.resolve([{ id: 21 }]);
    await Promise.all([updating, paging]);
    expect(state.mergeConversationHead).not.toHaveBeenCalled();
    expect(state.requestTasks).toHaveBeenCalledWith(true);
    expect(state.conversationRequestPromise).toBeNull();
  });

  it("项目连续触底只发一页；失败保留页码和重试入口", async () => {
    const page = deferred<any>();
    const state = {
      refreshInFlight: false, projectHasMore: true, projectLoadingMore: false,
      projectDataGeneration: 0,
      projectRequestPromise: null, projectLoadingMoreView: { value: false },
      projectNextPage: 2, fetchProjectPage: vi.fn(() => page.promise),
      syncProjectLoadMoreState: vi.fn(), console,
    };
    const api = await bind(drawer, ["loadMoreProjects"], state);
    const first = api.loadMoreProjects();
    await api.loadMoreProjects();
    expect(state.fetchProjectPage).toHaveBeenCalledTimes(1);
    expect(state.projectRequestPromise).not.toBeNull();
    page.resolve(null);
    await first;
    expect(state.projectNextPage).toBe(2);
    expect(state.projectHasMore).toBe(true);
    expect(state.projectRequestPromise).toBeNull();
    expect(state.projectLoadingMoreView.value).toBe(false);
  });
});

async function cacheApi(request: any) {
  const { code } = await transformWithOxc(
    cache.replace(/^import .*;\n/gm, "").replaceAll("export ", ""),
    "cache-test.ts", { lang: "ts" },
  );
  return runInNewContext(`${code}\n({prefetchConversationList, getCachedConversationList, getCachedLastId, getCachedHasMore, clearCachedConversationList})`, {
    apiAgentConversationList: request, ConversationListParams: class {}, SUCCESS_CODE: 0,
    apiResCode: (res: any) => res.code, apiResData: (res: any) => res.data, console,
  });
}

describe("侧栏初始化预取缓存", () => {
  it.each([{ rows: [] }, { rows: [{ id: 20, agent: { name: "助手" } }] }])("预取和立即打开复用请求，保存首屏与游标 %j", async ({ rows }) => {
    const response = deferred<any>();
    const request = vi.fn(() => response.promise);
    const api = await cacheApi(request);
    const startup = api.prefetchConversationList();
    const opening = api.prefetchConversationList();
    expect(request).toHaveBeenCalledTimes(1);
    response.resolve({ code: 0, data: rows });
    expect(await startup).toBe(true);
    expect(await opening).toBe(true);
    await api.prefetchConversationList();
    expect(request).toHaveBeenCalledTimes(1);
    expect(api.getCachedConversationList()).toHaveLength(rows.length);
    expect(api.getCachedLastId()).toBe(rows.length ? 20 : null);
    expect(api.getCachedHasMore()).toBe(rows.length > 0);
  });

  it("退出后丢弃旧账号的预取回包，新请求正常写入", async () => {
    const oldResponse = deferred<any>();
    const newResponse = deferred<any>();
    const request = vi.fn().mockReturnValueOnce(oldResponse.promise).mockReturnValueOnce(newResponse.promise);
    const api = await cacheApi(request);
    const oldRequest = api.prefetchConversationList();
    api.clearCachedConversationList();
    const newRequest = api.prefetchConversationList();
    oldResponse.resolve({ code: 0, data: [{ id: 1 }] });
    expect(await oldRequest).toBe(false);
    expect(api.getCachedConversationList()).toHaveLength(0);
    newResponse.resolve({ code: 0, data: [{ id: 2 }] });
    expect(await newRequest).toBe(true);
    expect(api.getCachedLastId()).toBe(2);
  });
});
