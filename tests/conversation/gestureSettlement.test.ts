import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformWithOxc } from "vite";
import { describe, expect, it, vi } from "vitest";

async function gestureModule() {
  const source = readFileSync("utils/horizontalGesture.uts", "utf8").replace(/^export /gm, "");
  const { code } = await transformWithOxc(source, "gesture.ts", { lang: "ts" });
  return runInNewContext(`${code}\n({ HorizontalGestureIntent, resolveHorizontalIntent, resolveDrawerOpen })`);
}

async function gesture() {
  const { HorizontalGestureIntent } = await gestureModule();
  const tracker = new HorizontalGestureIntent();
  tracker.begin(8);
  return tracker;
}

describe("菜单方向锁定", () => {
  it("系统容差内不锁定，之后按主轴分配触摸", async () => {
    const tracker = await gesture();
    expect(tracker.move(3, 1)).toBe(0);
    expect(tracker.move(5, 6)).toBe(0);
    expect(tracker.move(9, 20)).toBe(-1);
    expect(tracker.move(130, 25)).toBe(-1);
  });
  it("相同轨迹不因 MOVE 事件数量不同而换方向", async () => {
    const sparse = await gesture();
    const dense = await gesture();
    dense.move(2, 1); dense.move(4, 2); dense.move(6, 3);
    expect(dense.move(12, 5)).toBe(sparse.move(12, 5));
    expect(dense.move(14, 50)).toBe(1);
  });
  it("对角线倾向纵向，新触摸重置旧方向", async () => {
    const tracker = await gesture();
    expect(tracker.move(12, 12)).toBe(-1);
    tracker.begin(8);
    expect(tracker.move(-15, 3)).toBe(1);
  });
});

async function createPager() {
  const source = readFileSync("components/directional-pager/directional-pager.uvue", "utf8")
    .split('<script setup lang="uts">')[1].split('</script>')[0]
    .replace(/import .* from .*;/g, '');
  const { code } = await transformWithOxc(source, "pager.ts", { lang: "ts" });
  const trackerSource = readFileSync("utils/horizontalTabSwipe.uts", "utf8").replace(/^export /gm, "");
  const trackerCode = (await transformWithOxc(trackerSource, "swipe.ts", { lang: "ts" })).code;
  const { HorizontalTabSwipeTracker } = runInNewContext(`${trackerCode}\n({ HorizontalTabSwipeTracker })`);
  const props = { current: 1, count: 3, enabled: true };
  const emit = vi.fn();
  const result = runInNewContext(`${code}\n({ handleTouchStart, handleTouchEnd, handleTouchCancel })`, {
    nextTick: (callback: () => void) => callback(), HorizontalTabSwipeTracker,
    defineProps: () => props, withDefaults: (value: unknown) => value, defineEmits: () => emit,
  });
  return { ...result, props, emit };
}
const startTouch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] });
const endTouch = (x: number, y: number) => ({ changedTouches: [{ clientX: x, clientY: y }] });

describe("受控分页方向", () => {
  it("横滑先准备目标页，再执行一次切换", async () => {
    const pager = await createPager();
    pager.handleTouchStart(startTouch(500, 500));
    pager.handleTouchEnd(endTouch(120, 520));
    expect(pager.emit.mock.calls).toEqual([["preview", 2], ["change", 2]]);
  });
  it("强纵向位移即使有横向偏移也保持原页", async () => {
    const pager = await createPager();
    pager.handleTouchStart(startTouch(700, 1650));
    pager.handleTouchEnd(endTouch(780, 950));
    expect(pager.emit).not.toHaveBeenCalled();
  });
  it("页边界和关闭状态不切换", async () => {
    const pager = await createPager();
    pager.props.current = 0;
    pager.handleTouchStart(startTouch(100, 500));
    pager.handleTouchEnd(endTouch(450, 500));
    pager.props.enabled = false;
    pager.handleTouchStart(startTouch(500, 500));
    pager.handleTouchEnd(endTouch(100, 500));
    expect(pager.emit).not.toHaveBeenCalled();
  });
  it("取消触摸不执行切换", async () => {
    const pager = await createPager();
    pager.handleTouchStart(startTouch(500, 500));
    pager.handleTouchCancel(endTouch(100, 500));
    pager.handleTouchEnd(endTouch(100, 500));
    expect(pager.emit).not.toHaveBeenCalled();
  });
});

async function finishDrawer(offset: number, velocity: number, age: number, cancelled = false, wasOpen = false) {
  const source = readFileSync("components/project-task-drawer/project-task-drawer.uvue", "utf8");
  const start = source.indexOf("  function finishDrawerDrag(");
  const body = source.slice(start, source.indexOf("\n  }", start) + 4);
  const { code } = await transformWithOxc(body, "drawer.ts", { lang: "ts" });
  const settleDrawer = vi.fn();
  const finish = runInNewContext(`${code}\nfinishDrawerDrag`, {
    drawerOffset: { value: offset }, drawerWidth: { value: 320 }, drawerVelocity: velocity,
    drawerLastTime: Date.now() - age, settleDrawer, Date, ...(await gestureModule()),
  });
  finish(cancelled, wasOpen);
  return settleDrawer;
}

