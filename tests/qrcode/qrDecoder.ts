/**
 * 测试专用：极简 QR 解码器（只支持 ECL M、v1~10、byte 模式）。
 *
 * 用途：对 utils/qrcode/qrcodeEncoder.uts 的输出做**独立实现**的回环校验——
 * 解码器按 ISO/IEC 18004 规则重写一遍（读 format/version、去掩码、之字取码字、
 * 块解交织、RS 纠错校验、解析位流），任何一处与编码器理解不一致都会在这里炸出。
 * 仅 node/vitest 使用，可用标准 TS 特性。
 */

/** ECL M 每块纠错码字数（index = version-1）。 */
const ECC_PER_BLOCK_M = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
/** ECL M 分块数（index = version-1）。 */
const NUM_BLOCKS_M = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

/** 校正图形中心坐标标准表（v1 无、v2~v10）。 */
const ALIGNMENT_POSITIONS: Record<number, number[]> = {
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

function rawDataModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const na = Math.floor(ver / 7) + 2;
    r -= (25 * na - 10) * na - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}

/*---- GF(256)（独立实现；锚点断言见测试：α^8=0x1D、0x53×0xCA=0x8F） ----*/

const GF_EXP = new Array<number>(512).fill(0);
const GF_LOG = new Array<number>(256).fill(0);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if ((x & 0x100) != 0) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}

export function gfMul(a: number, b: number): number {
  if (a == 0 || b == 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

export const GF_ANCHOR_A8 = GF_EXP[8];

function rsDivisor(degree: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < degree - 1; i++) result.push(0);
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 2);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result: number[] = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => (result[i] ^= gfMul(coef, factor)));
  }
  return result;
}

/*---- 解码 ----*/

export interface QrDecodeReport {
  version: number;
  mask: number;
  eclBits: number;
  /** RS 校验通过（每块余数全零） */
  rsOk: boolean;
  /** 解码出的文本 */
  text: string;
}

