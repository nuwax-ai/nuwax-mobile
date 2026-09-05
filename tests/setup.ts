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

/**
 * uni storage mock（Map 实现）：conversationLocalFlags 等依赖
 * uni.getStorageSync / setStorageSync 的模块在 node 下可用。
 */
const storageBacking = new Map<string, unknown>();
const uniStub: Record<string, unknown> = {
  getStorageSync: (key: string): unknown => {
    return storageBacking.has(key) ? storageBacking.get(key) : "";
  },
  setStorageSync: (key: string, value: unknown): void => {
    storageBacking.set(key, value);
  },
  removeStorageSync: (key: string): void => {
    storageBacking.delete(key);
  },
};
(globalThis as Record<string, unknown>).uni = uniStub;
