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
import { readFileSync } from "node:fs";

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

/** 镜像 findUnclosedBlockFormulaStart：代码围栏内忽略，$$ 成对 / \[ 需配对 \]。 */
function findUnclosedBlockFormulaStart(text) {
  if (text.length === 0) return -1;
  let inFence = false;
  let dOpen = -1;
  let bOpen = -1;
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text.charAt(i);
    if (inFence) {
      if (c === "`" && i + 2 < n && text.charAt(i + 1) === "`" && text.charAt(i + 2) === "`") {
        inFence = false;
        i += 3;
        continue;
      }
      i++;
      continue;
    }
    if (c === "`" && i + 2 < n && text.charAt(i + 1) === "`" && text.charAt(i + 2) === "`") {
      inFence = true;
      i += 3;
      continue;
    }
    if (c === "$" && i + 1 < n && text.charAt(i + 1) === "$") {
      if (dOpen < 0) dOpen = i;
      else dOpen = -1;
      i += 2;
      continue;
    }
    if (c === "\\" && i + 1 < n && text.charAt(i + 1) === "[") {
      if (bOpen < 0) bOpen = i;
      i += 2;
      continue;
    }
    if (c === "\\" && i + 1 < n && text.charAt(i + 1) === "]") {
      bOpen = -1;
      i += 2;
      continue;
    }
    i++;
  }
  let best = -1;
  if (dOpen >= 0) best = dOpen;
  if (bOpen >= 0 && (best < 0 || bOpen < best)) best = bOpen;
  return best;
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

function lastSoftLineBoundaryBefore(text, limit) {
  const sliceEnd = Math.min(limit, text.length);
  if (sliceEnd <= 0) return 0;
  const region = text.substring(0, sliceEnd);
  const idx = region.lastIndexOf("\n");
  if (idx < 0) return 0;
  return idx + 1;
}

function isWhitespaceChar_(c) {
  return c === " " || c === "\n" || c === "\r" || c === "\t";
}

function isOrderedListItemStart(t) {
  let i = 0;
  const n = t.length;
  while (i < n && t.charAt(i) >= "0" && t.charAt(i) <= "9") i++;
  if (i === 0) return false;
  if (i < n) {
    const marker = t.charAt(i);
    if (marker === "." || marker === ")" || marker === "、") {
      if (i + 1 >= n || isWhitespaceChar_(t.charAt(i + 1))) return true;
    }
  }
  return false;
}

function isSafeProseText(text) {
  if (text.length === 0) return false;
  if (text.indexOf("```") >= 0) return false;
  if (text.indexOf("$$") >= 0) return false;
  if (text.indexOf("<markdown-custom") >= 0) return false;
  if (text.indexOf("![") >= 0) return false;
  if (text.indexOf("\n\n") >= 0) return false;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.length === 0) return false;
    const c = t.charAt(0);
    if (c === "#" || c === ">" || c === "|") return false;
    if (
      (c === "-" || c === "*" || c === "+") &&
      t.length > 1 &&
      isWhitespaceChar_(t.charAt(1))
    )
      return false;
    if (isOrderedListItemStart(t)) return false;
  }
  return true;
}

function isWhitespaceChar(ch) {
  return ch === " " || ch === "\n" || ch === "\r" || ch === "\t";
}

function isTerminalProcessOpenTag(openTag) {
  return (
    openTag.includes('status="FINISHED"') ||
    openTag.includes('status="FAILED"') ||
    openTag.includes("status='FINISHED'") ||
    openTag.includes("status='FAILED'")
  );
}

function scanProcessBlockEnd(slice, openIdx) {
  const openMarker = "<markdown-custom-process";
  if (slice.substring(openIdx, openIdx + openMarker.length) !== openMarker) {
    return -1;
  }
  const afterName = openIdx + openMarker.length;
  if (slice.substring(afterName, afterName + 6) === "-group") return -1;
  const gt = slice.indexOf(">", afterName);
  if (gt < 0) return -1;
  let blockEnd = gt + 1;
  if (slice.charAt(gt - 1) !== "/") {
    const closeMarker = "</markdown-custom-process>";
    const closeIdx = slice.indexOf(closeMarker, gt);
    if (closeIdx < 0) return -1;
    blockEnd = closeIdx + closeMarker.length;
  }
  return blockEnd;
}

function expandAfterProcessBlock(slice, blockEnd) {
  let lastEnd = blockEnd;
  let p = blockEnd;
  while (p < slice.length && isWhitespaceChar(slice.charAt(p))) p++;
  if (slice.substring(p, p + 6).toLowerCase() === "</div>") {
    lastEnd = p + 6;
  }
  return lastEnd;
}

