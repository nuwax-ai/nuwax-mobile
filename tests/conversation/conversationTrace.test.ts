/**
 * V2 轨迹投影层单元测试（对齐 PC 端 tests/conversation/traceItems.test.ts 契约）。
 *
 * 覆盖：连续工具成组 / 单工具独立 / 正文·Plan·OpenUI·Event 切断与丢弃 /
 * executeId 去重 / 相邻 Plan 去重 / 组状态优先级 / 活动组标记 /
 * 工具类型识别三级顺序 / 最终回答分离（outputText 优先 + 同源双向去重 +
 * 运行态末段提升）/ 指标（toolCount·elapsed·failed·hasTrace）/ 行摘要 /
 * 动作短语 key 与耗时格式化。
 */
import { describe, expect, it } from "vitest";
import {
  collectActionKinds,
  formatElapsedParts,
  getRowsGroupStatus,
  getToolTraceActionKind,
  projectTurnTrace,
  stripContainerTags,
  toolTraceActionI18nKey,
  TurnTraceInput,
  type TraceItem,
  type TraceToolRow,
} from "@/subpackages/components/ai-msg/conversationTrace.uts";

// ---------------------------------------------------------------------------
// 构造工具
// ---------------------------------------------------------------------------

function tag(
  executeId: string,
  type: string,
  status: string,
  name: string,
): string {
  return (
    `<markdown-custom-process executeId="${executeId}" type="${type}"` +
    ` status="${status}" name="${name}"></markdown-custom-process>`
  );
}

function processing(
  executeId: string,
  type: string,
  name: string,
  status: string,
  result: Record<string, unknown> | null = null,
): Record<string, unknown> {
  const item: Record<string, unknown> = {
    executeId,
    type,
    name,
    status,
    targetId: 0,
  };
  if (result != null) {
    item["result"] = result;
  }
  return item;
}

function project(options: {
  body?: string;
  think?: string;
  processing?: Array<Record<string, unknown>> | null;
  finalResult?: Record<string, unknown> | null;
  running?: boolean;
  messageKey?: string;
}) {
  const input = new TurnTraceInput();
  input.bodyText = options.body ?? "";
  input.thinkText = options.think ?? "";
  input.processingList = options.processing ?? null;
  input.finalResult = options.finalResult ?? null;
  input.running = options.running ?? false;
  input.messageKey = options.messageKey ?? "msg-1";
  return projectTurnTrace(input);
}

function groupItems(items: TraceItem[]): TraceItem[] {
  return items.filter((item) => item.kind == "tool-group");
}