describe("菜单拖动收尾", () => {
  it("慢拖按开关方向使用一致的三成距离阈值", async () => {
    expect(await finishDrawer(-260, 0, 200)).toHaveBeenCalledWith(false);
    expect(await finishDrawer(-100, 0, 200)).toHaveBeenCalledWith(true);
  });
  it("已打开菜单拖过三成即可退出，不必拖走一大半", async () => {
    expect(await finishDrawer(-120, 0, 200, false, true)).toHaveBeenCalledWith(false);
    expect(await finishDrawer(-60, 0, 200, false, true)).toHaveBeenCalledWith(true);
  });
  it("快速甩动按方向完成，停顿后按位移判断", async () => {
    expect(await finishDrawer(-260, 0.8, 10)).toHaveBeenCalledWith(true);
    expect(await finishDrawer(-60, -0.8, 10, false, true)).toHaveBeenCalledWith(false);
    expect(await finishDrawer(-260, 0.8, 200)).toHaveBeenCalledWith(false);
  });
  it("取消手势恢复原端点，不停留半开", async () => {
    expect(await finishDrawer(-160, 0.8, 10, true, false)).toHaveBeenCalledWith(false);
    expect(await finishDrawer(-160, -0.8, 10, true, true)).toHaveBeenCalledWith(true);
  });
});

async function getDirectionResolver() {
  return (await gestureModule()).resolveHorizontalIntent;
}

describe("按位移主轴判定手势方向", () => {
  it("横向累计位移大于纵向即可判为横切，无固定距离门槛", async () => {
    const resolve = await getDirectionResolver();
    expect(resolve(0, 0)).toBe(0);
    expect(resolve(3, 2)).toBe(1);
    expect(resolve(-4, 1)).toBe(1);
  });
  it("纵向累计位移大于横向时交给列表滚动", async () => {
    const resolve = await getDirectionResolver();
    expect(resolve(2, 3)).toBe(-1);
    expect(resolve(-4, -5)).toBe(-1);
  });
  it("两轴相等时继续观察", async () => {
    const resolve = await getDirectionResolver();
    expect(resolve(5, 5)).toBe(0);
    expect(resolve(5, 6)).toBe(-1);
  });
});

describe("反向末尾速度不能覆盖抽屉整体位移", () => {
  it("整体向右打开，最后向左回摆仍按打开位移判断", async () => {
    expect(await finishDrawer(-100, -0.8, 10, false, false)).toHaveBeenCalledWith(true);
  });
  it("整体向左关闭，最后向右回摆仍按关闭位移判断", async () => {
    expect(await finishDrawer(-180, 0.8, 10, false, true)).toHaveBeenCalledWith(false);
  });
  it("同方向短甩可以完成，极小抖动不能靠瞬时速度触发", async () => {
    expect(await finishDrawer(-280, 0.8, 10, false, false)).toHaveBeenCalledWith(true);
    expect(await finishDrawer(-315, 3, 10, false, false)).toHaveBeenCalledWith(false);
    expect(await finishDrawer(-5, -3, 10, false, true)).toHaveBeenCalledWith(true);
  });
});

describe("搜索页横拖预览请求", () => {
  it("相同关键词复用在途请求，切换关键词允许替换旧请求", async () => {
    const source = readFileSync("subpackages/pages/conversation-search/conversation-search.uvue", "utf8");
    const start = source.indexOf("  function prepareTab(");
    const body = source.slice(start, source.indexOf("\n  function handleTabClick", start));
    const { code } = await transformWithOxc(body, "search.ts", { lang: "ts" });
    const fetchConversationList = vi.fn();
    const fetchProjectList = vi.fn();
    const state = {
      searchKeyword: { value: "new" }, taskLoading: { value: true }, projectLoading: { value: true },
      taskRequestKeyword: "new", projectRequestKeyword: "old", taskKeyword: "old", projectKeyword: "old",
      conversationList: { value: [] }, projectList: { value: [] }, markTabVisited: vi.fn(),
      fetchConversationList, fetchProjectList,
    };
    const prepare = runInNewContext(`${code}\nprepareTab`, state);
    prepare("task");
    expect(fetchConversationList).not.toHaveBeenCalled();
    prepare("project");
    expect(fetchProjectList).toHaveBeenCalledWith(false, "new");
    prepare("skill");
    expect(state.markTabVisited).toHaveBeenCalledWith("skill");
    expect(fetchConversationList).not.toHaveBeenCalled();
    expect(fetchProjectList).toHaveBeenCalledTimes(1);
  });
});

describe("原生滚动所有权", () => {
  it("分页仅在 IDLE 读取最终原生页码", async () => {
    const source = readFileSync("utils/androidNativePager.uts", "utf8");
    const start = source.indexOf("  override onPageScrollStateChanged");
    const method = source.slice(start, source.indexOf("\n  }", start) + 4)
      .replace("override onPageScrollStateChanged", "function onPageScrollStateChanged");
    const { code } = await transformWithOxc(method, "idle.ts", { lang: "ts" });
    const callback = runInNewContext(`${code}\nonPageScrollStateChanged`, { ViewPager2: { SCROLL_STATE_IDLE: 0 } });
    const settled = vi.fn();
    const current = vi.fn(() => 2);
    const observer = { pager: { getCurrentItem: current }, settled };
    callback.call(observer, 1);
    callback.call(observer, 2);
    expect(current).not.toHaveBeenCalled();
    callback.call(observer, 0);
    expect(settled).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("首页列表开始滚动后退出尚未接管的横滑识别", async () => {
    const source = readFileSync("pages/index/index-content.uvue", "utf8");
    const start = source.indexOf("  function onGuideScroll()");
    const method = source.slice(start, source.indexOf("\n  }", start) + 4);
    const { code } = await transformWithOxc(method, "scroll.ts", { lang: "ts" });
    const resetEdgeSwipeGesture = vi.fn();
    const state = { edgeSwipeLocked: false, resetEdgeSwipeGesture };
    const callback = runInNewContext(`${code}\nonGuideScroll`, state);
    callback();
    expect(resetEdgeSwipeGesture).toHaveBeenCalledTimes(1);
    state.edgeSwipeLocked = true;
    callback();
    expect(resetEdgeSwipeGesture).toHaveBeenCalledTimes(1);
  });
});
