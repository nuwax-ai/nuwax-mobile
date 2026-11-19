import path from "node:path";
import { defineConfig } from "vitest/config";
import { transformWithEsbuild } from "vite";

/**
 * 移动端纯逻辑单测配置（对齐 PC 端 vitest 模式）。
 *
 * - 覆盖纯函数及功能生命周期。生命周期测试使用显式的 uni/native/系统 Kit mock。
 * - .uts / .ets 使用 TS loader。先按 uni 条件编译语义（// #ifdef ... // #endif）以 H5 平台
 *   求值剥离无关分支（同一符号在 H5 / 非 H5 各有一份实现，node 下会重复导出），
 *   再用 esbuild 以 ts loader 转译（vite 官方 transformWithEsbuild 方式）
 * - `@` 别名指向仓库根（与 uni 编译一致）；H5 分支的 `import "diff"` 已在 dependencies
 */

/** 测试目标平台：与 mp-html 渲染链路（H5 / WEB）一致。 */
const TEST_PLATFORMS = new Set(["H5", "WEB"]);

function evalConditionExpression(expr: string): boolean {
  // uni 条件编译：`||` 为或、`&&` 为与；token 为平台名
  return expr
    .split("||")
    .some((orTerm) =>
      orTerm
        .split("&&")
        .every((token) => TEST_PLATFORMS.has(token.trim())),
    );
}

/** 以 TEST_PLATFORMS 求值条件编译，剥离不生效分支的代码行。 */
function stripConditionalCompilation(code: string): string {
  const lines = code.split("\n");
  const out: string[] = [];
  // 每层为该 #ifdef/#ifndef 分支是否生效；层内代码仅当所有已开层都生效时保留
  const activeStack: boolean[] = [];
  for (const line of lines) {
    const ifdefMatch = line.match(/^\s*\/\/\s*#ifdef\s+(.+)$/);
    const ifndefMatch = line.match(/^\s*\/\/\s*#ifndef\s+(.+)$/);
    const endifMatch = line.match(/^\s*\/\/\s*#endif\b/);
    if (ifdefMatch != null) {
      activeStack.push(evalConditionExpression(ifndefMatch?.[1] ?? ifdefMatch[1]));
      continue;
    }
    if (ifndefMatch != null) {
      activeStack.push(!evalConditionExpression(ifndefMatch[1]));
      continue;
    }
    if (endifMatch != null) {
      activeStack.pop();
      continue;
    }
    if (activeStack.every((active) => active)) {
      out.push(line);
    }
  }
  return out.join("\n");
}

export default defineConfig({
  resolve: {
    alias: [
      // HBuilderX resolves uni_modules by platform. Node tests use the H5 entry.
      { find: /^@\/uni_modules\/nuwax-voip$/, replacement: path.resolve(__dirname, "uni_modules/nuwax-voip/utssdk/web/index.uts") },
      { find: "@", replacement: path.resolve(__dirname) },
    ],
    // 依赖链里存在不带后缀的 `@/utils/xxx` import（.uts 文件间引用），
    // 让 vite 按 ts 方式解析 .uts 扩展
    extensions: [
      ".uts",
      ".ts",
      ".mjs",
      ".js",
      ".mts",
      ".jsx",
      ".tsx",
      ".json",
    ],
  },
  plugins: [
    {
      name: "uts-as-ts",
      enforce: "pre",
      transform(code, id) {
        if (id.endsWith(".uts") || id.endsWith(".ets")) {
          return transformWithEsbuild(
            stripConditionalCompilation(code),
            id.replace(/\.(uts|ets)$/, ".ts"),
            { loader: "ts" },
          );
        }
        return undefined;
      },
    },
  ],
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    environment: "node",
  },
});
