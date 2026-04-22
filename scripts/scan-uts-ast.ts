#!/usr/bin/env tsx
/**
 * UTS 违规扫描器 — AST 版
 *
 * 基于 TypeScript Compiler API 做语法树分析：
 *   - 自动跳过字符串字面量/注释中的内容（regex 的致命弱点）
 *   - 能感知语法结构（类型位置 vs 值位置、条件位置、嵌套深度）
 *   - 支持 .uts（纯 UTS）和 .uvue（Vue SFC，自动提取 <script> 块）
 *   - 条件编译块（#ifdef H5|WEB）内的代码自动豁免
 *
 * 用法:
 *   npx tsx scripts/scan-uts-ast.ts                  # 扫描项目根目录
 *   npx tsx scripts/scan-uts-ast.ts ./subpackages    # 扫描子目录
 *   npx tsx scripts/scan-uts-ast.ts --json           # 输出 JSON
 */

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

// ─── 类型定义 ────────────────────────────────────────────────────────────────

type Severity = 'HIGH' | 'MEDIUM' | 'LOW';

type Violation = {
  file: string;
  line: number;
  column: number;
  rule: string;
  severity: Severity;
  message: string;
  code: string;   // 该行源码（trimmed）
  fix?: string;
};

// ─── Utility Types（不支持的 TS Utility Types）────────────────────────────────

const UTILITY_TYPES = new Set([
  'Partial', 'Required', 'Readonly', 'Pick', 'Omit',
  'Exclude', 'Extract', 'NonNullable', 'Parameters',
  'ConstructorParameters', 'ReturnType', 'InstanceType',
  'NoInfer', 'ThisParameterType', 'OmitThisParameter',
  'ThisType', 'Uppercase', 'Lowercase', 'Capitalize',
  'Uncapitalize', 'Awaited', 'Record',
]);

// 创建响应式状态的函数
const REACTIVE_FNS = new Set(['reactive', 'ref', 'shallowRef', 'shallowReactive', 'readonly']);

// ─── .uvue 处理 ──────────────────────────────────────────────────────────────

type ScriptBlock = {
  code: string;
  lineOffset: number; // <script> 标签在文件中的起始行号（0-based）
};

/** 从 .uvue 文件中提取 <script> 块 */
function extractScriptBlock(content: string): ScriptBlock | null {
  const match = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/i.exec(content);
  if (!match) return null;
  const scriptContent = match[1];
  const tagStart = match.index;
  const scriptStart = tagStart + match[0].indexOf(scriptContent);
  const lineOffset = content.substring(0, scriptStart).split('\n').length - 1;
  return { code: scriptContent, lineOffset };
}

// ─── 条件编译处理 ─────────────────────────────────────────────────────────────

/**
 * 将条件编译指令行替换为空行（保留行号，保留块内代码）。
 * 同时记录 H5/WEB-only 块的行范围，供后续豁免检查使用。
 */
function processConditionalCompilation(code: string): {
  cleaned: string;
  webOnlyLines: Set<number>; // 0-based line indices that are H5/WEB-only
} {
  const lines = code.split('\n');
  const webOnlyLines = new Set<number>();

  type StackEntry = { platform: 'WEB' | 'OTHER'; startLine: number };
  const stack: StackEntry[] = [];

  const cleaned = lines.map((line, idx) => {
    const t = line.trim();

    if (/^\/\/\s*#ifdef\s+(H5|WEB)\b/.test(t)) {
      stack.push({ platform: 'WEB', startLine: idx });
      return '';
    }
    if (/^\/\/\s*#ifdef\b/.test(t)) {
      stack.push({ platform: 'OTHER', startLine: idx });
      return '';
    }
    if (/^\/\/\s*#ifndef\b/.test(t)) {
      stack.push({ platform: 'OTHER', startLine: idx });
      return '';
    }
    if (/^\/\/\s*#endif\b/.test(t)) {
      stack.pop();
      return '';
    }
    if (/^\/\/\s*#else\b/.test(t)) {
      return '';
    }

    // Mark line as web-only if inside a H5/WEB ifdef
    if (stack.some(e => e.platform === 'WEB')) {
      webOnlyLines.add(idx);
    }
    return line;
  });

  return { cleaned: cleaned.join('\n'), webOnlyLines };
}

