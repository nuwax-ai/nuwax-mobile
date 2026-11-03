import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureAppWebViewNavigationReady,
  isNativeAppWebView,
} from "../utils/appWebViewNavigation.uts";
import {
  spaceInviteCodeFromUrl,
  spaceInvitePageUrl,
} from "../utils/spaceInvite.uts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("邀请网页的原生导航桥", () => {
  it("浏览器即使加载了 JSSDK，也不当作 App", async () => {
    vi.stubGlobal("window", { uni: { webView: { navigateTo: vi.fn() } } });
    expect(isNativeAppWebView()).toBe(false);
    expect(await ensureAppWebViewNavigationReady()).toBe(false);
  });
  it("外链容器按需加载已发布的 JSSDK，并使用真实 SDK 的原生服务通道", async () => {
    const nativeService = vi.fn();
    const document = {
      addEventListener: vi.fn(),
      createElement: () => ({}),
      head: { appendChild: vi.fn() },
    };
    const w: any = {
      document,
      __uniapp_x_postMessage: vi.fn(),
      __uniapp_x_postMessageToService: nativeService,
    };
    vi.stubGlobal("window", w);
    document.head.appendChild.mockImplementation((script: any) => {
      expect(script.src).toBe("./static/uni.webview.1.5.5.js");
      const context: any = {
        window: w,
        document,
        navigator: { userAgent: "uni-app appview" },
        setTimeout,
        CustomEvent: vi.fn(),
      };
      context.self = context;
      runInNewContext(
        readFileSync("static/uni.webview.1.5.5.js", "utf8"),
        context,
      );
      w.uni = context.uni;
      script.onload();
    });
    expect(await ensureAppWebViewNavigationReady()).toBe(true);
    w.uni.webView.navigateTo({
      url: "/pages/message/chat?convId=9007199254740993&convType=4",
    });
    expect(nativeService).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "WEB_INVOKE_APPSERVICE",
        args: expect.objectContaining({
          data: expect.objectContaining({
            name: "navigateTo",
            arg: {
              url: "/pages/message/chat?convId=9007199254740993&convType=4",
            },
          }),
        }),
      }),
    );
  });
  it("桥未就绪时有界超时，后续点击可以重新加载", async () => {
    vi.useFakeTimers();
    const appendChild = vi.fn();
    const w: any = {
      __uniapp_x_postMessage: vi.fn(),
      document: { createElement: () => ({}), head: { appendChild } },
    };
    vi.stubGlobal("window", w);
    const first = ensureAppWebViewNavigationReady();
    const duplicate = ensureAppWebViewNavigationReady();
    expect(appendChild).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await first).toBe(false);
    expect(await duplicate).toBe(false);
    w.uni = { webView: { navigateTo: vi.fn() } };
    expect(await ensureAppWebViewNavigationReady()).toBe(true);
  });
});

describe("IM 邀请链接复用原生确认页", () => {
  const source = readFileSync("utils/system.uts", "utf8");
  const start = source.indexOf("export function openNativeSpaceInviteLink");
  const end = source.indexOf("/**", start);
  const code = transformSync(
    source.slice(start, end).replace("export ", "") +
      "\nopenNativeSpaceInviteLink;",
    { loader: "ts" },
  ).code;
  it.each([
    ["https://team.example/invite/space/school%26code", true],
    ["/invite/space/school%26code", true],
    ["https://other.example/invite/space/school%26code", false],
    ["https://team.example.attacker/invite/space/school%26code", false],
    ["https://team.example/home", false],
  ])("%s 只接手当前服务域的邀请", (url, accepted) => {
    const navigate = vi.fn();
    const open = runInNewContext(code, {
      getApiBaseUrl: () => "https://team.example",
      normalizeExternalHref: (v: string) => v,
      spaceInviteCodeFromUrl,
      spaceInvitePageUrl,
      navigateToPageOnce: navigate,
    });
    expect(open(url)).toBe(accepted);
    if (accepted)
      expect(navigate).toHaveBeenCalledExactlyOnceWith(
        "/subpackages/pages/space-invite/space-invite?code=school%26code",
      );
    else expect(navigate).not.toHaveBeenCalled();
  });
});
