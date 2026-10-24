import { beforeEach, expect, it } from "vitest";
import { loadUtsClass } from "./runtimeHarness";

type Rec = Record<string, any>;

// 内存 IO（与生产 H5 降级同款形态；注入后生产 uni 路径不可达）
function makeIo() {
  const map = new Map<string, string>();
  return {
    get: (k: string): string | null => (map.has(k) ? (map.get(k) as string) : null),
    set: (k: string, v: string): boolean => {
      map.set(k, v);
      return true;
    },
    remove: (k: string): void => {
      map.delete(k);
    },
    keys: (): string[] => [...map.keys()],
    _map: map,
  };
}

const api = loadUtsClass(
  "utils/im/imMsgDb.uts",
  `({
  configure: configureImMsgDbIo,
  upsert: upsertImMsgDbMessages,
  latest: loadImMsgDbLatest,
  before: loadImMsgDbBefore,
  hasBelow: hasImMsgDbBelow,
  meta: getImMsgDbMeta,
  setHasMore: setImMsgDbHasMore,
  removeMsgs: removeImMsgDbMessages,
  clearBefore: applyImMsgDbClearBefore,
  dropConv: dropImMsgDbConversation,
  clearUser: clearImMsgDbUser,
  clearAll: clearImMsgDbAll,
  applyRevoke: applyImMsgDbRevoke,
  applyEdit: applyImMsgDbEdit,
})`,
  {},
) as any;

let io: ReturnType<typeof makeIo>;
beforeEach(() => {
  io = makeIo();
  api.configure(io);
});

function rec(seq: number, over: Rec = {}): Rec {
  return {
    msgId: `m${seq}`,
    convId: "c1",
    seq,
    clientMsgId: `k${seq}`,
    senderId: "u1",
    msgType: "text",
    body: { text: `t${seq}` },
    ...over,
  };
}
const ids = (rows: Rec[] | null): string[] => (rows ?? []).map((r) => r.msgId);
function batch(from: number, to: number): Rec[] {
  const out: Rec[] = [];
  for (let s = from; s <= to; s++) out.push(rec(s));
  return out;
}

it("upsert 幂等 + 尾页升序读取 + meta 水位", () => {
  expect(api.upsert("U1", "c1", batch(1, 20))).toBe(20);
  expect(api.latest("U1", "c1", 20).map((r: Rec) => r.seq)).toEqual(batch(1, 20).map((r) => r.seq));
  const m = api.meta("U1", "c1");
  expect(m.latestSeq).toBe(20);
  expect(m.oldestSeq).toBe(1);
  expect(m.total).toBe(20);
  // 同批重放：幂等零生效
  expect(api.upsert("U1", "c1", batch(1, 20))).toBe(0);
  expect(api.meta("U1", "c1").total).toBe(20);
});

it("before 分页：seq<beforeSeq 倒取 limit 条后转升序，翻到头返回 null", () => {
  api.upsert("U1", "c1", batch(1, 50));
  expect(api.latest("U1", "c1", 20).map((r: Rec) => r.msgId)).toEqual(ids(batch(31, 50)));
  expect(api.before("U1", "c1", 41, 10).map((r: Rec) => r.msgId)).toEqual(ids(batch(31, 40)));
  expect(api.before("U1", "c1", 21, 50).map((r: Rec) => r.msgId)).toEqual(ids(batch(1, 20)));
  expect(api.before("U1", "c1", 1, 10)).toBeNull();
  // 无本地库 → null（空不当命中）
  expect(api.latest("U1", "nope", 20)).toBeNull();
});

it("超段自动分裂：250 条跨段可整读，键数 > 1", () => {
  api.upsert("U1", "c1", batch(1, 250));
  const segKeys = io.keys().filter((k) => k.includes(".s."));
  expect(segKeys.length).toBeGreaterThan(1);
  expect(api.before("U1", "c1", 251, 250).map((r: Rec) => r.msgId)).toEqual(ids(batch(1, 250)));
  expect(api.meta("U1", "c1").total).toBe(250);
});

