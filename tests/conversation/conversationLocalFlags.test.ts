/**
 * 会话本地标记（置顶/归档/收藏）单元测试。
 * 契约对齐 PC conversationLocalFlags：数组结构、id 归一、toggle 幂等、
 * 删除清残留、归档过滤双向、置顶稳定排序（组内保持原相对顺序）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearConversationFlags,
  CONVERSATION_FLAG_ARCHIVED,
  CONVERSATION_FLAG_COLLECTED,
  CONVERSATION_FLAG_PINNED,
  ConversationLocalFlags,
  countArchivedConversations,
  filterActiveConversations,
  filterArchivedConversations,
  hasConversationFlag,
  loadConversationFlags,
  sortConversationsByPinned,
  toggleConversationFlag,
} from "@/utils/conversationLocalFlags.uts";

function makeFlags(
  pinned: number[] = [],
  archived: number[] = [],
  collected: number[] = [],
): ConversationLocalFlags {
  const flags = new ConversationLocalFlags();
  flags.pinned = pinned;
  flags.archived = archived;
  flags.collected = collected;
  return flags;
}

function conv(id: number): Record<string, unknown> {
  return { id, topic: `会话${id}` };
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
    const flags = loadConversationFlags();
    expect(flags.pinned).toEqual([]);
    expect(flags.archived).toEqual([]);
    expect(flags.collected).toEqual([]);
  });

  it("toggle 开启后可读、再 toggle 关闭；持久化跨 load 生效", () => {
    expect(toggleConversationFlag(CONVERSATION_FLAG_PINNED, 42)).toBe(true);
    expect(hasConversationFlag(CONVERSATION_FLAG_PINNED, 42)).toBe(true);
    // 持久化：重新 load 仍在
    expect(loadConversationFlags().pinned).toEqual([42]);

    expect(toggleConversationFlag(CONVERSATION_FLAG_PINNED, 42)).toBe(false);
    expect(hasConversationFlag(CONVERSATION_FLAG_PINNED, 42)).toBe(false);
    expect(loadConversationFlags().pinned).toEqual([]);
  });

  it("三组标记互不影响", () => {
    toggleConversationFlag(CONVERSATION_FLAG_PINNED, 1);
    toggleConversationFlag(CONVERSATION_FLAG_ARCHIVED, 2);
    toggleConversationFlag(CONVERSATION_FLAG_COLLECTED, 3);
    const flags = loadConversationFlags();
    expect(flags.pinned).toEqual([1]);
    expect(flags.archived).toEqual([2]);
    expect(flags.collected).toEqual([3]);
    expect(hasConversationFlag(CONVERSATION_FLAG_ARCHIVED, 1)).toBe(false);
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
    const flags = loadConversationFlags();
    expect(flags.pinned).toEqual([7, 9]);
    expect(hasConversationFlag(CONVERSATION_FLAG_PINNED, 7)).toBe(true);
  });

  it("坏数据容错返回空标记", () => {
    (globalThis as Record<string, unknown>).uni = {
      getStorageSync: (): string => "not-a-json{{{",
      setStorageSync: (): void => {},
    };
    const flags = loadConversationFlags();
    expect(flags.pinned).toEqual([]);
  });

  it("删除会话时清理三组残留标记", () => {
    toggleConversationFlag(CONVERSATION_FLAG_PINNED, 5);
    toggleConversationFlag(CONVERSATION_FLAG_ARCHIVED, 5);
    toggleConversationFlag(CONVERSATION_FLAG_COLLECTED, 6);
    clearConversationFlags(5);
    const flags = loadConversationFlags();
    expect(flags.pinned).toEqual([]);
    expect(flags.archived).toEqual([]);
    expect(flags.collected).toEqual([6]);
  });
});

describe("列表 selector", () => {
  it("默认视图过滤归档项、已归档视图只看归档项", () => {
    const list = [conv(1), conv(2), conv(3), conv(4)];
    const flags = makeFlags([], [2, 4]);
    expect(filterActiveConversations(list, flags).map((i) => i["id"])).toEqual([1, 3]);
    expect(filterArchivedConversations(list, flags).map((i) => i["id"])).toEqual([2, 4]);
    expect(countArchivedConversations(list, flags)).toBe(2);
  });

  it("置顶稳定排序：置顶项置前、组内保持原相对顺序", () => {
    const list = [conv(1), conv(2), conv(3), conv(4), conv(5)];
    // 置顶 3 与 5（乱序加入），1/2/4 保持原顺序
    const flags = makeFlags([3, 5]);
    expect(sortConversationsByPinned(list, flags).map((i) => i["id"])).toEqual([
      3, 5, 1, 2, 4,
    ]);
  });

  it("无置顶时排序不改变原顺序", () => {
    const list = [conv(2), conv(1), conv(3)];
    expect(sortConversationsByPinned(list, makeFlags()).map((i) => i["id"])).toEqual([
      2, 1, 3,
    ]);
  });

  it("列表 id 为 string 形式时同样匹配标记", () => {
    const list = [{ id: "11", topic: "a" }, { id: 12, topic: "b" }];
    const flags = makeFlags([11]);
    expect(sortConversationsByPinned(list, flags)[0]["id"]).toBe("11");
    expect(countArchivedConversations(list, makeFlags([], [12]))).toBe(1);
  });
});
