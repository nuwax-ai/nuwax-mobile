import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import { PinnedProjectInfo } from "@/types/interfaces/displayRecommend.uts";
import { mapProjectTabResponse, projectKeyOf } from "@/utils/projectGroupProjection.uts";

// 执行真实抽屉处理函数；网络、弹窗和页面通知由 mock 隔离，避免改动现有项目。
const source = readFileSync(
  new URL("../../components/project-task-drawer/project-task-drawer.uvue", import.meta.url), "utf8",
);
const functionNames = [
  "findProjectGroup", "toggleProjectExpand", "handleAddConversation",
  "handleProjectPinTap", "handleProjectChildClick", "performProjectDeleteSubmit",
];
const code = transformSync(functionNames.map((name) => {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf("\n  }\n", start);
  if (start < 0 || end < start) throw new Error(`抽屉处理函数未找到：${name}`);
  return source.slice(start, end + 5);
}).join("\n") + `\n({${functionNames.join(",")}});`, { loader: "ts" }).code;

function setup() {
  const groups = mapProjectTabResponse({ records: [
    { projectId: 3, projectType: "UserApp", name: "测试网站应用1", sandboxId: 301,
      conversations: [{ id: 101, agentId: 10, devTargetType: "UserApp", devTargetId: 3, topic: "网站会话" }] },
    { projectId: 3, projectType: "NormalProject", name: "测试常规1", sandboxId: 417,
      conversations: [{ id: 102, agentId: 1596, devTargetType: "NormalProject", devTargetId: 3, topic: "常规会话" }] },
  ] }, value => value);
  const context = {
    projectGroupsData: groups,
    projectVersion: { value: 0 },
    projectKeyOf,
    PinnedProjectInfo,
    UTSJSONObject: class { constructor() {} },
    close: vi.fn(),
    emit: vi.fn(),
    performProjectPinToggle: vi.fn(),
    apiUserAppDelete: vi.fn().mockResolvedValue({ code: "0000" }),
    apiUserProjectDelete: vi.fn().mockResolvedValue({ code: "0000" }),
    apiResCode: (res: { code: string }) => res.code,
    apiResMessage: () => "",
    SUCCESS_CODE: "0000",
    clearProjectFlags: vi.fn(),
    uni: { showToast: vi.fn() },
    t: (key: string) => key,
  };
  const handlers = runInNewContext(code, context);
  return { context, groups, handlers };
}

describe("同号项目的抽屉操作定位", () => {
  it("按复合键查到各自的项目", () => {
    const { groups, handlers } = setup();
    expect(handlers.findProjectGroup("UserApp:3")).toBe(groups[0]);
    expect(handlers.findProjectGroup("NormalProject:3")).toBe(groups[1]);
  });

  it("折叠常规项目不会改变同号网站应用的展开状态", () => {
    const { groups, handlers } = setup();
    handlers.toggleProjectExpand("NormalProject:3");
    expect(groups.map(group => group.expanded)).toEqual([true, false]);
    handlers.toggleProjectExpand("UserApp:3");
    handlers.toggleProjectExpand("NormalProject:3");
    expect(groups.map(group => group.expanded)).toEqual([false, true]);
  });

  it.each(["UserApp", "NormalProject"])("%s 的新建会话绑定自身类型、ID 和电脑", type => {
    const { context, groups, handlers } = setup();
    const group = groups.find(item => item.projectType === type)!;
    handlers.handleAddConversation(`${type}:3`);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(context.emit).toHaveBeenCalledWith("pin-project", expect.objectContaining({
      projectId: 3, projectType: type, name: group.name, sandboxId: group.sandboxId,
    }));
  });

  it.each([
    { type: "UserApp", childId: 101, agentId: 10 },
    { type: "NormalProject", childId: 102, agentId: 1596 },
  ])("点击 $type 子会话跳转自身会话", ({ type, childId, agentId }) => {
    const { context, handlers } = setup();
    handlers.handleProjectChildClick(`${type}:3`, childId);
    expect(context.emit).toHaveBeenCalledWith("conversation-click", expect.objectContaining({
      id: 3, conversationId: childId, agentId, pType: type,
    }));
  });

  it("置顶入口定位到常规项目", () => {
    const { context, groups, handlers } = setup();
    handlers.handleProjectPinTap("NormalProject:3");
    expect(context.performProjectPinToggle.mock.calls[0][0]).toBe(groups[1]);
  });

  it.each(["UserApp", "NormalProject"])("删除 %s 只移除自身，保留同号另一类型及其旧标记", async type => {
    const { context, groups, handlers } = setup();
    const group = groups.find(item => item.projectType === type)!;
    await handlers.performProjectDeleteSubmit(group);
    const expectedApi = type === "UserApp" ? context.apiUserAppDelete : context.apiUserProjectDelete;
    const otherApi = type === "UserApp" ? context.apiUserProjectDelete : context.apiUserAppDelete;
    expect(expectedApi).toHaveBeenCalledWith(3);
    expect(otherApi).not.toHaveBeenCalled();
    expect(context.projectGroupsData).toEqual(groups.filter(item => item !== group));
    expect(context.clearProjectFlags).not.toHaveBeenCalled();
  });

  it("删除最后一个同号项目后仍清理旧本地标记", async () => {
    const { context, groups, handlers } = setup();
    context.projectGroupsData = [groups[1]];
    await handlers.performProjectDeleteSubmit(groups[1]);
    expect(context.projectGroupsData).toEqual([]);
    expect(context.clearProjectFlags).toHaveBeenCalledWith(3);
  });
});
