#!/usr/bin/env node
/**
 * Android SSE Markdown 热点自测（Node 侧镜像关键算法）
 *
 * 覆盖：
 * 1) 完整自定义工具卡后正文不被 strip / extract 丢掉
 * 2) 流式半截工具卡只裁真尾巴
 * 3) 「每 tick 全量重解析」成本随正文增长近似 O(n²)
 * 4) 自适应合并窗降低累计解析量
 * 5) 增量 fallback（findStableMarkdownCut）vs 全量成本对比
 *
 * 运行：node scripts/test-android-sse-markdown.mjs
 * 或：pnpm test:android-sse-md
 */

import assert from "node:assert/strict";

// ─── 镜像 utils/markdownCustomProcess.uts 关键算法 ───────────────────────────

function scanOpenTagEnd(text, openStart) {
  const marker = "<markdown-custom-process";
  if (text.substring(openStart, openStart + marker.length) !== marker) return -1;
  let i = openStart + marker.length;
  if (text.substring(i, i + 6) === "-group") return -1;
  let quote = "";
  while (i < text.length) {
    const ch = text.charAt(i);
    if (quote.length > 0) {
      if (ch === quote) quote = "";
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      i++;
      continue;
    }
    if (ch === ">") return i + 1;
    i++;
  }
  return -1;
}

function expandIncompleteMarkupStart(text, tagStart) {
  let j = tagStart;
  while (j > 0 && /\s/.test(text.charAt(j - 1))) j--;
  if (j <= 0 || text.charAt(j - 1) !== ">") return tagStart;
  let k = j - 1;
  const minK = Math.max(0, tagStart - 256);
  while (k >= minK) {
    if (text.charAt(k) === "<") {
      const open = text.substring(k, j);
      if (/^<(?:div|p)\b[^>]*>$/i.test(open)) return k;
      break;
    }
    k--;
  }
  return tagStart;
}

function earlierIndex(a, b) {
  if (a < 0) return b;
  if (b < 0) return a;
  return a < b ? a : b;
}

function findIncompleteCustomMarkupTailStart(text) {
  if (text.length === 0) return -1;
  let cut = -1;
  const processMarker = "<markdown-custom-process";
  let search = 0;
  while (search < text.length) {
    const idx = text.indexOf(processMarker, search);
    if (idx < 0) break;
    const afterName = idx + processMarker.length;
    if (text.substring(afterName, afterName + 6) === "-group") {
      const closeIdx = text.indexOf(
        "</markdown-custom-process-group>",
        afterName,
      );
      if (closeIdx < 0) cut = earlierIndex(cut, expandIncompleteMarkupStart(text, idx));
      search = afterName + 6;
      continue;
    }
    const openEnd = scanOpenTagEnd(text, idx);
    if (openEnd < 0) {
      cut = earlierIndex(cut, expandIncompleteMarkupStart(text, idx));
      break;
    }
    if (text.charAt(openEnd - 2) !== "/") {
      const closeMarker = "</markdown-custom-process>";
      const closeIdx = text.indexOf(closeMarker, openEnd);
      if (closeIdx < 0) {
        cut = earlierIndex(cut, expandIncompleteMarkupStart(text, idx));
        break;
      }
      search = closeIdx + closeMarker.length;
      continue;
    }
    search = openEnd;
  }
  return cut;
}

