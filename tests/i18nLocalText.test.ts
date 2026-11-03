import { afterEach, describe, expect, it, vi } from "vitest";
import { localText } from "../utils/i18nLocalText.uts";
import { objectI18nParams } from "../utils/i18nParams.uts";

afterEach(() => vi.unstubAllGlobals());

describe("基础工具本地错误文案", () => {
  it("模板参数构造成真实 Map，保留数值、状态和空值", () => {
    vi.stubGlobal("UTSJSONObject", { keys: Object.keys });
    const params = objectI18nParams({
      count: 7,
      state: "Running",
      empty: null,
    }) as Map<string, string | number>;
    expect(params).toBeInstanceOf(Map);
    expect([...params]).toEqual([
      ["count", "7"],
      ["state", "Running"],
      ["empty", ""],
    ]);
  });
  it("使用当前存储语言，切换后读取对应词包", () => {
    let lang = "en-us";
    vi.stubGlobal("uni", { getStorageSync: () => lang });
    expect(localText("Mobile.Error.selectedFileUnavailable")).toBe(
      "Cannot open the selected file",
    );
    lang = "zh-cn";
    expect(localText("Mobile.Error.selectedFileUnavailable")).toBe(
      "无法打开所选文件",
    );
  });

  it("首次启动或存储不可用时仍能给出默认语言错误", () => {
    vi.stubGlobal("uni", {
      getStorageSync: () => {
        throw new Error("fixture storage unavailable");
      },
    });
    expect(localText("Mobile.Error.sessionExpired")).toBe("登录状态已失效");
  });
});
