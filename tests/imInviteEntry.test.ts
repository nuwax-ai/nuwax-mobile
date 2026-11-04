import { describe, expect, it } from "vitest";
import { imInviteReturnPath, planImInvite } from "../utils/imInviteEntry.uts";

describe("IM 承接页参数", () => {
  it("spaceId 只进入 enter，不生成聊天页地址", () => {
    const plan = planImInvite("?spaceId=9007199254740993");
    expect(plan.action).toBe("enter");
    expect(plan.value).toBe("9007199254740993");
    expect(JSON.stringify(plan)).not.toContain("/pages/message/chat");
  });

  it("多个参数时 convId 优先于 spaceId", () => {
    const plan = planImInvite("?spaceId=1140&convId=00088");
    expect(plan.action).toBe("detail");
    expect(plan.value).toBe("88");
  });

  it("invite 覆盖 groupNo，群号去掉短横线后预填加群页", () => {
    const both = planImInvite("?invite=1790-762262&groupNo=1111");
    expect(both.action).toBe("join");
    expect(both.value).toBe("1790762262");
    const onlyGroup = planImInvite("?groupNo=1790762262");
    expect(onlyGroup.action).toBe("join");
    expect(onlyGroup.value).toBe("1790762262");
  });

  it("userId 与 agentId 走不同动作，避免把智能体 id 当真人", () => {
    expect(planImInvite("?userId=42").action).toBe("p2p");
    expect(planImInvite("?agentId=42").action).toBe("agent");
  });

  it("第一个参数不合法时不改走后面的 spaceId", () => {
    expect(planImInvite("?convId=abc&spaceId=1140").action).toBe("invalid");
    expect(planImInvite("").action).toBe("empty");
  });

  it("回跳地址保留原始 query", () => {
    expect(imInviteReturnPath("?spaceId=1140")).toBe(
      "/subpackages/pages/im-invite/im-invite?spaceId=1140",
    );
  });
});


describe("与 PC 群号及双目标的边界", () => {
  it.each(["1", "001", "1790+762262", "1790%20762262", "1790-762262", "1790%E3%80%80762262"])("接受合法群号 %s", (value) => {
    expect(planImInvite("?invite=" + value).action).toBe("join");
  });
  it.each(["12345678901234567890", "1790%2B762262", "abc", "", "%ZZ"])("拒绝非法群号 %s", (value) => {
    expect(planImInvite("?groupNo=" + value).action).toBe("invalid");
  });
  it.each(["convId", "userId", "agentId", "spaceId"])("invite+%s 不静默丢一个目标", (key) => {
    expect(planImInvite("?invite=001&" + key + "=42").action).toBe("unsupported");
  });
  it("direct 参数优先级及 hash 片段与原编码保持分离", () => {
    expect(planImInvite("?userId=00042&agentId=77&groupNo=123&spaceId=9")).toMatchObject({ action: "p2p", value: "42" });
    expect(planImInvite("?groupNo=001&spaceId=9")).toMatchObject({ action: "join", value: "001" });
    expect(planImInvite("?convId=7#pane")).toMatchObject({ action: "detail", value: "7" });
    expect(planImInvite("?convId=7%23pane").action).toBe("invalid");
  });
  it("PC 锚点元数据不参与业务参数判定", () => {
    expect(planImInvite("?convId=9007199254740993&__imEntryHash=%23pane")).toMatchObject({
      action: "detail", value: "9007199254740993",
    });
    expect(planImInvite("?convId=7%23pane&__imEntryHash=%23other").action).toBe("invalid");
    expect(planImInvite("?__imEntryHash=%23pane").action).toBe("empty");
  });
});
