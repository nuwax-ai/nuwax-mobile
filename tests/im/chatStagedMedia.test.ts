import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import { ChatStagedMedia, readStagedMedia, serializeStagedMedia, stagedMediaMime, stagedMediaName } from "../../utils/im/chatStagedMedia.uts";
import { loadUtsClass } from "./runtimeHarness";

const source = readFileSync("pages/message/chat.uvue", "utf8");
function section(from: string, to: string) {
  return source.slice(source.indexOf(from), source.indexOf(to));
}
function media(path: string, kind = "image") {
  const item = new ChatStagedMedia();
  item.localPath = path;
  item.kind = kind;
  return item;
}
class Row {
  outgoingMedia = [];
  imageAtts = [];
  linkAtts = [];
  videoUrl = "";
  videoPlayUrl = "";
  replyId = "";
  mentionIds = [];
  status = 0;
}
function chatHarness() {
  let id = 0;
  const scope: Record<string, any> = {
    StagedImage: ChatStagedMedia, ImMsgRow: Row, ImMsgAtt: class {},
    stagedMediaName, stagedMediaMime, serializeStagedMedia, readStagedMedia,
    stagedImages: { value: [] }, inputText: { value: "" }, messages: { value: [] },
    convId: { value: "42" }, quoteTarget: { value: null }, convDisbanded: { value: false },
    STAGED_IMAGE_MAX: 9, SUCCESS_CODE: "0", mediaSendChain: Promise.resolve(),
    generateUUID: () => `${++id}`, t: (key: string) => key, tCount: (key: string) => key,
    uni: { showToast: vi.fn(), navigateTo: vi.fn(), previewImage: vi.fn() },
    stopChatAudio: vi.fn(), pauseChatVideos: vi.fn(), queueMediaRow: vi.fn(),
    applyActiveMarks: (text: string) => text,
    scanMentions: () => ({ ids: [], all: false }),
    applyRichToRow: vi.fn(), applyQuoteToRow: vi.fn(), journalOutgoingRow: vi.fn(),
    maxSeq: () => 20, scrollToBottom: vi.fn(), isChatCurrent: () => true,
    uploadSingleFile: vi.fn(async (path: string, _id: string, _p: unknown, name: string) => ({
      success: true, file: { url: `/api/f/${encodeURIComponent(path)}`, name, type: "application/octet-stream", size: 123 },
    })),
    apiImSendRichTextMsg: vi.fn(async () => ({ code: "0" })),
    apiImSendMediaMsg: vi.fn(async () => ({ code: "0" })),
    apiResCode: (res: any) => res.code, apiResData: () => null, apiResMessage: () => "",
    buildConfirmedRow: (_data: unknown, row: any) => ({ ...row, outgoingMedia: [], status: 1 }),
    localSendPreviewOf: (path: string) => path,
    replaceByClientMsgId: vi.fn((row: any) => { scope.messages.value = [row]; }),
    findRowByClientMsgId: () => scope.messages.value[0],
    resolveRowMedia: vi.fn(), resolveSentAttRemote: vi.fn(), preloadChatVideos: vi.fn(),
    reportReadIfNeeded: vi.fn(), refreshReadStatus: vi.fn(), resetQuoteMentionSnapshot: vi.fn(),
    deferHarmonyAvaMount: vi.fn(), handleMuteRejection: () => false,
    readString: (obj: any, key: string) => obj[key] == null ? "" : `${obj[key]}`,
    readNumber: (obj: any, key: string, fallback: number) => obj[key] ?? fallback,
    readBool: (obj: any, key: string) => obj[key] === true,
    markRowFailed: vi.fn(() => { scope.messages.value[0].status = 2; }),
    localFileReadable: () => true, sendAudioWithRow: vi.fn(), sendMediaWithRow: vi.fn(), sendWithRow: vi.fn(),
  };
  const code = [
    section("  async function sendMediaWithRow(", "  async function sendRichTextWithRow("),
    section("  async function sendRichTextWithRow(", "  async function sendAudioWithRow("),
    section("  function dispatchStagedSend(", "  const LONG_TEXT_AS_FILE_THRESHOLD"),
    section("  function retrySendRow(", "  function handleSendFailTap("),
    section("  function handleStagedImageTap(", "  class MediaPermissionResult"),
    section("  function stagePickedAlbumFiles(", "  function handlePickImage("),
    section("  function failedRowToPayload(", "  function replaceByClientMsgId("),
    section("  function failedPayloadToRow(", "  function restoreFailedRows("),
  ].join("\n");
  const js = transformSync(code, { loader: "ts" }).code;
  const api = new Function("scope", `with(scope){${js};return {stagePickedAlbumFiles,dispatchStagedSend,handleStagedImageTap,retrySendRow,failedRowToPayload,failedPayloadToRow,sendMediaWithRow};}`)(scope);
  return { ...api, scope };
}

