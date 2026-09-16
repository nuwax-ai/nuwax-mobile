/**
 * V2 工具行内联详情归一化单测。
 * 契约对齐 PC toolDetail.ts + hasProcessNodeDetail：
 * 字段抽取（command/rawInput 嵌套、filePath 多 key、query/url、structuredResult、
 * exitCode、output 拼接+剥 fence、inputText 剔除、diffs/additions/isCreate、steps）、
 * hasToolNodeDetail 空节点判定、prefixDiffLines。
 */
import { describe, expect, it } from "vitest";
import {
  hasToolNodeDetail,
  normalizeToolNodeDetail,
  prefixDiffLines,
} from "@/subpackages/components/work-trace/toolNodeDetail.uts";

function makeProcessing(result: Record<string, unknown>): Record<string, unknown> {
  return { executeId: "e1", type: "ToolCall", name: "t", status: "FINISHED", result };
}

describe("normalizeToolNodeDetail 字段抽取", () => {
  it("terminal：command/exitCode/output（data 数组逐项 content 拼接）", () => {
    const detail = normalizeToolNodeDetail(
      "terminal",
      makeProcessing({
        kind: "execute",
        input: { command: "npm test" },
        data: [
          { type: "terminal", content: "line1\nline2", exitCode: 0 },
        ],
      }),
      "finished",
    );
    expect(detail.command).toBe("npm test");
    expect(detail.exitCode).toBe(0);
    expect(detail.output).toBe("line1\nline2");
  });

  it("terminal：rawInput 嵌套 command 兜底", () => {
    const detail = normalizeToolNodeDetail(
      "terminal",
      makeProcessing({
        input: { rawInput: { command: "ls -la" } },
      }),
      "finished",
    );
    expect(detail.command).toBe("ls -la");
  });

  it("terminal：output 剥最外层 code fence，内部 fence 保留", () => {
    const detail = normalizeToolNodeDetail(
      "terminal",
      makeProcessing({
        data: "```\ninner\n```",
      }),
      "finished",
    );
    expect(detail.output).toBe("inner");
  });

  it("terminal：失败态（success=false）failed 置位、运行态回填", () => {
    const failed = normalizeToolNodeDetail(
      "terminal",
      makeProcessing({ success: false, input: { command: "x" }, data: "err" }),
      "finished",
    );
    expect(failed.failed).toBe(true);
    const running = normalizeToolNodeDetail(
      "terminal",
      makeProcessing({ input: { command: "x" } }),
      "running",
    );
    expect(running.running).toBe(true);
    expect(running.failed).toBe(false);
  });

  it("file-read：filePath 多 key 命中 + 行范围 + 内容", () => {
    const detail = normalizeToolNodeDetail(
      "file-read",
      makeProcessing({
        kind: "read",
        input: { file_path: "/home/user/9/a.ts", line_start: 1, line_end: 20 },
        data: "文件内容",
      }),
      "finished",
    );
    expect(detail.filePath).toBe("/home/user/9/a.ts");
    expect(detail.lineStart).toBe(1);
    expect(detail.lineEnd).toBe(20);
    expect(detail.output).toBe("文件内容");
  });

  it("file-edit：diffs/additions/deletions/isCreate", () => {
    const detail = normalizeToolNodeDetail(
      "file-edit",
      makeProcessing({
        kind: "edit",
        input: { file_path: "a.ts" },
        data: [
          { type: "diff", path: "a.ts", oldText: "old", newText: "n1\nn2" },
          { type: "diff", path: "new.ts", oldText: "", newText: "x\ny" },
        ],
      }),
      "finished",
    );
    expect(detail.diffs).toHaveLength(2);
    expect(detail.additions).toBe(4);
    expect(detail.deletions).toBe(1);
    expect(detail.isCreate).toBe(false);
  });

  it("file-edit：全部无 oldText → isCreate", () => {
    const detail = normalizeToolNodeDetail(
      "file-edit",
      makeProcessing({
        data: [{ type: "diff", path: "n.ts", oldText: "", newText: "a" }],
      }),
      "finished",
    );
    expect(detail.isCreate).toBe(true);
  });

  it("search/browser：query + structuredResult title/summary/url", () => {
    const detail = normalizeToolNodeDetail(
      "search",
      makeProcessing({
        input: { query: "vite 升级" },
        data: [{ title: "Vite 指南", summary: "迁移说明", url: "https://vitejs.dev" }],
      }),
      "finished",
    );
    expect(detail.query).toBe("vite 升级");
    expect(detail.resultTitle).toBe("Vite 指南");
    expect(detail.resultSummary).toBe("迁移说明");
    expect(detail.url).toBe("https://vitejs.dev");
  });

  it("url：input 优先，structuredResult 兜底", () => {
    const fromInput = normalizeToolNodeDetail(
      "browser",
      makeProcessing({ input: { url: "https://a.dev" }, data: { url: "https://b.dev" } }),
      "finished",
    );
    expect(fromInput.url).toBe("https://a.dev");
    const fromData = normalizeToolNodeDetail(
      "browser",
      makeProcessing({ data: { url: "https://b.dev" } }),
      "finished",
    );
    expect(fromData.url).toBe("https://b.dev");
  });

  it("todo：steps 取 data 中含 content 的项", () => {
    const detail = normalizeToolNodeDetail(
      "todo",
      makeProcessing({
        data: [
          { status: "completed", content: "第一步" },
          { status: "in_progress", content: "第二步" },
          { type: "terminal", content: "不应进 steps" },
        ],
      }),
      "finished",
    );
    // terminal 项同样含 content 字符串——PC 语义：含 content:string 的项都进 steps
    expect(detail.steps).toHaveLength(3);
    expect(detail.steps[0].status).toBe("completed");
  });

  it("generic：inputText 剔除已知字段后 JSON 化", () => {
    const detail = normalizeToolNodeDetail(
      "generic",
      makeProcessing({
        input: { command: "x", file_path: "a", target: "mock", mode: "typed" },
        data: { success: true },
      }),
      "finished",
    );
    expect(detail.inputText).toContain("mock");
    expect(detail.inputText).toContain("typed");
    expect(detail.inputText).not.toContain("command");
    expect(detail.inputText).not.toContain("file_path");
  });

  it("skill：skillContent 双 key", () => {
    const camel = normalizeToolNodeDetail(
      "skill",
      makeProcessing({ input: { skillContent: "# S" } }),
      "finished",
    );
    expect(camel.skillContent).toBe("# S");
    const snake = normalizeToolNodeDetail(
      "skill",
      makeProcessing({ input: { skill_content: "# S2" } }),
      "finished",
    );
    expect(snake.skillContent).toBe("# S2");
  });

  it("空/脏数据安全降级", () => {
    const empty = normalizeToolNodeDetail("generic", null, "finished");
    expect(empty.command).toBe("");
    expect(empty.output).toBe("");
    expect(empty.failed).toBe(false);
    const bad = normalizeToolNodeDetail("terminal", "not-an-object", "finished");
    expect(bad.command).toBe("");
  });
});

describe("hasToolNodeDetail", () => {
  it("空协议节点无详情（不伪装可点）", () => {
    const empty = normalizeToolNodeDetail("generic", null, "finished");
    expect(hasToolNodeDetail(empty)).toBe(false);
  });

  it("仅 output 存在即有详情", () => {
    const detail = normalizeToolNodeDetail(
      "generic",
      makeProcessing({ data: "some output" }),
      "finished",
    );
    expect(hasToolNodeDetail(detail)).toBe(true);
  });

  it("exitCode 数字也算详情", () => {
    const detail = normalizeToolNodeDetail(
      "terminal",
      makeProcessing({ data: [{ type: "terminal", exitCode: 1 }] }),
      "finished",
    );
    expect(hasToolNodeDetail(detail)).toBe(true);
  });
});

describe("prefixDiffLines", () => {
  it("逐行加前缀（- / +）", () => {
    expect(prefixDiffLines("a\nb", "- ")).toBe("- a\n- b");
    expect(prefixDiffLines("x", "+ ")).toBe("+ x");
    expect(prefixDiffLines("", "- ")).toBe("");
  });
});
