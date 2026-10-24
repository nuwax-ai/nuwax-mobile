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

// imMsgDb：真实实现（imMsgSync 的依赖经 harness 作用域注入同一实例）
const db = loadUtsClass(
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
})`,
  {},
) as any;

// imMsgSync：imMsgDb 导出函数按被剥 import 的同名标识符注入
const sync = loadUtsClass(
  "utils/im/imMsgSync.uts",
  `({
  syncOnEnter: syncImConvOnEnter,
  tailCompare: tailCompareImConv,
  persist: persistImConvRecords,
  applySyncResult: applyImConvSyncResult,
  fetchPage: fetchImConvHistoryPage,
})`,
  {
    getImMsgDbMeta: db.meta,
    loadImMsgDbBefore: db.before,
    hasImMsgDbBelow: db.hasBelow,
    upsertImMsgDbMessages: db.upsert,
    removeImMsgDbMessages: db.removeMsgs,
    applyImMsgDbClearBefore: db.clearBefore,
    setImMsgDbHasMore: db.setHasMore,
    dropImMsgDbConversation: db.dropConv,
  },
) as any;

let io: ReturnType<typeof makeIo>;
beforeEach(() => {
  io = makeIo();
  db.configure(io);
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
function batch(from: number, to: number, convId = "c1"): Rec[] {
  const out: Rec[] = [];
  for (let s = from; s <= to; s++) out.push(rec(s, { convId }));
  return out;
}
type FakeFetcher = (convId: string, beforeSeq: number, limit: number) => Promise<any>;

it("进会话建窗（空库）：尾页 20 条落库 + hasMore 采用响应值", async () => {
  const fetcher: FakeFetcher = async () => ({ records: batch(1, 20), hasMore: true });
  const out = await sync.syncOnEnter("U1", "c1", fetcher);
  expect(out.usedNetwork).toBe(true);
  expect(out.wiped).toBe(false);
  expect(out.removedMsgIds).toEqual([]);
  expect(ids(out.records)).toEqual(ids(batch(1, 20)));
  const m = db.meta("U1", "c1");
  expect(m.latestSeq).toBe(20);
  expect(m.total).toBe(20);
  expect(m.hasMore).toBe(true);
});

it("进会话命中（已同步）：幂等零生效、不触发回填", async () => {
  await sync.syncOnEnter("U1", "c1", async () => ({ records: batch(1, 20), hasMore: true }));
  const calls: number[] = [];
  const fetcher: FakeFetcher = async (_c, before) => {
    calls.push(before);
    return { records: batch(1, 20), hasMore: true };
  };
  const out = await sync.syncOnEnter("U1", "c1", fetcher);
  expect(calls).toEqual([0]); // 只尾页一次
  expect(db.meta("U1", "c1").total).toBe(20);
  expect(out.removedMsgIds).toEqual([]);
});

it("tail 比对：服务端缺失的行（按人删除）被剔库并回报", async () => {
  await sync.syncOnEnter("U1", "c1", async () => ({ records: batch(1, 20), hasMore: true }));
  // 服务端 m19 被按人删除：尾页 19 行（seq 窗口仍 1..20）
  const serverTail = batch(1, 18).concat([rec(20)]);
  const out = await sync.syncOnEnter("U1", "c1", async () => ({ records: serverTail, hasMore: true }));
  expect(out.removedMsgIds).toEqual(["m19"]);
  expect(db.meta("U1", "c1").total).toBe(19);
  expect(ids(db.latest("U1", "c1", 20))).not.toContain("m19");
});

it("空洞回填：断线缺口用历史接口翻页补齐到本地水位", async () => {
  await sync.syncOnEnter("U1", "c1", async () => ({ records: batch(1, 20), hasMore: true }));
  const calls: number[] = [];
  const fetcher: FakeFetcher = async (_c, before) => {
    calls.push(before);
    if (before == 0) return { records: batch(46, 65), hasMore: true };
    if (before == 46) return { records: batch(26, 45), hasMore: true };
    if (before == 26) return { records: batch(2, 25), hasMore: true };
    return null;
  };
  const out = await sync.syncOnEnter("U1", "c1", fetcher);
  expect(calls).toEqual([0, 46, 26]); // 尾页 + 两页回填即触达本地水位
  expect(ids(out.records)).toEqual(ids(batch(46, 65))); // UI 只拿尾页
  const m = db.meta("U1", "c1");
  expect(m.latestSeq).toBe(65);
  expect(m.total).toBe(65);
  expect(ids(db.latest("U1", "c1", 65))).toEqual(ids(batch(1, 65)));
});

it("网络失败：outcome null、本地不动（断网可继续浏览）", async () => {
  await sync.syncOnEnter("U1", "c1", async () => ({ records: batch(1, 20), hasMore: true }));
  const out = await sync.syncOnEnter("U1", "c1", async () => null);
  expect(out).toBeNull();
  expect(db.meta("U1", "c1").total).toBe(20);
  // 形态不符（缺 records 键）同按失败处理
  const out2 = await sync.syncOnEnter("U1", "c1", async () => ({ code: 500 }));
  expect(out2).toBeNull();
  expect(db.meta("U1", "c1").total).toBe(20);
});

it("真空页：本地缓存被清空/全删 ⇒ 整库剔除并置 wiped；全新空会话不误伤", async () => {
  await sync.syncOnEnter("U1", "c1", async () => ({ records: batch(1, 20), hasMore: true }));
  const out = await sync.syncOnEnter("U1", "c1", async () => ({ records: [], hasMore: false }));
  expect(out.wiped).toBe(true);
  expect(out.records).toEqual([]);
  expect(db.meta("U1", "c1")).toBeNull();
  // 空会话首次进入：wiped=false、不建库
  const fresh = await sync.syncOnEnter("U1", "c9", async () => ({ records: [], hasMore: false }));
  expect(fresh.wiped).toBe(false);
  expect(db.meta("U1", "c9")).toBeNull();
});

it("翻页本地优先：足页零请求；不足走 HTTP 落库后残页本地化", async () => {
  db.upsert("U1", "c1", batch(1, 50));
  const calls: number[] = [];
  const never: FakeFetcher = async () => {
    throw new Error("should not fetch");
  };
  const p1 = await sync.fetchPage("U1", "c1", 51, 20, never);
  expect(p1.usedNetwork).toBe(false);
  expect(ids(p1.records)).toEqual(ids(batch(31, 50)));
  expect(p1.hasMoreLocal).toBe(true);

  const fetcher: FakeFetcher = async (_c, before) => {
    calls.push(before);
    return { records: batch(1, 10), hasMore: false }; // 服务端翻到顶
  };
  const p2 = await sync.fetchPage("U1", "c1", 11, 20, fetcher);
  expect(p2.usedNetwork).toBe(true);
  expect(ids(p2.records)).toEqual(ids(batch(1, 10)));
  expect(p2.hasMoreLocal).toBe(false);
  expect(db.meta("U1", "c1").hasMore).toBe(false);
  // 再翻：本地已到头残页直出，不再触网
  calls.length = 0;
  const p3 = await sync.fetchPage("U1", "c1", 11, 20, fetcher);
  expect(p3.usedNetwork).toBe(false);
  expect(p3.hasMoreLocal).toBe(false);
  expect(calls).toEqual([]);
});

it("断网翻页：HTTP 失败回退本地残页，hasMore 不被误翻", async () => {
  db.upsert("U1", "c1", batch(1, 30));
  const p = await sync.fetchPage("U1", "c1", 11, 20, async () => null);
  expect(p.usedNetwork).toBe(false);
  expect(ids(p.records)).toEqual(ids(batch(1, 10)));
  expect(p.hasMoreLocal).toBe(true);
  expect(db.meta("U1", "c1").hasMore).toBe(true);
});

it("applySyncResult：clearBeforeSeq 应用 + 跨会话消息批分发", () => {
  db.upsert("U1", "c1", batch(1, 60));
  const syncData = {
    conversations: [
      { convId: "c1", clearBeforeSeq: 50 },
      { convId: "cX", clearBeforeSeq: 0 }, // 0=无清空，no-op
    ],
    messages: [rec(70), { ...rec(5, { convId: "c2", msgId: "n5" }) }],
  };
  sync.applySyncResult("U1", syncData);
  const m = db.meta("U1", "c1");
  expect(m.clearBeforeSeq).toBe(50);
  expect(ids(db.latest("U1", "c1", 20))).toEqual(ids(batch(51, 60)).concat(["m70"]));
  expect(ids(db.latest("U1", "c2", 5))).toEqual(["n5"]);
});

it("hasMore 合并口径：null 不动；显式值才落（尾部刷新不许翻回 false）", async () => {
  await sync.syncOnEnter("U1", "c1", async () => ({ records: batch(1, 20), hasMore: false }));
  expect(db.meta("U1", "c1").hasMore).toBe(false);
  // 尾部刷新传 null：不动
  sync.persist("U1", "c1", batch(21, 30), null);
  expect(db.meta("U1", "c1").hasMore).toBe(false);
  expect(db.meta("U1", "c1").latestSeq).toBe(30);
  // 翻到顶/建窗等显式口径才允许翻转
  sync.persist("U1", "c1", [], true);
  expect(db.meta("U1", "c1").hasMore).toBe(true);
});

it("uid 未就绪：纯网络降级，不碰库不回填", async () => {
  const out = await sync.syncOnEnter("", "c1", async () => ({ records: batch(1, 20), hasMore: true }));
  expect(out != null && out.records.length).toBe(20);
  expect(out!.wiped).toBe(false);
  // 空页不误 wipe（无库路径）
  const empty = await sync.syncOnEnter("", "c1", async () => ({ records: [], hasMore: false }));
  expect(empty!.wiped).toBe(false);
  const p = await sync.fetchPage("", "c1", 21, 20, async () => ({ records: batch(1, 20), hasMore: false }));
  expect(p.usedNetwork).toBe(true);
  expect(p.records.length).toBe(20);
  // 全程零键写入（空 uid 不污染命名空间：`.u..` 双点形态不存在）
  expect(io.keys().filter((k) => k.includes(".u..")).length).toBe(0);
});

it("httpFailed 标记：网络失败残页兜底时可判（首屏空列表走失败态）", async () => {
  const p1 = await sync.fetchPage("U1", "c9", 0, 20, async () => null);
  expect(p1.httpFailed).toBe(true);
  expect(p1.records).toEqual([]);
  const p2 = await sync.fetchPage("U1", "c9", 0, 20, async () => ({ records: batch(1, 5), hasMore: false }));
  expect(p2.httpFailed).toBe(false);
});

// 真机 2026-10-24 17:34 场景复刻：群 seq 稀疏（20 行跨 1603..2504）+ 密集尾段
// （2505..2524）。跨会话翻页必须 db 直出——防「重进后翻页永远走 net」回归。
it("跨会话稀疏 seq：会话1翻页落库 → 会话2重进同步 → 翻页 db 直出且内容正确", async () => {
  const dense = batch(2505, 2524); // 密集尾段 20 行
  const sparseSeqs = [2504, 2450, 2400, 2350, 2300, 2250, 2200, 2150, 2100, 2050, 2000, 1950, 1900, 1850, 1800, 1750, 1700, 1660, 1630, 1603];
  const sparse = sparseSeqs.map((s) => rec(s)).reverse(); // 升序形态
  const older = batch(60, 200, "c1").filter((_r, i) => i % 7 == 0); // 更早稀疏页
  // 会话1：建窗 + 上翻两页全 HTTP
  await sync.syncOnEnter("U1", "c1", async () => ({ records: dense, hasMore: true }));
  const f1: FakeFetcher = async (_c, b) =>
    b == 2505 ? { records: sparse, hasMore: true } : { records: older, hasMore: false };
  await sync.fetchPage("U1", "c1", 2505, 20, f1);
  await sync.fetchPage("U1", "c1", 1603, 20, f1);
  expect(db.meta("U1", "c1").total).toBe(40 + older.length);
  // 会话2：重进（尾页新增一条 2525）
  const dense2 = [rec(2525)].concat(dense.slice(0, 19));
  await sync.syncOnEnter("U1", "c1", async () => ({ records: dense2, hasMore: true }));
  // 翻页 beforeSeq=2505：本地足页直出，内容=稀疏段升序
  const never: FakeFetcher = async () => {
    throw new Error("db miss");
  };
  const p = await sync.fetchPage("U1", "c1", 2505, 20, never);
  expect(p.usedNetwork).toBe(false);
  expect(p.records.length).toBe(20);
  expect(ids(p.records)).toEqual(ids(sparse));
});

// 真机 2026-10-24「第二次进入直接没有更多、深历史查看不到」回归：meta.hasMore 被提前
// 毒化 false 后，翻页两分支透传关闸即永久锁死。进会话同步须以本地最旧 seq 探测自愈。
it("到顶闩自愈：毒化 false + 重进探测有更早 ⇒ 解锁且探测行落库", async () => {
  await sync.syncOnEnter("U1", "c1", async () => ({ records: batch(41, 60), hasMore: true }));
  db.upsert("U1", "c1", batch(11, 30)); // 更早深历史已缓存（oldestSeq=11）
  sync.persist("U1", "c1", [], false); // 毒化：hasMore=false
  const calls: Array<[number, number]> = [];
  const fetcher: FakeFetcher = async (_c, before, limit) => {
    calls.push([before, limit]);
    if (before == 0) return { records: batch(41, 60), hasMore: true }; // 权威尾页
    return { records: [rec(5)], hasMore: true }; // 探测：11 之下确有更早（seq=5）
  };
  const out = await sync.syncOnEnter("U1", "c1", fetcher);
  expect(calls).toEqual([[0, 20], [11, 1]]); // 尾页 + 以最旧 seq 为游标的 limit=1 探测
  expect(out.records.length).toBe(20); // UI 仍只拿尾页
  expect(db.meta("U1", "c1").hasMore).toBe(true); // 闩解锁
  expect(ids(db.latest("U1", "c1", 80))).toContain("m5"); // 探测行落库
  // 解锁后翻页不再被「没有更多」闸死：残页兜底且闸门保持开（可继续触网续读）
  const p = await sync.fetchPage("U1", "c1", 11, 20, async () => {
    throw new Error("net down");
  });
  expect(p.usedNetwork).toBe(false); // 断网兜底走本地残页
  expect(p.httpFailed).toBe(true);
  expect(p.hasMoreLocal).toBe(true); // 闸门已开，不会显示「没有更多」
});

it("到顶闩自愈：确实到顶 ⇒ 探测为空维持 false（每次重进一条空探测为代价）", async () => {
  await sync.syncOnEnter("U1", "c1", async () => ({ records: batch(41, 60), hasMore: false }));
  const calls: number[] = [];
  const fetcher: FakeFetcher = async (_c, before) => {
    calls.push(before);
    if (before == 0) return { records: batch(41, 60), hasMore: false };
    return { records: [], hasMore: false }; // 41 之下确无更早
  };
  await sync.syncOnEnter("U1", "c1", fetcher);
  expect(calls).toEqual([0, 41]);
  expect(db.meta("U1", "c1").hasMore).toBe(false);
});

it("到顶闩自愈：探测网络失败 ⇒ 维持 false 不影响进会话同步", async () => {
  await sync.syncOnEnter("U1", "c1", async () => ({ records: batch(41, 60), hasMore: false }));
  const fetcher: FakeFetcher = async (_c, before) => {
    if (before == 0) return { records: batch(41, 60), hasMore: false };
    return null; // 探测失败
  };
  const out = await sync.syncOnEnter("U1", "c1", fetcher);
  expect(out).not.toBeNull();
  expect(out!.records.length).toBe(20);
  expect(db.meta("U1", "c1").hasMore).toBe(false);
});

// 真机 2026-10-24 晚复现场景：一次会话翻到真顶（hasMore=false 合法落库）→ 重进只装
// 尾窗 → 旧逻辑 hasMore=false 闸死，一次 loadHistory 都不发，库内深历史全部不可见。
// 闸门必须解耦：DB 本页之下仍有缓存行 ⇒ 继续开闸（db 直出翻到库底才关）。
it("闸门解耦：hasMore=false 但 DB 缓存更深 ⇒ db 足页持续开闸翻到库底", async () => {
  db.upsert("U1", "c1", batch(1, 105)); // 深历史 105 行已缓存（5 足页 + 5 残页）
  sync.persist("U1", "c1", [], false); // 上次会话翻到真顶：false 合法落库
  const never: FakeFetcher = async () => {
    throw new Error("no net");
  };
  // 连续翻页全程 db 直出；足页之下仍有缓存 ⇒ 闸门必须保持开
  let cursor = 106;
  let pages = 0;
  while (pages < 10) {
    const p = await sync.fetchPage("U1", "c1", cursor, 20, never);
    expect(p.usedNetwork).toBe(false);
    if (p.records.length < 20) {
      expect(p.hasMoreLocal).toBe(false); // 残页/空页=库底，收口
      break;
    }
    if (p.hasMoreLocal != true) {
      break; // 恰好整页收口（页底即库底）：合法终态
    }
    cursor = (p.records[0] as Rec).seq;
    pages++;
  }
  expect(pages).toBe(5); // 5 个足页全开闸，第 6 次残页收口
  // 恰好整页边界（100 行）：最后一页足页但底下无货 → 该页直接关闸
  db.dropConv("U1", "c2");
  db.upsert("U1", "c2", batch(1, 100, "c2"));
  sync.persist("U1", "c2", [], false);
  const last = await sync.fetchPage("U1", "c2", 21, 20, never);
  expect(last.usedNetwork).toBe(false);
  expect(last.records.length).toBe(20);
  expect(last.hasMoreLocal).toBe(false);
  // 索引级探测自检：库底之下无、库底之上有
  expect(db.hasBelow("U1", "c1", 11)).toBe(true);
  expect(db.hasBelow("U1", "c1", 1)).toBe(false);
});
