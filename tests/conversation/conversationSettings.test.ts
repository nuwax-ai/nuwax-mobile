import { describe, expect, it } from "vitest";
import { hasMissingConversationSettings } from "@/subpackages/utils/conversationSettings.uts";

describe("智能体会话必填参数", () => {
  const fields = [
    { name: "age", require: true },
    { name: "city", require: true },
    { name: "system", require: true, systemVariable: true },
    { name: "name", require: false },
  ];

  it("缺值、空白及未选中的下拉项均拦截，数字零有效", () => {
    expect(hasMissingConversationSettings(fields, null)).toBe(true);
    expect(hasMissingConversationSettings(fields, { age: 0, city: " " })).toBe(true);
    expect(hasMissingConversationSettings(fields, { age: 0, city: [] })).toBe(true);
    expect(hasMissingConversationSettings(fields, { age: 0, city: ["成都"] })).toBe(false);
    expect(hasMissingConversationSettings([], null)).toBe(false);
  });
});
