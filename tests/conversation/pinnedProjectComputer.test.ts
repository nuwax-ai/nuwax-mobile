import { describe, expect, it } from "vitest";
import {
  PinnedProjectInfo,
  resolvePersonalWorkspacePath,
  resolvePinnedConversationSandboxId,
} from "@/types/interfaces/displayRecommend.uts";

function pinned(projectType: string, sandboxId: number): PinnedProjectInfo {
  const project = new PinnedProjectInfo();
  project.projectType = projectType;
  project.sandboxId = sandboxId;
  return project;
}

describe("pinned project conversation computer", () => {
  it("uses the current cloud or personal computer for an existing regular project", () => {
    const project = pinned("NormalProject", 307);
    expect(resolvePinnedConversationSandboxId(project, "-1")).toBe("-1");
    expect(resolvePinnedConversationSandboxId(project, "308")).toBe("308");
    expect(resolvePersonalWorkspacePath("308", "/work/new")).toBe("/work/new");
    expect(resolvePersonalWorkspacePath("-1", "/work/new")).toBe("");
  });

  it("keeps a non-regular project's bound computer", () => {
    expect(resolvePinnedConversationSandboxId(pinned("UserApp", 307), "-1")).toBe("307");
  });
});
