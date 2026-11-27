import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLocaleBundle } from "./i18n-locales.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const resourceDir = path.join(root, "static/app-android/i18n");
const locales = ["en-us", "zh-cn", "zh-hk", "zh-tw"];
const checkOnly = process.argv.includes("--check");

if (!checkOnly) {
  fs.mkdirSync(resourceDir, { recursive: true });
}

for (const locale of locales) {
  const source = path.join(root, "constants/i18n-locales", `${locale}.uts`);
  const exportName = `I18N_${locale.toUpperCase().replace("-", "_")}`;
  const bundle = parseLocaleBundle(source, exportName);
  const resource = path.join(resourceDir, `${locale}.json`);
  const expected = `${JSON.stringify(bundle, null, 2)}\n`;

  if (checkOnly) {
    const existing = fs.existsSync(resource)
      ? fs.readFileSync(resource, "utf8").replace(/\r\n/g, "\n")
      : "";
    if (existing !== expected) {
      console.error(
        `[i18n Android] Outdated or missing ${path.relative(root, resource)}. Run pnpm i18n:sync-android.`,
      );
      process.exitCode = 1;
    }
  } else {
    fs.writeFileSync(resource, expected);
  }
}

if (process.exitCode !== 1) {
  console.log(
    checkOnly ? "[i18n Android] Bundles are current." : "[i18n Android] Bundles updated.",
  );
}
