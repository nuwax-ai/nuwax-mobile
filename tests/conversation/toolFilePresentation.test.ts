/**
 * V2 工具文件路径徽标纯函数单测。
 * 契约对齐 PC toolFilePresentation.test.ts：沙箱路径判定 / 路径拆段
 * （尾斜杠、隐藏文件、无扩展名）/ 徽标映射（已知扩展名、未知截断、FILE 兜底）。
 */
import { describe, expect, it } from "vitest";
import {
  buildFileBadgeViews,
  getFileTypeInfo,
  isConversationSandboxPath,
  splitFilePath,
} from "@/subpackages/components/work-trace/toolFilePresentation.uts";

describe("isConversationSandboxPath", () => {
  it("会话沙箱路径 /home/user/{数字}/ 命中", () => {
    expect(isConversationSandboxPath("/home/user/1562087/src/index.tsx")).toBe(true);
    expect(isConversationSandboxPath("/home/user/1/a.md")).toBe(true);
  });

  it("非沙箱路径不命中（家目录其它位置 / 普通绝对路径 / 空）", () => {
    expect(isConversationSandboxPath("/home/user/Desktop/a.md")).toBe(false);
    expect(isConversationSandboxPath("/workspace/a.ts")).toBe(false);
    expect(isConversationSandboxPath("a.ts")).toBe(false);
    expect(isConversationSandboxPath("")).toBe(false);
  });
});

describe("splitFilePath", () => {
  it("常规路径拆目录/文件名/小写扩展名", () => {
    const parts = splitFilePath("/home/user/1/src/App.TSX");
    expect(parts.dir).toBe("/home/user/1/src");
    expect(parts.name).toBe("App.TSX");
    expect(parts.ext).toBe("tsx");
  });

  it("容忍结尾斜杠；根目录文件 dir 为空", () => {
    const parts = splitFilePath("/a/b/");
    expect(parts.dir).toBe("/a");
    expect(parts.name).toBe("b");
    expect(parts.ext).toBe("");
    const root = splitFilePath("README.md");
    expect(root.dir).toBe("");
    expect(root.name).toBe("README.md");
    expect(root.ext).toBe("md");
  });

  it("点开头隐藏文件不算扩展名；无扩展名为空串", () => {
    expect(splitFilePath("/home/user/1/.env").ext).toBe("");
    expect(splitFilePath("/home/user/1/.gitignore").ext).toBe("");
    expect(splitFilePath("/home/user/1/Makefile").ext).toBe("");
  });
});

describe("getFileTypeInfo", () => {
  it("常见扩展名命中映射表", () => {
    expect(getFileTypeInfo("a.ts").label).toBe("TS");
    expect(getFileTypeInfo("a.tsx").label).toBe("TSX");
    expect(getFileTypeInfo("a.md").label).toBe("MD");
    expect(getFileTypeInfo("a.markdown").label).toBe("MD");
    expect(getFileTypeInfo("a.cpp").label).toBe("C++");
    expect(getFileTypeInfo("a.h").label).toBe("C");
    expect(getFileTypeInfo("a.png").label).toBe("IMG");
    expect(getFileTypeInfo("a.mp4").label).toBe("VIDEO");
    expect(getFileTypeInfo("a.yaml").label).toBe("YML");
  });

  it("未知扩展名取前 4 位大写；无扩展名归 FILE", () => {
    expect(getFileTypeInfo("archive.tar.gz2x").label).toBe("GZ2X");
    expect(getFileTypeInfo("config.weirdlongext").label).toBe("WEIR");
    expect(getFileTypeInfo("Makefile").label).toBe("FILE");
    expect(getFileTypeInfo(".gitignore").label).toBe("FILE");
  });
});

describe("buildFileBadgeViews", () => {
  it("批量生成徽标视图（label+name）", () => {
    const views = buildFileBadgeViews([
      "/home/user/1/src/index.tsx",
      "package.json",
    ]);
    expect(views).toHaveLength(2);
    expect(views[0].label).toBe("TSX");
    expect(views[0].name).toBe("index.tsx");
    expect(views[1].label).toBe("JSON");
    expect(views[1].name).toBe("package.json");
  });

  it("空列表返回空数组", () => {
    expect(buildFileBadgeViews([])).toEqual([]);
  });
});
