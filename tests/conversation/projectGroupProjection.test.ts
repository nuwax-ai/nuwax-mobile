/**
 * 项目列表接口响应 → 分组视图映射 单元测试。
 * 覆盖：正常映射（projectId 主键/类型/子会话随行回包 conversations）、records 缺失容错、
 * 空数组、conversations 缺失、id/agentId 字符串归一、空主题兜底、类型标签 key 映射。
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
  it.each([
    { workspacePath: "/work/project", agentWorkspacePath: "/agent/project", fileWorkspacePath: "/files/project", expected: "/work/project" },
    { workspacePath: null, agentWorkspacePath: "/agent/project", fileWorkspacePath: "/files/project", expected: "/agent/project" },
    { fileWorkspacePath: "/files/project", expected: "/files/project" },
    { agentWorkspacePath: null, fileWorkspacePath: null, expected: "" },
  ])("保留项目电脑类型与工作目录：$expected", ({ expected, ...paths }) => {
    const groups = mapProjectTabResponse(makeResponse([
      { projectId: 509, projectType: "NormalProject", sandboxId: 417, sandboxType: "Personal", ...paths },
    ]), identityFormat);
    expect(groups[0].sandboxId).toBe(417);
    expect(groups[0].sandboxType).toBe("Personal");
    expect(groups[0].workspacePath).toBe(expected);
  });

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
    expect(groups[0].key).toBe("UserApp:1");
    expect(groups[0].name).toBe("全栈项目A");
    expect(groups[0].expanded).toBe(true);
    // 标记字段回读打标（2026-09-13 服务端化）：有值读值、缺省 false
    expect(groups[0].pinned).toBe(true);
    expect(groups[0].collected).toBe(true);
    expect(groups[0].archived).toBe(false);
    expect(groups[1].archived).toBe(true);
    expect(groups[1].key).toBe("NormalProject:2");
    expect(groups[1].pinned).toBe(false);
  });

  it("2026-09-21 完整接口：列表行自带 conversations 直接映射子会话 + 空主题兜底", () => {
    const groups = mapProjectTabResponse(
      makeResponse([
        {
          projectId: 1,
          projectType: "NormalProject",
          name: "常规项目B",
          conversations: [
            { id: 11, agentId: 5, topic: "会话A", modified: "2026-09-08 15:40:00", taskStatus: "EXECUTING" },
            { id: 12, agentId: 6, topic: "" },
          ],
        },
      ]),
      identityFormat,
      "未命名会话",
    );
    expect(groups.length).toBe(1);
    expect(groups[0].children.length).toBe(2);
    expect(groups[0].children[0].id).toBe(11);
    expect(groups[0].children[0].agentId).toBe(5);
    expect(groups[0].children[0].name).toBe("会话A");
    expect(groups[0].children[0].taskStatus).toBe("EXECUTING");
    expect(groups[0].children[0].timeLabel).toBe("[2026-09-08 15:40:00]");
    // 空主题回退兜底文案（与任务列表「未命名会话」口径一致）
    expect(groups[0].children[1].name).toBe("未命名会话");
  });

  it("conversations 字段缺失时 children 为空数组（展示「暂无会话」）", () => {
    const groups = mapProjectTabResponse(
      makeResponse([{ projectId: 1, projectType: "NormalProject", name: "无会话项目" }]),
      identityFormat,
      "未命名会话",
    );
    expect(groups.length).toBe(1);
    expect(groups[0].children.length).toBe(0);
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
    expect(groups[0].children.length).toBe(1);
    expect(groups[0].children[0].id).toBe(21);
    expect(groups[0].children[0].agentId).toBe(7);
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

describe("mapProjectChildren（列表行 conversations 映射）", () => {
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

  it("同一页的网站应用 3 和测试常规 3 都保留，仅同类型同 ID 去重", () => {
    const groups = mapProjectTabResponse(makeResponse([
      { projectId: 3, projectType: "UserApp", name: "测试网站应用1" },
      { projectId: 3, projectType: "NormalProject", name: "测试常规1" },
      { projectId: 3, projectType: "NormalProject", name: "重复回包" },
    ]), identityFormat);
    const merged = appendProjectGroupsDedup([], groups);
    expect(merged.map((group) => group.name)).toEqual(["测试网站应用1", "测试常规1"]);
  });

  it("分页追加时同号的另一类项目保留，重复项目不覆盖已加载数据", () => {
    const first = mapProjectTabResponse(makeResponse([
      { projectId: 3, projectType: "UserApp", name: "测试网站应用1" },
    ]), identityFormat);
    const next = mapProjectTabResponse(makeResponse([
      { projectId: 3, projectType: "NormalProject", name: "测试常规1" },
      { projectId: 3, projectType: "UserApp", name: "重复回包" },
    ]), identityFormat);
    expect(appendProjectGroupsDedup(first, next).map((group) => group.name))
      .toEqual(["测试网站应用1", "测试常规1"]);
  });

  it("reconcileProjectGroups：服务端字段/顺序/子会话以回包为准，仅保留展开态", () => {
    const current = new ProjectGroupView();
    current.id = 1;
    current.name = "旧名称";
    current.expanded = false;
    const staleChild = new ProjectChildView();
    staleChild.id = 11;
    current.children = [staleChild];

    const removed = new ProjectGroupView();
    removed.id = 2;

    const fresh = new ProjectGroupView();
    fresh.id = 1;
    fresh.name = "新名称";
    fresh.pinned = true;
    const freshChild = new ProjectChildView();
    freshChild.id = 99;
    fresh.children = [freshChild];

    const added = new ProjectGroupView();
    added.id = 3;
    added.name = "新增";

    const result = reconcileProjectGroups([current, removed], [added, fresh]);
    expect(result.map((item) => item.id)).toEqual([3, 1]);
    expect(result.find((item) => item.id === 2)).toBeUndefined();
    expect(result[1].name).toBe("新名称");
    expect(result[1].pinned).toBe(true);
    // 展开态保留（不整屏回弹）；子会话以服务端回包为准（不沿用本地旧数据）；
    // 静默刷新新发现项目默认收起（防用户浏览中内容整屏推移）
    expect(result[1].expanded).toBe(false);
    expect(result[1].children.length).toBe(1);
    expect(result[1].children[0].id).toBe(99);
    expect(result[0].expanded).toBe(false);
  });

  it("刷新同号项目时分别保留各自的展开状态", () => {
    const current = mapProjectTabResponse(makeResponse([
      { projectId: 3, projectType: "UserApp", name: "网站应用" },
      { projectId: 3, projectType: "NormalProject", name: "常规项目" },
    ]), identityFormat);
    current[0].expanded = false;
    current[1].expanded = true;
    const fresh = mapProjectTabResponse(makeResponse([
      { projectId: 3, projectType: "NormalProject", name: "常规项目新名称" },
      { projectId: 3, projectType: "UserApp", name: "网站应用新名称" },
    ]), identityFormat);
    const result = reconcileProjectGroups(current, fresh);
    expect(result.map((group) => group.expanded)).toEqual([true, false]);
    expect(result.map((group) => group.name)).toEqual(["常规项目新名称", "网站应用新名称"]);
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
    group.projectType = "NormalProject";
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
    expect(rows[0].key).toBe("p-NormalProject:1");
    expect(rows[0].groupEnd).toBe(true);
    expect(rows[1].groupEnd).toBe(true);
  });

  it("展开项目 → 项目行 + 子会话行序，末子行 groupEnd；保持输入顺序", () => {
    const a = makeGroup(1, true);
    a.children = [makeChild(11, "A1"), makeChild(12, "A2")];
    const b = makeGroup(2, false);
    const rows = flattenProjectRows([a, b]);
    expect(rows.map((r) => r.kind)).toEqual([
      PROJECT_FLAT_KIND_GROUP,
      PROJECT_FLAT_KIND_CHILD,
      PROJECT_FLAT_KIND_CHILD,
      PROJECT_FLAT_KIND_GROUP,
    ]);
    expect(rows.map((r) => r.key)).toEqual(["p-NormalProject:1", "c-NormalProject:1-11", "c-NormalProject:1-12", "p-NormalProject:2"]);
    expect(rows[2].groupEnd).toBe(true);
    expect(rows[3].groupEnd).toBe(true);
    expect(rows[1].groupId).toBe(1);
    expect(rows[1].childId).toBe(11);
    expect(rows[1].child.name).toBe("A1");
  });

  it("展开且无会话 → 项目行 + 空态行，键带组前缀", () => {
    const empty = makeGroup(3, true);
    const rows = flattenProjectRows([empty]);
    expect(rows.length).toBe(2);
    expect(rows[0].kind).toBe(PROJECT_FLAT_KIND_GROUP);
    expect(rows[1].kind).toBe(PROJECT_FLAT_KIND_EMPTY);
    expect(rows[1].key).toBe("n-NormalProject:3");
    expect(rows[1].groupEnd).toBe(true);
  });

  it("子会话 id 与其他项目 id 撞车时复合键仍唯一", () => {
    const a = makeGroup(7, false);
    const b = makeGroup(8, true);
    b.children = [makeChild(7, "与项目 7 同号")];
    const rows = flattenProjectRows([a, b]);
    expect(rows.map((r) => r.key)).toEqual(["p-NormalProject:7", "p-NormalProject:8", "c-NormalProject:8-7"]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(3);
  });

  it("跨类型同号项目及其同号子项均生成不同的列表 key", () => {
    const app = makeGroup(3, true);
    app.projectType = "UserApp";
    app.children = [makeChild(11, "网站会话")];
    const normal = makeGroup(3, true);
    normal.children = [makeChild(11, "常规会话")];
    const rows = flattenProjectRows([app, normal]);
    expect(rows.map((row) => row.key)).toEqual([
      "p-UserApp:3", "c-UserApp:3-11", "p-NormalProject:3", "c-NormalProject:3-11",
    ]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(4);
  });
});
