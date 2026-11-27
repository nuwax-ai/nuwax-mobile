import fs from "node:fs";
import vm from "node:vm";

export function parseLocaleBundle(filePath, exportName) {
  const source = fs.readFileSync(filePath, "utf8");
  const exportRegex = new RegExp(
    `export\\s+const\\s+${exportName}\\s*(:\\s*Record<[^>]+>\\s*)?=`,
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
}
