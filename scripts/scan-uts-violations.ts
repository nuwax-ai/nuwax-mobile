#!/usr/bin/env tsx
/**
 * UTS 违规项扫描脚本
 *
 * 检测 uni-app-x 项目中的 UTS 兼容性问题：
 * - UTS110111120: 非布尔表达式在条件位置
 * - UTS110111101: 行内对象字面量类型
 * - UTS110111163: interface 用作对象字面量类型
 */

import * as fs from 'fs';
import * as path from 'path';

interface Violation {
  file: string;
  line: number;
  column: number;
  type: 'UTS110111120' | 'UTS110111101' | 'UTS110111163';
  code: string;
  message: string;
  fix?: string;
}

interface ScanResult {
  total: number;
  violations: Violation[];
  byType: Record<string, number>;
  byFile: Record<string, number>;
}

function getBraceDelta(line: string): number {
  // 粗略去除字符串字面量，避免统计到字符串中的花括号
  const noStringLine = line
    .replace(/'[^'\\]*(?:\\.[^'\\]*)*'/g, '')
    .replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, '')
    .replace(/`[^`\\]*(?:\\.[^`\\]*)*`/g, '');
  const openCount = (noStringLine.match(/{/g) || []).length;
  const closeCount = (noStringLine.match(/}/g) || []).length;
  return openCount - closeCount;
}

/**
 * 检测单个文件的违规项
 */
function scanFile(filePath: string): Violation[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const violations: Violation[] = [];
  const isVue = filePath.endsWith('.uvue');
  let inTypeDeclaration = false;
  let typeBraceDepth = 0;

  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const trimmedLine = line.trim();
    const braceDelta = getBraceDelta(line);
    const isTypeDeclarationStart =
      /^\s*(export\s+)?interface\s+\w+/.test(trimmedLine) ||
      /^\s*(export\s+)?type\s+\w+\s*=\s*\{/.test(trimmedLine);

    // 跳过注释行
    if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*') || trimmedLine.startsWith('/*')) {
      if (isTypeDeclarationStart) {
        inTypeDeclaration = true;
        typeBraceDepth = braceDelta;
      } else if (inTypeDeclaration) {
        typeBraceDepth += braceDelta;
        if (typeBraceDepth <= 0) {
          inTypeDeclaration = false;
          typeBraceDepth = 0;
        }
      }
      return;
    }

    // 跳过空行
    if (trimmedLine.length === 0) {
      return;
    }

    // ===== UTS110111120: 非布尔表达式在条件位置 =====

    // Template: v-if/v-show/:class 中的 ?.length
    if (isVue) {
      const templateCondMatch = line.match(/v-(if|show|else-if)="([^"]*?)\?\.length/);
      if (templateCondMatch) {
        const varName = extractVarName(line, templateCondMatch.index!);
        violations.push({
          file: filePath,
          line: lineNum,
          column: templateCondMatch.index! + 1,
          type: 'UTS110111120',
          code: line.trim(),
          message: `Non-boolean in v-${templateCondMatch[1]}: ${varName}?.length`,
          fix: `Use hasLen(${varName}) or ${varName} != null && ${varName}.length > 0`
        });
      }

      // Template: v-if 中的 ?.includes()（排除已有 null 检查的）
      const includesMatch = line.match(/v-(if|show|else-if)="([^"]*?)\?\.[\w\.]+\.includes\(/);
      if (includesMatch && !line.includes('!= null')) {
        violations.push({
          file: filePath,
          line: lineNum,
          column: includesMatch.index! + 1,
          type: 'UTS110111120',
          code: line.trim(),
          message: 'Non-boolean in v-if: optional chaining with includes()',
          fix: 'Check null before calling includes()'
        });
      }

      // Template: v-if 中的直接变量引用（如 v-if="item?.icon"）
      const directRefMatch = line.match(/v-(if|show|else-if)="([^"]*?)\b(\w+)\?\.(\w+)(?!\s*[\|\&])[^"]*"/);
      if (directRefMatch) {
        const fullMatch = directRefMatch[0];
        // 确保不是已经有其他布尔运算符
        if (!fullMatch.includes('==') && !fullMatch.includes('!=') && !fullMatch.includes('>')) {
          violations.push({
            file: filePath,
            line: lineNum,
            column: directRefMatch.index! + 1,
            type: 'UTS110111120',
            code: line.trim(),
            message: `Non-boolean in v-${directRefMatch[1]}: ${directRefMatch[3]}?.${directRefMatch[4]}`,
            fix: `Check ${directRefMatch[3]}.${directRefMatch[4]} != null && hasLen(...)`
          });
        }
      }
    }

    // Script: if/while 中的 ?.length
    const scriptLengthMatch = line.match(/\b(if|while)\s*\(([^)]*?)\?\.length/);
    if (scriptLengthMatch) {
      const varName = extractVarName(line, scriptLengthMatch.index!);
      violations.push({
        file: filePath,
        line: lineNum,
        column: scriptLengthMatch.index! + 1,
        type: 'UTS110111120',
        code: line.trim(),
        message: `Non-boolean in ${scriptLengthMatch[1]}: ${varName}?.length`,
        fix: `Use hasLen(${varName}) or ${varName} != null && ${varName}.length > 0`
      });
    }

    // Script: !variable 取反（可能违规）
    const negationMatch = line.match(/\b(if|while)\s*\(\s*!\s*([a-zA-Z_]\w*)\s*\)/);
    if (negationMatch) {
      // 跳过已知的布尔变量名（is/has/enabled 开头的通常是 boolean）
      const knownBooleanPrefixes = ['is', 'has', 'Has', 'enabled', 'disabled', 'visible', 'hidden'];
      const varName = negationMatch[2];
      const isBooleanPrefix = knownBooleanPrefixes.some(prefix => varName.startsWith(prefix));

      if (!isBooleanPrefix) {
        violations.push({
          file: filePath,
          line: lineNum,
          column: negationMatch.index! + 1,
          type: 'UTS110111120',
          code: line.trim(),
          message: `Possible non-boolean negation: !${varName}`,
          fix: `Verify ${varName} type, use !hasLen() or == null`
        });
      }
    }

    // Script: 非布尔回退（a || b）常见于 JS 写法，在 UTS/APP 端高风险
    const hasFallbackOr = line.includes('||');
    const isControlLine = /\b(if|while|for)\s*\(/.test(line);
    const looksLikeBooleanExpr = /===|!==|>=|<=|>\s*0|<\s*0|&&/.test(line);
    if (hasFallbackOr && !isControlLine && !looksLikeBooleanExpr) {
      const assignFallbackMatch = line.match(/=\s*[^;]*\|\|\s*(\[\]|\{\}|null|undefined|""|''|0)/);
      const returnFallbackMatch = line.match(/return\s+[^;]*\|\|\s*(\[\]|\{\}|null|undefined|""|''|0)/);
      if (assignFallbackMatch || returnFallbackMatch) {
        violations.push({
          file: filePath,
          line: lineNum,
          column: (assignFallbackMatch?.index ?? returnFallbackMatch?.index ?? 0) + 1,
          type: 'UTS110111120',
          code: line.trim(),
          message: 'Non-boolean fallback with || may fail in UTS APP compile',
          fix: 'Replace with explicit null check, e.g. x != null ? x : fallback'
        });
      }
    }

    // ===== UTS110111101: 行内对象字面量类型 =====

    // interface/type 内的属性行内对象类型（如: categoryItems: {）
    const inlinePropObjectTypeMatch = line.match(/^\s*[a-zA-Z_]\w*\??\s*:\s*\{\s*$/);
    if (inlinePropObjectTypeMatch && inTypeDeclaration) {
      violations.push({
        file: filePath,
        line: lineNum,
        column: inlinePropObjectTypeMatch.index! + 1,
        type: 'UTS110111101',
        code: line.trim(),
        message: 'Inline object literal type in interface/type property',
        fix: 'Extract to named type or Record<...>, then reference it by name'
      });
    }

    // 函数参数中的行内对象类型
    const paramMatch = line.match(/(?:function|fn|async\s+function)?\s*\w+\s*\([^)]*:\s*{/);
    if (paramMatch && !line.includes('//')) { // 排除注释
      violations.push({
        file: filePath,
        line: lineNum,
        column: paramMatch.index! + 1,
        type: 'UTS110111101',
        code: line.trim(),
        message: 'Inline object literal type in function parameter',
        fix: 'Extract to named type: type MyParam = { ... };'
      });
    }

    // 回调参数中的行内对象类型（onLoad）
    const onLoadMatch = line.match(/onLoad\s*\(\s*(?:async\s+)?\([^)]*:\s*{/);
    if (onLoadMatch) {
      violations.push({
        file: filePath,
        line: lineNum,
        column: onLoadMatch.index! + 1,
        type: 'UTS110111101',
        code: line.trim(),
        message: 'Inline object literal type in onLoad callback',
        fix: 'Extract to: type OnLoadOptions = { ... }; onLoad((options: OnLoadOptions) => {})'
      });
    }

    // 泛型中的行内对象类型（ref<>、Promise<> 等）
    const genericMatch = line.match(/(?:ref|Promise|Record)<\s*{/);
    if (genericMatch && !line.includes('=>')) { // 排除箭头函数返回类型
      violations.push({
        file: filePath,
        line: lineNum,
        column: genericMatch.index! + 1,
        type: 'UTS110111101',
        code: line.trim(),
        message: 'Inline object literal type in generic parameter',
        fix: 'Extract to named type or use type alias'
      });
    }

    // 类型断言中的行内对象
    const asMatch = line.match(/\s+as\s+\{/);
    if (asMatch && !line.trim().startsWith('//')) {
      violations.push({
        file: filePath,
        line: lineNum,
        column: asMatch.index! + 1,
        type: 'UTS110111101',
        code: line.trim(),
        message: 'Inline object literal type in type assertion',
        fix: 'Extract to named type'
      });
    }

    // 索引签名的行内声明（排除已定义的 type 和 interface）
    const indexSigMatch = line.match(/\{[^}]*\[\s*key\s*:\s*string[^\}]*\}/);
    if (indexSigMatch) {
      const trimmedLine = line.trim();
      // 排除 type 定义和 interface 定义
      if (!trimmedLine.startsWith('type ') && !trimmedLine.startsWith('interface ') &&
          !trimmedLine.startsWith('export interface ') && !trimmedLine.startsWith('export type ')) {
        violations.push({
          file: filePath,
          line: lineNum,
          column: indexSigMatch.index! + 1,
          type: 'UTS110111101',
          code: line.trim(),
          message: 'Inline index signature type',
          fix: 'Extract to: type MyMap = { [key: string]: ... };'
        });
      }
    }

    if (isTypeDeclarationStart) {
      inTypeDeclaration = true;
      typeBraceDepth = braceDelta;
    } else if (inTypeDeclaration) {
      typeBraceDepth += braceDelta;
      if (typeBraceDepth <= 0) {
        inTypeDeclaration = false;
        typeBraceDepth = 0;
      }
    }
  });

  return violations;
}

/**
 * 从代码中提取变量名（简化版）
 */
function extractVarName(line: string, matchIndex: number): string {
  const before = line.substring(0, matchIndex);
  const match = before.match(/(\w+)\?\.?$/);
  return match ? match[1] : 'unknown';
}

/**
 * 递归遍历目录扫描所有文件
 */
function scanProject(dir: string, skipDirs: string[] = ['node_modules', 'dist', '.git', 'unpackage', 'uni_modules']): Violation[] {
  const violations: Violation[] = [];

  function walk(currentPath: string) {
    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          if (!skipDirs.includes(entry.name)) {
            walk(fullPath);
          }
        } else if (entry.isFile() && (entry.name.endsWith('.uvue') || entry.name.endsWith('.uts') || entry.name.endsWith('.vue'))) {
          violations.push(...scanFile(fullPath));
        }
      }
    } catch (error) {
      // 跳过无法访问的目录
    }
  }

  walk(dir);
  return violations;
}

