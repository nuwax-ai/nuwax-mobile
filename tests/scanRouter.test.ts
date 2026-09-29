/**
 * scanRouter 单测：四路分发 + build/match 对称性。
 *
 * 域名经 setApiBaseUrl / resetApiBaseUrl 走真实配置代码路径控制
 * （tests/setup.ts 已 mock uni storage；测试环境 DEFAULT_API_BASE_URL 为空串，
 * 正好覆盖「H5 同源生产、域名未配置」分支）。
 * 群码是 group#{群号}[#{convId}] 标识内容（非 URL）：group# 前缀判型，
 * 不看域名也不看群号位数（测试环境 10 位 / 契约 19 位都命中）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildGroupCardContent,
  buildUserCardUrl,
  cardUrlOrigin,
  extractUrlQueryValue,
  matchGroupCardContent,
  matchUserCardUrl,
  parseScanContent,
} from "@/utils/scanRouter.uts";
import { resetApiBaseUrl, setApiBaseUrl } from "@/constants/config";

const HOST = "https://agent.nuwax.com";
const USER_ID = "1234567890123456789";
const GROUP_NO = "9876543210987654321"; // 契约 19 位（测试环境实测 10 位）
const CONV_ID = "5555555555555555555";

describe("scanRouter", () => {
  beforeEach(() => {
    setApiBaseUrl(HOST);
  });

  describe("build 与 match 对称", () => {
    it("个人码：带账号 → 识别 user 且 a 解码还原", () => {
      const url = buildUserCardUrl(USER_ID, "zq010");
      expect(url).toBe(`${HOST}/u/${USER_ID}?a=zq010`);
      expect(matchUserCardUrl(url)).toBe(USER_ID);
      const route = parseScanContent(url);
      expect(route.kind).toBe("user");
      expect(route.userId).toBe(USER_ID);
      expect(route.userAccount).toBe("zq010");
    });

    it("个人码：账号含中文/空格经 encodeURIComponent，match 侧解码还原", () => {
      const url = buildUserCardUrl(USER_ID, "赵 一");
      expect(url).toBe(`${HOST}/u/${USER_ID}?a=${encodeURIComponent("赵 一")}`);
      const route = parseScanContent(url);
      expect(route.kind).toBe("user");
      expect(route.userAccount).toBe("赵 一");
    });

    it("个人码：账号缺省省略 query（老格式兼容）", () => {
      const url = buildUserCardUrl(USER_ID, "");
      expect(url).toBe(`${HOST}/u/${USER_ID}`);
      const route = parseScanContent(url);
      expect(route.kind).toBe("user");
      expect(route.userAccount).toBe("");
    });

    it("群码：带 convId → 识别 group 且第二段还原", () => {
      const content = buildGroupCardContent(GROUP_NO, CONV_ID);
      expect(content).toBe(`group#${GROUP_NO}#${CONV_ID}`);
      expect(matchGroupCardContent(content)).toBe(GROUP_NO);
      const route = parseScanContent(content);
      expect(route.kind).toBe("group");
      expect(route.groupNo).toBe(GROUP_NO);
      expect(route.groupConvId).toBe(CONV_ID);
    });

    it("群码：convId 缺省省略第二段，groupConvId 为空", () => {
      const content = buildGroupCardContent(GROUP_NO, "");
      expect(content).toBe(`group#${GROUP_NO}`);
      const route = parseScanContent(content);
      expect(route.kind).toBe("group");
      expect(route.groupConvId).toBe("");
    });

    it("域名未配置（H5 同源生产）：user build 空串且 match 不命中；群码不受影响", () => {
      resetApiBaseUrl();
      expect(cardUrlOrigin()).toBe("");
      expect(buildUserCardUrl(USER_ID, "a")).toBe("");
      const url = `${HOST}/u/${USER_ID}`;
      expect(matchUserCardUrl(url)).toBe("");
      expect(parseScanContent(url).kind).toBe("url");
      // group# 标识判型：不依赖 API 域名，照常生成与识别
      expect(buildGroupCardContent(GROUP_NO, CONV_ID)).toBe(`group#${GROUP_NO}#${CONV_ID}`);
      expect(parseScanContent(`group#${GROUP_NO}`).kind).toBe("group");
    });

    it("企业域名 http 形态：origin 保留 http scheme", () => {
      setApiBaseUrl("http://192.168.1.5");
      expect(cardUrlOrigin()).toBe("http://192.168.1.5");
      const route = parseScanContent(buildUserCardUrl(USER_ID, ""));
      expect(route.kind).toBe("user");
      expect(route.userId).toBe(USER_ID);
    });
  });

  describe("match 容错", () => {
    it("/m H5 前缀与尾斜杠归一（user；群码非 URL 不涉及）", () => {
      expect(matchUserCardUrl(`${HOST}/m/u/${USER_ID}`)).toBe(USER_ID);
      expect(matchUserCardUrl(`${HOST}/m/u/${USER_ID}/`)).toBe(USER_ID);
    });

    it("跨域名 /u/ 不认（防伪造），按 url 走", () => {
      expect(matchUserCardUrl(`https://evil.com/u/${USER_ID}`)).toBe("");
      expect(parseScanContent(`https://evil.com/u/${USER_ID}`).kind).toBe("url");
    });

    it("非法形态：group# 后非纯数字回退 text；旧 /g/ URL 形态按普通链接走", () => {
      expect(matchGroupCardContent("group#12ab567890")).toBe(""); // 非纯数字
      expect(matchGroupCardContent("group#")).toBe(""); // 空群号
      expect(matchGroupCardContent(`GROUP#${GROUP_NO}`)).toBe(""); // 标识严格小写
      expect(matchGroupCardContent(`user#${USER_ID}`)).toBe(""); // 其他标识不认
      expect(parseScanContent("group#12ab567890").kind).toBe("text");
      expect(parseScanContent(`${HOST}/g/${GROUP_NO}`).kind).toBe("url"); // 旧 URL 形态不再判群
    });

    it("位数不参与判型：10 位（测试环境）/ 19 位（契约）均命中", () => {
      expect(matchGroupCardContent("group#1234567890")).toBe("1234567890");
      expect(matchGroupCardContent(`group#${GROUP_NO}`)).toBe(GROUP_NO);
      const route = parseScanContent(`group#1234567890#${CONV_ID}`);
      expect(route.kind).toBe("group");
      expect(route.groupNo).toBe("1234567890");
      expect(route.groupConvId).toBe(CONV_ID);
    });

    it("query 提取：hash 截断、首键优先、缺 key 空串", () => {
      expect(extractUrlQueryValue(`${HOST}/u/1?a=x#frag`, "a")).toBe("x");
      expect(extractUrlQueryValue(`${HOST}/u/1#?a=x`, "a")).toBe(""); // ? 在 # 后不算 query
      expect(extractUrlQueryValue(`${HOST}/u/1?a=x&a=y`, "a")).toBe("x");
      expect(extractUrlQueryValue(`${HOST}/u/1?b=1`, "a")).toBe("");
      expect(extractUrlQueryValue(`${HOST}/u/1?a=%E8%B5%B5`, "a")).toBe("赵");
      expect(extractUrlQueryValue(`${HOST}/u/1?a=%ZZ`, "a")).toBe("%ZZ"); // 非法编码回原文
    });

    it("第二段 convId 非纯数字时丢弃（数字字面量拼接口口径）", () => {
      const route = parseScanContent(`group#${GROUP_NO}#abc`);
      expect(route.kind).toBe("group");
      expect(route.groupConvId).toBe("");
    });

    it("大小写 scheme 与 text 分支", () => {
      const route = parseScanContent(`HTTPS://${HOST.substring(8)}/u/${USER_ID}`);
      expect(route.kind).toBe("user");
      expect(parseScanContent("  hello world  ").kind).toBe("text");
      expect(parseScanContent("  hello world  ").text).toBe("hello world");
    });
  });
});