// ─── 核心扫描 ─────────────────────────────────────────────────────────────────

function scanFile(filePath: string): Violation[] {
  const rawContent = fs.readFileSync(filePath, 'utf-8');
  const isVue = filePath.endsWith('.uvue') || filePath.endsWith('.vue');

  let code: string;
  let lineOffset = 0;

  if (isVue) {
    const block = extractScriptBlock(rawContent);
    if (!block) return [];
    code = block.code;
    lineOffset = block.lineOffset;
  } else {
    code = rawContent;
  }

  if (!code.trim()) return [];

  const { cleaned, webOnlyLines } = processConditionalCompilation(code);

  // TypeScript AST（纯语法分析，无需 type checker）
  const sourceFile = ts.createSourceFile(
    filePath,
    cleaned,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );

  const violations: Violation[] = [];
  const codeLines = code.split('\n');

  // ─── 第一遍：收集 interface 名称 ─────────────────────────────────────────

  const interfaceNames = new Set<string>();

  function collectInterfaces(node: ts.Node): void {
    if (ts.isInterfaceDeclaration(node)) {
      interfaceNames.add(node.name.text);
    }
    ts.forEachChild(node, collectInterfaces);
  }
  collectInterfaces(sourceFile);

  // ─── 辅助函数 ────────────────────────────────────────────────────────────

  function getPos(node: ts.Node): { line: number; col: number } {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile, false),
    );
    return { line: line + 1, col: character + 1 };
  }

  function getLineText(line1based: number): string {
    return (codeLines[line1based - 1] ?? '').trim();
  }

  function add(
    node: ts.Node,
    rule: string,
    severity: Severity,
    message: string,
    fix?: string,
  ): void {
    const { line, col } = getPos(node);
    if (webOnlyLines.has(line - 1)) return; // 豁免 H5/WEB 块
    violations.push({
      file: filePath,
      line: line + lineOffset,
      column: col,
      rule,
      severity,
      message,
      code: getLineText(line),
      fix,
    });
  }

  // 判断节点是否在 H5/WEB 条件编译块内
  function isWebOnly(node: ts.Node): boolean {
    const { line } = getPos(node);
    return webOnlyLines.has(line - 1);
  }

  // ─── 检测 Promise 回调深度（用于 return 禁止检测）──────────────────────────

  let promiseCallbackDepth = 0;

  function enterPromiseCallback(cb: () => void): void {
    promiseCallbackDepth++;
    cb();
    promiseCallbackDepth--;
  }

  // ─── 第二遍：遍历 AST 检测违规 ───────────────────────────────────────────

  function visit(node: ts.Node): void {
    if (isWebOnly(node)) {
      ts.forEachChild(node, visit);
      return;
    }

    // ═══ 1. any = null — UTS 中 any 是非 null 类型 ════════════════════════

    if (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) {
      const decl = node as ts.VariableDeclaration;
      if (
        decl.type?.kind === ts.SyntaxKind.AnyKeyword &&
        decl.initializer?.kind === ts.SyntaxKind.NullKeyword
      ) {
        add(node, 'TYPE_ANY_NULLABLE', 'HIGH',
          `'any' 类型变量不能赋值 null —— UTS 中 any 是非 null 类型`,
          `改为 'any | null'`);
      }
    }

    // ═══ 2. 展开运算符 [...a, ...b] ═══════════════════════════════════════

    if (ts.isSpreadElement(node)) {
      if (ts.isArrayLiteralExpression(node.parent)) {
        add(node, 'TYPE_SPREAD', 'HIGH',
          `数组展开 [...] 不支持`,
          `改用 a.concat(b)`);
      }
    }

    // ═══ 3. 对象展开 {...a, ...b} ════════════════════════════════════════

    if (ts.isSpreadAssignment(node)) {
      add(node, 'TYPE_SPREAD', 'HIGH',
        `对象展开 {...obj} 不支持`,
        `逐字段赋值或用 Object.keys().forEach()`);
    }

    // ═══ 4. String() 构造函数 ════════════════════════════════════════════

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'String' &&
      node.arguments.length > 0
    ) {
      add(node, 'TYPE_STRING_CTOR', 'MEDIUM',
        `String() 构造函数不支持`,
        "改用模板字面量: `${expr}`");
    }

    // ═══ 5. Object.assign() ══════════════════════════════════════════════

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'Object' &&
      node.expression.name.text === 'assign'
    ) {
      add(node, 'TYPE_OBJECT_ASSIGN', 'HIGH',
        `Object.assign() 不支持`,
        `逐字段赋值`);
    }

    // ═══ 6. 箭头函数默认参数 (x = 0) => ═════════════════════════════════

    if (ts.isArrowFunction(node)) {
      for (const param of node.parameters) {
        if (param.initializer !== undefined) {
          const name = ts.isIdentifier(param.name) ? param.name.text : '?';
          add(param, 'TYPE_ARROW_DEFAULT', 'HIGH',
            `箭头函数默认参数 '${name} = ...' 不支持`,
            `在函数体内用 ?? 处理: const ${name} = param ?? default`);
        }
      }
    }

    // ═══ 7. 解构 rest 展开 { a, ...rest } ═══════════════════════════════

    if (ts.isObjectBindingPattern(node)) {
      for (const el of node.elements) {
        if (el.dotDotDotToken) {
          add(el, 'TYPE_DESTRUCT_SPREAD', 'HIGH',
            `解构 rest 展开 { ...rest } 不支持`,
            `显式列出所有字段`);
        }
      }
    }
    if (ts.isArrayBindingPattern(node)) {
      for (const el of node.elements) {
        if (!ts.isOmittedExpression(el) && el.dotDotDotToken) {
          add(el, 'TYPE_DESTRUCT_SPREAD', 'HIGH',
            `数组解构 rest [...rest] 不支持`,
            `用下标或 slice() 代替`);
        }
      }
    }

    // ═══ 8. Utility Types (Partial, Record, etc.) ════════════════════════

    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      const name = node.typeName.text;
      if (UTILITY_TYPES.has(name)) {
        add(node, 'UTS110111125', 'HIGH',
          `Utility Type '${name}' 不支持`,
          name === 'Record'
            ? `改用 UTSJSONObject 或 Map<K,V>`
            : `手动定义等效 type`);
      }
    }

    // ═══ 9. as unknown ══════════════════════════════════════════════════

    if (ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.UnknownKeyword) {
      add(node, 'TYPE_AS_UNKNOWN', 'HIGH',
        `'as unknown' 不支持`,
        `直接 as TargetType`);
    }

    // ═══ 10. : unknown 类型注解 ══════════════════════════════════════════

    if (node.kind === (ts.SyntaxKind as any).UnknownKeyword) {
      if (node.parent && ts.isTypeNode(node.parent as ts.Node)) {
        add(node, 'UTS110111122', 'HIGH',
          `类型 'unknown' 不支持（仅泛型中可用）`,
          `改为 'any'`);
      }
    }

    // ═══ 11. undefined ══════════════════════════════════════════════════

    if (ts.isIdentifier(node) && node.text === 'undefined') {
      // 排除 typeof x === 'undefined' 写法
      const parent = node.parent;
      if (!parent || !ts.isTypeOfExpression(parent)) {
        add(node, 'UTS110111119', 'MEDIUM',
          `'undefined' 不支持，用 null`,
          `替换为 null`);
      }
    }

    // ═══ 12. delete 运算符 ═══════════════════════════════════════════════

    if (node.kind === ts.SyntaxKind.DeleteExpression) {
      add(node, 'UTS110111149', 'HIGH',
        `'delete' 运算符不支持`,
        `改为将属性设为 null`);
    }

    // ═══ 13. interface 用于对象字面量 ═══════════════════════════════════

    // 13a. const x: InterfaceName = { ... }
    if (ts.isVariableDeclaration(node)) {
      if (
        node.type &&
        ts.isTypeReferenceNode(node.type) &&
        ts.isIdentifier(node.type.typeName) &&
        interfaceNames.has(node.type.typeName.text) &&
        node.initializer &&
        ts.isObjectLiteralExpression(node.initializer)
      ) {
        const name = (node.type.typeName as ts.Identifier).text;
        add(node.type, 'UTS110111163', 'HIGH',
          `interface '${name}' 用于对象字面量赋值，应改为 type`,
          `将 'interface ${name}' 改为 'type ${name} = { ... }'`);
      }
    }

    // 13b. reactive<InterfaceName>({}) / ref<InterfaceName>(...)
    if (ts.isCallExpression(node) && node.typeArguments) {
      const fnName = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.name)
          ? node.expression.name.text
          : '';
      if (REACTIVE_FNS.has(fnName)) {
        for (const typeArg of node.typeArguments) {
          if (
            ts.isTypeReferenceNode(typeArg) &&
            ts.isIdentifier(typeArg.typeName) &&
            interfaceNames.has(typeArg.typeName.text)
          ) {
            const tName = (typeArg.typeName as ts.Identifier).text;
            add(typeArg, 'UTS110111163', 'HIGH',
              `interface '${tName}' 用于 ${fnName}<> 泛型，应改为 type`,
              `将 'interface ${tName}' 改为 'type ${tName} = { ... }'`);
          }
        }
      }
    }

    // ═══ 14. if/while 条件中的可选链 (obj?.prop) ════════════════════════

    if (ts.isIfStatement(node) || ts.isWhileStatement(node)) {
      checkNonBooleanCondition(node.expression);
    }

    // ═══ 15. 非布尔返回值在 watch() getter ══════════════════════════════

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'watch' &&
      node.arguments.length >= 1
    ) {
      const getter = node.arguments[0];
      if (
        (ts.isArrowFunction(getter) || ts.isFunctionExpression(getter)) &&
        !ts.isBlock((getter as ts.ArrowFunction).body)
      ) {
        // 简箭头函数: watch(() => someVar, ...)
        const body = (getter as ts.ArrowFunction).body as ts.Expression;
        // 如果 getter 返回属性访问（不是比较/布尔运算），可能违规
        if (
          ts.isPropertyAccessExpression(body) &&
          !ts.isBinaryExpression(body)
        ) {
          add(getter, 'TYPE_WATCH_GETTER_BOOL', 'HIGH',
            `watch getter 直接返回属性值，若属性非 boolean 则类型不匹配`,
            `改为 () => someVar === true 或用 computed`);
        }
      }
    }

    // ═══ 16. new Promise 内的 return ═════════════════════════════════════

    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Promise' &&
      node.arguments?.length
    ) {
      const executor = node.arguments[0];
      if (ts.isArrowFunction(executor) || ts.isFunctionExpression(executor)) {
        enterPromiseCallback(() => {
          ts.forEachChild(executor.body, visitForPromiseReturn);
        });
        // 已经处理过 executor 子节点，跳过默认的 forEachChild
        // 但其他参数还是要继续 visit
        return;
      }
    }

    // ═══ 17. ref 可选链调用 ref?.method() ════════════════════════════════

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression as any).questionDotToken !== undefined
    ) {
      // ref?.open() 等
      const obj = node.expression.expression;
      if (ts.isIdentifier(obj) && obj.text.endsWith('Ref')) {
        add(node, 'TYPE_REF_OPTIONAL', 'HIGH',
          `ref 可选链调用 '${obj.text}?.method()' 不支持`,
          `用 if (${obj.text}.value != null) { ${obj.text}.value.method() }`);
      }
    }

    // ═══ 18. 三元条件中的 truthy string（有限检测） ════════════════════════

    if (ts.isConditionalExpression(node)) {
      checkNonBooleanCondition(node.condition);
    }

    ts.forEachChild(node, visit);
  }

  /** 检测可选链在条件位置 */
  function checkNonBooleanCondition(expr: ts.Expression): void {
    if (isWebOnly(expr)) return;

    // obj?.prop 或 obj?.method() — 返回 T | undefined，非 boolean
    const hasOptional =
      ts.isPropertyAccessExpression(expr) && (expr as any).questionDotToken
      || (ts.isCallExpression(expr) &&
          ts.isPropertyAccessExpression(expr.expression) &&
          (expr.expression as any).questionDotToken);

    if (hasOptional) {
      add(expr, 'UTS110111120', 'HIGH',
        `条件中的可选链表达式返回 T | undefined 而非 boolean`,
        `改为显式判断: expr != null`);
    }

    // || 作为回退（赋值中的 falsy fallback）
    if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      // a || b 在条件位置通常 ok，但赋值中可能是违规（见 visit 中赋值回退检测）
    }
  }

  /** 在 Promise executor 内检测 return 语句 */
  function visitForPromiseReturn(node: ts.Node): void {
    if (ts.isReturnStatement(node)) {
      add(node, 'TYPE_PROMISE_RETURN', 'HIGH',
        `Promise executor 内的 return 语句在 UTS Kotlin 编译下被禁止`,
        `用 if/else 替代 return 做早退出`);
    }
    // 不深入嵌套函数，只看当前层
    if (
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isFunctionDeclaration(node)
    ) {
      return;
    }
    ts.forEachChild(node, visitForPromiseReturn);
  }

  visit(sourceFile);
  return violations;
}

