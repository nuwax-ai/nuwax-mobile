/**
 * 项目 tab 接口响应 → 分组视图映射 单元测试。
 * 覆盖：正常映射（projectId 主键/类型/子会话字段）、records 缺失容错、
 * 空数组、conversations 缺失、id/agentId 字符串归一、类型标签 key 映射。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  mapProjectTabResponse,
  mapProjectChildren,
  projectTypeLabelKey,
  ProjectChildView,
  ProjectGroupView,
  computeProjectHasMore,
  needsProjectChase,
  appendProjectGroupsDedup,
  reconcileProjectGroups,
  mapProjectTotalPages,
  mapProjectTotalCount,
  remainingProjectCount,
  flattenProjectRows,
  PROJECT_FLAT_KIND_GROUP,
  PROJECT_FLAT_KIND_CHILD,
  PROJECT_FLAT_KIND_LOADING,
  PROJECT_FLAT_KIND_ERROR,
  PROJECT_FLAT_KIND_EMPTY,
} from "@/utils/projectGroupProjection.uts";

/** 恒等 formatter：仅验证 modified 被传入，时间文案内容不在本测试范围 */
const identityFormat = (s: string): string => `[${s}]`;

beforeEach(() => {
  // projectGroupProjection 不依赖 uni，但保持与其他用例一致的隔离习惯
  (globalThis as Record<string, unknown>).uni = {};
});

function makeResponse(records: unknown[]): unknown {
  return { records, total: records.length, current: 1, size: 100 };
}

describe("mapProjectTabResponse", () => {
  it("映射项目行：projectId 主键、projectType、name、服务端标记字段", () => {
    const groups = mapProjectTabResponse(
      makeResponse([
        {
          projectId: 1,
          projectType: "UserApp",
          name: "全栈项目A",
          modified: "2026-09-01 10:00:00",
          pinned: true,
          collected: true,
        },
        {
          projectId: 2,
          projectType: "NormalProject",
          name: "常规项目B",
          archived: true,
        },
      ]),
      identityFormat,
    );
    expect(groups.length).toBe(2);
    expect(groups[0].id).toBe(1);
    expect(groups[0].projectType).toBe("UserApp");
    expect(groups[0].name).toBe("全栈项目A");
    expect(groups[0].expanded).toBe(true);
    // 标记字段回读打标（2026-09-13 服务端化）：有值读值、缺省 false
    expect(groups[0].pinned).toBe(true);
    expect(groups[0].collected).toBe(true);
    expect(groups[0].archived).toBe(false);
    expect(groups[1].archived).toBe(true);
    expect(groups[1].pinned).toBe(false);
  });

  it("2026-09-14 统一接口：列表行不再回 conversations，children 空、childrenLoaded=false", () => {
    const groups = mapProjectTabResponse(
      makeResponse([
        {
          projectId: 1,
          projectType: "NormalProject",
          name: "常规项目B",
          conversations: [{ id: 11, topic: "旧字段已下线" }], // 防御：即使回包仍带也忽略
        },
      ]),
      identityFormat,
    );
    expect(groups.length).toBe(1);
    expect(groups[0].children.length).toBe(0);
    expect(groups[0].childrenLoaded).toBe(false);
  });

  it("id/agentId 为字符串时归一为数字", () => {
    const groups = mapProjectTabResponse(
      makeResponse([
        {
          projectId: "3",
          name: "C",
          conversations: [{ id: "21", agentId: "7", topic: "t", modified: "" }],
        },
      ]),
      identityFormat,
    );
    expect(groups[0].id).toBe(3);
    expect(groups[0].children.length).toBe(0);
  });

  it("records 缺失或 data 为空时返回空数组", () => {
    expect(mapProjectTabResponse(null, identityFormat).length).toBe(0);
    expect(mapProjectTabResponse({}, identityFormat).length).toBe(0);
    expect(mapProjectTabResponse({ records: [] }, identityFormat).length).toBe(0);
  });

  it("records 内 null 项被跳过", () => {
    const groups = mapProjectTabResponse(
      makeResponse([null, { projectId: 1, name: "D" }]),
      identityFormat,
    );
    expect(groups.length).toBe(1);
  });
});

describe("mapProjectChildren（子会话懒加载）", () => {
  it("数组直入：id/agentId/topic/taskStatus/时间走 formatter", () => {
    const children = mapProjectChildren(
      [
        {
          id: 11,
          agentId: 5,
          topic: "会话渲染 V2 重构",
          taskStatus: "EXECUTING",
          modified: "2026-09-08 15:40:00",
        },
      ],
      identityFormat,
    );
    expect(children.length).toBe(1);
    expect(children[0].id).toBe(11);
    expect(children[0].agentId).toBe(5);
    expect(children[0].name).toBe("会话渲染 V2 重构");
    expect(children[0].taskStatus).toBe("EXECUTING");
    expect(children[0].timeLabel).toBe("[2026-09-08 15:40:00]");
  });

  it("非数组对象与空入参返回空；modified 缺失 timeLabel 为空", () => {
    expect(mapProjectChildren({ unexpected: 1 }, identityFormat).length).toBe(0);
    expect(mapProjectChildren(null, identityFormat).length).toBe(0);
    const children = mapProjectChildren([{ id: 9, topic: "x" }], identityFormat);
    expect(children[0].timeLabel).toBe("");
  });
});

