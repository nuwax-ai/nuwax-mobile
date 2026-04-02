#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const rootDir = process.cwd();

const localeConfig = {
  "zh-cn": {
    file: path.join(rootDir, "constants/i18n-locales/zh-CN.uts"),
    exportName: "I18N_ZH_CN",
  },
  "en-us": {
    file: path.join(rootDir, "constants/i18n-locales/en-US.uts"),
    exportName: "I18N_EN_US",
  },
};

const outputCsv = path.join(rootDir, "docs/i18n-platform-default-import.csv");
const outputJson = path.join(rootDir, "docs/i18n-platform-default-import.json");

const parseLocaleBundle = (filePath, exportName) => {
  const source = fs.readFileSync(filePath, "utf8");
  const exportRegex = new RegExp(
    `export\\s+const\\s+${exportName}\\s*:\\s*Record<[^>]+>\\s*=`,
    "m",
  );

  if (!exportRegex.test(source)) {
    throw new Error(`Cannot find export \"${exportName}\" in ${filePath}`);
  }

  const executable = source.replace(exportRegex, "module.exports =");
  const sandbox = {
    module: { exports: {} },
    exports: {},
  };

  vm.runInNewContext(executable, sandbox, {
    filename: filePath,
    timeout: 1000,
  });

  const bundle = sandbox.module.exports;
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    throw new Error(`Invalid locale bundle in ${filePath}`);
  }

  return bundle;
};

const csvEscape = (value) => {
  const normalized = String(value ?? "")
    .replace(/\r?\n/g, "\\n")
    .replace(/"/g, '""');
  return `"${normalized}"`;
};

const main = () => {
  const zhBundle = parseLocaleBundle(
    localeConfig["zh-cn"].file,
    localeConfig["zh-cn"].exportName,
  );
  const enBundle = parseLocaleBundle(
    localeConfig["en-us"].file,
    localeConfig["en-us"].exportName,
  );

  const zhKeys = Object.keys(zhBundle).sort();
  const enKeys = Object.keys(enBundle).sort();

  const missingInEn = zhKeys.filter((key) => !Object.hasOwn(enBundle, key));
  const missingInZh = enKeys.filter((key) => !Object.hasOwn(zhBundle, key));

  if (missingInEn.length > 0 || missingInZh.length > 0) {
    const detail = [
      missingInEn.length > 0
        ? `Missing in en-us: ${missingInEn.slice(0, 10).join(", ")}${missingInEn.length > 10 ? " ..." : ""}`
        : "",
      missingInZh.length > 0
        ? `Missing in zh-cn: ${missingInZh.slice(0, 10).join(", ")}${missingInZh.length > 10 ? " ..." : ""}`
        : "",
    ]
      .filter(Boolean)
      .join(" | ");
    throw new Error(`Locale key mismatch. ${detail}`);
  }

  const rows = zhKeys.map((key) => ({
    key,
    "zh-cn": zhBundle[key] || "",
    "en-us": enBundle[key] || "",
  }));

  const csvLines = [
    "key,zh-cn,en-us",
    ...rows.map((row) =>
      [
        csvEscape(row.key),
        csvEscape(row["zh-cn"]),
        csvEscape(row["en-us"]),
      ].join(","),
    ),
  ];

  const jsonPayload = {
    generatedAt: new Date().toISOString(),
    totalKeys: rows.length,
    source: {
      "zh-cn": path.relative(rootDir, localeConfig["zh-cn"].file),
      "en-us": path.relative(rootDir, localeConfig["en-us"].file),
    },
    rows,
  };

  fs.writeFileSync(outputCsv, `${csvLines.join("\n")}\n`, "utf8");
  fs.writeFileSync(
    outputJson,
    `${JSON.stringify(jsonPayload, null, 2)}\n`,
    "utf8",
  );

  console.log(
    `[i18n export] wrote ${rows.length} keys to ${path.relative(rootDir, outputCsv)} and ${path.relative(rootDir, outputJson)}`,
  );
};

main();
