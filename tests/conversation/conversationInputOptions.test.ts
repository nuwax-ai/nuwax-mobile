import { describe, expect, it } from "vitest";
import {
  conversationModelMatchesAgentType,
  resolveConversationModelScope,
  resolveConversationModelId,
  resolveHomeComputerId,
  resolveBoundConversationComputerId,
  resolveBoundComputerUnavailableKey,
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

describe("conversation computer availability", () => {
  it("restores the historical personal computer even when the agent defaults to cloud", () => {
    const id = resolveBoundConversationComputerId("366", "-1");
    expect(id).toBe("366");
    expect(resolveBoundComputerUnavailableKey(id, ["-1"])).toBe("Mobile.Sandbox.personalUnavailable");
  });

  it("keeps the historical computer instead of the agent's newer binding", () => {
    expect(resolveBoundConversationComputerId("366", "377")).toBe("366");
    expect(resolveBoundConversationComputerId("-1", "377")).toBe("-1");
  });

  it("uses a real agent binding when the conversation has no computer", () => {
    expect(resolveBoundConversationComputerId("", "377")).toBe("377");
    expect(resolveBoundConversationComputerId("", "personal-sandbox")).toBe("personal-sandbox");
    expect(resolveBoundConversationComputerId("", "-1")).toBe("");
    expect(resolveBoundConversationComputerId("", "0")).toBe("");
    expect(resolveBoundConversationComputerId("", "")).toBe("");
  });

  it("shows personal computer unavailable even when the entire list is empty", () => {
    expect(resolveBoundComputerUnavailableKey("366", [])).toBe("Mobile.Sandbox.personalUnavailable");
    expect(resolveBoundComputerUnavailableKey("personal-sandbox", [])).toBe("Mobile.Sandbox.personalUnavailable");
  });

  it("distinguishes a missing cloud computer from a missing personal computer", () => {
    expect(resolveBoundComputerUnavailableKey("-1", [])).toBe("Mobile.Sandbox.unavailable");
    expect(resolveBoundComputerUnavailableKey("366", ["-1", "366"])).toBe("");
    expect(resolveBoundComputerUnavailableKey("-1", ["-1"])).toBe("");
  });
});
