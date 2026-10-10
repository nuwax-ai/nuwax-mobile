/**
 * 项目本地标记（置顶/归档/收藏）单元测试。
 * 对齐 conversationLocalFlags 用例结构：数组结构、id 归一、toggle 幂等、
 * 删除清残留、归档过滤双向、置顶稳定排序（组内保持原相对顺序）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearProjectFlags,
  countArchivedProjects,
  filterActiveProjects,
  filterArchivedProjects,
  hasProjectFlag,
  loadProjectFlags,
  PROJECT_FLAG_ARCHIVED,
  PROJECT_FLAG_COLLECTED,
  PROJECT_FLAG_PINNED,
  ProjectLocalFlags,
  sortProjectsByPinned,
  toggleProjectFlag,
} from "@/utils/projectLocalFlags.uts";
import { ProjectGroupView } from "@/utils/projectGroupProjection.uts";

function makeFlags(
  pinned: number[] = [],
  archived: number[] = [],
  collected: number[] = [],
): ProjectLocalFlags {
  const flags = new ProjectLocalFlags();
  flags.pinned = pinned;
  flags.archived = archived;
  flags.collected = collected;
  return flags;
}

function group(id: number, name = `项目${id}`): ProjectGroupView {
  const g = new ProjectGroupView();
  g.id = id;
  g.name = name;
  return g;
}

beforeEach(() => {
  // 每用例独立的 Map 存储（覆盖 setup 的共享实例，实现用例间隔离）
  const storage = new Map<string, unknown>();
  (globalThis as Record<string, unknown>).uni = {
    getStorageSync: (key: string): unknown =>
      storage.has(key) ? storage.get(key) : "",
    setStorageSync: (key: string, value: unknown): void => {
      storage.set(key, value);
    },
  };
});

describe("标记读写", () => {
  it("无数据时返回空标记", () => {
    const flags = loadProjectFlags();
    expect(flags.pinned).toEqual([]);
    expect(flags.archived).toEqual([]);
    expect(flags.collected).toEqual([]);
  });

  it("toggle 开启后可读、再 toggle 关闭；持久化跨 load 生效", () => {
    expect(toggleProjectFlag(PROJECT_FLAG_PINNED, 42)).toBe(true);
    expect(hasProjectFlag(PROJECT_FLAG_PINNED, 42)).toBe(true);
    expect(loadProjectFlags().pinned).toEqual([42]);

    expect(toggleProjectFlag(PROJECT_FLAG_PINNED, 42)).toBe(false);
    expect(hasProjectFlag(PROJECT_FLAG_PINNED, 42)).toBe(false);
    expect(loadProjectFlags().pinned).toEqual([]);
  });

  it("三组标记互不影响", () => {
    toggleProjectFlag(PROJECT_FLAG_PINNED, 1);
    toggleProjectFlag(PROJECT_FLAG_ARCHIVED, 2);
    toggleProjectFlag(PROJECT_FLAG_COLLECTED, 3);
    const flags = loadProjectFlags();
    expect(flags.pinned).toEqual([1]);
    expect(flags.archived).toEqual([2]);
    expect(flags.collected).toEqual([3]);
    expect(hasProjectFlag(PROJECT_FLAG_ARCHIVED, 1)).toBe(false);
  });

  it("id 归一：string 形式持久化数据可解析", () => {
    (globalThis as Record<string, unknown>).uni = {
      getStorageSync: (): string =>
        JSON.stringify({
          version: 1,
          pinned: ["7", 9],
          archived: [],
          collected: [],
        }),
      setStorageSync: (): void => {},
    };
    const flags = loadProjectFlags();
    expect(flags.pinned).toEqual([7, 9]);
    expect(hasProjectFlag(PROJECT_FLAG_PINNED, 7)).toBe(true);
  });

  it("坏数据容错返回空标记", () => {
    (globalThis as Record<string, unknown>).uni = {
      getStorageSync: (): string => "not-a-json{{{",
      setStorageSync: (): void => {},
    };
    const flags = loadProjectFlags();
    expect(flags.pinned).toEqual([]);
  });

  it("删除项目时清理三组残留标记", () => {
    toggleProjectFlag(PROJECT_FLAG_PINNED, 5);
    toggleProjectFlag(PROJECT_FLAG_ARCHIVED, 5);
    toggleProjectFlag(PROJECT_FLAG_COLLECTED, 6);
    clearProjectFlags(5);
    const flags = loadProjectFlags();
    expect(flags.pinned).toEqual([]);
    expect(flags.archived).toEqual([]);
    expect(flags.collected).toEqual([6]);
  });
});

describe("列表 selector", () => {
  it("默认视图过滤归档项、已归档视图只看归档项", () => {
    const list = [group(1), group(2), group(3), group(4)];
    const flags = makeFlags([], [2, 4]);
    expect(filterActiveProjects(list, flags).map((g) => g.id)).toEqual([1, 3]);
    expect(filterArchivedProjects(list, flags).map((g) => g.id)).toEqual([2, 4]);
    expect(countArchivedProjects(list, flags)).toBe(2);
  });

  it("置顶稳定排序：置顶项目置前、组内保持原相对顺序", () => {
    const list = [group(1), group(2), group(3), group(4), group(5)];
    const flags = makeFlags([3, 5]);
    expect(sortProjectsByPinned(list, flags).map((g) => g.id)).toEqual([
      3, 5, 1, 2, 4,
    ]);
  });

  it("无置顶时排序不改变原顺序", () => {
    const list = [group(2), group(1), group(3)];
    expect(sortProjectsByPinned(list, makeFlags()).map((g) => g.id)).toEqual([
      2, 1, 3,
    ]);
  });
});