describe("album video staging", () => {
  it.each(["content://media/external/video/123", "/tmp/IMG_123.MOV", "/cache/视频.mp4"])("stages instead of sending: %s", (path) => {
    const h = chatHarness();
    h.stagePickedAlbumFiles([path], [true], 9);
    expect(h.scope.stagedImages.value[0]).toMatchObject({ kind: "video", localPath: path });
    expect(h.scope.queueMediaRow).not.toHaveBeenCalled();
    expect(h.scope.uploadSingleFile).not.toHaveBeenCalled();
  });
  it("shares the nine item limit across image and video, preserving posters", () => {
    const h = chatHarness();
    h.scope.stagedImages.value = Array.from({ length: 8 }, () => media("old.jpg"));
    h.stagePickedAlbumFiles(["a.mp4", "b.jpg"], [true, false], 1, ["cover.jpg", ""]);
    expect(h.scope.stagedImages.value).toHaveLength(9);
    expect(h.scope.stagedImages.value[8].poster).toBe("cover.jpg");
    expect(h.scope.uni.showToast).toHaveBeenCalledOnce();
  });
  it("keeps videos out of the image viewer and preserves video URI through routing", () => {
    const h = chatHarness();
    const path = "content://media/视频?id=1&name=100%25";
    h.scope.stagedImages.value = [media("a.jpg"), media(path, "video"), media("b.jpg")];
    h.handleStagedImageTap("b.jpg");
    expect(h.scope.uni.previewImage).toHaveBeenCalledWith({ urls: ["a.jpg", "b.jpg"], current: "b.jpg" });
    h.handleStagedImageTap(path);
    const url = h.scope.uni.navigateTo.mock.calls[0][0].url;
    expect(decodeURIComponent(url.split("?src=")[1])).toBe(path);
    expect(h.scope.stopChatAudio).toHaveBeenCalledOnce();
    expect(h.scope.pauseChatVideos).toHaveBeenCalledOnce();
    expect(h.scope.uploadSingleFile).not.toHaveBeenCalled();
  });
  it("sends a lone video through the existing media queue only after send", () => {
    const h = chatHarness();
    h.scope.stagedImages.value = [media("content://video/123", "video")];
    expect(h.dispatchStagedSend("")).toBe(true);
    expect(h.scope.queueMediaRow).toHaveBeenCalledWith("content://video/123", "123.mp4", false, true);
    expect(h.scope.stagedImages.value).toEqual([]);
  });
  it("uploads mixed media in order and sends one message with text and correct kinds", async () => {
    const h = chatHarness();
    h.scope.stagedImages.value = [media("v.mov", "video"), media("a.png"), media("b.jpg")];
    expect(h.dispatchStagedSend("一起发送")).toBe(true);
    expect(h.scope.messages.value[0].videoPlayUrl).toBe("v.mov");
    expect(h.scope.messages.value[0].imageAtts).toHaveLength(2);
    await h.scope.mediaSendChain;
    const call = h.scope.apiImSendRichTextMsg.mock.calls[0];
    expect(call[1]).toBe("一起发送");
    expect(JSON.parse(call[2]).map((a: any) => [a.kind, a.mime])).toEqual([
      ["video", "video/quicktime"], ["image", "image/png"], ["image", "image/jpeg"],
    ]);
    expect(h.scope.apiImSendRichTextMsg).toHaveBeenCalledOnce();
    // 视频排在前面时，远端图片回填仍使用图片数组的下标。
    expect(h.scope.resolveSentAttRemote.mock.calls.map((call: any[]) => call[1])).toEqual([0, 1]);
    expect(h.scope.messages.value[0].videoUrl).toContain("/api/f/");
    expect(h.scope.messages.value[0].imageAtts).toHaveLength(2);
    expect(h.scope.stagedImages.value).toEqual([]);
  });
  it("preserves single video kind when the upload service cannot identify its MIME", async () => {
    const h = chatHarness();
    const row = Object.assign(new Row(), { clientMsgId: "c", msgType: "file", videoUrl: "/tmp/123", videoFileName: "clip.mov" });
    h.scope.messages.value = [row];
    await h.sendMediaWithRow(row, "/tmp/123", "clip.mov");
    const call = h.scope.apiImSendMediaMsg.mock.calls[0];
    expect(call[1]).toBe("video");
    expect(call[5]).toBe("video/quicktime");
    expect(h.scope.messages.value[0].msgType).toBe("video");
  });
  it("retries a failed video with text as rich media, preserving local metadata", async () => {
    const h = chatHarness();
    h.scope.uploadSingleFile.mockResolvedValueOnce({ success: false, error: "offline" });
    h.scope.stagedImages.value = [media("/cache/no-extension", "video")];
    h.dispatchStagedSend("video caption");
    await h.scope.mediaSendChain;
    let failed = h.scope.messages.value[0];
    expect(failed.status).toBe(2);
    // 模拟持久化再恢复发件箱。
    failed = h.failedPayloadToRow(JSON.parse(JSON.stringify(h.failedRowToPayload(failed))));
    h.scope.messages.value = [failed];
    h.retrySendRow(failed);
    await h.scope.mediaSendChain;
    expect(JSON.parse(h.scope.apiImSendRichTextMsg.mock.calls[0][2])[0].kind).toBe("video");
    expect(h.scope.sendWithRow).not.toHaveBeenCalled();
    expect(h.scope.messages.value[0].status).toBe(1);
  });
  it("keeps an expired video in failed state and asks for reselection without uploading", () => {
    const h = chatHarness();
    const failed = Object.assign(new Row(), { status: 2, local: true, msgType: "rich_text", outgoingMedia: [media("/expired", "video")] });
    h.scope.localFileReadable = () => false;
    h.retrySendRow(failed);
    expect(failed.status).toBe(2);
    expect(h.scope.uni.showToast).toHaveBeenCalledWith({ title: "Mobile.Message.sendFileExpired", icon: "none" });
    expect(h.scope.uploadSingleFile).not.toHaveBeenCalled();
  });
});

