#!/usr/bin/env node
/**
 * 产品 logo PNG → utils/qrcode/qrLogoPixels.uts 像素常量（一次性代码生成脚本）。
 *
 * 用途：二维码保存图中央合成 logo（utils/qrcode/qrPng.uts 的 qrLogoPngDataUrl）。
 * 屏幕显示层不合成（view 叠加 /static/logo.png），仅保存到相册的 RGB PNG 需要像素。
 * logo 更换后重跑：node scripts/gen-qr-logo-pixels.mjs（参数见 parseArgs；
 * 默认 --size 192：保存图 logo 区约 140~160px，源不低于目标才不糊）。
 *
 * 实现：Node 内置 zlib，零三方依赖。
 *   PNG 解析（签名/chunk/IHDR）→ IDAT inflateSync → 逐行 unfilter（0~4 标准公式）
 *   → RGBA → box 平均降采样（alpha 预乘防透明边渗色）→ 写 .uts 常量文件。
 * 仅支持 8-bit、colorType 6(RGBA) / 2(RGB)、非隔行——本项目 logo 满足；
 * 其他格式直接报错提示先转 RGBA。
 */
import { inflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const opts = { input: "static/logo.png", output: "utils/qrcode/qrLogoPixels.uts", size: 192 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input") opts.input = argv[++i];
    else if (a === "--output") opts.output = argv[++i];
    else if (a === "--size") opts.size = parseInt(argv[++i], 10);
    else {
      console.error(`未知参数：${a}\n用法：node scripts/gen-qr-logo-pixels.mjs [--input static/logo.png] [--output utils/qrcode/qrLogoPixels.uts] [--size 192]`);
      process.exit(1);
    }
  }
  return opts;
}

/** 解析 PNG：返回 { width, height, rgba(Uint8Array) }，仅支持 8-bit RGBA/RGB 非隔行。 */
function decodePng(buf) {
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) {
    throw new Error("不是合法 PNG（签名不匹配）");
  }
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  const idats = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idats.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len; // len + type + data + crc
  }
  if (width <= 0 || height <= 0 || idats.length === 0) {
    throw new Error("PNG 结构不完整（缺 IHDR/IDAT）");
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`仅支持 8-bit RGBA/RGB PNG，当前 bitDepth=${bitDepth} colorType=${colorType}；请先转 RGBA 再运行`);
  }
  if (interlace !== 0) {
    throw new Error("不支持隔行（Adam7）PNG，请先转非隔行");
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idats));
  if (raw.length < (stride + 1) * height) {
    throw new Error(`IDAT 解压后长度不足：${raw.length} < ${(stride + 1) * height}`);
  }
  // 逐行 unfilter（PNG 标准 9.2）
  const recon = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const rowStart = y * (stride + 1) + 1;
    const cur = recon.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? recon.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const filt = raw[rowStart + x];
      const left = x >= bpp ? cur[x - bpp] : 0;
      const up = prior != null ? prior[x] : 0;
      const upLeft = prior != null && x >= bpp ? prior[x - bpp] : 0;
      let v;
      switch (filter) {
        case 0: v = filt; break;
        case 1: v = filt + left; break;
        case 2: v = filt + up; break;
        case 3: v = filt + ((left + up) >> 1); break;
        case 4: v = filt + paeth(left, up, upLeft); break;
        default: throw new Error(`未知 filter 类型：${filter}`);
      }
      cur[x] = v & 0xff;
    }
  }
  // → RGBA
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = recon[i * bpp];
    rgba[i * 4 + 1] = recon[i * bpp + 1];
    rgba[i * 4 + 2] = recon[i * bpp + 2];
    rgba[i * 4 + 3] = colorType === 6 ? recon[i * bpp + 3] : 255;
  }
  return { width, height, rgba };
}

/** box 平均降采样（alpha 预乘：Σa==0 输出全透明，防止透明边混入背景色）。 */
function downsample(rgba, width, height, size) {
  const out = new Uint8Array(size * size * 4);
  for (let ty = 0; ty < size; ty++) {
    const y0 = Math.floor((ty * height) / size);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * height) / size));
    for (let tx = 0; tx < size; tx++) {
      const x0 = Math.floor((tx * width) / size);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / size));
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          const a = rgba[i + 3];
          sr += rgba[i] * a;
          sg += rgba[i + 1] * a;
          sb += rgba[i + 2] * a;
          sa += a;
          n++;
        }
      }
      const o = (ty * size + tx) * 4;
      if (sa === 0) {
        out[o] = 0;
        out[o + 1] = 0;
        out[o + 2] = 0;
        out[o + 3] = 0;
      } else {
        out[o] = Math.round(sr / sa);
        out[o + 1] = Math.round(sg / sa);
        out[o + 2] = Math.round(sb / sa);
        out[o + 3] = Math.round(sa / n);
      }
    }
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const inputPath = resolve(repoRoot, opts.input);
  const outputPath = resolve(repoRoot, opts.output);
  const { width, height, rgba } = decodePng(readFileSync(inputPath));
  const size = opts.size;
  const pixels = downsample(rgba, width, height, size);
  // ★像素以 base64 串导出：16384 元素的 Array<number> 字面量会让 Android 端
  //   导入绑定退化成 Any?（.length 都找不到，error17/18 连环）；串常量导入无此问题
  const b64 = Buffer.from(pixels).toString("base64");
  const content = `// AUTO-GENERATED by scripts/gen-qr-logo-pixels.mjs — DO NOT EDIT
// 源图：${opts.input}（${width}×${height}）→ ${size}×${size} box 平均降采样（alpha 预乘）
// 供 utils/qrcode/qrPng.uts 的 qrLogoPngDataUrl 合成「保存到相册」的含 logo 二维码。
// logo 更换后重跑生成：node scripts/gen-qr-logo-pixels.mjs
/** 降采样后 logo 边长（像素），像素为 RGBA 平铺，字节数 = QR_LOGO_SIDE²×4。 */
export const QR_LOGO_SIDE: number = ${size};
/** RGBA 像素 base64（每像素 4 字节 R,G,B,A；A=0 全透明），经 qrPng 的 getQrLogoPixels() 解码使用。 */
export const QR_LOGO_PIXELS_B64: string = "${b64}";
`;
  writeFileSync(outputPath, content, "utf8");
  // 抽查输出：四角 + 中心 alpha/RGB
  const probe = (x, y) => {
    const i = (y * size + x) * 4;
    return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
  };
  const c = Math.floor(size / 2);
  console.log(`✓ ${opts.input}（${width}×${height}，rgba ${rgba.length >> 2} px）`);
  console.log(`✓ 已生成 ${opts.output}（${size}×${size}，${pixels.length} 字节）`);
  console.log(`  四角采样 rgba：TL=${probe(0, 0)} TR=${probe(size - 1, 0)} BL=${probe(0, size - 1)} BR=${probe(size - 1, size - 1)}`);
  console.log(`  中心采样 rgba：${probe(c, c)}`);
}

main();
