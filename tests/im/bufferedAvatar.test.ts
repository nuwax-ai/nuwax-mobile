import { describe, expect, it } from "vitest";
import { loadUtsClass } from "./runtimeHarness";

const BufferedAvatarState = loadUtsClass(
  "utils/im/bufferedAvatar.uts",
  "BufferedAvatarState",
  {},
);

function loadedAvatar() {
  const state = new BufferedAvatarState();
  state.update("avatar-a", "display-a", false);
  const original = state.layers[0];
  state.imageLoaded(original.id);
  return { state, original };
}

describe("buffered avatars", () => {
  it("keeps the original node during resolution and until the new image loads", () => {
    const { state, original } = loadedAvatar();
    state.update("avatar-b", "", false);
    expect(state.layers).toEqual([original]);
    expect(state.loading).toBe(true);

    state.update("avatar-b", "display-b", false);
    const candidate = state.layers[1];
    expect(state.layers[0]).toBe(original);
    expect(candidate.loaded).toBe(false);

    expect(state.imageLoaded(candidate.id)).toBe(true);
    expect(state.layers).toEqual([candidate]);
    expect(state.layers[0]).toBe(candidate);
    expect(candidate.loaded).toBe(true);
    expect(state.loading).toBe(false);
  });

  it("retains the old image if the replacement fails", () => {
    const { state, original } = loadedAvatar();
    state.update("avatar-b", "display-b", false);
    expect(state.imageFailed(state.layers[1].id)).toBe(true);
    expect(state.layers).toEqual([original]);
    expect(state.loading).toBe(false);

    state.update("avatar-b", "display-b", true);
    expect(state.layers).toEqual([original]);
  });

  it("ignores success and error events from superseded images", () => {
    const { state, original } = loadedAvatar();
    state.update("avatar-b", "display-b", false);
    const superseded = state.layers[1];
    state.update("avatar-c", "", false);
    expect(state.imageLoaded(superseded.id)).toBe(false);
    expect(state.imageFailed(superseded.id)).toBe(false);
    expect(state.layers).toEqual([original]);

    state.update("avatar-c", "display-c", false);
    const latest = state.layers[1];
    expect(state.imageLoaded(superseded.id)).toBe(false);
    expect(state.imageLoaded(latest.id)).toBe(true);
    expect(state.layers[0].url).toBe("display-c");
  });

  it("keeps the loaded node when a list refresh supplies the same image", () => {
    const { state, original } = loadedAvatar();
    state.update("avatar-a", "display-a", false);
    expect(state.layers).toEqual([original]);
    expect(state.layers[0]).toBe(original);
    expect(state.loading).toBe(false);
    expect(state.imageLoaded(original.id)).toBe(false);
  });

  it("uses a placeholder on first load, and enables fallback only after failure", () => {
    const state = new BufferedAvatarState();
    state.update("avatar-a", "", false);
    expect(state.layers).toEqual([]);
    expect(state.loading).toBe(true);
    state.update("avatar-a", "display-a", false);
    state.imageFailed(state.layers[0].id);
    expect(state.layers).toEqual([]);
    expect(state.loading).toBe(false);
  });

  it("clears the old image only when the source explicitly removes the avatar", () => {
    const { state } = loadedAvatar();
    state.update("avatar-b", "display-b", false);
    const candidate = state.layers[1];
    state.update("", "", false);
    expect(state.layers).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.imageLoaded(candidate.id)).toBe(false);
  });

  it("can retry after a failed replacement without removing the old image", () => {
    const { state, original } = loadedAvatar();
    state.update("avatar-b", "display-b", false);
    const failed = state.layers[1];
    state.imageFailed(failed.id);
    state.update("avatar-b", "", false);
    state.update("avatar-b", "display-b", false);
    const retry = state.layers[1];
    expect(state.layers[0]).toBe(original);
    expect(retry.id).not.toBe(failed.id);
    expect(state.imageLoaded(failed.id)).toBe(false);
    expect(state.imageLoaded(retry.id)).toBe(true);
    expect(state.layers[0].url).toBe("display-b");
  });
});
