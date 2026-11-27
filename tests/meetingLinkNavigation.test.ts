import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("App meeting link navigation", () => {
  const system = readFileSync("utils/system.uts", "utf8");
  const start = system.indexOf("export function openNativeMeetingInviteLink");
  const end = system.indexOf("/**", start);
  const helper = system.slice(start, end);
  const chat = readFileSync("pages/message/components/chat-view.uvue", "utf8");

  it("routes Harmony meeting links to the native join page", () => {
    expect(helper).toContain("// #ifdef APP-ANDROID || APP-IOS || APP-HARMONY");
    expect(helper).toContain("// #ifndef APP-ANDROID || APP-IOS || APP-HARMONY");
    expect(helper).toContain("/subpackages/pages/im-meeting/im-meeting-join?room=");
    expect(helper).toContain("&auto=1");
  });

  it("uses the meeting-link interceptor for message links and action cards", () => {
    expect(chat).toContain("handleExternalLinkInWebview(url, \"\")");
    expect(chat).toContain("if (openNativeMeetingInviteLink(url)) return;");
    expect(chat).toContain("@join=\"handleBubbleTap(msg)\"");
    expect(chat).toContain("/subpackages/pages/im-meeting/im-meeting-room?room=");
  });
});
