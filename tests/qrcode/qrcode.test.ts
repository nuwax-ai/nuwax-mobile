/**
 * 二维码编码器 + PNG 封装单测。
 *
 * 验证策略（无外部依赖的金样例）：tests/qrcode/qrDecoder.ts 是按 ISO/IEC 18004
 * 独立重写的解码器，对编码器输出做回环校验——format/version 的 BCH 解码校验、
 * 去掩码、之字取码字、块解交织、RS 纠错余数全零、byte 位流还原原文。任何一处
 * 编码/解码理解不一致都会失败。GF(256) 另用锚点钉死（α^8=0x1D 本原多项式 0x11D；
 * 0x53×0xCA=0x8F 经 log/exp 表与 peasant 无表乘法双实现交叉验证）。
 */
import { describe, expect, it } from "vitest";
import { encodeQr } from "@/utils/qrcode/qrcodeEncoder.uts";
import { qrPngDataUrl } from "@/utils/qrcode/qrPng.uts";
import { decodeQr, gfMul, GF_ANCHOR_A8 } from "./qrDecoder.ts";
import { inflateSync } from "node:zlib";

const GROUP_URL = "https://agent.nuwax.com/g/1234567890123456789?c=1234567890123456789";
const USER_URL = "https://agent.nuwax.com/u/1234567890123456789?a=zq010";
const CN_URL = "https://x.cn/m/u/1234567890123456789?a=赵一";

describe("GF(256) 锚点", () => {
  it("α^8 = 0x1D（本原多项式 0x11D）", () => {
    expect(GF_ANCHOR_A8).toBe(0x1d);
  });
  it("0x53 × 0xCA = 0x8F（与 peasant 无表乘法交叉验证）", () => {
    expect(gfMul(0x53, 0xca)).toBe(0x8f);
  });
});

describe("encodeQr 回环解码", () => {
  const cases: Array<{ name: string; text: string; version: number }> = [
    { name: "单字符 → v1（单块、无校正图形）", text: "N", version: 1 },
    { name: "中文 URL → v4（44 字节）", text: CN_URL, version: 4 },
    { name: "个人名片码 → v4（2 块）", text: USER_URL, version: 4 },
    { name: "群名片码 → v5（2 块 + 校正 6,30）", text: GROUP_URL, version: 5 },
    { name: "150 字节 → v8（RS 短块 + version 信息）", text: "a".repeat(150), version: 8 },
    { name: "213 字节 → v10（容量上限）", text: "b".repeat(213), version: 10 },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const res = encodeQr(c.text);
      expect(res).not.toBeNull();
      const r = res!;
      expect(r.version).toBe(c.version);
      expect(r.size).toBe(c.version * 4 + 17);
      expect(r.modules.length).toBe(r.size * r.size);
      const report = decodeQr(r.modules, r.size);
      expect(report.version).toBe(c.version);
      expect(report.mask).toBe(r.mask);
      expect(report.eclBits).toBe(0); // ECL M
      expect(report.rsOk).toBe(true);
      expect(report.text).toBe(c.text);
    });
  }

  it("空文本与超容量返回 null", () => {
    expect(encodeQr("")).toBeNull();
    expect(encodeQr("c".repeat(214))).toBeNull();
  });

  it("同输入结果确定", () => {
    const a = encodeQr(GROUP_URL)!;
    const b = encodeQr(GROUP_URL)!;
    expect(a.mask).toBe(b.mask);
    expect(a.modules).toEqual(b.modules);
  });

  it("结构断言：定位图形 / 时序 / 暗模块 / 校正中心（以群码 v5 为例）", () => {
    const r = encodeQr(GROUP_URL)!;
    const s = r.size;
    const get = (x: number, y: number) => r.modules[y * s + x];
    // 三个定位图形：中心黑、dist2 白环、dist3 黑环、dist4 分隔白。
    // 读方向按角落选内测偏移（cx±4 中总有一个越界），不依赖编码时的边界守卫
    expect(get(3, 3)).toBe(true);
    expect(get(5, 3)).toBe(false); // 左上 finder 正向偏移
    expect(get(6, 3)).toBe(true);
    expect(get(7, 3)).toBe(false);
    expect(get(s - 4, 3)).toBe(true);
    expect(get(s - 6, 3)).toBe(false); // 右上 finder 负向偏移
    expect(get(s - 7, 3)).toBe(true);
    expect(get(s - 8, 3)).toBe(false);
    expect(get(3, s - 4)).toBe(true);
    expect(get(3, s - 6)).toBe(false); // 左下 finder 负向偏移
    expect(get(3, s - 7)).toBe(true);
    expect(get(3, s - 8)).toBe(false);
    // 时序：finder 之间黑白交替（col 8 起）
    for (let i = 8; i < s - 8; i++) {
      expect(get(i, 6)).toBe(i % 2 == 0);
      expect(get(6, i)).toBe(i % 2 == 0);
    }
    // 暗模块
    expect(get(8, s - 8)).toBe(true);
    // 校正中心（v5: 6,30 组合，除三个角）
    expect(get(30, 30)).toBe(true);
    expect(get(30, 31)).toBe(false);
    expect(get(6, 30)).toBe(true);
    expect(get(30, 6)).toBe(true);
  });
});

