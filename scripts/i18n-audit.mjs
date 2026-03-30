#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const includeDirs = ["pages", "subpackages", "components", "utils", "servers"];
const includeFiles = ["App.uvue"];
const includeExt = new Set([".uvue", ".vue", ".uts"]);
const excludeFiles = new Set([
  "components/pane-tabs/example.uvue",
  "utils/mockApiService.uts",
  "utils/pinyin.uts",
]);

const hasChinese = /[\u4e00-\u9fff]/;
const visibleLine = new RegExp(
  [
    "showToast",
    "showModal",
    "showLoading",
    "setNavigationBarTitle",
    "throw\\s+new\\s+Error",
    "reject\\s*\\(\\s*new\\s+Error",
    "confirmText",
    "cancelText",
    "placeholder=",
    "title=",
    "alt=",
    "label\\s*:",
    "content\\s*:",
    "description\\s*:",
    "steps\\s*:",
    "error\\s*:\\s*['\"`]",
    "message\\s*:\\s*['\"`]",
    "<text",
    "<button",
    "<input",
    "<textarea",
  ].join("|"),
);
const hardcodedVisibleLiteral = new RegExp(
  [
    "title\\s*:\\s*['\"](?!NuwaxMobile\\.)[^'\"\\n]+['\"]",
    "content\\s*:\\s*['\"](?!NuwaxMobile\\.)[^'\"\\n]+['\"]",
    "confirmText\\s*:\\s*['\"](?!NuwaxMobile\\.)[^'\"\\n]+['\"]",
    "cancelText\\s*:\\s*['\"](?!NuwaxMobile\\.)[^'\"\\n]+['\"]",
    "(^|\\s)placeholder\\s*=\\s*['\"][^'\"\\n]+['\"]",
    "(^|\\s)alt\\s*=\\s*['\"][^'\"\\n]+['\"]",
  ].join("|"),
);

const stripComments = (content) => {
  return content
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
};

const walkFiles = (dir) => {
  const absDir = path.join(rootDir, dir);
  if (!fs.existsSync(absDir)) return [];

  const results = [];
  const stack = [absDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.forEach((entry) => {
      const absPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absPath);
        return;
      }
      const relPath = path.relative(rootDir, absPath).replace(/\\/g, "/");
      if (excludeFiles.has(relPath)) return;
      if (!includeExt.has(path.extname(relPath))) return;
      results.push(relPath);
    });
  }
  return results;
};

const findings = [];
const files = Array.from(
  new Set([
    ...includeDirs.flatMap((dir) => walkFiles(dir)),
    ...includeFiles.filter((file) => {
      const relPath = file.replace(/\\/g, "/");
      return (
        fs.existsSync(path.join(rootDir, relPath)) &&
        includeExt.has(path.extname(relPath))
      );
    }),
  ]),
);

files.forEach((relPath) => {
  const absPath = path.join(rootDir, relPath);
  const raw = fs.readFileSync(absPath, "utf8");
  const content = stripComments(raw);
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    const code = line.replace(/\/\/.*$/, "");
    const trimmed = code.trim();
    if (!trimmed || trimmed.startsWith("//")) return;

    if (hardcodedVisibleLiteral.test(code)) {
      findings.push({
        file: relPath,
        line: index + 1,
        text: code.trim(),
      });
      return;
    }

    if (!hasChinese.test(code)) return;
    if (!visibleLine.test(code)) return;

    findings.push({
      file: relPath,
      line: index + 1,
      text: code.trim(),
    });
  });
});

if (findings.length > 0) {
  console.error(
    `[i18n audit] failed: found ${findings.length} user-visible Chinese hardcoded line(s).`,
  );
  findings.forEach((item) => {
    console.error(`${item.file}:${item.line}: ${item.text}`);
  });
  process.exit(1);
}

console.log("[i18n audit] passed: 0 user-visible Chinese hardcoded lines.");
