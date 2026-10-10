import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";

export function loadUtsClass(path: string, className: string, scope: Record<string, unknown>) {
  const source = readFileSync(path, "utf8")
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*$/gm, "")
    .replace(/^export /gm, "");
  const code = transformSync(source, { loader: "ts" }).code;
  return new Function(...Object.keys(scope), `${code}; return ${className};`)(...Object.values(scope));
}