/**
 * 生成统计信息
 */
function generateStats(violations: Violation[]): ScanResult {
  const byType: Record<string, number> = {};
  const byFile: Record<string, number> = {};

  violations.forEach(v => {
    byType[v.type] = (byType[v.type] || 0) + 1;
    byFile[v.file] = (byFile[v.file] || 0) + 1;
  });

  return {
    total: violations.length,
    violations,
    byType,
    byFile
  };
}

/**
 * 输出 Markdown 报告
 */
function outputMarkdown(result: ScanResult, outputPath: string): void {
  const md = `# UTS 违规项扫描报告

生成时间：${new Date().toLocaleString('zh-CN')}

## 概览

- **总违规数**: ${result.total}
- **涉及文件**: ${Object.keys(result.byFile).length}

## 按类型统计

${Object.entries(result.byType)
  .map(([type, count]) => `- **${type}**: ${count} 处`)
  .join('\n')}

## 按文件统计

${Object.entries(result.byFile)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .map(([file, count]) => `- \`${file}\`: ${count} 处`)
  .join('\n')}

## 详细违规列表

${result.violations.map(v => `
### ${v.file}:${v.line}

**类型**: ${v.type}
**位置**: 第 ${v.line} 行，第 ${v.column} 列

\`\`\`
${v.code}
\`\`\`

**说明**: ${v.message}
${v.fix ? `**修复建议**: ${v.fix}` : ''}
---
`).join('\n')}