function isIncompleteMarkupTrueTail(text, cut) {
  const after = text.substring(cut);
  if (after.length === 0) return true;
  if (/\n[ \t]*\|/.test(after)) return false;
  if (/\n[ \t]*#{1,6}[ \t]/.test(after)) return false;
  if (/\n[ \t]*```/.test(after) || /\n[ \t]*\$\$/.test(after)) return false;
  return true;
}

function stripIncompleteCustomMarkupTail(text) {
  const cut = findIncompleteCustomMarkupTailStart(text);
  if (cut < 0) return text;
  if (!isIncompleteMarkupTrueTail(text, cut)) return text;
  return text.substring(0, cut);
}

function findNextMarkdownCustomProcessTag(text, from = 0) {
  const marker = "<markdown-custom-process";
  let search = from;
  while (search < text.length) {
    const idx = text.indexOf(marker, search);
    if (idx < 0) return null;
    const afterName = idx + marker.length;
    if (text.substring(afterName, afterName + 6) === "-group") {
      search = afterName;
      continue;
    }
    const openEnd = scanOpenTagEnd(text, idx);
    if (openEnd < 0) {
      search = afterName;
      continue;
    }
    let tagEnd = openEnd;
    if (text.charAt(openEnd - 2) !== "/") {
      const closeMarker = "</markdown-custom-process>";
      const closeIdx = text.indexOf(closeMarker, openEnd);
      if (closeIdx < 0) {
        search = afterName;
        continue;
      }
      tagEnd = closeIdx + closeMarker.length;
    }
    // 简化：吃可选外层 </div>
    let fullStart = idx;
    let fullEnd = tagEnd;
    let j = idx;
    while (j > 0 && /\s/.test(text.charAt(j - 1))) j--;
    if (j > 0 && text.charAt(j - 1) === ">") {
      let k = j - 1;
      const minK = Math.max(0, idx - 256);
      while (k >= minK) {
        if (text.charAt(k) === "<") {
          const open = text.substring(k, j);
          if (/^<(?:div|p)\b[^>]*>$/i.test(open)) fullStart = k;
          break;
        }
        k--;
      }
    }
    if (fullStart < idx) {
      let p = tagEnd;
      while (p < text.length && /\s/.test(text.charAt(p))) p++;
      if (text.substring(p, p + 6).toLowerCase() === "</div>") fullEnd = p + 6;
    }
    return { index: fullStart, endIndex: fullEnd };
  }
  return null;
}

function extractCustomProcessBlocks(markdown) {
  const segments = [];
  let cursor = 0;
  let hasCustomBlock = false;
  while (cursor < markdown.length) {
    const hit = findNextMarkdownCustomProcessTag(markdown, cursor);
    if (hit == null) break;
    if (hit.index > cursor) {
      segments.push({ kind: "md", text: markdown.substring(cursor, hit.index) });
    }
    segments.push({
      kind: "process",
      text: markdown.substring(hit.index, hit.endIndex),
    });
    hasCustomBlock = true;
    cursor = hit.endIndex > cursor ? hit.endIndex : cursor + 1;
  }
  if (cursor < markdown.length) {
    segments.push({ kind: "md", text: markdown.substring(cursor) });
  }
  return { hasCustomBlock, segments };
}

/** 近似 fallback 扫描成本：按字符数计（normalize + line walk + inline 扫描的下界） */
function approxParseCostUnits(body) {
  // 每字符至少走一遍 + 对 $ / | / < 的额外扫描
  let cost = body.length;
  for (let i = 0; i < body.length; i++) {
    const ch = body.charAt(i);
    if (ch === "$" || ch === "|" || ch === "<" || ch === "`") cost += 2;
  }
  // 自定义块拆段后再扫尾段
  const ext = extractCustomProcessBlocks(body);
  if (ext.hasCustomBlock) {
    for (const seg of ext.segments) {
      if (seg.kind === "md") cost += seg.text.length;
    }
  }
  return cost;
}

function adaptiveStructInterval(bodyLen) {
  if (bodyLen < 2000) return 80;
  if (bodyLen < 8000) return 160;
  if (bodyLen < 20000) return 280;
  return 400;
}

// ─── 镜像 utils/markdownStableCut.uts ───────────────────────────────────────

function findUnclosedCodeFenceStart(text) {
  let search = 0;
  let openAt = -1;
  while (search < text.length) {
    const idx = text.indexOf("```", search);
    if (idx < 0) break;
    if (openAt < 0) {
      openAt = idx;
      search = idx + 3;
      continue;
    }
    openAt = -1;
    search = idx + 3;
  }
  return openAt;
}

function findUnclosedBlockMathStart(text) {
  let search = 0;
  let openAt = -1;
  while (search < text.length) {
    const idx = text.indexOf("$$", search);
    if (idx < 0) break;
    if (openAt < 0) {
      openAt = idx;
      search = idx + 2;
      continue;
    }
    openAt = -1;
    search = idx + 2;
  }
  return openAt;
}

function findTrailingOpenTableStart(text) {
  if (text.length === 0) return -1;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let end = lines.length - 1;
  while (end >= 0 && lines[end].trim().length === 0) end--;
  if (end < 0) return -1;
  if (!lines[end].trim().startsWith("|")) return -1;
  let startLine = end;
  while (startLine > 0) {
    const prev = lines[startLine - 1].trim();
    if (prev.length === 0) break;
    if (!prev.startsWith("|")) break;
    startLine--;
  }
  let offset = 0;
  for (let i = 0; i < startLine; i++) offset += lines[i].length + 1;
  return offset;
}

function lastParagraphBoundaryBefore(text, limit) {
  const sliceEnd = Math.min(limit, text.length);
  if (sliceEnd <= 0) return 0;
  const region = text.substring(0, sliceEnd);
  const idx = region.lastIndexOf("\n\n");
  if (idx < 0) return 0;
  return idx + 2;
}

function endOfFinishedCustomBlocks(text, limit) {
  const sliceEnd = Math.min(limit, text.length);
  if (sliceEnd <= 0) return 0;
  const slice = text.substring(0, sliceEnd);
  const openMarker = "<markdown-custom-process";
  const closeMarker = "</markdown-custom-process>";
  let search = 0;
  let lastEnd = 0;
  while (search < slice.length) {
    const idx = slice.indexOf(openMarker, search);
    if (idx < 0) break;
    const afterName = idx + openMarker.length;
    if (slice.substring(afterName, afterName + 6) === "-group") {
      search = afterName + 6;
      continue;
    }
    const gt = slice.indexOf(">", afterName);
    if (gt < 0) break;
    const openTag = slice.substring(idx, gt + 1);
    const terminal =
      openTag.includes('status="FINISHED"') ||
      openTag.includes('status="FAILED"') ||
      openTag.includes("status='FINISHED'") ||
      openTag.includes("status='FAILED'");
    let blockEnd = gt + 1;
    if (slice.charAt(gt - 1) !== "/") {
      const closeIdx = slice.indexOf(closeMarker, gt);
      if (closeIdx < 0) break;
      blockEnd = closeIdx + closeMarker.length;
    }
    if (terminal) {
      lastEnd = blockEnd;
      let p = blockEnd;
      while (p < slice.length && /\s/.test(slice.charAt(p))) p++;
      if (slice.substring(p, p + 6).toLowerCase() === "</div>") {
        lastEnd = p + 6;
      }
    }
    search = blockEnd;
  }
  return lastEnd;
}

function findStableMarkdownCut(markdown, streaming = true) {
  if (markdown.length === 0) return 0;
  if (streaming !== true) return markdown.length;
  let incompleteAt = -1;
  incompleteAt = earlierIndex(incompleteAt, findUnclosedCodeFenceStart(markdown));
  incompleteAt = earlierIndex(incompleteAt, findUnclosedBlockMathStart(markdown));
  incompleteAt = earlierIndex(incompleteAt, findTrailingOpenTableStart(markdown));
  incompleteAt = earlierIndex(
    incompleteAt,
    findIncompleteCustomMarkupTailStart(markdown),
  );
  const structureLimit = incompleteAt >= 0 ? incompleteAt : markdown.length;
  const paraCut = lastParagraphBoundaryBefore(markdown, structureLimit);
  const toolCut = endOfFinishedCustomBlocks(markdown, structureLimit);
  return Math.max(paraCut, toolCut);
}

/**
 * 模拟增量 fallback：累计「本次实际解析字符」成本 = newlyFrozen + live
 */
function simulateIncrementalParseCost(fullBody, chunkSize) {
  let stablePrefix = "";
  let fullCum = 0;
  let incrCum = 0;
  let ticks = 0;
  let maxLive = 0;
  let finalCut = 0;
  for (let end = chunkSize; end < fullBody.length + chunkSize; end += chunkSize) {
    const body = fullBody.slice(0, Math.min(fullBody.length, end));
    ticks += 1;
    fullCum += approxParseCostUnits(body);
    if (stablePrefix.length > 0 && !body.startsWith(stablePrefix)) {
      incrCum += approxParseCostUnits(body);
      stablePrefix = "";
      continue;
    }
    const cut = findStableMarkdownCut(body, true);
    finalCut = cut;
    if (stablePrefix.length > 0 && cut < stablePrefix.length) {
      incrCum += approxParseCostUnits(body);
      stablePrefix = "";
      continue;
    }
    let cost = 0;
    if (cut > stablePrefix.length) {
      const newly = body.substring(stablePrefix.length, cut);
      cost += approxParseCostUnits(newly);
      stablePrefix = body.substring(0, cut);
    }
    const live = body.substring(stablePrefix.length);
    if (live.length > 0) cost += approxParseCostUnits(live);
    maxLive = Math.max(maxLive, live.length);
    incrCum += cost;
  }
  return { ticks, fullCum, incrCum, maxLive, finalCut, stableLen: stablePrefix.length };
}

// ─── 样本：用户报告的 SandboxStart + 新闻 + 公式 ───────────────────────────

const TOOL =
  `<div><markdown-custom-process executeId="65ee774a75264d7d8fa9604def3d1d31" type="SandboxStart" status="FINISHED" name="智能体电脑启动"></markdown-custom-process></div>`;

const NEWS = `

你好！这是一篇约 300 字的新闻：

**今日快讯：国际数学家大会今日开幕，朗兰兹纲领研究获重磅进展**

第 127 届国际数学家大会今日在赫尔辛基开幕，来自全球百余名数学家齐聚一堂。
`;

const FORMULAS = `

以下再输出 20 个更复杂的数学公式：

1. **斯特林公式**：$n!\\sim\\sqrt{2\\pi n}\\left(\\dfrac{n}{e}\\right)^{n}$
2. **拉马努金 π 公式**：$\\dfrac{1}{\\pi}=\\dfrac{2\\sqrt{2}}{9801}\\displaystyle\\sum_{k=0}^{\\infty}\\frac{(4k)!(1103+26390k)}{(k!)^{4}396^{4k}}$
3. **柯西-比内公式**：$\\det(AB)=\\displaystyle\\sum_{S}\\det(A_{S})\\det(B^{S})$
4. **雅可比公式**：$\\dfrac{d}{dt}\\det A(t)=\\det A(t)\\cdot\\operatorname{tr}(A^{-1}\\dfrac{dA}{dt})$
5. **范德蒙行列式**：$\\det V=\\displaystyle\\prod_{1\\le i<j\\le n}(x_{j}-x_{i})$
6. **盖尔范德谱半径公式**：$\\rho(A)=\\displaystyle\\lim_{k\\to\\infty}\\|A^{k}\\|^{1/k}$
7. **闵可夫斯基不等式**：$\\|f+g\\|_{p}\\le\\|f\\|_{p}+\\|g\\|_{p}$
8. **赫尔德不等式**：$\\displaystyle\\int|fg|\\le\\|f\\|_{p}\\|g\\|_{q}$
9. **贝塞尔函数**：$J_{n}(x)=\\dfrac{1}{\\pi}\\displaystyle\\int_{0}^{\\pi}\\cos(x\\sin\\theta-n\\theta)\\,d\\theta$
10. **泊松求和公式**：$\\displaystyle\\sum_{n=-\\infty}^{\\infty}f(n)=\\sum_{k=-\\infty}^{\\infty}\\hat{f}(k)$
`;

const FULL = TOOL + NEWS + FORMULAS;

const TABLE = `

| 名称 | 公式 |
| --- | --- |
| 斯特林 | $n!$ |
| 雅可比 | $\\det A$ |
`;

// ─── 测试用例 ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
  }
}

