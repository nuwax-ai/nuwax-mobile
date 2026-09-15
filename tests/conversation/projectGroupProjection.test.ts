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