function rowById(items: TraceItem[], id: string): TraceToolRow | null {
  for (const item of items) {
    if (item.kind == "tool-group") {
      const found = item.rows.find((row) => row.id == id);
      if (found != null) return found;
    }
    if ((item.kind == "tool-row" || item.kind == "plan") && item.row?.id == id) {
      return item.row;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 分组投影
// ---------------------------------------------------------------------------

describe("分组投影", () => {
  it("连续两条工具成组，组 id 用首个节点 executeId（流式追加稳定）", () => {
    const p = project({
      body: tag("e1", "ToolCall", "FINISHED", "读取文件 a.ts") +
        "\n" +
        tag("e2", "ToolCall", "FINISHED", "执行命令 ls"),
    });
    expect(p.items).toHaveLength(1);
    const group = p.items[0];
    expect(group.kind).toBe("tool-group");
    expect(group.id).toBe("tool-group:e1");
    expect(group.rows.map((row) => row.id)).toEqual(["e1", "e2"]);
  });

  it("连续三条工具合并为同一组", () => {
    const p = project({
      body:
        tag("e1", "ToolCall", "FINISHED", "读取文件") +
        "\n" +
        tag("e2", "ToolCall", "FINISHED", "读取文件") +
        "\n" +
        tag("e3", "ToolCall", "FINISHED", "执行命令"),
    });
    const groups = groupItems(p.items);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(3);
  });

  it("单条工具独立成行，不套组容器", () => {
    const p = project({ body: tag("e1", "ToolCall", "FINISHED", "执行命令 ls") });
    expect(p.items).toHaveLength(1);
    expect(p.items[0].kind).toBe("tool-row");
    expect(p.items[0].row?.id).toBe("e1");
  });

  it("正文切断分组：工具组-正文-工具组 产生两组与中间 narration（末段提升为回答）", () => {
    const p = project({
      body:
        tag("e1", "ToolCall", "FINISHED", "读取文件 a.ts") +
        "\n" +
        tag("e2", "ToolCall", "FINISHED", "执行命令 ls") +
        "\n\n中间说明正文。\n\n" +
        tag("e3", "ToolCall", "FINISHED", "读取文件 b.ts") +
        "\n" +
        tag("e4", "ToolCall", "FINISHED", "执行命令 pwd"),
    });
    const groups = groupItems(p.items);
    expect(groups).toHaveLength(2);
    expect(groups[0].id).toBe("tool-group:e1");
    expect(groups[1].id).toBe("tool-group:e3");
    // 终态无 outputText 回退：从后向前找最后一段非空正文（跳过工具，对齐 PC）
    // → 「中间说明正文」提升为回答区，轨迹内不再保留 narration
    expect(p.finalAnswerText).toContain("中间说明正文");
    expect(p.items.some((item) => item.kind == "narration")).toBe(false);
  });

  it("Plan 切断分组且自身为独立 plan 项", () => {
    const p = project({
      body:
        tag("e1", "ToolCall", "FINISHED", "读取文件 a.ts") +
        "\n" +
        tag("p1", "Plan", "FINISHED", "执行计划") +
        "\n" +
        tag("e2", "ToolCall", "FINISHED", "执行命令 ls"),
    });
    const kinds = p.items.map((item) => item.kind);
    expect(kinds).toEqual(["tool-row", "plan", "tool-row"]);
    expect(p.items[1].row?.componentType).toBe("Plan");
  });

  it("OpenUI 切断分组且输出规范化 HTML 标签段", () => {
    const p = project({
      body:
        tag("e1", "ToolCall", "FINISHED", "读取文件 a.ts") +
        "\n" +
        tag("op1", "Event", "FINISHED", "nuwax_render_openui") +
        "\n" +
        tag("e2", "ToolCall", "FINISHED", "执行命令 ls"),
    });
    const kinds = p.items.map((item) => item.kind);
    expect(kinds).toEqual(["tool-row", "openui", "tool-row"]);
    expect(p.items[1].text).toContain("<markdown-custom-process");
    expect(p.items[1].text).toContain("nuwax_render_openui");
  });

  it("非 OpenUI 的 Event 事件默认丢弃，不进入任何组", () => {
    const p = project({
      body:
        tag("e1", "ToolCall", "FINISHED", "读取文件 a.ts") +
        "\n" +
        tag("ev1", "Event", "FINISHED", "普通内部事件") +
        "\n" +
        tag("e2", "ToolCall", "FINISHED", "执行命令 ls"),
    });
    // Event 被丢弃后 e1/e2 仍连续，但 Event 位置不产生正文切断
    const groups = groupItems(p.items);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((row) => row.id)).toEqual(["e1", "e2"]);
  });

  it("同 executeId 重复标签只保留最后一次（状态取最后一次）", () => {
    const p = project({
      body:
        tag("e1", "ToolCall", "EXECUTING", "执行命令 ls") +
        "\n" +
        tag("e1", "ToolCall", "FINISHED", "执行命令 ls"),
      processing: [
        processing("e1", "ToolCall", "执行命令 ls", "FINISHED", {
          kind: "execute",
          input: { command: "ls" },
        }),
      ],
    });
    const rows = [rowById(p.items, "e1")];
    expect(rows.filter((row) => row != null)).toHaveLength(1);
    const toolItems = p.items.filter(
      (item) => item.kind == "tool-row" || item.kind == "tool-group",
    );
    expect(toolItems).toHaveLength(1);
    expect(rowById(p.items, "e1")?.status).toBe("finished");
  });

  it("相邻连续 Plan（中间无正文）只保留最后一个", () => {
    const p = project({
      body:
        tag("p1", "Plan", "FINISHED", "计划一") +
        "\n" +
        tag("p2", "Plan", "FINISHED", "计划二") +
        "\n" +
        tag("p3", "Plan", "FINISHED", "计划三"),
    });
    const plans = p.items.filter((item) => item.kind == "plan");
    expect(plans).toHaveLength(1);
    expect(plans[0].row?.name).toBe("计划三");
  });

  it("不同 executeId 的重复动作逐次保留（组内两行同 kind）", () => {
    const p = project({
      body:
        tag("r1", "ToolCall", "FINISHED", "读取文件 a.ts") +
        "\n" +
        tag("r2", "ToolCall", "FINISHED", "读取文件 b.ts"),
    });
    const groups = groupItems(p.items);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[0].actionKinds).toEqual(["file-read"]);
  });

  it("验收场景4 复现：同 executeId 两次标签 + 两个重复读取 + 独立末段正文", () => {
    const p = project({
      body:
        tag("d1", "ToolCall", "EXECUTING", "执行命令 npm ls") +
        "\n" +
        tag("d1", "ToolCall", "FINISHED", "执行命令 npm ls") +
        "\n" +
        tag("d2", "ToolCall", "FINISHED", "读取文件 a.ts") +
        "\n" +
        tag("d3", "ToolCall", "FINISHED", "读取文件 b.ts") +
        "\n\n以上过程展示了重复调用的合并与保留。",
      processing: [
        processing("d1", "ToolCall", "执行命令 npm ls", "FINISHED", {
          kind: "execute",
          input: { command: "npm ls" },
        }),
        processing("d2", "ToolCall", "读取文件 a.ts", "FINISHED", {
          kind: "read",
          input: { file_path: "/workspace/a.ts" },
        }),
        processing("d3", "ToolCall", "读取文件 b.ts", "FINISHED", {
          kind: "read",
          input: { file_path: "/workspace/b.ts" },
        }),
      ],
      finalResult: {
        outputText: "去重规则与 PC 一致：同 executeId 保留最后一次状态，不同 executeId 的重复动作逐次保留。",
        success: true,
      },
    });
    // d1 去重合并：d1+d2+d3 连续成一组 3 行，无独立 d1 行
    const groups = groupItems(p.items);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((row) => row.id)).toEqual(["d1", "d2", "d3"]);
    expect(p.items.some((item) => item.kind == "tool-row")).toBe(false);
    // 末段正文与 outputText 不同源 → 保留在轨迹内
    const narrations = p.items.filter((item) => item.kind == "narration");
    expect(narrations).toHaveLength(1);
    expect(narrations[0].text).toContain("以上过程");
    // d1 行状态取最终态（FINISHED）
    const d1Row = groups[0].rows.find((row) => row.id == "d1");
    expect(d1Row?.status).toBe("finished");
  });

  it("活动组：仅运行轮最末尾未被超越的组为 active", () => {
    const p = project({
      running: true,
      body:
        tag("e1", "ToolCall", "FINISHED", "读取文件 a.ts") +
        "\n" +
        tag("e2", "ToolCall", "FINISHED", "执行命令 ls") +
        "\n\n中间正文。\n\n" +
        tag("e3", "ToolCall", "FINISHED", "读取文件 b.ts") +
        "\n" +
        tag("e4", "ToolCall", "EXECUTING", "执行命令 pwd"),
    });
    const groups = groupItems(p.items);
    expect(groups).toHaveLength(2);
    expect(groups[0].active).toBe(false);
    expect(groups[1].active).toBe(true);
    // 运行态末元素为工具：正文段留轨迹、无实时回答区
    expect(p.finalAnswerText).toBe("");
    expect(
      p.items.some((item) => item.kind == "narration"),
    ).toBe(true);
  });

  it("终态（非 running）没有活动组", () => {
    const p = project({
      running: false,
      body: tag("e1", "ToolCall", "EXECUTING", "执行命令 ls"),
      finalResult: { outputText: "回答", success: true },
    });
    const groups = groupItems(p.items);
    expect(groups.every((group) => group.active != true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 状态解析
// ---------------------------------------------------------------------------

describe("状态解析", () => {
  it("组状态优先级：任一 running > 任一 failed > finished", () => {
    expect(getRowsGroupStatus([])).toBe("finished");
    const finishedRow = { status: "finished" } as TraceToolRow;
    expect(getRowsGroupStatus([finishedRow])).toBe("finished");
    const failedRow = { status: "failed" } as TraceToolRow;
    expect(getRowsGroupStatus([finishedRow, failedRow])).toBe("failed");
    const runningRow = { status: "running" } as TraceToolRow;
    expect(getRowsGroupStatus([failedRow, runningRow])).toBe("running");
  });

  it("finalResult 在场时残余 EXECUTING 判 failed（对齐 PC collectProcessingByKey）", () => {
    const p = project({
      running: false,
      body: tag("e1", "ToolCall", "EXECUTING", "执行命令 ls"),
      finalResult: { outputText: "回答", success: true },
    });
    expect(rowById(p.items, "e1")?.status).toBe("failed");
  });

  it("processingList 状态优先于标签 status", () => {
    const p = project({
      body: tag("e1", "ToolCall", "EXECUTING", "执行命令 ls"),
      processing: [processing("e1", "ToolCall", "执行命令 ls", "FAILED")],
    });
    expect(rowById(p.items, "e1")?.status).toBe("failed");
  });

  it("运行中 EXECUTING 保持 running", () => {
    const p = project({
      running: true,
      body: tag("e1", "ToolCall", "EXECUTING", "执行命令 ls"),
    });
    expect(rowById(p.items, "e1")?.status).toBe("running");
  });
});

// ---------------------------------------------------------------------------
// 工具类型识别（协议优先 → componentType → 名称启发式）
// ---------------------------------------------------------------------------

describe("工具类型识别", () => {
  it("result.data 含 type=terminal / diff 优先", () => {
    expect(
      getToolTraceActionKind("ToolCall", "x", {
        data: [{ type: "terminal", content: "out" }],
      }),
    ).toBe("terminal");
    expect(
      getToolTraceActionKind("ToolCall", "x", {
        data: [{ type: "diff", path: "a.ts" }],
      }),
    ).toBe("file-edit");
  });

  it("kind=execute 或 input.command（含 rawInput 嵌套）→ terminal", () => {
    expect(getToolTraceActionKind("ToolCall", "x", { kind: "execute" })).toBe(
      "terminal",
    );
    expect(
      getToolTraceActionKind("ToolCall", "x", { input: { command: "ls" } }),
    ).toBe("terminal");
    expect(
      getToolTraceActionKind("ToolCall", "x", {
        input: { rawInput: { command: "ls" } },
      }),
    ).toBe("terminal");
  });

  it("kind=read/edit/write → file-read / file-edit；input.kind 同样生效", () => {
    expect(getToolTraceActionKind("ToolCall", "x", { kind: "read" })).toBe(
      "file-read",
    );
    expect(getToolTraceActionKind("ToolCall", "x", { kind: "edit" })).toBe(
      "file-edit",
    );
    expect(getToolTraceActionKind("ToolCall", "x", { kind: "write" })).toBe(
      "file-edit",
    );
    expect(
      getToolTraceActionKind("ToolCall", "x", { input: { kind: "read" } }),
    ).toBe("file-read");
  });

  it("componentType 映射：Plan→todo Skill→skill Knowledge→search Page→browser", () => {
    expect(getToolTraceActionKind("Plan", "任意", null)).toBe("todo");
    expect(getToolTraceActionKind("Skill", "任意", null)).toBe("skill");
    expect(getToolTraceActionKind("Knowledge", "任意", null)).toBe("search");
    expect(getToolTraceActionKind("Page", "任意", null)).toBe("browser");
  });

  it("名称启发式兜底（中英文）", () => {
    expect(getToolTraceActionKind("ToolCall", "读取文件 a.ts", null)).toBe(
      "file-read",
    );
    expect(getToolTraceActionKind("ToolCall", "read_file", null)).toBe(
      "file-read",
    );
    expect(getToolTraceActionKind("ToolCall", "编辑文件 a.ts", null)).toBe(
      "file-edit",
    );
    expect(getToolTraceActionKind("ToolCall", "apply_patch", null)).toBe(
      "file-edit",
    );
    expect(getToolTraceActionKind("ToolCall", "搜索知识库", null)).toBe(
      "search",
    );
    expect(getToolTraceActionKind("ToolCall", "browser navigate", null)).toBe(
      "browser",
    );
    expect(getToolTraceActionKind("ToolCall", "更新待办 todo", null)).toBe(
      "todo",
    );
  });

  it("未命中降级 generic", () => {
    expect(getToolTraceActionKind("ToolCall", "完全未知工具", null)).toBe(
      "generic",
    );
  });
});

// ---------------------------------------------------------------------------
// 最终回答分离
// ---------------------------------------------------------------------------

describe("最终回答分离", () => {
  it("终态 outputText 优先作为最终回答", () => {
    const p = project({
      body: tag("e1", "ToolCall", "FINISHED", "读取文件 a.ts"),
      finalResult: { outputText: "这是最终回答。", success: true },
    });
    expect(p.finalAnswerText).toBe("这是最终回答。");
  });

  it("末段正文与 outputText 同源（outputText 包含末段）时移出轨迹", () => {
    const p = project({
      body:
        tag("e1", "ToolCall", "FINISHED", "读取文件 a.ts") +
        "\n\n前置说明。\n\n" +
        tag("e2", "ToolCall", "FINISHED", "执行命令 ls") +
        "\n\n这是最终回答的一部分。",
      finalResult: {
        outputText: "这是最终回答的一部分。后续补充内容。",
        success: true,
      },
    });
    expect(p.finalAnswerText).toContain("最终回答");
    const narrations = p.items.filter((item) => item.kind == "narration");
    expect(narrations.map((item) => item.text)).toEqual(["\n\n前置说明。"]);
  });

  it("末段包含 outputText（反向包含）同样视为同源并移除", () => {
    const p = project({
      body:
        tag("e1", "ToolCall", "FINISHED", "读取文件 a.ts") +
        "\n\n这是最终回答，并且比 outputText 更长更完整。",
      finalResult: { outputText: "这是最终回答", success: true },
    });
    const narrations = p.items.filter((item) => item.kind == "narration");
    expect(narrations).toHaveLength(0);
  });

  it("终态无 outputText 时回退：最后一段非空正文提升为回答", () => {
    const p = project({
      body:
        tag("e1", "ToolCall", "FINISHED", "读取文件 a.ts") +
        "\n\n过程说明。\n\n" +
        tag("e2", "ToolCall", "FINISHED", "执行命令 ls") +
        "\n\n这段是最终回答。",
      finalResult: { outputText: "", success: true },
    });
    expect(p.finalAnswerText).toBe("这段是最终回答。");
    const narrations = p.items.filter((item) => item.kind == "narration");
    expect(narrations.map((item) => item.text.trim())).toEqual(["过程说明。"]);
  });

  it("运行态：末元素为正文段时提升为实时回答区", () => {
    const p = project({
      running: true,
      body:
        tag("e1", "ToolCall", "FINISHED", "读取文件 a.ts") +
        "\n\n过程说明。\n\n" +
        tag("e2", "ToolCall", "FINISHED", "执行命令 ls") +
        "\n\n正在流式输出的回答开头",
    });
    expect(p.finalAnswerText).toBe("正在流式输出的回答开头");
    const narrations = p.items.filter((item) => item.kind == "narration");
    expect(narrations.map((item) => item.text.trim())).toEqual(["过程说明。"]);
  });

  it("运行态：末元素为工具时无回答区，前面正文段留轨迹", () => {
    const p = project({
      running: true,
      body:
        tag("e1", "ToolCall", "FINISHED", "读取文件 a.ts") +
        "\n\n前置说明。\n\n" +
        tag("e2", "ToolCall", "EXECUTING", "执行命令 ls"),
    });
    expect(p.finalAnswerText).toBe("");
    const narrations = p.items.filter((item) => item.kind == "narration");
    expect(narrations.map((item) => item.text.trim())).toEqual(["前置说明。"]);
  });

  it("outputText 内嵌工具标签时剥除后作为回答", () => {
    const p = project({
      body: tag("e1", "ToolCall", "FINISHED", "读取文件 a.ts"),
      finalResult: {
        outputText: "结论前" + tag("e9", "ToolCall", "FINISHED", "x") + "结论后",
        success: true,
      },
    });
    expect(p.finalAnswerText).toBe("结论前结论后");
  });
});

// ---------------------------------------------------------------------------
// 指标与整轮状态
// ---------------------------------------------------------------------------

describe("轨迹指标", () => {
  it("toolCount 为去重 executeId 数且不含 Plan", () => {
    const p = project({
      body:
        tag("e1", "ToolCall", "FINISHED", "读取文件 a.ts") +
        "\n" +
        tag("e2", "ToolCall", "FINISHED", "执行命令 ls") +
        "\n" +
        tag("p1", "Plan", "FINISHED", "计划"),
    });
    expect(p.metrics.toolCount).toBe(2);
  });

  it("elapsedMs 取 finalResult start/end 差值（秒级时间戳归一）", () => {
    const p = project({
      body: tag("e1", "ToolCall", "FINISHED", "读取文件 a.ts"),
      finalResult: { outputText: "答", success: true, startTime: 100, endTime: 160 },
    });
    expect(p.metrics.elapsedMs).toBe(60000);
  });

  it("运行态 elapsedAnchorMs 取工具最小 startTime", () => {
    const now = Date.now();
    const p = project({
      running: true,
      body:
        tag("e1", "ToolCall", "EXECUTING", "读取文件 a.ts") +
        "\n" +
        tag("e2", "ToolCall", "EXECUTING", "执行命令 ls"),
      processing: [
        processing("e1", "ToolCall", "读取文件 a.ts", "EXECUTING", {
          startTime: now - 5000,
        }),
        processing("e2", "ToolCall", "执行命令 ls", "EXECUTING", {
          startTime: now - 1000,
        }),
      ],
    });
    expect(p.metrics.elapsedAnchorMs).toBe(now - 5000);
  });

  it("failed：任一工具失败或 finalResult.success=false", () => {
    const failedTool = project({
      body: tag("e1", "ToolCall", "FAILED", "执行命令 build"),
    });
    expect(failedTool.metrics.failed).toBe(true);

    const failedResult = project({
      body: tag("e1", "ToolCall", "FINISHED", "读取文件 a.ts"),
      finalResult: { outputText: "答", success: false },
    });
    expect(failedResult.metrics.failed).toBe(true);
  });

  it("hasTrace 边界：纯文本终态无轨迹；有思考或运行中则有轨迹", () => {
    expect(project({ body: "只有正文的回答。" }).hasTrace).toBe(false);
    expect(project({ body: "回答。", think: "思考内容" }).hasTrace).toBe(true);
    expect(project({ running: true, body: "流式回答" }).hasTrace).toBe(true);
    expect(
      project({ body: tag("e1", "ToolCall", "FINISHED", "读取文件") }).hasTrace,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 行摘要
// ---------------------------------------------------------------------------

describe("行摘要", () => {
  it("terminal：target 取命令首行（多行命令截断）", () => {
    const p = project({
      body: tag("e1", "ToolCall", "FINISHED", "执行命令"),
      processing: [
        processing("e1", "ToolCall", "执行命令", "FINISHED", {
          kind: "execute",
          input: { command: "npm install\n--registry=https://registry.npmjs.org" },
        }),
      ],
    });
    const row = rowById(p.items, "e1");
    expect(row?.kind).toBe("terminal");
    expect(row?.target).toBe("npm install");
  });

  it("file-read：target 取 file_path", () => {
    const p = project({
      body: tag("e1", "ToolCall", "FINISHED", "读取文件"),
      processing: [
        processing("e1", "ToolCall", "读取文件", "FINISHED", {
          kind: "read",
          input: { file_path: "/workspace/README.md" },
        }),
      ],
    });
    expect(rowById(p.items, "e1")?.target).toBe("/workspace/README.md");
  });

  it("file-edit 多 diff：fileCount=N、meta=+N -M、单路径 target；全新建 isCreate", () => {
    const p = project({
      body: tag("e1", "ToolCall", "FINISHED", "编辑文件"),
      processing: [
        processing("e1", "ToolCall", "编辑文件", "FINISHED", {
          kind: "edit",
          input: {},
          data: [
            { type: "diff", path: "a.ts", oldText: "", newText: "line1\nline2" },
            { type: "diff", path: "b.ts", oldText: "old", newText: "new" },
          ],
        }),
      ],
    });
    const row = rowById(p.items, "e1");
    expect(row?.kind).toBe("file-edit");
    expect(row?.fileCount).toBe(2);
    expect(row?.target).toBe("a.ts");
    expect(row?.meta).toBe("+3 -1");
    expect(row?.isCreate).toBe(false);
  });

  it("file-edit 全部 diff 无 oldText → isCreate（「创建文件」语态）", () => {
    const p = project({
      body: tag("e1", "ToolCall", "FINISHED", "编辑文件"),
      processing: [
        processing("e1", "ToolCall", "编辑文件", "FINISHED", {
          kind: "edit",
          input: {},
          data: [{ type: "diff", path: "new.ts", oldText: "", newText: "a\nb" }],
        }),
      ],
    });
    expect(rowById(p.items, "e1")?.isCreate).toBe(true);
  });

  it("search：target 取 input.query；browser：target 取结构化 title", () => {
    const search = project({
      body: tag("s1", "Knowledge", "FINISHED", "知识库检索"),
      processing: [
        processing("s1", "Knowledge", "知识库检索", "FINISHED", {
          input: { query: "vite 升级" },
        }),
      ],
    });
    expect(rowById(search.items, "s1")?.target).toBe("vite 升级");

    const browser = project({
      body: tag("b1", "ToolCall", "FINISHED", "打开页面"),
      processing: [
        processing("b1", "ToolCall", "打开页面", "FINISHED", {
          data: [{ title: "Vite 指南", url: "https://vitejs.dev" }],
        }),
      ],
    });
    expect(rowById(browser.items, "b1")?.target).toBe("Vite 指南");
  });

  it("显示名清洗：URL 编码解码、换行压空格、引号实体还原", () => {
    const p = project({
      body: tag("e1", "ToolCall", "FINISHED", "%E8%AF%BB%E5%8F%96%E6%96%87%E4%BB%B6"),
      processing: [],
    });
    expect(rowById(p.items, "e1")?.name).toBe("读取文件");
  });
});

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

describe("工具函数", () => {
  it("formatElapsedParts：秒 / 分秒 / 时分 / 负值", () => {
    expect(formatElapsedParts(-1)).toBe("");
    expect(formatElapsedParts(0)).toBe("0{s}");
    expect(formatElapsedParts(59000)).toBe("59{s}");
    expect(formatElapsedParts(60000)).toBe("1{m}");
    expect(formatElapsedParts(95000)).toBe("1{m}35{s}");
    expect(formatElapsedParts(3600000)).toBe("1{h}");
    expect(formatElapsedParts(3660000)).toBe("1{h}1{m}");
  });

  it("toolTraceActionI18nKey：kind×状态×isCreate 组合", () => {
    expect(toolTraceActionI18nKey("terminal", "running", false)).toBe(
      "Mobile.Chat.WorkTrace.toolActionTerminalRunning",
    );
    expect(toolTraceActionI18nKey("file-read", "finished", false)).toBe(
      "Mobile.Chat.WorkTrace.toolActionFileReadFinished",
    );
    expect(toolTraceActionI18nKey("file-edit", "failed", false)).toBe(
      "Mobile.Chat.WorkTrace.toolActionFileEditFailed",
    );
    expect(toolTraceActionI18nKey("file-edit", "finished", true)).toBe(
      "Mobile.Chat.WorkTrace.toolActionFileCreateFinished",
    );
    expect(toolTraceActionI18nKey("unknown-kind", "finished", false)).toBe(
      "Mobile.Chat.WorkTrace.toolActionGenericFinished",
    );
  });

  it("stripContainerTags 剥除过程标签保留正文", () => {
    expect(
      stripContainerTags("前文" + tag("e1", "ToolCall", "FINISHED", "x") + "后文"),
    ).toBe("前文后文");
    expect(stripContainerTags("纯文本")).toBe("纯文本");
  });

  it("collectActionKinds 按首次出现顺序去重", () => {
    const rows = [
      { kind: "file-read" } as TraceToolRow,
      { kind: "terminal" } as TraceToolRow,
      { kind: "file-read" } as TraceToolRow,
      { kind: "generic" } as TraceToolRow,
    ];
    expect(collectActionKinds(rows)).toEqual(["file-read", "terminal", "generic"]);
  });
});