it("revision 只增守卫：旧编辑/复活撤回被拒", () => {
  api.upsert("U1", "c1", [rec(5), rec(6)]);
  // 新编辑生效
  expect(api.upsert("U1", "c1", [rec(5, { editTime: 100, body: { text: "v2" } })])).toBe(1);
  expect(api.latest("U1", "c1", 2).find((r: Rec) => r.msgId == "m5").body.text).toBe("v2");
  // 旧编辑不覆盖
  expect(api.upsert("U1", "c1", [rec(5, { editTime: 50, body: { text: "old" } })])).toBe(0);
  expect(api.latest("U1", "c1", 2).find((r: Rec) => r.msgId == "m5").body.text).toBe("v2");
  // 撤回生效且不可被无撤回快照复活
  api.upsert("U1", "c1", [rec(6, { msgStatus: 2, revokeTime: 10, body: null })]);
  api.upsert("U1", "c1", [rec(6)]);
  const m6 = api.latest("U1", "c1", 2).find((r: Rec) => r.msgId == "m6");
  expect(m6.msgStatus).toBe(2);
});

it("clientMsgId 确认替换：旧 msgId 行被原位替换", () => {
  api.upsert("U1", "c1", [rec(10, { clientMsgId: "kc" })]);
  api.upsert("U1", "c1", [rec(10, { msgId: "m10b", clientMsgId: "kc" })]);
  const rows = api.latest("U1", "c1", 5);
  expect(ids(rows)).toEqual(["m10b"]);
  expect(api.meta("U1", "c1").total).toBe(1);
});

it("入库闸门：tmp-/msgStatus<0/seq0/跨会话一律不入库", () => {
  const bad = [
    rec(1, { msgId: "tmp-abc" }),
    rec(2, { msgStatus: -1 }),
    rec(0),
    rec(3, { convId: "other" }),
  ];
  expect(api.upsert("U1", "c1", bad)).toBe(0);
  expect(api.meta("U1", "c1")).toBeNull();
  expect(api.latest("U1", "c1", 10)).toBeNull();
});

it("removeMessages：tail 权威比对删除指定行", () => {
  api.upsert("U1", "c1", batch(1, 20));
  const gone = new Set<string>(["m18", "m20"]);
  expect(api.removeMsgs("U1", "c1", gone)).toBe(2);
  expect(ids(api.latest("U1", "c1", 20))).toEqual(ids(batch(1, 17)).concat(ids(batch(19, 19))));
  expect(api.meta("U1", "c1").total).toBe(18);
  expect(api.removeMsgs("U1", "c1", new Set<string>(["m18"]))).toBe(0);
});

it("applyClearBefore：整段/半段清除、只前进不后退、清光后尾页为 null", () => {
  api.upsert("U1", "c1", batch(1, 100));
  api.clearBefore("U1", "c1", 50);
  // beforeSeq=101：取 seq<101（清掉 ≤50 后剩 51..100）
  expect(ids(api.before("U1", "c1", 101, 100))).toEqual(ids(batch(51, 100)));
  expect(api.before("U1", "c1", 51, 10)).toBeNull();
  expect(ids(api.latest("U1", "c1", 3))).toEqual(ids(batch(98, 100)));
  expect(api.meta("U1", "c1").oldestSeq).toBeGreaterThanOrEqual(51);
  // 低水位不再生效
  api.clearBefore("U1", "c1", 30);
  expect(api.meta("U1", "c1").clearBeforeSeq).toBe(50);
  // 全清
  api.clearBefore("U1", "c1", 100);
  expect(api.latest("U1", "c1", 5)).toBeNull();
});

it("CAP_ROWS 上限淘汰：2100 条落库后最旧段被整段丢弃", () => {
  api.upsert("U1", "c1", batch(1, 2100));
  const m = api.meta("U1", "c1");
  expect(m.total).toBeLessThanOrEqual(2000);
  expect(m.oldestSeq).toBeGreaterThan(1);
  expect(ids(api.latest("U1", "c1", 20))).toEqual(ids(batch(2081, 2100)));
});

it("坏段容忍：坏 JSON 段当 miss 跳过，不炸读取", () => {
  api.upsert("U1", "c1", batch(1, 250));
  const tailKey = io.keys().filter((k) => k.includes(".s.")).sort().pop() as string;
  io._map.set(tailKey, "{bad json");
  const rows = api.latest("U1", "c1", 5);
  // 尾段坏了 → 从前段取，仍能返回（宁缺勿炸）
  expect(Array.isArray(rows)).toBe(true);
  if (rows != null && rows.length > 0) {
    expect((rows[0] as Rec).seq).toBeLessThan(200);
  }
});

