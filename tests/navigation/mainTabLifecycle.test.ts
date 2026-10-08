import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";

function compile(path: string, exports: string[], ios = false) {
  let source = readFileSync(path, "utf8").replace(/^import .*;\n/gm, "").replace(/^export /gm, "");
  if (ios) source = source.replace(/\s*\/\/ #ifndef APP-IOS\n[\s\S]*?\/\/ #endif/g, "");
  return transformSync(`${source}\n({ ${exports.join(",")} });`, { loader: "ts" }).code;
}

function navigation(custom = true, routes = ["pages/tab-shell/tab-shell"], ios = false) {
  const nextTicks: (() => void)[] = [];
  const success = (options: any) => options.success?.({ errMsg: "navigate:ok" });
  const context = {
    CUSTOM_TAB_BAR_ENABLED: custom,
    ref: <T>(value: T) => ({ value }),
    nextTick: (callback: () => void) => nextTicks.push(callback),
    closeAllPopups: vi.fn(),
    getCurrentPages: () => routes.map(route => ({ route })),
    uni: { switchTab: vi.fn(), navigateBack: vi.fn(success), reLaunch: vi.fn(success) },
  };
  const api = runInNewContext(compile("utils/mainTabNavigation.uts", [
    "MAIN_TAB_PATHS", "mainTabActivePath", "mainTabPageVisible", "switchMainTab", "resolveMainTabPagePath",
  ], ios), context);
  return { ...context, ...api, settle: () => nextTicks.splice(0).forEach(callback => callback()) };
}

describe("常驻主界面路由", () => {
  it("切 Tab 只修改内容，保留容器；成功回调在响应式更新后执行", () => {
    const page = navigation();
    const success = vi.fn(); const complete = vi.fn();
    page.switchMainTab({ url: "/pages/index/index", success, complete });
    expect(page.mainTabActivePath.value).toBe("/pages/index/index");
    expect(page.uni.switchTab).not.toHaveBeenCalled();
    expect(page.uni.reLaunch).not.toHaveBeenCalled();
    expect(page.uni.navigateBack).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    page.settle();
    expect(success).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ errMsg: "switchTab:ok" }));
    expect(page.resolveMainTabPagePath("pages/tab-shell/tab-shell")).toBe("/pages/index/index");
  });

  it("从二级页返回指定 Tab，退回已有容器而不重建首页", () => {
    const page = navigation(true, ["pages/tab-shell/tab-shell", "subpackages/pages/agent-search/agent-search", "subpackages/pages/agent-detail/agent-detail"]);
    page.switchMainTab({ url: "/pages/expert-list/expert-list?old=1" });
    expect(page.uni.navigateBack).toHaveBeenCalledWith(expect.objectContaining({ delta: 2 }));
    expect(page.uni.reLaunch).not.toHaveBeenCalled();
    expect(page.mainTabActivePath.value).toBe("/pages/expert-list/expert-list");
    expect(page.resolveMainTabPagePath("subpackages/pages/agent-search/agent-search")).toBe("/subpackages/pages/agent-search/agent-search");
  });

  it("登录落地或旧链接直达时才创建容器，并传入目标 Tab", () => {
    const page = navigation(true, ["subpackages/pages/login/login"]);
    page.switchMainTab({ url: "/pages/mine/mine" });
    expect(page.uni.reLaunch).toHaveBeenCalledWith(expect.objectContaining({ url: "/pages/tab-shell/tab-shell?tab=/pages/mine/mine" }));
    expect(page.uni.switchTab).not.toHaveBeenCalled();
  });

  it("小程序仍走原生 Tab API，回调保持透传", () => {
    const page = navigation(false);
    const options = { url: "/pages/index/index", success: vi.fn() };
    page.switchMainTab(options);
    expect(page.uni.switchTab).toHaveBeenCalledWith(options);
    expect(page.mainTabActivePath.value).toBe("/pages/message/message");
  });

  it("iOS 的索引和内容都跳过应用 Tab", () => {
    const page = navigation(true, [], true);
    expect([...page.MAIN_TAB_PATHS]).toEqual([
      "/pages/message/message", "/pages/index/index", "/pages/expert-list/expert-list", "/pages/mine/mine",
    ]);
  });

  it("路由失败只触发失败及完成回调，不误报成功", () => {
    const page = navigation(true, []);
    const error = { errMsg: "reLaunch:fail", errCode: 1 };
    page.uni.reLaunch.mockImplementation(options => options.fail(error));
    const success = vi.fn(); const fail = vi.fn(); const complete = vi.fn();
    page.switchMainTab({ url: "/pages/message/message", success, fail, complete });
    page.settle();
    expect(success).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(error);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ errMsg: error.errMsg }));
  });
});