console.log("\n[1] 自定义工具卡完整性 / 正文保留");

test("完整工具卡 strip 不裁切", () => {
  const out = stripIncompleteCustomMarkupTail(FULL);
  assert.equal(out, FULL);
  assert.ok(out.includes("你好！"));
  assert.ok(out.includes("斯特林公式"));
});

test("完整工具卡后 extract 保留新闻+公式段", () => {
  const { hasCustomBlock, segments } = extractCustomProcessBlocks(FULL);
  assert.equal(hasCustomBlock, true);
  assert.ok(segments.length >= 2);
  assert.equal(segments[0].kind, "process");
  const md = segments.filter((s) => s.kind === "md").map((s) => s.text).join("");
  assert.ok(md.includes("你好！"));
  assert.ok(md.includes("斯特林公式"));
  assert.ok(md.includes("$n!"));
});

test("半截开标签：裁到工具起点，不泄漏半截 HTML", () => {
  const incomplete =
    TOOL.slice(0, TOOL.indexOf("status=")) + "\n\n你好已经到了";
  const cut = findIncompleteCustomMarkupTailStart(incomplete);
  assert.ok(cut >= 0);
  const stripped = stripIncompleteCustomMarkupTail(incomplete);
  assert.ok(!stripped.includes("markdown-custom-process"));
  assert.ok(!stripped.includes("你好已经到了"));
});