it("撤回/编辑补丁：命中改写、revision 守卫拒旧、未命中/无库 no-op", () => {
  api.upsert("U1", "c1", batch(1, 20));
  // 编辑生效：body.text 替换 + editTime
  expect(api.applyEdit("U1", "c1", "m5", 100, "v2")).toBe(true);
  const m5 = api.latest("U1", "c1", 20).find((r: Rec) => r.msgId == "m5") as Rec;
  expect(m5.body.text).toBe("v2");
  expect(m5.editTime).toBe(100);
  // 旧编辑被拒（revision 只增）
  expect(api.applyEdit("U1", "c1", "m5", 50, "old")).toBe(false);
  // 撤回生效：msgStatus=2 + body 清空 + revokeBy
  expect(api.applyRevoke("U1", "c1", "m6", 200, "u9")).toBe(true);
  const m6 = api.latest("U1", "c1", 20).find((r: Rec) => r.msgId == "m6") as Rec;
  expect(m6.msgStatus).toBe(2);
  expect(m6.body).toBeNull();
  expect(m6.revokeBy).toBe("u9");
  // 撤回后的低版本编辑补丁被拒（不可复活）
  expect(api.applyEdit("U1", "c1", "m6", 150, "x")).toBe(false);
  // 未命中行 / 无库会话 / 非法 revision：no-op
  expect(api.applyEdit("U1", "c1", "ghost", 10, "x")).toBe(false);
  expect(api.applyRevoke("U1", "nope", "m6", 10, "u")).toBe(false);
  expect(api.applyRevoke("U1", "c1", "m7", 0, "u")).toBe(false);
  expect(api.meta("U1", "c1").total).toBe(20);
});

it("hasMore setter 与 drop/clearUser/clearAll 作用域", () => {
  api.upsert("U1", "c1", batch(1, 5));
  api.setHasMore("U1", "c1", false);
  expect(api.meta("U1", "c1").hasMore).toBe(false);
  api.setHasMore("U1", "ghost", false); // 无库 no-op 不抛
  // 外来键不受 clearAll 影响
  io._map.set("OTHER_KEY", "x");
  api.dropConv("U1", "c1");
  expect(api.meta("U1", "c1")).toBeNull();
  api.upsert("U1", "c2", batch(1, 5));
  api.clearUser("U1");
  expect(io.keys().filter((k) => k.startsWith("IM_MSGDB_V1")).length).toBe(0);
  expect(io._map.has("OTHER_KEY")).toBe(true);
});

// CAP_ROWS=2000 淘汰推进库底时，hasMore=false（翻到顶落库）断言过期——被丢的行
// 服务端仍有，必须复位 true 让翻页到新底时走网络重新求证（真机 2026-10-24 晚场景配套）。
it("CAP 淘汰推进 oldestSeq ⇒ hasMore=false 复位 true", () => {
  api.upsert("U1", "c1", batch(1, 2000));
  api.setHasMore("U1", "c1", false); // 深翻到真顶
  const m0 = api.meta("U1", "c1");
  expect(m0.total).toBe(2000);
  expect(m0.hasMore).toBe(false);
  api.upsert("U1", "c1", batch(2001, 2100)); // 新消息把总量顶过上限 → 淘汰最旧
  const m = api.meta("U1", "c1");
  expect(m.total).toBeLessThanOrEqual(2000);
  expect(m.oldestSeq).toBeGreaterThan(1); // 库底上移
  expect(m.hasMore).toBe(true); // 旧 false 过期，复位
  // hasBelow 索引探测：新库底之下无、之上有
  expect(api.hasBelow("U1", "c1", m.oldestSeq)).toBe(false);
  expect(api.hasBelow("U1", "c1", m.oldestSeq + 1)).toBe(true);
  // 未触发淘汰的 upsert 不多事翻动 false
  api.setHasMore("U1", "c1", false);
  api.upsert("U1", "c2", batch(1, 5));
  expect(api.meta("U1", "c1").hasMore).toBe(false);
});
