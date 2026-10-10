import { describe, expect, it } from "vitest";
import {
  DisplayRecommendInfo,
  findTypeFallbackAgent,
  isProjectExpertRestricted,
  isRecommendSelectable,
} from "@/types/interfaces/displayRecommend.uts";

function recommend(functionType: string, targetId: number): DisplayRecommendInfo {
  const item = new DisplayRecommendInfo();
  item.functionType = functionType;
  item.targetId = targetId;
  return item;
}

describe("pinned project agent policy", () => {
  it("regular projects exclude five development types and allow other types", () => {
    for (const type of ["AgentDev", "PageAppDev", "PluginDev", "SkillDev", "UserAppDev"]) {
      expect(isRecommendSelectable(type, "NormalProject")).toBe(false);
    }
    for (const type of ["Chat", "NormalProjectDev", "", "custom"]) {
      expect(isRecommendSelectable(type, "NormalProject")).toBe(true);
    }
    expect(isProjectExpertRestricted("NormalProject")).toBe(false);
    expect(findTypeFallbackAgent([recommend("NormalProjectDev", 17)], "NormalProject")).toBeNull();
  });

  it("full-stack projects still require UserAppDev and restrict expert selection", () => {
    expect(isRecommendSelectable("UserAppDev", "UserApp")).toBe(true);
    expect(isRecommendSelectable("Chat", "UserApp")).toBe(false);
    expect(isRecommendSelectable("NormalProjectDev", "UserApp")).toBe(false);
    expect(isProjectExpertRestricted("UserApp")).toBe(true);
    expect(findTypeFallbackAgent([recommend("UserAppDev", 19)], "UserApp")?.targetId).toBe(19);
  });

  it("without a pinned project every recommendation remains selectable", () => {
    expect(isRecommendSelectable("AgentDev", "")).toBe(true);
    expect(isProjectExpertRestricted("")).toBe(false);
  });
});
