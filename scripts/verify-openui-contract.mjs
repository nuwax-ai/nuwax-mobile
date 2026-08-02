/**
 * OpenUI 集成契约校验（对齐 scripts/verify-mcp-ask-contract.mjs）。
 *
 * uni-app x 对 npm 包子路径（exports）运行时 import 无先例且不可靠，故 nuwax-mobile
 * 采用 mcp-ask 同款范式：本地常量 + 本脚本在构建期对 ../nuwax-openui-mcp 交叉校验，
 * 确保 4 个工具名 token 与 MCP 包一致（单一事实源由脚本保证），server 侧重命名后移动端不会漏检。
 *
 * 运行：node scripts/verify-openui-contract.mjs
 */
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const mcpDir = path.resolve(rootDir, "../nuwax-openui-mcp");

function read(relativePath, baseDir = rootDir) {
  return fs.readFileSync(path.join(baseDir, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/** 从 contracts.ts 提取最新工具名基名；兼容旧版 tool-names.ts 直接声明。 */
function extractBaseNames(toolNamesSource, contractsSource) {
  const bases = {};
  const contractRe =
    /export\s+const\s+(OPENUI_[A-Z_]*TOOL_BASE_NAME)\s*=\s*['"]([a-z_]+)['"]/g;
  let m;
  while ((m = contractRe.exec(contractsSource)) !== null) {
    bases[m[1]] = m[2];
  }
  // 版本化：`<base>${OPENUI_MCP_VERSION_SUFFIX}`
  const versionedRe =
    /export\s+const\s+(OPENUI_[A-Z_]*TOOL_NAME)\s*=\s*`([a-z_]+)\$\{OPENUI_MCP_VERSION_SUFFIX\}`/g;
  while ((m = versionedRe.exec(toolNamesSource)) !== null) {
    bases[m[1]] = m[2];
  }
  // 字面量：'<base>' as const
  const literalRe =
    /export\s+const\s+(OPENUI_[A-Z_]*TOOL_NAME)\s*=\s*'([a-z_]+)'\s*as\s+const/g;
  while ((m = literalRe.exec(toolNamesSource)) !== null) {
    bases[m[1]] = m[2];
  }
  return bases;
}

const toolNames = read("packages/server/src/tool-names.ts", mcpDir);
const contracts = read("packages/server/src/contracts.ts", mcpDir);
const mcpBases = extractBaseNames(toolNames, contracts);
const renderBase =
  mcpBases.OPENUI_RENDER_TOOL_BASE_NAME ?? mcpBases.OPENUI_TOOL_NAME;
assert(
  renderBase === "nuwax_render_openui",
  `Could not derive OpenUI render tool base (got "${renderBase}")`,
);
const nonRenderBases = [
  mcpBases.OPENUI_REFERENCE_TOOL_BASE_NAME ?? mcpBases.OPENUI_REFERENCE_TOOL_NAME,
  mcpBases.OPENUI_UPDATE_GUIDE_TOOL_BASE_NAME ?? mcpBases.OPENUI_UPDATE_GUIDE_TOOL_NAME,
  mcpBases.OPENUI_VALIDATE_TOOL_BASE_NAME ?? mcpBases.OPENUI_VALIDATE_TOOL_NAME,
];
for (const b of nonRenderBases) {
  assert(!!b, `Could not derive a non-render tool base from nuwax-openui-mcp`);
}

const mobileSchema = read("utils/openUiSchema.uts");

// render token
const tokenMatch = mobileSchema.match(
  /OPENUI_RENDER_TOOL_TOKEN\s*=\s*"([^"]+)"/,
);
const mobileRenderToken = tokenMatch?.[1] ?? "";
assert(
  mobileRenderToken === renderBase,
  `OPENUI_RENDER_TOOL_TOKEN mismatch: expected "${renderBase}", got "${mobileRenderToken}"`,
);

// 非 render token 数组（顺序无关，集合相等）
const arrayMatch = mobileSchema.match(
  /OPENUI_NON_RENDER_TOOL_TOKENS\s*=\s*\[([\s\S]*?)\]/,
);
const mobileNonRender = (arrayMatch?.[1] ?? "")
  .split(",")
  .map((s) => s.replace(/["'\s]/g, ""))
  .filter(Boolean);
for (const expected of nonRenderBases) {
  assert(
    mobileNonRender.includes(expected),
    `OPENUI_NON_RENDER_TOOL_TOKENS missing expected base "${expected}"`,
  );
}

// 关键导出/文件存在性
assert(
  mobileSchema.includes("export function isOpenUiRenderToolName"),
  "utils/openUiSchema.uts missing export: isOpenUiRenderToolName",
);
assert(
  mobileSchema.includes("export function extractOpenUiArtifactInfo"),
  "utils/openUiSchema.uts missing export: extractOpenUiArtifactInfo",
);
assert(
  mobileSchema.includes("export function buildOpenUiFilePath"),
  "utils/openUiSchema.uts missing export: buildOpenUiFilePath",
);
assert(
  fs.existsSync(
    path.join(rootDir, "subpackages/components/openui-card/openui-card.uvue"),
  ),
  "openui-card.uvue missing",
);
assert(
  fs.existsSync(
    path.join(rootDir, "subpackages/utils/openUiArtifactAdapter.uts"),
  ),
  "openUiArtifactAdapter.uts missing",
);
const mobileAdapter = read("subpackages/utils/openUiArtifactAdapter.uts");
assert(
  mobileAdapter.includes("normalizeRenderUiProcessingData") &&
    mobileAdapter.includes('"subEventType"') &&
    mobileAdapter.includes('readRawField(result, "data")'),
  "openUiArtifactAdapter.uts missing latest PROCESSING + RENDER_UI result.data adapter",
);
assert(
  read("utils/system.uts").includes("openOpenUiArtifact"),
  "utils/system.uts missing openOpenUiArtifact nav helper",
);

console.log(
  `✓ OpenUI 契约一致：render "${mobileRenderToken}"，非 render [${mobileNonRender.join(
    ", ",
  )}]，均对齐 nuwax-openui-mcp；关键文件齐备。`,
);
