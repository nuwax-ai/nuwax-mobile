import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { buildEditorAtomicReplacementScript } from "@/utils/editorAtomicReplacement.uts";

describe("editor atomic replacement bridge", () => {
  function execute(original: any[], expected: string, change: any, cursor: number) {
    let cells = original.slice();
    const frames: any[][] = [];
    let selection = -1;
    const q = {
      history: { cutoff() {} },
      getContents: () => ({ ops: cells.map(insert => ({ insert })) }),
      updateContents(delta: any) {
        let offset = 0;
        const result: any[] = [];
        for (const op of delta.ops) {
          if (op.retain) { result.push(...cells.slice(offset, offset + op.retain)); offset += op.retain; }
          else if (op.delete) offset += op.delete;
          else if (typeof op.insert === "string") result.push(...op.insert.split(""));
          else result.push(op.insert);
        }
        cells = [...result, ...cells.slice(offset)];
        frames.push(cells.slice());
      },
      setSelection(index: number) { selection = index; },
      clear() { throw new Error("must not clear the editor"); },
      setContents() { throw new Error("must not rebuild the document"); },
    };
    runInNewContext(buildEditorAtomicReplacementScript({ expected, change, cursor }), {
      document: { querySelector: () => ({ __quill: q }) },
    });
    return { cells, frames, selection };
  }

  it("replaces a middle trigger in one visible update, preserving existing embeds and suffix", () => {
    const existing = { mention: { id: "skill|1", name: "已有技能" } };
    const added = { mention: { id: "skill|2", name: "新技能" } };
    const original = [existing, ..." /new 后文\n".split("")];
    const result = execute(original, "\ufffc /new 后文", {
      ops: [{ retain: 2 }, { delete: 4 }, { insert: added }, { insert: " " }],
    }, 4);
    expect(result.frames).toHaveLength(1);
    expect(result.cells).toEqual([existing, " ", added, ..."  后文\n".split("")]);
    expect(result.cells[0]).toBe(existing);
    expect(result.selection).toBe(4);
  });

  it("treats configured names as data, including quotes and script-like text", () => {
    const name = "');throw new Error('injected');//\n中文";
    const added = { mention: { id: "context-file|a", name } };
    const result = execute("@a\n".split(""), "@a", {
      ops: [{ delete: 2 }, { insert: added }, { insert: " " }],
    }, 2);
    expect(result.frames).toHaveLength(1);
    expect(result.cells[0]).toEqual(added);
    expect(result.selection).toBe(2);
  });

  it("does not overwrite typing that occurred after the snapshot", () => {
    const result = execute("/newer\n".split(""), "/new", { ops: [{ delete: 4 }] }, 0);
    expect(result.frames).toHaveLength(0);
    expect(result.cells.join("")).toBe("/newer\n");
    expect(result.selection).toBe(-1);
  });

  it("dismisses a trigger while retaining text on both sides", () => {
    const result = execute("前 @a 后\n".split(""), "前 @a 后", {
      ops: [{ retain: 2 }, { delete: 2 }],
    }, 2);
    expect(result.frames).toHaveLength(1);
    expect(result.cells.join("")).toBe("前  后\n");
    expect(result.selection).toBe(2);
  });
});
