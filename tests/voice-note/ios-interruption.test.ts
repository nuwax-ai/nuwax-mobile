import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";

const localId = "1780000000000";
const path = (name: string) => "/documents/voice-notes/" + localId + "/" + name + ".m4a";

function selectIos(source: string): string {
  const conditions: boolean[] = [];
  const platforms = new Set(["APP", "APP-IOS"]);
  return source.split("\n").filter(line => {
    const condition = line.match(/^\s*\/\/ #if(n?)def (.+)$/);
    if (condition) {
      const enabled = condition[2].split("||").some(term =>
        term.split("&&").every(token => platforms.has(token.trim())),
      );
      conditions.push(condition[1] === "n" ? !enabled : enabled);
      return false;
    }
    if (/^\s*\/\/ #endif\b/.test(line)) {
      conditions.pop();
      return false;
    }
    return conditions.every(Boolean);
  }).join("\n").replace(/^import\s[\s\S]*?;\n/gm, "").replace(/^export /gm, "");
}

const source = readFileSync(new URL("../../utils/voice-note/voiceNoteEngine.uts", import.meta.url), "utf8");
const compiled = transformSync(selectIos(source), { loader: "ts", target: "esnext" }).code;

function harness() {
  let saved: any = null;
  let state = "";
  let journal: string[] = [];
  const files = new Map<string, string>();
  const note = () => structuredClone(saved);
  const upload = vi.fn(async () => "segment-id");
  const complete = vi.fn(async () => "note");
  const stop = vi.fn(async () => "1");
  const pause = vi.fn(async () => { state = ""; return "1"; });
  const requestResume = vi.fn(() => "1");
  const recorder = {
    recordingState: () => state,
    requestInterruptionResume: requestResume,
    takeClosedDurationMs: () => 0,
    configureInterruptionUpload: () => {},
    pause,
    stop,
  };
  const scope = {
    JSON: { parseArray: JSON.parse },
    uni: { getFileSystemManager: () => ({
      getFileInfo: ({ success }: { success: () => void }) => success(),
      unlink: ({ filePath, success }: { filePath: string; success: () => void }) => {
        files.delete(filePath);
        success();
      },
    }) },
    VoiceNoteSegmentRecord: class { sealAttempts = 0; },
    findOpenVoiceNote: () => note()?.awaitComplete ? null : note(),
    loadVoiceNotes: () => saved == null ? [] : [note()],
    upsertVoiceNote: (record: object) => { saved = structuredClone(record); },
    inspectIosVoiceNoteFile: (file: string) => files.get(file) ?? "missing",
    iosVoiceNoteRecoveryPaths: () => JSON.stringify(journal),
    acknowledgeIosVoiceNoteFile: (file: string) => { journal = journal.filter(item => item !== file); },
    iosVoiceNoteBackgroundUploadStatus: () => "",
    isAppInBackground: () => false,
    beginVoiceNoteBackground: () => {},
    endVoiceNoteBackground: () => {},
    iosVoiceNoteUploadContext: () => "",
    apiVoiceNoteUploadSegment: upload,
    apiVoiceNoteComplete: complete,
    setInterval: () => 1,
    clearInterval: () => {},
  };
  const engine = new Function(...Object.keys(scope), compiled + `
    return {
      pollVoiceInterruption,
      resumePausedNote,
      pauseActiveRecorder,
      finishM4aStop,
      pumpQueue,
      setRecorder: (native, path) => { m4aRecorder = native; currentSegmentPath = path; },
    };
  `)(...Object.values(scope));
  function seed(phase = "recording", openSegmentPath = "") {
    saved = {
      localId, noteId: "note", phase, openSegmentPath, openSegmentIndex: 0,
      accumulatedMs: 0, openElapsedMs: 0, segmentStartedAt: Date.now(),
      heldByCall: false, error: "", segments: [], awaitComplete: false,
    };
    engine.setRecorder(recorder, openSegmentPath);
    return saved;
  }
  function index(entries: [string, string][]) {
    journal = entries.map(entry => entry[0]);
    for (const [file, status] of entries) files.set(file, status);
  }
  return { engine, note, seed, index, files, upload, complete, stop, pause, requestResume,
    setState: (value: string) => { state = value; } };
}

describe("iOS voice note interruption", () => {
  it("stays frozen without a native live segment and adopts the actual resumed duration", async () => {
    const app = harness();
    const first = path("first");
    app.seed("recording", first);
    app.index([[first, "ready|1200"]]);
    app.setState("held|1200|" + first);
    await app.engine.pollVoiceInterruption();
    await app.engine.pollVoiceInterruption();
    expect(app.note()).toMatchObject({ phase: "paused", heldByCall: true, accumulatedMs: 1200, segmentStartedAt: 0 });
    expect(app.requestResume).not.toHaveBeenCalled();

    await app.engine.resumePausedNote(app.note());
    expect(app.requestResume).toHaveBeenCalledWith(localId);
    expect(app.note().phase).toBe("paused");

    const resumed = path("resumed");
    app.setState("live|2900|" + resumed);
    await app.engine.pollVoiceInterruption();
    expect(app.note()).toMatchObject({ phase: "recording", openSegmentPath: resumed, openElapsedMs: 0, heldByCall: false });
    expect(Date.now() - app.note().segmentStartedAt).toBeGreaterThanOrEqual(2900);
  });

  it("records the latest native paused state even after two interruptions while UTS slept", async () => {
    const app = harness();
    const first = path("first");
    const middle = path("middle");
    app.seed("recording", first);
    app.index([[first, "ready|1000"]]);
    app.setState("held|1000|" + first);
    await app.engine.pollVoiceInterruption();

    app.index([[middle, "ready|2500"]]);
    app.setState("held|2500|" + middle);
    await app.engine.pollVoiceInterruption();
    expect(app.note().segments.map((segment: any) => segment.filePath)).toEqual([first, middle]);
    expect(app.note()).toMatchObject({ phase: "paused", accumulatedMs: 3500 });
  });

  it("finishes with native order when the stop path is newer than an unregistered segment", async () => {
    const app = harness();
    const first = path("first");
    const middle = path("middle");
    const last = path("last");
    const record = app.seed("recording", last);
    record.openSegmentIndex = 1;
    record.segments = [{ filePath: first, segmentIndex: 0, durationMs: 1000, uploadStatus: "uploaded" }];
    app.index([[middle, "pending"], [last, "pending"]]);

    await app.engine.finishM4aStop("exit", last);
    expect(app.stop).toHaveBeenCalledOnce();
    expect(app.note().segments.map((segment: any) => [segment.filePath, segment.segmentIndex]))
      .toEqual([[first, 0], [middle, 1], [last, 2]]);
  });

  it("drops a cached empty candidate and still completes the valid audio", async () => {
    const app = harness();
    const first = path("first");
    const empty = path("empty");
    const last = path("last");
    const record = app.seed("uploading");
    record.awaitComplete = true;
    record.openSegmentIndex = 3;
    record.segments = [
      { filePath: first, segmentIndex: 0, durationMs: 1000, uploadStatus: "uploaded" },
      { filePath: empty, segmentIndex: 1, durationMs: 0, uploadStatus: "pending", sealAttempts: 3 },
      { filePath: last, segmentIndex: 2, durationMs: 2400, uploadStatus: "pending", uploadAttempts: 0 },
    ];
    app.files.set(empty, "empty");
    app.files.set(last, "ready|2400");
    await app.engine.pumpQueue(localId, false);
    expect(app.upload).toHaveBeenCalledExactlyOnceWith("note", last, 1, 2400);
    expect(app.complete).toHaveBeenCalledExactlyOnceWith("note", 2, true);
    expect(app.files.has(empty)).toBe(false);
    expect(app.note().phase).toBe("processing");
  });

  it("keeps unreadable media after repair exhaustion while uploading later valid audio", async () => {
    const app = harness();
    const corrupt = path("corrupt");
    const last = path("last");
    const record = app.seed("uploading");
    record.awaitComplete = true;
    record.segments = [
      { filePath: corrupt, segmentIndex: 0, durationMs: 0, uploadStatus: "pending", sealAttempts: 3 },
      { filePath: last, segmentIndex: 1, durationMs: 2000, uploadStatus: "pending", uploadAttempts: 0 },
    ];
    app.files.set(corrupt, "pending");
    app.files.set(last, "ready|2000");
    await app.engine.pumpQueue(localId, false);
    expect(app.upload).toHaveBeenCalledExactlyOnceWith("note", last, 1, 2000);
    expect(app.complete).not.toHaveBeenCalled();
    expect(app.note()).toMatchObject({ phase: "failed", error: "录音文件待修复" });
    expect(app.note().segments[0].filePath).toBe(corrupt);
  });

  it("syncs a user pause without asking for another automatic recovery", async () => {
    const app = harness();
    const first = path("first");
    app.seed("recording", first);
    app.index([[first, "ready|1500"]]);
    app.setState("held|1500|" + first);
    await app.engine.pollVoiceInterruption();
    await app.engine.pauseActiveRecorder(app.note());
    await app.engine.pollVoiceInterruption();
    expect(app.pause).toHaveBeenCalledOnce();
    expect(app.requestResume).not.toHaveBeenCalled();
    expect(app.note()).toMatchObject({ phase: "paused", heldByCall: false, accumulatedMs: 1500 });
  });
});