describe("projectTypeLabelKey", () => {
  it("三类类型映射到对应 i18n key，未知类型返回空串", () => {
    expect(projectTypeLabelKey("NormalProject")).toBe("Mobile.Project.typeNormal");
    expect(projectTypeLabelKey("PageApp")).toBe("Mobile.Project.typePageApp");
    expect(projectTypeLabelKey("UserApp")).toBe("Mobile.Project.typeUserApp");
    expect(projectTypeLabelKey("")).toBe("");
    expect(projectTypeLabelKey("Agent")).toBe("");
  });
});

describe("项目列表分页（对齐 PC projectHistoryRows 口径）", () => {
  it("computeProjectHasMore：pages 回读优先，未回读退满页判定", () => {
    // 回读 3 页拉完 2 页 → 还有
    expect(computeProjectHasMore(2, 3, 20, 20)).toBe(true);
    // 回读 3 页拉完 3 页 → 没有
    expect(computeProjectHasMore(3, 3, 20, 20)).toBe(false);
    // 未回读（pages=0）：满页视为还有
    expect(computeProjectHasMore(1, 0, 20, 20)).toBe(true);
    // 未回读：不满页 → 没有
    expect(computeProjectHasMore(2, 0, 7, 20)).toBe(false);
  });

  it("needsProjectChase：可见行够量即停，不足且还有更多才追拉", () => {
    // 可见 12 ≥ 10 → 不追
    expect(needsProjectChase(12, 10, 1, 3, 20, 20)).toBe(false);
    // 可见 4 < 10 且还有 → 追
    expect(needsProjectChase(4, 10, 1, 3, 20, 20)).toBe(true);
    // 可见不足但已到最后一页 → 不追
    expect(needsProjectChase(4, 10, 3, 3, 20, 20)).toBe(false);
    // 可见不足、未回读 pages 但上页不满 → 不追
    expect(needsProjectChase(4, 10, 1, 0, 8, 20)).toBe(false);
  });

  it("appendProjectGroupsDedup：同 id 保留先到，不同 id 全追加", () => {
    const a = new ProjectGroupView();
    a.id = 1;
    a.name = "first";
    const b = new ProjectGroupView();
    b.id = 2;
    const dup = new ProjectGroupView();
    dup.id = 1;
    dup.name = "later";
    const merged = appendProjectGroupsDedup([a, b], [dup]);
    expect(merged.length).toBe(2);
    expect(merged[0].name).toBe("first");
    const c = new ProjectGroupView();
    c.id = 3;
    expect(appendProjectGroupsDedup([a], [c]).length).toBe(2);
  });

  it("reconcileProjectGroups：服务端字段和顺序更新，同时保留展开态与已加载子会话", () => {
    const current = new ProjectGroupView();
    current.id = 1;
    current.name = "旧名称";
    current.expanded = false;
    current.childrenLoaded = true;
    const child = new ProjectChildView();
    child.id = 11;
    current.children = [child];

    const removed = new ProjectGroupView();
    removed.id = 2;

    const fresh = new ProjectGroupView();
    fresh.id = 1;
    fresh.name = "新名称";
    fresh.pinned = true;

    const added = new ProjectGroupView();
    added.id = 3;
    added.name = "新增";

    const result = reconcileProjectGroups([current, removed], [added, fresh]);
    expect(result.map((item) => item.id)).toEqual([3, 1]);
    expect(result.find((item) => item.id === 2)).toBeUndefined();
    expect(result[1].name).toBe("新名称");
    expect(result[1].pinned).toBe(true);
    expect(result[1].expanded).toBe(false);
    expect(result[1].childrenLoaded).toBe(true);
    expect(result[1].children[0].id).toBe(11);
  });

  it("reconcileProjectGroups：保留子会话懒加载中/失败态（静默刷新不重置三态）", () => {
    const loadingGroup = new ProjectGroupView();
    loadingGroup.id = 1;
    loadingGroup.childrenLoading = true;

    const errorGroup = new ProjectGroupView();
    errorGroup.id = 2;
    errorGroup.childrenError = true;

    const fresh1 = new ProjectGroupView();
    fresh1.id = 1;
    const fresh2 = new ProjectGroupView();
    fresh2.id = 2;

    const result = reconcileProjectGroups([loadingGroup, errorGroup], [fresh1, fresh2]);
    expect(result[0].childrenLoading).toBe(true);
    expect(result[0].childrenError).toBe(false);
    expect(result[1].childrenLoading).toBe(false);
    expect(result[1].childrenError).toBe(true);
  });

  it("mapProjectTotalPages：回读 pages 数值，缺失/非数回 0", () => {
    expect(mapProjectTotalPages({ records: [], pages: 3 })).toBe(3);
    expect(mapProjectTotalPages({ records: [], pages: "5" })).toBe(5);
    expect(mapProjectTotalPages({ records: [] })).toBe(0);
    expect(mapProjectTotalPages(null)).toBe(0);
  });

  it("mapProjectTotalCount：回读 total 数值，缺失/非数回 0", () => {
    expect(mapProjectTotalCount({ records: [], total: 57 })).toBe(57);
    expect(mapProjectTotalCount({ records: [], total: "42" })).toBe(42);
    expect(mapProjectTotalCount({ records: [] })).toBe(0);
    expect(mapProjectTotalCount(null)).toBe(0);
  });

  it("remainingProjectCount：total - 已加载可见行，未回读/超发钳 0（对齐 PC remainingProjects）", () => {
    expect(remainingProjectCount(57, 20)).toBe(37);
    expect(remainingProjectCount(20, 20)).toBe(0);
    expect(remainingProjectCount(15, 20)).toBe(0);
    expect(remainingProjectCount(0, 20)).toBe(0);
  });
});