test("工具已闭合 + 后续表格：不因误判真尾巴而裁掉", () => {
  const body = TOOL + TABLE;
  const out = stripIncompleteCustomMarkupTail(body);
  assert.equal(out, body);
  assert.ok(out.includes("| 名称 |"));
});

console.log("\n[2] 流式全量重解析成本模型（卡顿根因）");

test("固定 80ms 合并：累计解析量近似 O(n²)", () => {
  const chunk = 40; // 每 tick 增长字符
  const ticks = Math.ceil(FULL.length / chunk);
  let cumulative = 0;
  const costs = [];
  for (let t = 1; t <= ticks; t++) {
    const body = FULL.slice(0, Math.min(FULL.length, t * chunk));
    const c = approxParseCostUnits(body);
    costs.push(c);
    cumulative += c;
  }
  const finalCost = costs[costs.length - 1];
  // 若每 tick 全量扫到当前长度，累计 ≈ final * ticks / 2
  const expectedLower = finalCost * ticks * 0.35;
  assert.ok(
    cumulative > expectedLower,
    `累计成本过低，不像全量重扫: cum=${cumulative} expect>~${Math.round(expectedLower)}`,
  );
  // 相对「只解析终态一次」的放大比
  const amplification = cumulative / finalCost;
  console.log(
    `    ticks=${ticks} finalCost=${finalCost} cumulative=${cumulative} amplification=${amplification.toFixed(1)}x`,
  );
  assert.ok(
    amplification > 5,
    `放大比应显著 >5（实际全量流式），got ${amplification.toFixed(1)}`,
  );
});

