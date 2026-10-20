/**
 * IM 文件「已下载」注册表单元测试。
 * 契约：fileName 优先键、mark 幂等去重、上限 500 滚动裁剪、坏 JSON 容错、持久化跨读。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  imFileDownloadKey,
  isImFileDownloaded,
  markImFileDownloaded,
  unmarkImFileDownloaded,
} from "@/utils/imFileDownloadRegistry.uts";

beforeEach(() => {
  // 每用例独立的 Map 存储（conversationLocalFlags.test 同款隔离法）
  const storage = new Map<string, unknown>();
  (globalThis as Record<string, unknown>).uni = {
    getStorageSync: (key: string): unknown =>
      storage.has(key) ? storage.get(key) : "",
    setStorageSync: (key: string, value: unknown): void => {
      storage.set(key, value);
    },
  };
});

describe("登记键", () => {
  it("fileName 优先，缺省回落 url", () => {
    expect(imFileDownloadKey("报告.pdf", "/api/f/x")).toBe("报告.pdf");
    expect(imFileDownloadKey("", "/api/f/x")).toBe("/api/f/x");
  });
});

describe("标记读写", () => {
  it("空键不标记、不误报", () => {
    markImFileDownloaded("");
    expect(isImFileDownloaded("")).toBe(false);
  });

  it("mark 后可读；重复 mark 幂等（不产生重复条目）", () => {
    markImFileDownloaded("a.pdf");
    expect(isImFileDownloaded("a.pdf")).toBe(true);
    markImFileDownloaded("a.pdf");
    markImFileDownloaded("a.pdf");
    expect(isImFileDownloaded("a.pdf")).toBe(true);
    expect(isImFileDownloaded("b.pdf")).toBe(false);
  });

  it("坏 JSON 容错：当未下载，不抛错；随后可正常写入", () => {
    (globalThis as Record<string, unknown>).uni = {
      getStorageSync: (_key: string): unknown => "{not json",
      setStorageSync: (_key: string, _value: unknown): void => {},
    };
    expect(isImFileDownloaded("a.pdf")).toBe(false);
    expect(() => markImFileDownloaded("a.pdf")).not.toThrow();
  });

  it("超过 500 条滚动裁剪最旧", () => {
    for (let i = 0; i < 502; i++) {
      markImFileDownloaded(`file-${i}.pdf`);
    }
    expect(isImFileDownloaded("file-0.pdf")).toBe(false);
    expect(isImFileDownloaded("file-1.pdf")).toBe(false);
    expect(isImFileDownloaded("file-2.pdf")).toBe(true);
    expect(isImFileDownloaded("file-501.pdf")).toBe(true);
  });

  it("unmark 只撤指定键，不影响其他条目；未标记键 unmark 无副作用", () => {
    markImFileDownloaded("a.pdf");
    markImFileDownloaded("b.pdf");
    unmarkImFileDownloaded("a.pdf");
    expect(isImFileDownloaded("a.pdf")).toBe(false);
    expect(isImFileDownloaded("b.pdf")).toBe(true);
    unmarkImFileDownloaded("a.pdf");
    unmarkImFileDownloaded("");
    expect(isImFileDownloaded("b.pdf")).toBe(true);
  });
});
