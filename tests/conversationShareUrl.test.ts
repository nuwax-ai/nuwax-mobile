import { expect, it } from "vitest";
import { buildConversationShareUrl, nativeRouteFromConversationUrl } from "@/utils/conversationShareUrl.uts";

const origin = "https://testagent.xspaceagi.com";

it("浏览器会话地址保留业务参数，去掉宿主注入参数", () => {
  const href =
    origin +
    "/m/?offlineH5Attempt=1710000000000-1#/subpackages/pages/agent-detail/agent-detail?id=1596&conversationId=88&pType=UserApp&accessToken=secret&statusBarHeight=47&appEmbedded=1&safeAreaBottom=34&offlineH5RequestId=1710000000000-1";
  expect(buildConversationShareUrl(href, origin)).toBe(
    origin + "/m/#/subpackages/pages/agent-detail/agent-detail?id=1596&conversationId=88&pType=UserApp",
  );
});

it("内嵌页地址缺 /m/ 或域名多一个点时，收成同一条会话链接", () => {
  const href =
    "https://testagent.xspaceagi.com./#/subpackages/pages/agent-detail/agent-detail?id=1596&conversationId=1465924&offlineH5RequestId=1";
  expect(buildConversationShareUrl(href, origin)).toBe(
    origin +
      "/m/#/subpackages/pages/agent-detail/agent-detail?id=1596&conversationId=1465924",
  );
});

it("中转页带回的会话地址能还原成带参数的站内路由", () => {
  const pageUrl =
    origin +
    "/m/#/subpackages/pages/agent-detail/agent-detail?id=1596&conversationId=88&pType=UserApp";
  expect(nativeRouteFromConversationUrl(pageUrl, origin)).toBe(
    "/subpackages/pages/agent-detail/agent-detail?id=1596&conversationId=88&pType=UserApp",
  );
  expect(nativeRouteFromConversationUrl("https://evil.example/m/#/pages/index/index", origin)).toBe("");
  expect(
    nativeRouteFromConversationUrl(
      "https://testagent.xspaceagi.com./#/subpackages/pages/agent-detail/agent-detail?id=1596&conversationId=1465924",
      origin,
    ),
  ).toBe("/subpackages/pages/agent-detail/agent-detail?id=1596&conversationId=1465924");
});

it("离线包 file 地址改写成同一条 /m/ 会话链接", () => {
  const href =
    "file:///app/offline-h5/index.html?apiBase=" +
    encodeURIComponent(origin) +
    "#/subpackages/pages/agent-detail/agent-detail?id=1596&conversationId=88&pType=NormalProject&appNativeLogin=1&drawerTitleScope=account-scope-1&drawerTitleBootstrap=1&token=abc";
  expect(buildConversationShareUrl(href, "")).toBe(
    origin +
      "/m/#/subpackages/pages/agent-detail/agent-detail?id=1596&conversationId=88&pType=NormalProject",
  );
});