test("自适应合并窗：累计解析量显著下降", () => {
  // 拉长到 >8k，才能跨过 160/280ms 档；模拟长会话
  const longBody = (FULL + TABLE).repeat(8);
  const chunk = 120;
  const ticks = Math.ceil(longBody.length / chunk);
  let fixedCum = 0;
  let adaptiveCum = 0;
  let fixedParses = 0;
  let adaptiveParses = 0;
  let lastFixedAt = -999;
  let lastAdaptiveAt = -999;
  let elapsed = 0;
  for (let t = 1; t <= ticks; t++) {
    elapsed += 40; // 假设 SSE 每 40ms 到一批
    const body = longBody.slice(0, Math.min(longBody.length, t * chunk));
    const cost = approxParseCostUnits(body);
    if (elapsed - lastFixedAt >= 80) {
      fixedCum += cost;
      fixedParses += 1;
      lastFixedAt = elapsed;
    }
    const interval = adaptiveStructInterval(body.length);
    if (elapsed - lastAdaptiveAt >= interval) {
      adaptiveCum += cost;
      adaptiveParses += 1;
      lastAdaptiveAt = elapsed;
    }
  }
  const ratio = adaptiveCum / fixedCum;
  console.log(
    `    bodyLen=${longBody.length} fixedParses=${fixedParses} adaptiveParses=${adaptiveParses} costRatio=${ratio.toFixed(2)}`,
  );
  assert.ok(
    adaptiveParses < fixedParses,
    "自适应应减少解析次数",
  );
  assert.ok(
    ratio < 0.75,
    `自适应累计成本应 < 固定 80ms 的 75%，got ${(ratio * 100).toFixed(0)}%`,
  );
});

