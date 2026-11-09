import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";

function badgeHarness() {
  const source = readFileSync("utils/appIconBadge.uts", "utf8")
    .replace(/\/\/ #ifdef APP-ANDROID \|\| APP-IOS \|\| APP-HARMONY/g, "")
    .replace(/\/\/ #endif/g, "")
    .replace(/\bexport /g, "");
  const setAppBadgeNumber = vi.fn();
  const code = transformSync(source, { loader: "ts" }).code;
  const api = new Function("uni", `${code}; return {
    setAppIconBadgeSuppressed, clearAppIconBadge, syncAppIconBadge
  };`)({ setAppBadgeNumber });
  return { ...api, setAppBadgeNumber };
}

describe("app icon badge lifecycle", () => {
  it("keeps the icon clear in foreground without changing in-app unread state", () => {
    const h = badgeHarness();
    h.syncAppIconBadge(8);
    h.setAppIconBadgeSuppressed(true);
    h.syncAppIconBadge(12);
    expect(h.setAppBadgeNumber.mock.calls).toEqual([[8], [0]]);
  });

  it("clears on hide, then permits later background push badges", () => {
    const h = badgeHarness();
    h.setAppIconBadgeSuppressed(true);
    h.setAppIconBadgeSuppressed(false);
    h.clearAppIconBadge();
    h.syncAppIconBadge(3);
    expect(h.setAppBadgeNumber.mock.calls).toEqual([[0], [0], [3]]);
  });
});