describe("media drafts", () => {
  function drafts(storage: Map<string, unknown>) {
    return loadUtsClass("utils/im/chatDrafts.uts", "({getChatDraftMedia,getChatDraftImages,setChatDraft,chatDraftHasContent})", {
      ACCESS_TOKEN: "token", ACCESS_TOKEN_ORIGIN: "origin", ChatStagedMedia, readStagedMedia, serializeStagedMedia,
      uni: { getStorageSync: (key: string) => storage.get(key) ?? "", setStorageSync: (key: string, value: unknown) => storage.set(key, value) },
    });
  }
  it("restores old image drafts and preserves video types across a module reload", () => {
    const storage = new Map<string, unknown>([["IM_CHAT_DRAFTS", JSON.stringify({ s: "|", items: [{ id: "legacy", t: "", imgs: ["old.jpg"] }] })]]);
    const d = drafts(storage);
    expect(d.getChatDraftMedia("legacy")[0].kind).toBe("image");
    d.setChatDraft("new", "", [], [media("content://video/123", "video"), media("/tmp/a.jpg")]);
    const restored = drafts(storage);
    expect(restored.getChatDraftMedia("new").map((m: ChatStagedMedia) => m.kind)).toEqual(["video", "image"]);
    expect(restored.getChatDraftImages("new")).toEqual(["/tmp/a.jpg"]);
    expect(restored.chatDraftHasContent("new")).toBe(true);
    restored.setChatDraft("new", "");
    expect(drafts(storage).chatDraftHasContent("new")).toBe(false);
  });
  it("retains video-only drafts and returns independent media objects", () => {
    const d = drafts(new Map());
    d.setChatDraft("c", "", [], [media("/cache/123", "video")]);
    d.getChatDraftMedia("c")[0].kind = "image";
    expect(d.getChatDraftMedia("c")[0].kind).toBe("video");
    expect(d.chatDraftHasContent("c")).toBe(true);
    expect(d.getChatDraftImages("c")).toEqual([]);
  });
});