test("工具+公式+表：单次成本高于纯文本同长度", () => {
  const plain = "甲".repeat(FULL.length);
  const plainCost = approxParseCostUnits(plain);
  const richCost = approxParseCostUnits(FULL + TABLE);
  assert.ok(
    richCost > plainCost * 1.2,
    `富文本成本应明显高于纯文本: rich=${richCost} plain=${plainCost}`,
  );
  console.log(`    plain=${plainCost} rich=${richCost} ratio=${(richCost / plainCost).toFixed(2)}`);
});

console.log("\n[3] 稳定 key 规则（防 Android 错位复用）");

test("key 不得拼 list index（插卡后会漂移）", () => {
  function markdownItemKey(type, uniqueId, index) {
    // 正确实现
    if (uniqueId != null && `${uniqueId}`.length > 0) {
      return `${type}__${uniqueId}`;
    }
    return `${type}__i${index}`;
  }
  const before = [
    markdownItemKey("paragraph", "fallback-segment-1-0-p0", 0),
    markdownItemKey("paragraph", "fallback-segment-1-1-p1", 1),
  ];
  // 前端插入工具卡
  const after = [
    markdownItemKey(
      "markdown_custom_process",
      "fallback-markdown_custom_process-65ee",
      0,
    ),
    markdownItemKey("paragraph", "fallback-segment-1-0-p0", 1),
    markdownItemKey("paragraph", "fallback-segment-1-1-p1", 2),
  ];
  assert.equal(before[0], after[1]);
  assert.equal(before[1], after[2]);
  // 错误实现（带 index）会让段落 key 变化
  const bad = (type, id, index) => `${type}-${id}${index}`;
  assert.notEqual(bad("paragraph", "p0", 0), bad("paragraph", "p0", 1));
});

console.log("\n[4] 主线程预算估算（80ms 窗 vs 解析成本）");

test("正文变长后单次成本线性上升并可能占满 80ms 窗", () => {
  const samples = [];
  for (let n = 1; n <= 8; n++) {
    const body = (FULL + TABLE).repeat(n);
    const units = approxParseCostUnits(body);
    samples.push({ len: body.length, units, n });
  }
  console.log("    解析成本单位（镜像，不含 katex/原生 diff）:");
  for (const s of samples) {
    console.log(`      x${s.n} bodyLen=${s.len} units=${s.units}`);
  }
  assert.ok(samples[7].units > samples[0].units * 6);
  const msPerUnitGuess = 0.02;
  const saturate = samples.find((s) => s.units * msPerUnitGuess > 80);
  if (saturate) {
    console.log(
      `    ⚠ 粗估：bodyLen≈${saturate.len} 时单次可能 >80ms 合并窗 → 与下一 tick 叠峰`,
    );
  } else {
    console.log(
      `    本样本最大 units=${samples[7].units}；叠 katex/列表替换后长会话仍易打满窗`,
    );
  }
});