describe("flattenProjectRows（Android list-view 扁平化）", () => {
  function makeGroup(id: number, expanded: boolean): ProjectGroupView {
    const group = new ProjectGroupView();
    group.id = id;
    group.expanded = expanded;
    return group;
  }

  function makeChild(id: number, name: string): ProjectChildView {
    const child = new ProjectChildView();
    child.id = id;
    child.name = name;
    return child;
  }

  it("收起项目 → 单项目行，groupEnd 补分组间距", () => {
    const rows = flattenProjectRows([makeGroup(1, false), makeGroup(2, false)]);
    expect(rows.length).toBe(2);
    expect(rows[0].kind).toBe(PROJECT_FLAT_KIND_GROUP);
    expect(rows[0].key).toBe("p-1");
    expect(rows[0].groupEnd).toBe(true);
    expect(rows[1].groupEnd).toBe(true);
  });

  it("展开项目 → 项目行 + 子会话行序，末子行 groupEnd；保持输入顺序", () => {
    const a = makeGroup(1, true);
    a.childrenLoaded = true;
    a.children = [makeChild(11, "A1"), makeChild(12, "A2")];
    const b = makeGroup(2, false);
    const rows = flattenProjectRows([a, b]);
    expect(rows.map((r) => r.kind)).toEqual([
      PROJECT_FLAT_KIND_GROUP,
      PROJECT_FLAT_KIND_CHILD,
      PROJECT_FLAT_KIND_CHILD,
      PROJECT_FLAT_KIND_GROUP,
    ]);
    expect(rows.map((r) => r.key)).toEqual(["p-1", "c-1-11", "c-1-12", "p-2"]);
    expect(rows[2].groupEnd).toBe(true);
    expect(rows[3].groupEnd).toBe(true);
    expect(rows[1].groupId).toBe(1);
    expect(rows[1].childId).toBe(11);
    expect(rows[1].child.name).toBe("A1");
  });

  it("三态互斥：loading / error / 空态各出一行，键带组前缀不撞车", () => {
    const loading = makeGroup(1, true);
    loading.childrenLoading = true;
    const error = makeGroup(2, true);
    error.childrenError = true;
    const empty = makeGroup(3, true);
    empty.childrenLoaded = true;
    empty.children = [];
    const rows = flattenProjectRows([loading, error, empty]);
    expect(rows[1].kind).toBe(PROJECT_FLAT_KIND_LOADING);
    expect(rows[1].key).toBe("l-1");
    expect(rows[3].kind).toBe(PROJECT_FLAT_KIND_ERROR);
    expect(rows[3].key).toBe("e-2");
    expect(rows[5].kind).toBe(PROJECT_FLAT_KIND_EMPTY);
    expect(rows[5].key).toBe("n-3");
    expect(rows[1].groupEnd && rows[3].groupEnd && rows[5].groupEnd).toBe(true);
  });

  it("展开但未加载完成且无三态标记（首帧）→ 仅项目行，不猜测子行", () => {
    const fresh = makeGroup(9, true);
    const rows = flattenProjectRows([fresh]);
    expect(rows.length).toBe(1);
    expect(rows[0].kind).toBe(PROJECT_FLAT_KIND_GROUP);
    expect(rows[0].groupEnd).toBe(true);
  });

  it("子会话 id 与其他项目 id 撞车时复合键仍唯一", () => {
    const a = makeGroup(7, false);
    const b = makeGroup(8, true);
    b.childrenLoaded = true;
    b.children = [makeChild(7, "与项目 7 同号")];
    const rows = flattenProjectRows([a, b]);
    expect(rows.map((r) => r.key)).toEqual(["p-7", "p-8", "c-8-7"]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(3);
  });
});
