import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { expect, it, vi } from "vitest";

function createStore(initial: object[]) {
  const storage = new Map<string, string>([["nuwax_voice_note_sessions", JSON.stringify(initial)]]);
  const source = readFileSync("utils/voice-note/voiceNoteStore.uts", "utf8");
  const code = transformSync(source, { loader: "ts", format: "cjs" }).code;
  const module = { exports: {} };
  runInNewContext(code, {
    module, exports: module.exports, Date, JSON, parseFloat, isNaN,
    require: () => ({ pushVoiceNoteDebug: vi.fn() }),
    uni: { getStorageSync: (key: string) => storage.get(key), setStorageSync: (key: string, value: string) => storage.set(key, value) },
  });
  return { store: module.exports as any, storage };
}

it("读取旧录音后更新状态时保留旧缓存字段和分段信息", () => {
  const legacy = { localId: "local", noteId: "note", title: "记录", startedAt: 10, elapsedMs: 50,
    serverStatus: "PROCESSING", docUrl: "doc", asrText: "识别内容", updatedAt: 12, phase: "paused",
    accumulatedMs: 50, segments: [{ segmentIndex: 0, filePath: "/record.m4a", durationMs: 50,
      startedAt: 10, endedAt: 60, uploadStatus: "pending", uploadAttempts: 1, error: "网络错误" }] };
  const { store, storage } = createStore([legacy]);
  const note = store.loadVoiceNotes()[0];
  note.heldByCall = true;
  note.openSealAttempts = 1;
  store.upsertVoiceNote(note);
  const saved = JSON.parse(storage.get("nuwax_voice_note_sessions")!)[0];
  expect(saved).toMatchObject({ ...legacy, updatedAt: expect.any(Number), heldByCall: true, openSealAttempts: 1 });
});

it("新录音的补封口与来电中断字段可持久化并恢复", () => {
  const { store } = createStore([]);
  const note = new store.VoiceNoteRecord();
  note.localId = "new";
  note.heldByCall = true;
  note.openSealAttempts = 2;
  const segment = new store.VoiceNoteSegmentRecord();
  segment.filePath = "/new.m4a";
  segment.sealAttempts = 2;
  note.segments.push(segment);
  store.upsertVoiceNote(note);
  expect(store.loadVoiceNotes()[0]).toMatchObject({ localId: "new", heldByCall: true, openSealAttempts: 2,
    segments: [{ filePath: "/new.m4a", sealAttempts: 2 }] });
});

it("录音抽屉关闭时外层不抢占伙伴页的菜单及权限守卫", () => {
  const source = readFileSync("components/main-tab-content/main-tab-content.uvue", "utf8");
  const start = source.indexOf("  function handleDismissTouchStart(");
  expect(start).toBeGreaterThan(-1);
  const body = source.slice(start, source.indexOf("\n  }", start) + 4);
  const code = transformSync(`let recordDragToken = 0;\n${body}\nhandleDismissTouchStart;`, { loader: "ts" }).code;
  const begin = vi.fn(() => 1);
  const open = { value: false };
  const handle = runInNewContext(code, {
    partnerVoiceOpen: open, partnerVoiceOffset: { value: 0 }, partnerVoiceDragging: { value: false },
    touchPointX: () => 30, touchPointY: () => 40, beginPartnerVoiceDrag: begin,
  });
  handle({});
  expect(begin).not.toHaveBeenCalled();
  open.value = true;
  handle({});
  expect(begin).toHaveBeenCalledOnce();
});
