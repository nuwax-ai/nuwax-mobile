/**
 * scanRouter 单测：四路分发 + build/match 对称性。
 *
 * 现行格式为下载页名片码：https://nuwax.com/app.html?u={userId}[&a=账号] /
 * ?g={群号}[&c=convId]——外部扫码落下载页引导安装，App 内扫码按 query 判型，
 * 不依赖 API 域名（域名经 setApiBaseUrl / resetApiBaseUrl 走真实配置代码路径控制，
 * tests/setup.ts 已 mock uni storage）。
 * 旧格式（API 域名 /u/ 个人码、group# 文本群码）仅为兼容已分享历史码保留识别，
 * 「match 容错」describe 即旧格式兼容用例（手写字面量）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildGroupCardUrl,
  buildUserCardUrl,
  extractUrlQueryValue,
  matchDownloadCardUrl,
  matchGroupCardContent,
  matchUserCardUrl,
  parseScanContent,
} from "@/utils/scanRouter.uts";
import { resetApiBaseUrl, setApiBaseUrl } from "@/constants/config";

const HOST = "https://agent.nuwax.com";
const DL = "https://nuwax.com/app.html";
const USER_ID = "1234567890123456789";
const GROUP_NO = "9876543210987654321"; // 契约 19 位（测试环境实测 10 位）
const CONV_ID = "5555555555555555555";

describe("scanRouter", () => {
  beforeEach(() => {
    setApiBaseUrl(HOST);
  });

  describe("build 与 match 对称（下载页格式）", () => {
    it("个人码：带账号 → 识别 user 且 a 解码还原", () => {
      const url = buildUserCardUrl(USER_ID, "zq010");
      expect(url).toBe(`${DL}?u=${USER_ID}&a=zq010`);
      const route = parseScanContent(url);
      expect(route.kind).toBe("user");
      expect(route.userId).toBe(USER_ID);
      expect(route.userAccount).toBe("zq010");
    });

    it("个人码：账号含中文/空格经 encodeURIComponent，match 侧解码还原", () => {
      const url = buildUserCardUrl(USER_ID, "赵 一");
      expect(url).toBe(`${DL}?u=${USER_ID}&a=${encodeURIComponent("赵 一")}`);
      const route = parseScanContent(url);
      expect(route.kind).toBe("user");
      expect(route.userAccount).toBe("赵 一");
    });

    it("个人码：账号缺省省略 &a=", () => {
      const url = buildUserCardUrl(USER_ID, "");
      expect(url).toBe(`${DL}?u=${USER_ID}`);
      const route = parseScanContent(url);
      expect(route.kind).toBe("user");
      expect(route.userAccount).toBe("");
    });

    it("群码：带 convId → 识别 group 且 &c= 还原", () => {
      const url = buildGroupCardUrl(GROUP_NO, CONV_ID);
      expect(url).toBe(`${DL}?g=${GROUP_NO}&c=${CONV_ID}`);
      const route = parseScanContent(url);
      expect(route.kind).toBe("group");
      expect(route.groupNo).toBe(GROUP_NO);
      expect(route.groupConvId).toBe(CONV_ID);
    });

    it("群码：convId 缺省省略 &c=，groupConvId 为空", () => {
      const url = buildGroupCardUrl(GROUP_NO, "");
      expect(url).toBe(`${DL}?g=${GROUP_NO}`);
      const route = parseScanContent(url);
      expect(route.kind).toBe("group");
      expect(route.groupConvId).toBe("");
    });

    it("域名未配置（H5 同源生产）：下载页格式照常生成与识别（个人码不再 failed）", () => {
      resetApiBaseUrl();
      expect(buildUserCardUrl(USER_ID, "a")).toBe(`${DL}?u=${USER_ID}&a=a`);
      expect(parseScanContent(buildUserCardUrl(USER_ID, "a")).kind).toBe("user");
      expect(buildGroupCardUrl(GROUP_NO, CONV_ID)).toBe(`${DL}?g=${GROUP_NO}&c=${CONV_ID}`);
      expect(parseScanContent(`${DL}?g=${GROUP_NO}`).kind).toBe("group");
      // 旧 /u/ 格式 match 仍依赖 API 域名：未配置不命中，按普通链接走
      const url = `${HOST}/u/${USER_ID}`;
      expect(matchUserCardUrl(url)).toBe("");
      expect(parseScanContent(url).kind).toBe("url");
    });

    it("企业域名 http 形态：旧 /u/ 码仍判 user；新格式 build 不受 API 域名影响", () => {
      setApiBaseUrl("http://192.168.1.5");
      const route = parseScanContent(`http://192.168.1.5/u/${USER_ID}`);
      expect(route.kind).toBe("user");
      expect(route.userId).toBe(USER_ID);
      expect(buildUserCardUrl(USER_ID, "")).toBe(`${DL}?u=${USER_ID}`);
    });
  });

  describe("下载页名片码 match（现行格式）", () => {
    it("无参/坏参回退普通 url（外部扫码落下载页，App 内不当名片处理）", () => {
      expect(parseScanContent(DL).kind).toBe("url");
      expect(parseScanContent(`${DL}?x=1`).kind).toBe("url");
      expect(parseScanContent(`${DL}?u=abc`).kind).toBe("url"); // 非纯数字
      expect(parseScanContent(`${DL}?g=`).kind).toBe("url"); // 空群号
      expect(matchDownloadCardUrl(DL)).toBeNull();
    });

    it("c 非纯数字丢弃（数字字面量拼接口口径）", () => {
      const route = parseScanContent(`${DL}?g=${GROUP_NO}&c=abc`);
      expect(route.kind).toBe("group");
      expect(route.groupConvId).toBe("");
    });

    it("跨域仿冒不认；子域放行", () => {
      expect(matchDownloadCardUrl(`https://evil.com/app.html?u=${USER_ID}`)).toBeNull();
      expect(parseScanContent(`https://evil.com/app.html?u=${USER_ID}`).kind).toBe("url");
      const route = parseScanContent(`https://www.nuwax.com/app.html?u=${USER_ID}`);
      expect(route.kind).toBe("user");
      expect(route.userId).toBe(USER_ID);
    });

    it("path 严格：仅 /app.html（尾斜杠归一放行）", () => {
      expect(parseScanContent(`https://nuwax.com/app.htm?u=${USER_ID}`).kind).toBe("url");
      expect(parseScanContent(`https://nuwax.com/other?u=${USER_ID}`).kind).toBe("url");
      expect(parseScanContent(`https://nuwax.com/app.html/?u=${USER_ID}`).kind).toBe("user");
    });

    it("u/g 同带时 u 优先（build 不会同带，优先级固化）", () => {
      const route = parseScanContent(`${DL}?u=${USER_ID}&g=${GROUP_NO}`);
      expect(route.kind).toBe("user");
      expect(route.userId).toBe(USER_ID);
    });

    it("大小写 scheme/host（extractUrlHost 已小写化，固化该行为）", () => {
      const route = parseScanContent(`HTTPS://NUWAX.COM/app.html?u=${USER_ID}`);
      expect(route.kind).toBe("user");
      expect(route.userId).toBe(USER_ID);
    });
  });

  describe("match 容错（旧格式兼容：API 域名 /u/ 个人码、group# 文本群码）", () => {
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

    it("旧格式兼容聚合：API 域名 /u/ 与 group# 文本仍按名片处理（历史已分享码不失效）", () => {
      const userRoute = parseScanContent(`${HOST}/u/${USER_ID}?a=zq010`);
      expect(userRoute.kind).toBe("user");
      expect(userRoute.userAccount).toBe("zq010");
      const groupRoute = parseScanContent(`group#${GROUP_NO}#${CONV_ID}`);
      expect(groupRoute.kind).toBe("group");
      expect(groupRoute.groupNo).toBe(GROUP_NO);
    });
  });
});
