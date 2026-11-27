import { describe, expect, it } from "vitest";
import { resolveDrawerListWindow } from "@/utils/drawerListWindow.uts";

describe("任务抽屉列表窗口", () => {
  it("以真实行边界切出不同高度的项目行，首尾占位保持高度", () => {
    const offsets = [0, 38, 71, 108, 150, 175];
    expect(resolveDrawerListWindow(offsets, 38, 108)).toMatchObject({
      start: 1, end: 3, before: 38, after: 67,
    });
    expect(resolveDrawerListWindow(offsets, 59, 131)).toMatchObject({
      start: 1, end: 4, before: 38, after: 25,
    });
  });

  it("整组离屏和折叠时不挂载任何行，保留原始滚动坐标", () => {
    const offsets = [0, 38, 76, 114];
    expect(resolveDrawerListWindow(offsets, 0, 0)).toMatchObject({
      start: 0, end: 0, before: 0, after: 114,
    });
    expect(resolveDrawerListWindow(offsets, 60, 60)).toMatchObject({
      start: 1, end: 1, before: 38, after: 76,
    });
    expect(resolveDrawerListWindow(offsets, 200, 440)).toMatchObject({
      start: 3, end: 3, before: 114, after: 0,
    });
    expect(resolveDrawerListWindow([0], 0, 600)).toMatchObject({
      start: 0, end: 0, before: 0, after: 0,
    });
  });

  it("数百条任务只渲染当前窗口，并覆盖最后一行", () => {
    const offsets = Array.from({ length: 501 }, (_, i) => i * 38);
    const middle = resolveDrawerListWindow(offsets, 9000, 10000);
    expect(middle.end - middle.start).toBeLessThanOrEqual(28);
    expect(middle.before + (offsets[middle.end] - offsets[middle.start]) + middle.after).toBe(19000);
    const end = resolveDrawerListWindow(offsets, 18400, 20000);
    expect(end.end).toBe(500);
    expect(end.after).toBe(0);
  });
});
