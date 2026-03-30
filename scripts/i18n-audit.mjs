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
const zhLocalePath = "constants/i18n-locales/zh-cn.uts";
const enLocalePath = "constants/i18n-locales/en-us.uts";

const hasChinese = /[\u4e00-\u9fff]/;
const visibleLine = new RegExp(
  [
    "showToast",
    "showModal",
    "showLoading",
    "showError\\(",
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
    "text\\s*:\\s*['\"](?!NuwaxMobile\\.)[^'\"\\n]+['\"]",
    "showError\\s*\\(\\s*['\"][^'\"\\n]+['\"]\\s*\\)",
    "new\\s+Error\\s*\\(\\s*['\"][^'\"\\n]+['\"]\\s*\\)",
    "confirmText\\s*:\\s*['\"](?!NuwaxMobile\\.)[^'\"\\n]+['\"]",
    "cancelText\\s*:\\s*['\"](?!NuwaxMobile\\.)[^'\"\\n]+['\"]",
    "(^|\\s)placeholder\\s*=\\s*['\"][^'\"\\n]+['\"]",
    "(^|\\s)alt\\s*=\\s*['\"][^'\"\\n]+['\"]",
    "(^|\\s):placeholder\\s*=\\s*['\"]\\s*['\"`][^'\"`\\n]+['\"`]\\s*['\"]",
    "(^|\\s):alt\\s*=\\s*['\"]\\s*['\"`][^'\"`\\n]+['\"`]\\s*['\"]",
    "(^|\\s):title\\s*=\\s*['\"]\\s*['\"`][^'\"`\\n]+['\"`]\\s*['\"]",
    "(^|\\s):content\\s*=\\s*['\"]\\s*['\"`][^'\"`\\n]+['\"`]\\s*['\"]",
    "(^|\\s):confirmText\\s*=\\s*['\"]\\s*['\"`][^'\"`\\n]+['\"`]\\s*['\"]",
    "(^|\\s):cancelText\\s*=\\s*['\"]\\s*['\"`][^'\"`\\n]+['\"`]\\s*['\"]",
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

const collectLocaleKeyLines = (relPath) => {
  const absPath = path.join(rootDir, relPath);
  if (!fs.existsSync(absPath)) return new Map();
  const content = fs.readFileSync(absPath, "utf8");
  const keyLineMap = new Map();
  const keyRegex = /"((?:NuwaxMobile|System)\.[A-Za-z0-9_.]+)"\s*:/g;
  let match;
  while ((match = keyRegex.exec(content)) !== null) {
    const key = match[1];
    if (!keyLineMap.has(key)) {
      keyLineMap.set(key, content.slice(0, match.index).split(/\r?\n/).length);
    }
  }
  return keyLineMap;
};

const findings = [];
const usedKeyLocations = new Map();
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

  const keyRegex = /["'`](NuwaxMobile\.[A-Za-z0-9_.]+)["'`]/g;
  let keyMatch;
  while ((keyMatch = keyRegex.exec(content)) !== null) {
    const key = keyMatch[1];
    if (!usedKeyLocations.has(key)) {
      usedKeyLocations.set(key, {
        file: relPath,
        line: content.slice(0, keyMatch.index).split(/\r?\n/).length,
      });
    }
  }

  const legacyKeyRegex = /["'`](System\.[A-Za-z0-9_.]+)["'`]/g;
  let legacyMatch;
  while ((legacyMatch = legacyKeyRegex.exec(content)) !== null) {
    findings.push({
      file: relPath,
      line: content.slice(0, legacyMatch.index).split(/\r?\n/).length,
      text: `legacy i18n key prefix is forbidden: ${legacyMatch[1]}`,
    });
  }

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

  const imageTagRegex = /<image\b[\s\S]*?>/g;
  let tagMatch;
  while ((tagMatch = imageTagRegex.exec(content)) !== null) {
    const imageTag = tagMatch[0];
    if (!/(^|\s)(:alt|alt)\s*=/.test(imageTag)) {
      findings.push({
        file: relPath,
        line: content.slice(0, tagMatch.index).split(/\r?\n/).length,
        text: imageTag.replace(/\s+/g, " ").trim(),
      });
    }
  }

  const contentWithoutSelfClosedTextNode = content.replace(
    /<(text|button)\b(?:[^>"']|"[^"]*"|'[^']*')*\/>/g,
    (match) => match.replace(/[^\n]/g, " "),
  );
  const textNodeRegex =
    /<(text|button)\b(?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)<\/\1>/g;
  let textNodeMatch;
  while ((textNodeMatch = textNodeRegex.exec(contentWithoutSelfClosedTextNode)) !== null) {
    const rawInnerText = textNodeMatch[2] || "";
    const cleanedInnerText = rawInnerText
      .replace(/\{\{[\s\S]*?\}\}/g, "")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (!cleanedInnerText) continue;
    findings.push({
      file: relPath,
      line: contentWithoutSelfClosedTextNode
        .slice(0, textNodeMatch.index)
        .split(/\r?\n/).length,
      text: `${textNodeMatch[1]} node contains hardcoded text: ${cleanedInnerText}`,
    });
  }
});

const zhKeyLineMap = collectLocaleKeyLines(zhLocalePath);
const enKeyLineMap = collectLocaleKeyLines(enLocalePath);

const zhKeys = new Set(
  [...zhKeyLineMap.keys()].filter((key) => key.startsWith("NuwaxMobile.")),
);
const enKeys = new Set(
  [...enKeyLineMap.keys()].filter((key) => key.startsWith("NuwaxMobile.")),
);

const legacyLocaleKeyList = [
  ...[...zhKeyLineMap.keys()].filter((key) => key.startsWith("System.")),
  ...[...enKeyLineMap.keys()].filter((key) => key.startsWith("System.")),
];
legacyLocaleKeyList.forEach((key) => {
  findings.push({
    file: key.startsWith("System.")
      ? zhKeyLineMap.has(key)
        ? zhLocalePath
        : enLocalePath
      : zhLocalePath,
    line: zhKeyLineMap.get(key) || enKeyLineMap.get(key) || 1,
    text: `legacy locale key prefix is forbidden: ${key}`,
  });
});

[...zhKeys]
  .filter((key) => !enKeys.has(key))
  .forEach((key) => {
    findings.push({
      file: enLocalePath,
      line: 1,
      text: `missing key in en-us locale: ${key}`,
    });
  });

[...enKeys]
  .filter((key) => !zhKeys.has(key))
  .forEach((key) => {
    findings.push({
      file: zhLocalePath,
      line: 1,
      text: `missing key in zh-cn locale: ${key}`,
    });
  });

usedKeyLocations.forEach((location, key) => {
  if (!zhKeys.has(key) || !enKeys.has(key)) {
    findings.push({
      file: location.file,
      line: location.line,
      text: `missing locale definition for key: ${key}`,
    });
  }
});

if (findings.length > 0) {
  console.error(
    `[i18n audit] failed: found ${findings.length} i18n coverage issue(s).`,
  );
  findings.forEach((item) => {
    console.error(`${item.file}:${item.line}: ${item.text}`);
  });
  process.exit(1);
}

console.log("[i18n audit] passed: 0 i18n coverage issues.");