function endOfFinishedCustomBlocks(text, limit) {
  const sliceEnd = Math.min(limit, text.length);
  if (sliceEnd <= 0) return 0;
  const slice = text.substring(0, sliceEnd);
  const openMarker = "<markdown-custom-process";
  const groupOpen = "<markdown-custom-process-group>";
  const groupClose = "</markdown-custom-process-group>";
  let search = 0;
  let lastEnd = 0;
  while (search < slice.length) {
    const groupIdx = slice.indexOf(groupOpen, search);
    const procIdx = slice.indexOf(openMarker, search);
    if (groupIdx < 0 && procIdx < 0) break;
    if (groupIdx >= 0 && (procIdx < 0 || groupIdx <= procIdx)) {
      const innerStart = groupIdx + groupOpen.length;
      const closeIdx = slice.indexOf(groupClose, innerStart);
      if (closeIdx < 0) break;
      const inner = slice.substring(innerStart, closeIdx);
      let allTerminal = true;
      let hasProcess = false;
      let innerSearch = 0;
      while (innerSearch < inner.length) {
        const pIdx = inner.indexOf(openMarker, innerSearch);
        if (pIdx < 0) break;
        const after = pIdx + openMarker.length;
        if (inner.substring(after, after + 6) === "-group") {
          innerSearch = after + 6;
          continue;
        }
        const gt = inner.indexOf(">", after);
        if (gt < 0) {
          allTerminal = false;
          break;
        }
        hasProcess = true;
        if (!isTerminalProcessOpenTag(inner.substring(pIdx, gt + 1))) {
          allTerminal = false;
          break;
        }
        const blockEndRel = scanProcessBlockEnd(inner, pIdx);
        if (blockEndRel < 0) {
          allTerminal = false;
          break;
        }
        innerSearch = blockEndRel;
      }
      const groupEnd = closeIdx + groupClose.length;
      if (hasProcess && allTerminal) {
        lastEnd = expandAfterProcessBlock(slice, groupEnd);
      }
      search = groupEnd;
      continue;
    }
    if (procIdx < 0) break;
    const afterName = procIdx + openMarker.length;
    if (slice.substring(afterName, afterName + 6) === "-group") {
      search = afterName + 6;
      continue;
    }
    const gt = slice.indexOf(">", afterName);
    if (gt < 0) break;
    const openTag = slice.substring(procIdx, gt + 1);
    const blockEnd = scanProcessBlockEnd(slice, procIdx);
    if (blockEnd < 0) break;
    if (isTerminalProcessOpenTag(openTag)) {
      lastEnd = expandAfterProcessBlock(slice, blockEnd);
    }
    search = blockEnd;
  }
  return lastEnd;
}

function collectToolBlockRanges(text) {
  const ranges = [];
  const openMarker = "<markdown-custom-process";
  const groupOpen = "<markdown-custom-process-group>";
  const groupClose = "</markdown-custom-process-group>";
  const containerMarker = ":::container";
  let search = 0;
  while (search < text.length) {
    const groupIdx = text.indexOf(groupOpen, search);
    const procIdx = text.indexOf(openMarker, search);
    const fenceIdx = text.indexOf(containerMarker, search);
    let best = -1;
    let kind = "";
    if (groupIdx >= 0) {
      best = groupIdx;
      kind = "group";
    }
    if (procIdx >= 0 && (best < 0 || procIdx < best)) {
      best = procIdx;
      kind = "process";
    }
    if (fenceIdx >= 0 && (best < 0 || fenceIdx < best)) {
      best = fenceIdx;
      kind = "container";
    }
    if (best < 0) break;
    if (kind === "group") {
      const closeIdx = text.indexOf(groupClose, best + groupOpen.length);
      if (closeIdx < 0) {
        ranges.push({ start: best, end: text.length });
        break;
      }
      ranges.push({ start: best, end: closeIdx + groupClose.length });
      search = ranges[ranges.length - 1].end;
      continue;
    }
    if (kind === "process") {
      const afterName = best + openMarker.length;
      if (text.substring(afterName, afterName + 6) === "-group") {
        search = afterName + 6;
        continue;
      }
      const blockEnd = scanProcessBlockEnd(text, best);
      if (blockEnd < 0) {
        ranges.push({ start: best, end: text.length });
        break;
      }
      const expanded = expandAfterProcessBlock(text, blockEnd);
      ranges.push({ start: best, end: expanded });
      search = expanded;
      continue;
    }
    const after = best + containerMarker.length;
    if (after < text.length) {
      const next = text.charAt(after);
      if (next !== " " && next !== "\t" && next !== "\n" && next !== "\r") {
        search = after;
        continue;
      }
    }
    const closeIdx = text.indexOf("\n:::", after);
    if (closeIdx < 0) {
      ranges.push({ start: best, end: text.length });
      break;
    }
    ranges.push({ start: best, end: closeIdx + "\n:::".length });
    search = ranges[ranges.length - 1].end;
  }
  return ranges;
}