describe("qrPngDataUrl", () => {
  it("生成合法 1-bit 灰度 PNG 且像素与矩阵一致", () => {
    const res = encodeQr(GROUP_URL)!;
    const scale = 4;
    const border = 2;
    const url = qrPngDataUrl(res, scale, border);
    expect(url.startsWith("data:image/png;base64,")).toBe(true);

    const bin = Buffer.from(url.substring(url.indexOf(",") + 1), "base64");
    // PNG 签名
    expect([...bin.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    // 走块：收集 IHDR/IDAT，验证 CRC
    const crc32 = (buf: Buffer): number => {
      let c = ~0;
      for (const b of buf) {
        c ^= b;
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
      }
      return ~c >>> 0;
    };
    let pos = 8;
    const chunks: Array<{ type: string; data: Buffer }> = [];
    while (pos + 8 <= bin.length) {
      const len = bin.readUInt32BE(pos);
      const type = bin.toString("ascii", pos + 4, pos + 8);
      const data = bin.subarray(pos + 8, pos + 8 + len);
      expect(bin.length).toBeGreaterThanOrEqual(pos + 12 + len);
      const crcStored = bin.readUInt32BE(pos + 8 + len);
      expect(crc32(bin.subarray(pos + 4, pos + 8 + len))).toBe(crcStored);
      chunks.push({ type, data });
      pos += 12 + len;
      if (type == "IEND") break;
    }
    expect(chunks[0].type).toBe("IHDR");
    const dim = (res.size + border * 2) * scale;
    const ihdr = chunks[0].data;
    expect(ihdr.readUInt32BE(0)).toBe(dim);
    expect(ihdr.readUInt32BE(4)).toBe(dim);
    expect(ihdr[8]).toBe(1); // bit depth
    expect(ihdr[9]).toBe(0); // color type: grayscale
    const idat = chunks.find((c) => c.type == "IDAT")!;
    expect(idat).toBeTruthy();
    expect(chunks[chunks.length - 1].type).toBe("IEND");

    // inflate（node 校验 stored 块结构与 adler32），逐像素回比对
    const raw = inflateSync(idat.data);
    const bytesPerLine = Math.ceil(dim / 8) + 1;
    expect(raw.length).toBe(bytesPerLine * dim);
    const px = (x: number, y: number): boolean => {
      const off = y * bytesPerLine + 1 + Math.floor(x / 8);
      const bit = 7 - (x % 8);
      return ((raw[off] >> bit) & 1) == 0; // 0=黑
    };
    for (let y = 0; y < dim; y++) {
      expect(raw[y * bytesPerLine]).toBe(0); // filter: None
      for (let x = 0; x < dim; x++) {
        const mx = Math.floor(x / scale) - border;
        const my = Math.floor(y / scale) - border;
        const inQr = mx >= 0 && mx < res.size && my >= 0 && my < res.size;
        const expectDark = inQr && res.modules[my * res.size + mx];
        expect(px(x, y)).toBe(expectDark);
      }
    }
  });
});