console.log("\n[5] 增量 fallback：稳定切点 + 全量 vs 增量对比");

test("完整工具卡后切点越过工具区，末段留 live", () => {
  const cut = findStableMarkdownCut(FULL, true);
  assert.ok(cut > TOOL.length, `cut=${cut} 应越过工具卡`);
  assert.ok(cut < FULL.length, "流式不应冻到文末");
  const frozen = FULL.substring(0, cut);
  assert.ok(frozen.includes("markdown-custom-process"));
  assert.ok(frozen.includes("你好！") || FULL.substring(cut).includes("你好！"));
});

test("仅 FINISHED 工具卡可冻全文；EXECUTING 不冻（防 status 改写）", () => {
  const finished = TOOL;
  assert.equal(
    findStableMarkdownCut(finished, true),
    finished.length,
    "FINISHED 单卡应冻满",
  );
  const executing = TOOL.replace('status="FINISHED"', 'status="EXECUTING"');
  assert.equal(
    findStableMarkdownCut(executing, true),
    0,
    "EXECUTING 单卡切点应为 0",
  );
});

test("未闭合代码围栏：切点不越过 fence 起点", () => {
  const body = TOOL + "\n\n前文\n\n```js\nconst x = 1;\n";
  const cut = findStableMarkdownCut(body, true);
  const fenceAt = body.indexOf("```");
  assert.ok(cut <= fenceAt, `cut=${cut} fence=${fenceAt}`);
});

test("增长中的表格整表留 live", () => {
  const body = TOOL + "\n\n说明\n\n| a | b |\n| --- | --- |\n| 1 | 2 |";
  const cut = findStableMarkdownCut(body, true);
  const tableAt = body.indexOf("| a |");
  assert.ok(tableAt >= 0);
  // cut 为 exclusive：冻结尾于表起点时，整表在 live
  assert.ok(
    cut <= tableAt,
    `表应在 live, cut=${cut} tableAt=${tableAt}`,
  );
  assert.ok(!body.substring(0, cut).includes("| a |"));
});

test("终态切点 = 全文长度", () => {
  assert.equal(findStableMarkdownCut(FULL, false), FULL.length);
});

test("增量累计成本显著低于全量 O(n²)", () => {
  const longBody = (FULL + "\n\n").repeat(4) + FORMULAS;
  const sim = simulateIncrementalParseCost(longBody, 80);
  const ratio = sim.incrCum / sim.fullCum;
  console.log(
    `    ticks=${sim.ticks} fullCum=${sim.fullCum} incrCum=${sim.incrCum} ratio=${ratio.toFixed(2)} maxLive=${sim.maxLive} stableLen=${sim.stableLen}`,
  );
  assert.ok(sim.incrCum < sim.fullCum, "增量累计应小于全量");
  assert.ok(
    ratio < 0.55,
    `增量成本应 < 全量 55%，got ${(ratio * 100).toFixed(0)}%`,
  );
  assert.ok(sim.stableLen > 0, "应冻结出稳定前缀");
});

// ─── 汇总 ──────────────────────────────────────────────────────────────────

console.log(`\n结果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

console.log(`
结论（由本自测支撑）:
1. 工具卡解析本身不会丢掉后续新闻/公式。
2. 改前：结构化内容下每 tick 全量 fallback → 累计 ≈ O(n²)。
3. 改后：稳定前缀冻结 + 只解析 newlyFrozen/live → 累计接近 O(n)，同长样本成本可降到全量一半以下。
4. 自适应合并窗 + 稳定 key 仍作为正交加固。
5. 不给公式/表/代码加块级 loading；会话级 icon_loading 表示 SSE 进行中即可。
`);
