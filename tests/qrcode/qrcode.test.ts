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
import { qrPngDataUrl, qrLogoPngDataUrl, getQrLogoPixels } from "@/utils/qrcode/qrPng.uts";
import { QR_LOGO_SIDE } from "@/utils/qrcode/qrLogoPixels.uts";
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

describe("qrLogoPngDataUrl", () => {
  /** 解析 PNG：返回 { dim, rgb(Uint8Array，dim*dim*3) }——filter 恒 0，直接展开。 */
  const parseRgbPng = (bin: Buffer) => {
    expect([...bin.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    let pos = 8;
    let width = 0;
    let bitDepth = 0;
    let colorType = -1;
    const idats: Buffer[] = [];
    while (pos + 8 <= bin.length) {
      const len = bin.readUInt32BE(pos);
      const type = bin.toString("ascii", pos + 4, pos + 8);
      const data = bin.subarray(pos + 8, pos + 8 + len);
      if (type == "IHDR") {
        width = data.readUInt32BE(0);
        bitDepth = data[8];
        colorType = data[9];
        expect(data.readUInt32BE(4)).toBe(width); // 方形
      } else if (type == "IDAT") {
        idats.push(data);
      } else if (type == "IEND") {
        break;
      }
      pos += 12 + len;
    }
    expect(bitDepth).toBe(8);
    expect(colorType).toBe(2);
    const raw = inflateSync(Buffer.concat(idats));
    const dim = width;
    const stride = dim * 3 + 1;
    expect(raw.length).toBe(stride * dim);
    const rgb = new Uint8Array(dim * dim * 3);
    for (let y = 0; y < dim; y++) {
      expect(raw[y * stride]).toBe(0); // filter: None
      rgb.set(raw.subarray(y * stride + 1, (y + 1) * stride), y * dim * 3);
    }
    return { dim, rgb };
  };

  it("8-bit truecolor PNG：垫外像素与矩阵一致、白垫/中心 logo 像素命中源数据", () => {
    const res = encodeQr(USER_URL)!;
    const scale = 12;
    const border = 2;
    const url = qrLogoPngDataUrl(res, scale, border);
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    const { dim, rgb } = parseRgbPng(Buffer.from(url.substring(url.indexOf(",") + 1), "base64"));

    // 与实现同口径重算中央几何（k = max(3, round(size*0.19)) 模块）
    const k = Math.max(3, Math.round(res.size * 0.19));
    const logoPx = k * scale;
    const padPx = Math.max(1, Math.floor(scale / 2));
    const half = Math.floor((logoPx + padPx * 2) / 2);
    const cx = Math.floor(dim / 2);
    const padX0 = cx - half;
    const padX1 = cx + half;
    const padY0 = cx - half;
    const padY1 = cx + half;
    const logoX0 = padX0 + padPx;
    const logoX1 = padX1 - padPx;
    const logoSpan = logoX1 - logoX0;

    const px = (x: number, y: number): [number, number, number] => [
      rgb[(y * dim + x) * 3],
      rgb[(y * dim + x) * 3 + 1],
      rgb[(y * dim + x) * 3 + 2],
    ];

    // 1) 垫外全图逐像素与模块矩阵一致（白=255 黑=0，RGB 同值）
    let colored = 0;
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const inPad = x >= padX0 && x < padX1 && y >= padY0 && y < padY1;
        if (inPad) {
          const [r, g, b] = px(x, y);
          const isWhite = r == 255 && g == 255 && b == 255;
          if (!isWhite) colored++;
          continue;
        }
        const mx = Math.floor(x / scale) - border;
        const my = Math.floor(y / scale) - border;
        const inQr = mx >= 0 && mx < res.size && my >= 0 && my < res.size;
        const expectDark = inQr && res.modules[my * res.size + mx];
        const v = expectDark ? 0 : 255;
        expect(px(x, y)).toEqual([v, v, v]);
      }
    }
    // logo 命中数：源像素半透明覆盖区按比例出现（64×64 中不透明像素 ≈84% → 输出
    // 72×72 采样格 ≈4300；留余量断言 >2000，防“全垫白”或“全 logo”两类塌缩）
    expect(colored).toBeGreaterThan(2000);

    // 2) 白垫环（logo 区外、垫内）纯白
    expect(px(padX0 + 2, cx)).toEqual([255, 255, 255]);
    expect(px(cx, padY0 + 2)).toEqual([255, 255, 255]);

    // 3) 中心像素 = 源 logo 中心（生成脚本探测值 64 源 224,230,231 / 192 源 225,231,232，不透明星形主体）
    const QR_LOGO_PIXELS = getQrLogoPixels();
    const sx = Math.min(QR_LOGO_SIDE - 1, Math.floor(((cx - logoX0) * QR_LOGO_SIDE) / logoSpan));
    const pi = (sx * QR_LOGO_SIDE + sx) * 4;
    expect(QR_LOGO_PIXELS[pi + 3]).toBeGreaterThanOrEqual(128);
    expect(px(cx, cx)).toEqual([
      QR_LOGO_PIXELS[pi],
      QR_LOGO_PIXELS[pi + 1],
      QR_LOGO_PIXELS[pi + 2],
    ]);

    // 4) logo 左上角（源像素全透明）保持垫白
    expect(QR_LOGO_PIXELS[3]).toBeLessThan(128);
    expect(px(logoX0, logoX0)).toEqual([255, 255, 255]);

    // 5) 三个 finder pattern 中心未被垫覆盖（暗模块保真，logo 只占中央 k×k 模块）
    const finder = (mx: number, my: number) => {
      const x = (border + mx) * scale + Math.floor(scale / 2);
      const y = (border + my) * scale + Math.floor(scale / 2);
      expect(px(x, y)).toEqual([0, 0, 0]);
    };
    finder(3, 3);
    finder(res.size - 4, 3);
    finder(3, res.size - 4);
  });

  it("scale/border 越界钳制（<1 / <0 按 1 / 0），同输入结果确定", () => {
    const res = encodeQr("N")!; // v1：size 21
    const url = qrLogoPngDataUrl(res, 0, -3);
    const { dim, rgb } = parseRgbPng(Buffer.from(url.substring(url.indexOf(",") + 1), "base64"));
    expect(dim).toBe(21); // (21+0)*1，border 钳 0
    // 与实现同口径重算几何：k=round(21*0.19)=4 模块、scale=1、padPx=1 → 垫 6×6
    const k1 = Math.max(3, Math.round(21 * 0.19));
    const half1 = Math.floor((k1 * 1 + Math.max(1, Math.floor(1 / 2)) * 2) / 2);
    const padX0 = Math.floor(dim / 2) - half1;
    const c = Math.floor(dim / 2);
    expect(rgb[(c * dim + padX0) * 3]).toBe(255); // 垫最左列纯白（logo 外）
    const centerR = rgb[(c * dim + c) * 3];
    expect([255, 224, 225]).toContain(centerR); // 星形（64 源 224 / 192 源 225）/ 极端采样落垫白
    expect(qrLogoPngDataUrl(res, 0, -3)).toBe(url);
  });
});