---

## 修复优先级

1. **高优先级** (UTS110111120): 导致编译错误，必须修复
2. **中优先级** (UTS110111101): 类型定义问题，建议修复
3. **低优先级** (UTS110111163): interface 使用问题，可逐步优化
`;

  fs.writeFileSync(outputPath, md, 'utf-8');
  console.log(`Markdown 报告已生成: ${outputPath}`);
}

/**
 * 输出 JSON 报告
 */
function outputJSON(result: ScanResult, outputPath: string): void {
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`JSON 报告已生成: ${outputPath}`);
}

/**
 * 主函数
 */
function main() {
  const args = process.argv.slice(2);
  const includeUniModules = args.includes('--include-uni-modules');
  const projectArg = args.find(arg => !arg.startsWith('-'));
  const projectRoot = path.resolve(projectArg || '.');
  const skipDirs = includeUniModules
    ? ['node_modules', 'dist', '.git', 'unpackage']
    : ['node_modules', 'dist', '.git', 'unpackage', 'uni_modules'];
  console.log(`开始扫描项目: ${projectRoot}`);
  console.log(`扫描模式: ${includeUniModules ? '含 uni_modules' : '默认(跳过 uni_modules)'}`);

  const violations = scanProject(projectRoot, skipDirs);
  console.log(`扫描完成，发现 ${violations.length} 个违规项`);

  const result = generateStats(violations);

  // 输出报告
  const jsonPath = path.join(projectRoot, 'uts-violations.json');
  const mdPath = path.join(projectRoot, 'uts-violations.md');

  outputJSON(result, jsonPath);
  outputMarkdown(result, mdPath);

  console.log(`\n统计信息:`);
  console.log(`- 总违规数: ${result.total}`);
  console.log(`- 涉及文件: ${Object.keys(result.byFile).length}`);
  console.log(`- 按类型:`);
  Object.entries(result.byType).forEach(([type, count]) => {
    console.log(`  - ${type}: ${count}`);
  });

  if (result.total > 0) {
    process.exit(1); // 发现违规，返回非 0 退出码
  }
}

// 运行主函数
main();
