import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import { resolvePersonalWorkspacePath } from "@/types/interfaces/displayRecommend.uts";

const home = readFileSync("pages/index/index-content.uvue", "utf8");
const api = readFileSync("servers/project.uts", "utf8");
const start = home.indexOf("  async function tryCreateProjectFlow(");
const end = home.indexOf("\n  }", start);
const apiStart = api.indexOf("export async function apiProjectCreateUnified(");
const apiEnd = api.indexOf("\n}", apiStart);
const code = transformSync(`${api.slice(apiStart, apiEnd + 2).replace("export ", "")}\n${home.slice(start, end + 4)}\ntryCreateProjectFlow;`, { loader: "ts" }).code;

describe("首页项目创建的容器参数", () => {
  it.each([
    { visible: false, id: "403", sandboxId: undefined, path: undefined },
    { visible: true, id: "-1", sandboxId: -1, path: undefined },
    { visible: true, id: "403", sandboxId: 403, path: "/work/selected" },
    { visible: true, id: "sb-a1b2", sandboxId: "sb-a1b2", path: "/work/selected" },
    { visible: true, id: "403-extra", sandboxId: "403-extra", path: "/work/selected" },
  ])("visible=$visible computer=$id", async ({ visible, id, sandboxId, path }) => {
    const request = vi.fn().mockResolvedValue({ code: "FAILED" });
    const create = runInNewContext(code, {
      request, UTSJSONObject: class {}, pinnedProject: { value: null },
      selectedRecommend: { value: { functionType: "NormalProjectDev" } },
      getProjectTypeByFunctionType: () => "NormalProject", projectCreating: { value: false },
      currentComputerId: { value: "old-computer" }, showHomeComputerSelector: { value: visible },
      workspacePath: { value: "/work/selected" }, selectedSpaceId: { value: 1 },
      strOf: (v: unknown) => v == null ? "" : String(v), resolvePersonalWorkspacePath,
      apiResData: () => null, apiResCode: (v: any) => v.code, apiResMessage: () => "", SUCCESS_CODE: "0000",
      failProjectCreate: vi.fn(), console,
    });
    await create(7, "创建项目", [], { sandboxId: id });
    const body = request.mock.calls[0][0].data;
    expect({ ...body }).toEqual({
      spaceId: 1, targetType: "NormalProject", devAgentId: 7,
      ...(sandboxId !== undefined ? { sandboxId } : {}),
      ...(path ? { workspacePath: path } : {}),
    });
  });
});