/** 解码扁平模块矩阵（index = y*size+x，true=深色）。断言失败抛 Error。 */
export function decodeQr(modules: boolean[], size: number): QrDecodeReport {
  if ((size - 17) % 4 != 0) throw new Error(`非法尺寸 ${size}`);
  const version = (size - 17) / 4;
  if (version < 1 || version > 10) throw new Error(`超出解码器版本范围 v${version}`);
  const get = (x: number, y: number) => modules[y * size + x];

  // ---- format 信息（两份任读第一份 + BCH 校验）----
  const formatPos: Array<[number, number]> = [];
  for (let i = 0; i <= 5; i++) formatPos.push([8, i]);
  formatPos.push([8, 7], [8, 8], [7, 8]);
  for (let i = 9; i < 15; i++) formatPos.push([14 - i, 8]);
  if (formatPos.length != 15) throw new Error("format 位置表长度错误");
  // LSB-first 还原：encoder 按 nayuki 摆位把 15bit 整数的第 i 位放到 formatPos[i]
  let raw = 0;
  for (let i = 0; i < 15; i++) raw |= (get(formatPos[i][0], formatPos[i][1]) ? 1 : 0) << i;
  const unmasked = raw ^ 0x5412;
  const data = (unmasked >>> 10) & 0x1f;
  let rem = unmasked & 0x3ff;
  // BCH 校验：data 重新编码的余数应与低 10 位一致
  let check = data;
  for (let i = 0; i < 10; i++) check = (check << 1) ^ ((check >>> 9) * 0x537);
  if ((check & 0x3ff) != rem) throw new Error(`format BCH 校验失败 (raw=0x${raw.toString(16)})`);
  const eclBits = (data >>> 3) & 3;
  const mask = data & 7;
  if (eclBits != 0) throw new Error(`ECL 位非 M: ${eclBits}`);

  // ---- 功能模块图 ----
  const isFun = new Uint8Array(size * size);
  const mark = (x: number, y: number) => {
    if (x >= 0 && x < size && y >= 0 && y < size) isFun[y * size + x] = 1;
  };
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as Array<[number, number]>) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) mark(cx + dx, cy + dy);
  }
  for (let i = 0; i < size; i++) {
    mark(6, i);
    mark(i, 6);
  }
  const align = ALIGNMENT_POSITIONS[version] ?? [];
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      if ((i == 0 && j == 0) || (i == 0 && j == align.length - 1) || (i == align.length - 1 && j == 0)) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) mark(align[i] + dx, align[j] + dy);
    }
  }
  for (const [x, y] of formatPos) mark(x, y);
  for (let i = 0; i < 8; i++) mark(size - 1 - i, 8);
  for (let i = 8; i < 15; i++) mark(8, size - 15 + i);
  mark(8, size - 8); // 暗模块
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      mark(a, b);
      mark(b, a);
    }
    // 版本 BCH 校验（读左下 3x6）
    let vBits = 0;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      vBits |= (get(a, b) ? 1 : 0) << i;
    }
    const vVal = vBits >>> 12;
    let vRem = vBits & 0xfff;
    let vCheck = vVal;
    for (let i = 0; i < 12; i++) vCheck = (vCheck << 1) ^ ((vCheck >>> 11) * 0x1f25);
    if (vVal != version || (vCheck & 0xfff) != vRem) throw new Error("version 信息校验失败");
  }

  // ---- 去掩码 ----
  const maskInvert = (x: number, y: number): boolean => {
    switch (mask) {
      case 0: return (x + y) % 2 == 0;
      case 1: return y % 2 == 0;
      case 2: return x % 3 == 0;
      case 3: return (x + y) % 3 == 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 == 0;
      case 5: return (x * y) % 2 + (x * y) % 3 == 0;
      case 6: return ((x * y) % 2 + (x * y) % 3) % 2 == 0;
      default: return (((x + y) % 2 + (x * y) % 3) % 2) == 0;
    }
  };
  const dem = modules.slice();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isFun[y * size + x] == 0) {
        if (maskInvert(x, y)) dem[y * size + x] = !dem[y * size + x];
      }
    }
  }

  // ---- 之字取码字位 ----
  const rawCw = Math.floor(rawDataModules(version) / 8);
  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right == 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) == 0;
        const y = upward ? size - 1 - vert : vert;
        if (isFun[y * size + x] == 0 && bits.length < rawCw * 8) {
          bits.push(dem[y * size + x] ? 1 : 0);
        }
      }
    }
  }
  const cw: number[] = [];
  for (let i = 0; i < rawCw; i++) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bits[i * 8 + k];
    cw.push(b);
  }

  // ---- 解交织 ----
  const eccLen = ECC_PER_BLOCK_M[version - 1];
  const numBlocks = NUM_BLOCKS_M[version - 1];
  const numShort = numBlocks - (rawCw % numBlocks);
  const shortData = Math.floor(rawCw / numBlocks) - eccLen;
  const blockDataLen = Array.from({ length: numBlocks }, (_, b) => (b < numShort ? shortData : shortData + 1));
  const blocks: number[][] = Array.from({ length: numBlocks }, () => []);
  const blocksEcc: number[][] = Array.from({ length: numBlocks }, () => []);
  let idx = 0;
  for (let col = 0; col < shortData + 1; col++) {
    for (let b = 0; b < numBlocks; b++) {
      if (col < blockDataLen[b]) blocks[b][col] = cw[idx++];
    }
  }
  for (let col = 0; col < eccLen; col++) {
    for (let b = 0; b < numBlocks; b++) blocksEcc[b][col] = cw[idx++];
  }
  if (idx != rawCw) throw new Error(`交织流长度不符: ${idx} != ${rawCw}`);

  // ---- RS 校验（余数应全零）----
  let rsOk = true;
  const divisor = rsDivisor(eccLen);
  for (let b = 0; b < numBlocks; b++) {
    const rem2 = rsRemainder([...blocks[b], ...blocksEcc[b]], divisor);
    if (rem2.some((v) => v != 0)) {
      rsOk = false;
      throw new Error(`块 ${b} RS 余数非零: ${rem2.join(",")}`);
    }
  }

  // ---- 位流解析（byte 模式）----
  const dataCw = rawCw - eccLen * numBlocks;
  const dataBytes: number[] = [];
  for (let b = 0; b < numBlocks; b++) for (let k = 0; k < blockDataLen[b]; k++) dataBytes.push(blocks[b][k]);
  if (dataBytes.length != dataCw) throw new Error("数据码字数不符");
  const stream: number[] = [];
  for (const b of dataBytes) for (let k = 7; k >= 0; k--) stream.push((b >> k) & 1);
  const readBits = (pos: number, len: number): number => {
    let v = 0;
    for (let i = 0; i < len; i++) v = (v << 1) | stream[pos + i];
    return v;
  };
  let pos = 0;
  const mode = readBits(pos, 4);
  pos += 4;
  if (mode != 4) throw new Error(`模式位非 byte: ${mode}`);
  const ccBits = version <= 9 ? 8 : 16;
  const len = readBits(pos, ccBits);
  pos += ccBits;
  const textBytes: number[] = [];
  for (let i = 0; i < len; i++) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | stream[pos + i * 8 + k];
    textBytes.push(b);
  }
  const text = Buffer.from(textBytes).toString("utf8");
  return { version, mask, eclBits, rsOk, text };
}