function startOfTrailingToolCluster(text) {
  const ranges = collectToolBlockRanges(text);
  if (ranges.length === 0) return -1;
  let lastContent = text.length - 1;
  while (lastContent >= 0 && isWhitespaceChar(text.charAt(lastContent))) {
    lastContent--;
  }
  if (lastContent < 0) return ranges[0].start;
  const lastRange = ranges[ranges.length - 1];
  if (lastContent < lastRange.start || lastContent >= lastRange.end) return -1;
  let clusterStart = lastRange.start;
  for (let i = ranges.length - 2; i >= 0; i--) {
    const prev = ranges[i];
    if (text.substring(prev.end, clusterStart).trim().length > 0) break;
    clusterStart = prev.start;
  }
  return clusterStart;
}

function findStableMarkdownCut(markdown, streaming = true) {
  if (markdown.length === 0) return 0;
  if (streaming !== true) return markdown.length;
  let incompleteAt = -1;
  incompleteAt = earlierIndex(incompleteAt, findUnclosedCodeFenceStart(markdown));
  incompleteAt = earlierIndex(incompleteAt, findUnclosedBlockFormulaStart(markdown));
  incompleteAt = earlierIndex(incompleteAt, findTrailingOpenTableStart(markdown));
  incompleteAt = earlierIndex(
    incompleteAt,
    findIncompleteCustomMarkupTailStart(markdown),
  );
  const structureLimit = incompleteAt >= 0 ? incompleteAt : markdown.length;
  const region = markdown.substring(0, structureLimit);
  const paraCut = isSafeProseText(region)
    ? lastSoftLineBoundaryBefore(markdown, structureLimit)
    : lastParagraphBoundaryBefore(markdown, structureLimit);
  const toolCut = endOfFinishedCustomBlocks(markdown, structureLimit);
  let cut = Math.max(paraCut, toolCut);
  const trailingTools = startOfTrailingToolCluster(markdown);
  if (trailingTools >= 0 && cut > trailingTools) {
    const beforeTools = lastParagraphBoundaryBefore(markdown, trailingTools);
    cut = beforeTools <= trailingTools ? beforeTools : trailingTools;
    if (cut > trailingTools) cut = trailingTools;
  }
  return cut;
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

test("文末 FINISHED 工具簇不冻（可继续合组）；后接正文才冻；EXECUTING 不冻", () => {
  const finished = TOOL;
  assert.equal(
    findStableMarkdownCut(finished, true),
    0,
    "文末单卡应留 live，避免第二张拆开",
  );
  const withText = TOOL + "\n\n你好";
  const cutWithText = findStableMarkdownCut(withText, true);
  assert.ok(
    cutWithText >= TOOL.length,
    `后接正文应冻过工具卡 cut=${cutWithText}`,
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

test("纯文本单段（无空行）：切点推进到最后一个 \\n（修复 O(n²)）", () => {
  // 单段长回复，只用单个 \n 软换行，无空行 —— 修复前切点恒为 0
  const line = "这是同一段落里的一句，讲清楚一个要点。";
  const body = Array.from({ length: 8 }, () => line).join("\n");
  const cut = findStableMarkdownCut(body, true);
  const live = body.length - cut;
  assert.ok(cut > 0, `单段长文切点应推进，got cut=${cut}`);
  assert.ok(
    live <= line.length + 1,
    `只留末行 live，got live=${live}（应 ≤ ${line.length + 1}）`,
  );
  // 终态不受影响
  assert.equal(findStableMarkdownCut(body, false), body.length);
});

test("含块结构 / 空行的文本：仍走原 \\n\\n 语义，切点不越过结构", () => {
  // 空行多段 → 用原 \n\n 边界
  const multi = "第一段。\n\n第二段。\n\n第三段。";
  const cutMulti = findStableMarkdownCut(multi, true);
  assert.equal(cutMulti, 12, `多段应冻到第一个 \\n\\n，got cut=${cutMulti}`);
  // 含代码围栏 → 不越过 fence
  const code = "前文。\n\n```js\nconst x = 1;\n";
  const cutCode = findStableMarkdownCut(code, true);
  assert.ok(
    cutCode <= code.indexOf("```"),
    `代码围栏前不应越界，got cut=${cutCode}`,
  );
  // 含列表 → 回退原 \n\n 语义（无空行则 cut=0 保持安全）
  const list = "- 条目一\n- 条目二\n- 条目三";
  const cutList = findStableMarkdownCut(list, true);
  assert.equal(cutList, 0, `列表（无空行）不应按 \\n 冻结，got cut=${cutList}`);
});

test("纯文本单段增量：live 受限于单行 + 前缀持续推进（不再 O(n²)）", () => {
  // 60 行单段：修复前每 tick 全量重解析整段（live=全文）；修复后 live 应 ≈ 单行
  const line = "这是同一段落里的一句，讲清楚一个要点，语气平稳。";
  const longBody = Array.from({ length: 60 }, () => line).join("\n");
  const sim = simulateIncrementalParseCost(longBody, 24);
  const ratio = sim.incrCum / sim.fullCum;
  console.log(
    `    ticks=${sim.ticks} fullCum=${sim.fullCum} incrCum=${sim.incrCum} ratio=${ratio.toFixed(2)} maxLive=${sim.maxLive} stableLen=${sim.stableLen} bodyLen=${longBody.length}`,
  );
  // 核心不变量：live 必须被限制在单行量级（末尾未闭合行），而非整段
  assert.ok(
    sim.maxLive <= line.length + 2,
    `live 应受限于单行(≤${line.length + 2})，got maxLive=${sim.maxLive}`,
  );
  // 前缀持续推进到接近全文
  assert.ok(
    sim.stableLen >= longBody.length * 0.9,
    `稳定前缀应推进到 ≥90% 全文，got stableLen=${sim.stableLen}/${longBody.length}`,
  );
  // 增量累计显著低于全量
  assert.ok(ratio < 0.2, `增量累计应 < 全量 20%，got ${ratio.toFixed(2)}`);
});

// ─── 镜像 subpackages/components/ai-msg/appMarkdownFallback.uts ─────────────
// promoteLatexInlineCode / looksLikeLatexInlineCode：反引号内 LaTeX 提升为行内 $...$。

function looksLikeLatexInlineCode(inner) {
  const s = inner.trim();
  if (s.length < 2 || s.length > 800) return false;
  if (
    s.indexOf("://") >= 0 ||
    s.indexOf("function ") >= 0 ||
    s.indexOf("const ") >= 0 ||
    s.indexOf("let ") >= 0 ||
    s.indexOf("var ") >= 0 ||
    s.indexOf("=>") >= 0 ||
    s.indexOf("import ") >= 0 ||
    s.indexOf("export ") >= 0 ||
    s.indexOf("console.") >= 0 ||
    s.indexOf("return ") >= 0
  )
    return false;
  const texcmds = [
    "\\frac", "\\sqrt", "\\sum", "\\int", "\\iint", "\\lim", "\\begin", "\\end",
    "\\partial", "\\infty", "\\pi", "\\pm", "\\times", "\\cdot", "\\sin", "\\cos",
    "\\tan", "\\det", "\\mathbf", "\\mathrm", "\\text", "\\left", "\\right", "\\to",
    "\\cap", "\\cup", "\\lambda", "\\alpha", "\\beta", "\\theta", "\\gamma", "\\Delta",
    "\\nabla", "\\,", "\\;",
  ];
  for (const c of texcmds) if (s.indexOf(c) >= 0) return true;
  if (s.indexOf("^") >= 0 || s.indexOf("_") >= 0) {
    if (s.indexOf("=") >= 0 || (s.indexOf("+") >= 0 && s.indexOf("(") >= 0))
      return true;
  }
  return false;
}

function promoteLatexInlineCode(markdown) {
  if (markdown.indexOf("`") < 0) return markdown;
  let out = "";
  let i = 0;
  const n = markdown.length;
  while (i < n) {
    if (
      i + 2 < n &&
      markdown.charAt(i) === "`" &&
      markdown.charAt(i + 1) === "`" &&
      markdown.charAt(i + 2) === "`"
    ) {
      const close = markdown.indexOf("```", i + 3);
      if (close < 0) {
        out += markdown.substring(i);
        break;
      }
      out += markdown.substring(i, close + 3);
      i = close + 3;
      continue;
    }
    if (markdown.charAt(i) === "`") {
      const close = markdown.indexOf("`", i + 1);
      if (close < 0) {
        out += markdown.substring(i);
        break;
      }
      const inner = markdown.substring(i + 1, close);
      const trimmedInner = inner.trim();
      // 反引号内已自带 $...$ 定界（模型常见输出 `` `$a^2 + b^2$` ``）：
      // 直接去反引号保留原公式，避免二次包裹成 $$...$$ 块级（行内解析跳过 $$ → 露裸 $$）。
      const alreadyDelimited =
        trimmedInner.length > 2 &&
        trimmedInner.charAt(0) === "$" &&
        trimmedInner.charAt(trimmedInner.length - 1) === "$";
      if (looksLikeLatexInlineCode(inner) || alreadyDelimited) {
        out += alreadyDelimited ? trimmedInner : "$" + trimmedInner + "$";
        i = close + 1;
        continue;
      }
      out += markdown.substring(i, close + 1);
      i = close + 1;
      continue;
    }
    out += markdown.charAt(i);
    i++;
  }
  return out;
}

console.log("\n[6] 反引号内 LaTeX 提升（`` `$...$` `` → 行内 $...$）");

test("已自带 $ 定界的反引号公式：去反引号保留行内 $，不二次包裹", () => {
  assert.equal(
    promoteLatexInlineCode("1. 平方和：`$a^2 + b^2$`"),
    "1. 平方和：$a^2 + b^2$",
  );
  assert.equal(
    promoteLatexInlineCode("2. 分式：`$\\frac{a}{b}$`"),
    "2. 分式：$\\frac{a}{b}$",
  );
  assert.equal(
    promoteLatexInlineCode("16. 行列式：`$\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix} = ad - bc$`"),
    "16. 行列式：$\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix} = ad - bc$",
  );
});

test("无 $ 定界的 LaTeX 反引号：包成行内 $...$（原行为）", () => {
  assert.equal(
    promoteLatexInlineCode("x = `\\frac{a}{b}`"),
    "x = $\\frac{a}{b}$",
  );
});

test("普通代码 / 货币反引号不被提升", () => {
  // 普通代码片段保持反引号原样
  assert.equal(
    promoteLatexInlineCode("运行 `npm install` 安装依赖"),
    "运行 `npm install` 安装依赖",
  );
  // 货币 $100（无闭合 $）保持反引号原样
  assert.equal(
    promoteLatexInlineCode("价格是 `$100`，总量 `$200`"),
    "价格是 `$100`，总量 `$200`",
  );
});

test("用户报告的全量 20 公式清单：无 $$ 块级残留、无 `` `$ `` 残留", () => {
  const list = `
1. 平方和：\`$a^2 + b^2$\`
2. 分式：\`$\\frac{a}{b}$\`
3. 根式：\`$\\sqrt[n]{x}$\`
4. 完全平方：\`$(a+b)^2$\`
5. 求和：\`$\\sum_{i=1}^{n} a_i$\`
6. 分段函数：\`$f(x) = \\begin{cases} x^2, & x>0 \\\\ 0, & x=0 \\end{cases}$\`
7. 定积分：\`$\\int_{a}^{b} f(x)\\,dx$\`
8. 导数：\`$\\frac{dy}{dx}$\`
9. 偏导数：\`$\\frac{\\partial f}{\\partial x}$\`
10. 极限：\`$\\lim_{x \\to 0} \\frac{\\sin x}{x}$\`
11. 级数：\`$\\sum_{n=1}^{\\infty} \\frac{1}{n^2}$\`
12. 二重积分：\`$\\iint_D f(x,y)\\,dx\\,dy$\`
13. 三角恒等式：\`$\\sin^2 x + \\cos^2 x = 1$\`
14. 和角公式：\`$\\sin(\\alpha+\\beta) = \\sin\\alpha\\cos\\beta + \\cos\\alpha\\sin\\beta$\`
15. 重要极限：\`$\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$\`
16. 行列式：\`$\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix} = ad - bc$\`
17. 特征值：\`$A\\mathbf{v} = \\lambda\\mathbf{v}$\`
18. 矩阵：\`$\\begin{bmatrix} a_{11} & a_{12} \\\\ a_{21} & a_{22} \\end{bmatrix}$\`
19. 条件概率：\`$P(A|B) = \\frac{P(A \\cap B)}{P(B)}$\`
20. 欧拉恒等式：\`$e^{i\\pi} + 1 = 0$\`
`;
  const out = promoteLatexInlineCode(list);
  const formulaLines = out
    .split("\n")
    .filter((l) => /^\d+\.\s/.test(l));
  assert.equal(formulaLines.length, 20, "20 条列表行都应保留");
  for (const ln of formulaLines) {
    const body = ln.replace(/^\d+\.\s+/, "");
    assert.ok(
      body.indexOf("$$") < 0,
      `不得出现块级 $$：${ln}`,
    );
    assert.ok(
      body.indexOf("`$") < 0,
      `不得残留反引号包 $：${ln}`,
    );
    assert.ok(
      body.split("$").length - 1 === 2,
      `应恰为行内一对 $ 定界：${ln}`,
    );
  }
});

// ─── 官方 WAIT 语义：未出图公式截断后续内容，不跳过、回头补 ───────────────────
// 镜像 aiMsgMarkdownParser.firstPendingMathItemIndex / mathTokenNeedsWait /
// isMathConcluded：流式增量渲染列表止于第一个「图尚未就绪」的公式（含其后内容），
// 待公式出图（scheduleMathFlush 重新增量解析）后再把公式与后续一并上屏。

function mirrorTokenPending(t, displayMode, concludedSet) {
  if (t.type !== "math") {
    if (t.tokens) {
      for (const c of t.tokens) {
        if (mirrorTokenPending(c, displayMode, concludedSet)) return true;
      }
    }
    return false;
  }
  if (
    (t.href != null && t.href.length > 0) ||
    (t.html != null && t.html.length > 0)
  ) {
    return false;
  }
  const key = (displayMode ? "v2d1:" : "v2d0:") + (t.text ?? "");
  return !concludedSet.has(key);
}

function mirrorFirstPendingIndex(items, concludedSet) {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const rows = it.datasList || [];
    const isBlock = it.type === "math";
    for (let r = 0; r < rows.length; r++) {
      for (let t = 0; t < rows[r].length; t++) {
        if (mirrorTokenPending(rows[r][t], isBlock, concludedSet)) return i;
      }
    }
  }
  return -1;
}

console.log("\n[7] 官方 WAIT 语义（等公式出图再继续，不跳过、回头补）");

test("已出图公式不截断（前后文同屏）", () => {
  const items = [
    { type: "paragraph", datasList: [[{ type: "text", text: "前文" }]] },
    { type: "math", datasList: [[{ type: "math", text: "E=mc^2", href: "data:image/png;base64,xxx" }]] },
    { type: "paragraph", datasList: [[{ type: "text", text: "后文" }]] },
  ];
  assert.equal(mirrorFirstPendingIndex(items, new Set()), -1, "已出图公式不应截断");
});

test("在途未结算公式：截断到公式前，后文暂不上屏（等出图再补）", () => {
  const items = [
    { type: "paragraph", datasList: [[{ type: "text", text: "前文" }]] },
    { type: "math", datasList: [[{ type: "math", text: "E=mc^2" }]] }, // href 空且未结算
    { type: "paragraph", datasList: [[{ type: "text", text: "后文" }]] },
  ];
  const idx = mirrorFirstPendingIndex(items, new Set());
  assert.equal(idx, 1, "应截断在公式所在 item");
  assert.deepEqual(items.slice(0, idx).map((i) => i.datasList[0][0].text), ["前文"]);
});

test("已结算公式（含失败缓存占位）：不截断，占位展示并继续", () => {
  const items = [
    { type: "math", datasList: [[{ type: "math", text: "E=mc^2" }]] },
    { type: "paragraph", datasList: [[{ type: "text", text: "后文" }]] },
  ];
  // 已结算：缓存有 key（即使结果为空图）
  const concluded = new Set(["v2d1:E=mc^2"]);
  assert.equal(mirrorFirstPendingIndex(items, concluded), -1, "已结算公式不应截断");
});

test("行内公式（paragraph）同理：未出图未结算则截断其所在段", () => {
  const items = [
    { type: "paragraph", datasList: [[{ type: "text", text: "面积 " }, { type: "math", text: "a^2" }]] },
    { type: "paragraph", datasList: [[{ type: "text", text: "后文" }]] },
  ];
  const idx = mirrorFirstPendingIndex(items, new Set());
  assert.equal(idx, 0, "行内公式未结算应截断其所在段");
});

test("表格单元格行内公式：嵌套 token 同样参与判定", () => {
  const items = [
    { type: "table", datasList: [[{ type: "table_cell", tokens: [{ type: "math", text: "x_i" }] }]] },
    { type: "paragraph", datasList: [[{ type: "text", text: "后文" }]] },
  ];
  assert.equal(mirrorFirstPendingIndex(items, new Set()), 0, "表格行内公式未结算应截断");
  const concluded = new Set(["v2d0:x_i"]);
  assert.equal(mirrorFirstPendingIndex(items, concluded), -1, "表格行内公式已结算不应截断");
});

// ─── 官方「整体冻结到闭合」：未闭合块级公式冻结 live，闭合后连同后续内容一并上屏 ──
// 镜像 findUnclosedBlockFormulaStart：live 区出现未闭合 $$ / \[ 时，只渲染其前内容；
// 代码围栏内 $$ 忽略（围栏未闭合时内部内容不视为公式）。

console.log("\n[8] 官方「整体冻结到闭合」（未闭合块级公式冻结 live）");

test("未闭合 $$：live 冻结到闭合（不渲染公式及后续）", () => {
  const live = "$$\nE=mc^2";
  const at = findUnclosedBlockFormulaStart(live);
  assert.equal(at, 0);
  const toParse = at >= 0 ? live.substring(0, at) : live;
  assert.equal(toParse, "");
});

test("闭合 $$：不冻结（-1），公式 + 后续正常解析", () => {
  assert.equal(findUnclosedBlockFormulaStart("$$\nE=mc^2\n$$\n\n后文"), -1);
});

test("未闭合 \\[：冻结；闭合 \\[ ... \\]：不冻结", () => {
  assert.equal(findUnclosedBlockFormulaStart("\\[\\int_0^1"), 0);
  assert.equal(findUnclosedBlockFormulaStart("\\[\\int_0^1 x\\,dx\\]"), -1);
});

test("代码围栏内 $$ 不触发冻结（围栏未闭合仍按代码展示）", () => {
  assert.equal(findUnclosedBlockFormulaStart("```python\nprice = $$100\n"), -1);
});

test("未闭合 $$ 前导安全文本仍渲染", () => {
  const live = "前文$$\nE=mc^2";
  const at = findUnclosedBlockFormulaStart(live);
  assert.equal(at, 2);
  assert.equal(live.substring(0, at), "前文");
});

test("findStableMarkdownCut：未闭合 $$ 切点停在公式前，公式留 live 冻结", () => {
  const body = "第一段。\n\n$$\nE=mc^2";
  const cut = findStableMarkdownCut(body, true);
  assert.ok(cut <= body.indexOf("$$"), `cut=${cut} 应 ≤ $$ 起点`);
  const frozen = body.substring(0, cut);
  assert.ok(!frozen.includes("$$"), "冻结前缀不得包含未闭合公式");
});

test("findStableMarkdownCut：闭合公式后正文可正常冻结推进", () => {
  const body = "第一段。\n\n$$\nE=mc^2\n$$\n\n第二段。";
  const cut = findStableMarkdownCut(body, true);
  assert.ok(cut > body.indexOf("$$"), `闭合公式后可推进，got cut=${cut}`);
});

// ─── 裸 URL：数字引用尾标 ──────────────────────────────────────────────────

function mirrorAutolinkBoundary(url) {
  const schemeLength = url.startsWith("https://") ? 8 : url.startsWith("http://") ? 7 : 0;
  for (let i = 0; i < url.length; i++) {
    if (url.charAt(i) !== "[") continue;
    const host = schemeLength > 0 ? url.substring(schemeLength, i) : "";
    if (host.length === 0 || /[/?#]/.test(host)) continue;
    let cursor = i + 1;
    const digitStart = cursor;
    while (cursor < url.length && /[0-9]/.test(url.charAt(cursor))) cursor++;
    if (cursor > digitStart && (cursor === url.length || url.charAt(cursor) === "]")) {
      return i;
    }
  }
  return -1;
}

console.log("\n[9] 裸 URL 数字引用尾标");

test("域名后的 [1] 不进入 URL", () => {
  const value = "https://www.nuwax.com[1]";
  const boundary = mirrorAutolinkBoundary(value);
  assert.equal(value.substring(0, boundary), "https://www.nuwax.com");
  assert.equal(value.substring(boundary), "[1]");
});

test("URL 路径中的 [1] 保持完整", () => {
  assert.equal(mirrorAutolinkBoundary("https://example.com/path[1]?a=1"), -1);
});

// ─── Android 纯文本流式快速通道 ───────────────────────────────────────────

function mirrorIsPlainStreamBody(body) {
  if (body.length === 0) return false;
  if (
    body.includes("markdown-custom-process") ||
    body.includes(":::container") ||
    body.includes("<task-result") ||
    body.includes("<conversation") ||
    body.includes("```m") ||
    body.includes("```") ||
    body.includes("![") ||
    body.includes("](") ||
    body.includes("$$") ||
    body.includes("\\[") ||
    body.includes("\\(") ||
    body.includes("$") ||
    body.includes("**") ||
    body.includes("__") ||
    body.includes("~~") ||
    body.includes("`")
  ) {
    return false;
  }
  if (/^\s{0,3}(?:#{1,6}\s|>\s|[-+*]\s|\d+[.)]\s)/m.test(body)) {
    return false;
  }
  if (/^\s*\|.*\|\s*$/m.test(body) && /^\s*\|?\s*:?-{3,}/m.test(body)) {
    return false;
  }
  return true;
}

function mirrorSafeRevealEnd(text, requestedEnd) {
  let end = Math.max(0, Math.min(requestedEnd, text.length));
  if (end > 0 && end < text.length) {
    const prev = text.charCodeAt(end - 1);
    const next = text.charCodeAt(end);
    if (prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      end += 1;
    }
  }
  return end;
}

function mirrorShouldPace(samples) {
  if (samples.some((sample) => sample.size > 16)) return true;
  const gaps = samples.map((sample) => sample.gap).filter((gap) => gap >= 0);
  if (gaps.length < 5) return false;
  gaps.sort((a, b) => a - b);
  const p95Index = Math.min(gaps.length - 1, Math.ceil(gaps.length * 0.95) - 1);
  return gaps[p95Index] > 100;
}

function mirrorFreezePlainStreamChunks(text, threshold = 512) {
  const frozen = [];
  let frozenLength = 0;
  while (text.length - frozenLength >= threshold) {
    const unfrozen = text.substring(frozenLength);
    const cut = unfrozen.lastIndexOf("\n");
    if (cut <= 0) break;
    frozen.push(unfrozen.substring(0, cut));
    frozenLength += cut + 1;
  }
  return { frozen, live: text.substring(frozenLength) };
}

console.log("\n[10] Android 纯文本流式快速通道");

test("普通中英文和自然换行走纯文本快速通道", () => {
  assert.equal(mirrorIsPlainStreamBody("这是普通正文。\nSecond plain line."), true);
});

test("Markdown / 公式 / 工具标记中途出现后退出快速通道", () => {
  const prefix = "先输出一段普通文本。";
  assert.equal(mirrorIsPlainStreamBody(prefix), true);
  for (const tail of ["\n## 标题", "\n- 列表", " **粗体**", " $E=mc^2$", "\n```ts\nlet x = 1", "\n<markdown-custom-process"]) {
    assert.equal(mirrorIsPlainStreamBody(prefix + tail), false, tail);
  }
});

test("Unicode 揭示边界不会拆开 Emoji 代理对", () => {
  const text = "甲😀乙";
  assert.equal(text.length, 4);
  assert.equal(mirrorSafeRevealEnd(text, 2), 3);
  assert.equal(text.substring(0, mirrorSafeRevealEnd(text, 2)), "甲😀");
});

test("按自然换行冻结有界块，避免逐行节点膨胀", () => {
  const text = `${"甲".repeat(300)}\n\n${"乙".repeat(300)}\n尾段`;
  const split = mirrorFreezePlainStreamChunks(text);
  assert.equal(split.frozen.length, 1);
  assert.equal(split.frozen[0], `${"甲".repeat(300)}\n\n${"乙".repeat(300)}`);
  assert.equal(split.live, "尾段");
});

test("仅在大块或 p95 间隔超过阈值时开启二次匀速", () => {
  assert.equal(mirrorShouldPace(Array.from({ length: 8 }, () => ({ size: 4, gap: 20 }))), false);
  assert.equal(mirrorShouldPace([{ size: 17, gap: 20 }]), true);
  assert.equal(mirrorShouldPace(Array.from({ length: 8 }, () => ({ size: 4, gap: 120 }))), true);
});

test("快速通道已接入 ai-msg、SSE cadence 与滚动分流", () => {
  const aiMsg = readFileSync(new URL("../subpackages/components/ai-msg/ai-msg.uvue", import.meta.url), "utf8");
  const fastText = readFileSync(new URL("../subpackages/components/ai-msg/plain-stream-fast-text.uvue", import.meta.url), "utf8");
  const service = readFileSync(new URL("../subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts", import.meta.url), "utf8");
  const scroll = readFileSync(new URL("../subpackages/pages/chat-conversation-component/layers/ScrollManager.uts", import.meta.url), "utf8");
  assert.match(aiMsg, /answer-plain-stream-text/);
  assert.match(fastText, /frozenChunks/);
  assert.match(aiMsg, /\$callMethod\("updateText"/);
  assert.match(aiMsg, /resolveStreamRenderProfile/);
  assert.match(aiMsg, /streamDisplayPacing/);
  const policy = readFileSync(new URL("../subpackages/components/ai-msg/streamRenderPolicy.uts", import.meta.url), "utf8");
  assert.match(policy, /STREAM_RENDER_KIND_CODE/);
  assert.match(policy, /STREAM_RENDER_KIND_TABLE/);
  assert.match(policy, /STREAM_RENDER_KIND_FORMULA/);
  assert.match(service, /StreamBurstDetector/);
  assert.match(scroll, /contentMayRelayout/);
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
6. [7] 官方 WAIT 语义：流式增量渲染止于第一个「图尚未就绪」的公式（含其后内容），
   公式出图后重新增量解析，把公式与后续内容一并上屏——等公式渲染完再继续，不跳过、回头补。
7. [8] 官方「整体冻结到闭合」：未闭合块级公式（$$ / \[）出现时，live 只渲染其前内容，
   公式及之后内容一律不上屏；闭合后下一轮增量解析再把公式 + 后续一并上屏（对齐官方 runTask 冻结）。
`);