type Owner = { parent?: Owner; values: Map<string, unknown>; mounts: (() => void)[]; unmounts: (() => void)[] };
function lifecycle() {
  let owner: Owner;
  const watches: { getter: () => unknown; callback: (value: any, old: any) => void; last: unknown }[] = [];
  const active = { value: "/pages/message/message" }; const visible = { value: false };
  const fallbackShow = vi.fn(); const fallbackHide = vi.fn(); const fallbackUnload = vi.fn();
  const context = {
    mainTabActivePath: active, mainTabPageVisible: visible,
    CUSTOM_TAB_BAR_ENABLED: true, switchMainTab: vi.fn(), closeTopPopup: vi.fn(() => false),
    ref: <T>(value: T) => ({ value }),
    computed: (getter: () => unknown) => ({ get value() { return getter(); } }),
    provide: (key: string, value: unknown) => owner.values.set(key, value),
    inject: (key: string, fallback: unknown) => owner.parent?.values.get(key) ?? fallback,
    onMounted: (callback: () => void) => owner.mounts.push(callback),
    onUnmounted: (callback: () => void) => owner.unmounts.push(callback),
    watch: (getter: () => unknown, callback: (value: any, old: any) => void) => watches.push({ getter, callback, last: getter() }),
    onPageShow: fallbackShow, onPageHide: fallbackHide, onPageUnload: fallbackUnload,
  };
  const api = runInNewContext(compile("hooks/useMainTabLifecycle.uts", [
    "useMainTabLifecycle", "onTabPageShow", "onTabPageHide", "dispatchMainTabBack", "dispatchMainTabResize",
  ]), context);
  return {
    ...api, active, visible, fallbackShow, fallbackHide,
    setup: (parent?: Owner): Owner => { owner = { parent, values: new Map(), mounts: [], unmounts: [] }; return owner; },
    mount: (value: Owner) => value.mounts.forEach(callback => callback()),
    unmount: (value: Owner) => value.unmounts.forEach(callback => callback()),
    flush: () => watches.forEach(watcher => {
      const next = watcher.getter();
      if (next !== watcher.last) { const old = watcher.last; watcher.last = next; watcher.callback(next, old); }
    }),
  };
}

describe("Tab 内容显隐生命周期", () => {
  it("首次初始化一次，切走保留实例，切回只触发显示刷新", () => {
    const page = lifecycle();
    const owner = page.setup();
    const hooks = page.useMainTabLifecycle("/pages/message/message");
    const load = vi.fn(); const show = vi.fn(); const hide = vi.fn(); const unload = vi.fn();
    hooks.onLoad(load); hooks.onShow(show); hooks.onHide(hide); hooks.onUnload(unload);
    page.visible.value = true; page.flush(); page.mount(owner);
    expect(load).toHaveBeenCalledTimes(1); expect(show).toHaveBeenCalledTimes(1);
    page.active.value = "/pages/index/index"; page.flush();
    expect(hide).toHaveBeenCalledTimes(1); expect(unload).not.toHaveBeenCalled();
    page.active.value = "/pages/message/message"; page.flush();
    expect(show).toHaveBeenCalledTimes(2); expect(load).toHaveBeenCalledTimes(1);
    page.unmount(owner); expect(unload).toHaveBeenCalledTimes(1);
  });

  it("详情返回或 App 前台恢复，只唤醒当前 Tab，隐藏 Tab 不跟随刷新", () => {
    const page = lifecycle();
    const messageOwner = page.setup();
    const message = page.useMainTabLifecycle("/pages/message/message");
    const messageShow = vi.fn(); message.onShow(messageShow);
    const taskOwner = page.setup();
    const task = page.useMainTabLifecycle("/pages/index/index");
    const taskShow = vi.fn(); task.onShow(taskShow);
    page.visible.value = true; page.flush(); page.mount(messageOwner); page.mount(taskOwner);
    page.active.value = "/pages/index/index"; page.flush();
    page.visible.value = false; page.flush(); page.visible.value = true; page.flush();
    expect(messageShow).toHaveBeenCalledTimes(1);
    expect(taskShow).toHaveBeenCalledTimes(2);
  });

  it("录音等内嵌组件跟随所属 Tab；普通详情页继续使用 SDK 钩子", () => {
    const page = lifecycle();
    const parent = page.setup(); page.useMainTabLifecycle("/pages/index/index");
    const child = page.setup(parent); const show = vi.fn(); const hide = vi.fn();
    page.onTabPageShow(show); page.onTabPageHide(hide);
    page.active.value = "/pages/index/index"; page.visible.value = true; page.flush(); page.mount(child);
    page.active.value = "/pages/message/message"; page.flush();
    expect(show).toHaveBeenCalledTimes(1); expect(hide).toHaveBeenCalledTimes(1);
    page.setup(); page.onTabPageShow(show); page.onTabPageHide(hide);
    expect(page.fallbackShow).toHaveBeenCalledWith(show); expect(page.fallbackHide).toHaveBeenCalledWith(hide);
  });

  it("返回和屏幕尺寸事件只分发给当前可见内容", () => {
    const page = lifecycle(); page.setup(); const hooks = page.useMainTabLifecycle("/pages/message/message");
    const back = vi.fn(() => true); const resize = vi.fn(); hooks.onBackPress(back); hooks.onResize(resize);
    page.visible.value = true;
    expect(page.dispatchMainTabBack("/pages/message/message", { from: "backbutton" })).toBe(true);
    page.dispatchMainTabResize("/pages/message/message", { size: { windowWidth: 375 } });
    page.active.value = "/pages/index/index";
    expect(page.dispatchMainTabBack("/pages/message/message", { from: "backbutton" })).toBe(false);
    page.dispatchMainTabResize("/pages/message/message", { size: { windowWidth: 812 } });
    expect(back).toHaveBeenCalledTimes(1); expect(resize).toHaveBeenCalledTimes(1);
  });
});
