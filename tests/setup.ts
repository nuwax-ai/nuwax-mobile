/**
 * node 环境下的 UTS 运行时垫片。
 *
 * 投影层（conversationTrace.uts 等）编译到 H5/App 时 UTSJSONObject 由 uni 提供；
 * vitest 跑在纯 node 下，只需保证 `value instanceof UTSJSONObject` 对普通对象
 * 返回 false（asRecord 走兜底分支，普通 object 原样通过）。
 */
class UTSJSONObjectStub {
  /* 占位：仅用于 instanceof 判定 */
}
(globalThis as Record<string, unknown>).UTSJSONObject = UTSJSONObjectStub;