// ─── 目录扫描 ─────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', '.git', 'unpackage', 'dist', '.claude', 'uni_modules']);

function collectFiles(dir: string, exts: string[]): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      results.push(...collectFiles(full, exts));
    } else if (entry.isFile() && exts.some(e => entry.name.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

// ─── 主程序 ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const targetArg = args.find(a => !a.startsWith('--'));
const root = path.resolve(targetArg ?? process.cwd());

const files = collectFiles(root, ['.uts', '.uvue']);
process.stderr.write(`Scanning ${files.length} files in ${root}...\n`);

const allViolations: Violation[] = [];
for (const f of files) {
  try {
    allViolations.push(...scanFile(f));
  } catch (err) {
    process.stderr.write(`  ERROR: ${f}: ${err}\n`);
  }
}

if (jsonMode) {
  console.log(JSON.stringify(allViolations, null, 2));
  process.exit(allViolations.length > 0 ? 1 : 0);
}

// ─── 人类可读输出 ─────────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<Severity, string> = {
  HIGH: '\x1b[31m',    // red
  MEDIUM: '\x1b[33m',  // yellow
  LOW: '\x1b[36m',     // cyan
};
const RESET = '\x1b[0m';

// 按文件分组
const byFile = new Map<string, Violation[]>();
for (const v of allViolations) {
  (byFile.get(v.file) ?? (byFile.set(v.file, []), byFile.get(v.file)!)).push(v);
}

// 按 rule 统计
const byRule = new Map<string, number>();
for (const v of allViolations) byRule.set(v.rule, (byRule.get(v.rule) ?? 0) + 1);

// 输出详情
for (const [file, vs] of byFile) {
  const rel = path.relative(root, file);
  console.log(`\n\x1b[1m${rel}\x1b[0m (${vs.length})`);
  for (const v of vs) {
    const col = SEVERITY_COLORS[v.severity];
    console.log(`  ${col}[${v.rule}]\x1b[0m L${v.line}:${v.column}  ${v.message}`);
    console.log(`    \x1b[2m${v.code}\x1b[0m`);
    if (v.fix) console.log(`    \x1b[32m→ ${v.fix}\x1b[0m`);
  }
}

// 汇总
console.log('\n─────────────────────────────────────────');
console.log(`总计 ${allViolations.length} 条违规，涉及 ${byFile.size} 个文件\n`);
console.log('按规则统计:');
for (const [rule, cnt] of [...byRule.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cnt.toString().padStart(4)}  ${rule}`);
}
