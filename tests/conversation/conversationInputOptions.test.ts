import { describe, expect, it } from "vitest";
import {
  conversationModelMatchesAgentType,
  resolveConversationModelScope,
  resolveConversationModelId,
  resolveHomeComputerId,
} from "@/components/conversation-input/conversationInputOptions.uts";

describe("conversation input model selection", () => {
  it("matches the PC scope, space type, and legacy fallback rules", () => {
    expect(resolveConversationModelScope("Tenant", "", 10)).toBe("system");
    expect(resolveConversationModelScope("Space", "Personal", 10)).toBe("personal");
    expect(resolveConversationModelScope("Space", "Team", 10)).toBe("team");
    expect(resolveConversationModelScope("Space", "", 10)).toBe("personal");
    expect(resolveConversationModelScope("", "", -1)).toBe("system");
    expect(resolveConversationModelScope("", "", 10)).toBe("personal");
  });

  it("filters usage scenarios only when restrictions exist", () => {
    expect(conversationModelMatchesAgentType([], "ChatBot")).toBe(true);
    expect(conversationModelMatchesAgentType(["ChatBot"], "ChatBot")).toBe(true);
    expect(conversationModelMatchesAgentType(["TaskAgent"], "ChatBot")).toBe(false);
  });

  it("keeps current selection before preferred and first fallback", () => {
    expect(resolveConversationModelId(2, 3, [1, 2, 3])).toBe(2);
    expect(resolveConversationModelId(9, 3, [1, 2, 3])).toBe(3);
    expect(resolveConversationModelId(9, 8, [1, 2, 3])).toBe(1);
  });

  it("selects the remembered computer before cloud and first fallback", () => {
    expect(resolveHomeComputerId("307", ["-1", "307"])).toBe("307");
    expect(resolveHomeComputerId("999", ["-1", "307"])).toBe("-1");
    expect(resolveHomeComputerId("", ["307", "308"])).toBe("307");
    expect(resolveHomeComputerId("", [])).toBe("");
  });
});
