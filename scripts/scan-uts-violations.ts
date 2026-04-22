#!/usr/bin/env tsx
/**
 * UTS 违规项扫描脚本 (v4)
 *
 * 检测 uni-app-x 项目中的 UTS 兼容性问题，覆盖 30+ 种违规模式。
 *
 * 用法:
 *   npx tsx scripts/scan-uts-violations.ts                    # 仅扫描
 *   npx tsx scripts/scan-uts-violations.ts --dry-run          # 预览自动修复
 *   npx tsx scripts/scan-uts-violations.ts --fix              # 执行自动修复
 *   npx tsx scripts/scan-uts-violations.ts --include-uni-modules  # 含 uni_modules
 *
 * 检测规则:
 *   高频: interface→type, 非布尔条件, 行内对象类型, 嵌套对象, 声明提升,
 *         as unknown as, 箭头默认参数, 展开运算符, 解构rest展开, Object.assign,
 *         ref可选链, any属性访问, ref<any>方法调用, watch getter, nullable布尔||,
 *         unknown类型, 箭头函数泛型参数
 *   中频: String()构造, valOr nullable, enum-string比较, undefined,
 *         Utility Types, npm import, 下标访问Any?, getStorageSync类型不匹配
 *   低频: as const, 确定赋值, delete, index signature, throw非Error
 *
 * 自动修复 (--fix):
 *   undefined→null, as unknown as→as, as const→移除,
 *   nullable||→==true||, watch getter→computed包装
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------- 类型定义 ----------

type ViolationType =
  | 'UTS110111120'  // 非布尔条件
  | 'UTS110111101'  // 行内对象类型
  | 'UTS110111163'  // interface 对象字面量
  | 'UTS110111162'  // type 嵌套对象字面量
  | 'UTS110111150'  // 声明提升
  | 'UTS110111119'  // undefined
  | 'UTS110111125'  // Utility Types
  | 'UTS110111126'  // as const
  | 'UTS110111127'  // 确定赋值断言
  | 'UTS110111149'  // delete
  | 'UTS110111144'  // index signature
  | 'UTS110111158'  // throw non-Error
  | 'TYPE_AS_UNKNOWN'       // as unknown as
  | 'TYPE_ARROW_DEFAULT'    // 箭头函数默认参数
  | 'TYPE_STRING_CTOR'      // String() 构造
  | 'TYPE_SPREAD'           // 展开运算符
  | 'TYPE_VALOR_NULLABLE'   // valOr nullable
  | 'TYPE_ENUM_STRING_CMP'  // enum === string
  | 'TYPE_OBJECT_ASSIGN'    // Object.assign
  | 'TYPE_REF_OPTIONAL'     // ref 可选链
  | 'TYPE_NPM_IMPORT'       // 非 UTS 兼容 npm import
  | 'TYPE_ANY_PROP_ACCESS'  // any 类型属性/下标访问
  | 'TYPE_BOOLEAN_NULLABLE_OR' // nullable 布尔值 || 在模板中
  | 'TYPE_WATCH_GETTER_BOOL'   // watch(() => props.bool) 返回类型不匹配
  | 'TYPE_MAP_INDEX_TYPED'     // 对象下标访问返回 Any? 传给类型参数
  | 'TYPE_REF_ANY_METHOD'      // ref<any> 上调用方法
  | 'TYPE_CURLY_QUOTE'         // 弯引号/全角引号代替ASCII引号（SFC解析器致命错误）
  | 'UTS110111122'             // unknown 类型
  | 'TYPE_GENERIC_ARROW'       // 箭头函数泛型参数（不支持）
  | 'TYPE_DESTRUCT_SPREAD'     // 解构 rest 展开运算符

interface Violation {
  file: string;
  line: number;
  column: number;
  type: ViolationType;
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

// ---------- 工具函数 ----------

/** 粗略去除字符串字面量中的花括号 */
function getBraceDelta(line: string): number {
  const noStringLine = line
    .replace(/'[^'\\]*(?:\\.[^'\\]*)*'/g, '')
    .replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, '')
    .replace(/`[^`\\]*(?:\\.[^`\\]*)*`/g, '');
  const openCount = (noStringLine.match(/{/g) || []).length;
  const closeCount = (noStringLine.match(/}/g) || []).length;
  return openCount - closeCount;
}

/** 从代码中提取变量名（简化版） */
function extractVarName(line: string, matchIndex: number): string {
  const before = line.substring(0, matchIndex);
  const match = before.match(/(\w+)\?\.?$/);
  return match ? match[1] : 'unknown';
}

/** 是否在条件编译块内 (#ifdef) */
function isInConditionalBlock(lines: string[], lineIndex: number): boolean {
  for (let i = lineIndex; i >= Math.max(0, lineIndex - 20); i--) {
    const t = lines[i].trim();
    if (t.match(/^\/\/\s*#ifdef\s+(WEB|H5)/)) return true;
    if (t.match(/^\/\/\s*#endif/)) return false;
  }
  return false;
}

/** 检查行是否是注释 */
function isComment(trimmedLine: string): boolean {
  return trimmedLine.startsWith('//') || trimmedLine.startsWith('*') || trimmedLine.startsWith('/*');
}

// ---------- 已知 UTS 兼容的 npm 包 ----------
const UTS_COMPAT_PACKAGES = new Set([
  'vue', '@vue/', 'pinia', '@dcloudio/', '@/',
]);

/** 判断是否为非 UTS 兼容的 npm 包 import */
function isNpmPackageImport(importPath: string): boolean {
  if (importPath.startsWith('.') || importPath.startsWith('/') || importPath.startsWith('@/')) return false;
  if (importPath.startsWith('@dcloudio/')) return false;
  const compatPrefixes = ['vue', '@vue/'];
  if (compatPrefixes.some(p => importPath.startsWith(p))) return false;
  return importPath.includes('/') || /^[a-z@]/.test(importPath);
}

/** 查找当前行所在函数的 any 类型参数名 */
function findAnyParamInScope(lines: string[], currentIndex: number): string | null {
  // 向上搜索函数签名中的 any 参数
  for (let i = currentIndex; i >= Math.max(0, currentIndex - 30); i--) {
    const line = lines[i].trim();
    // 匹配 (paramName: any) => 或 function fn(paramName: any)
    const match = line.match(/\(\s*(\w+)\s*:\s*any\s*\)/);
    if (match) {
      // 确认这不是 type 定义中的
      if (!line.startsWith('type ') && !line.startsWith('interface ')) {
        return match[1];
      }
    }
    // 到达函数/块边界则停止
    if (i < currentIndex && line.match(/^(const|let|function|export)\s/)) break;
  }
  return null;
}

// ---------- 检测函数 ----------

/**
 * 检测单个文件的违规项
 */
function scanFile(filePath: string): Violation[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const violations: Violation[] = [];
  const isVue = filePath.endsWith('.uvue') || filePath.endsWith('.vue');

  // 状态追踪：interface 名称收集
  const interfaceNames = new Set<string>();
  // 状态追踪：函数/变量定义位置（只在 script 区域内）
  const definitions = new Map<string, number>();
  let inTypeDeclaration = false;
  let typeBraceDepth = 0;
  let inInterfaceBlock = false;
  let interfaceBraceDepth = 0;

  // 确定每个文件 template/script/style 的行范围
  let scriptStartLine = -1;
  let scriptEndLine = lines.length;
  if (isVue) {
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*<script/.test(lines[i])) { scriptStartLine = i; }
      if (/^\s*<\/script>/.test(lines[i])) { scriptEndLine = i; break; }
    }
  } else {
    scriptStartLine = 0; // .uts 文件整个都是 script
  }

  // 第一遍：收集 interface 名称和函数/变量定义位置（仅 script 区域内）
  lines.forEach((line, index) => {
    if (isVue && (index < scriptStartLine || index > scriptEndLine)) return;
    const trimmed = line.trim();
    if (isComment(trimmed)) return;

    // 收集 interface 名称
    const ifaceMatch = trimmed.match(/^(?:export\s+)?interface\s+(\w+)/);
    if (ifaceMatch) interfaceNames.add(ifaceMatch[1]);

    // 收集函数定义
    const funcMatch = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
    if (funcMatch) definitions.set(funcMatch[1], index);

    // 收集 const/let 变量定义（包括箭头函数）
    const varMatch = trimmed.match(/^(?:export\s+)?(?:const|let)\s+(\w+)/);
    if (varMatch) definitions.set(varMatch[1], index);
  });

  // 第二遍：逐行检测违规
  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const trimmedLine = line.trim();
    const braceDelta = getBraceDelta(line);

    // 跳过注释行（但仍然更新状态）
    if (isComment(trimmedLine)) {
      const isTypeDeclStart =
        /^\s*(export\s+)?interface\s+\w+/.test(trimmedLine) ||
        /^\s*(export\s+)?type\s+\w+\s*=\s*\{/.test(trimmedLine);
      if (isTypeDeclStart) {
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
    if (trimmedLine.length === 0) return;

    // 跳过条件编译块内的 WEB/H5 专用代码
    const inWebBlock = isInConditionalBlock(lines, index);

    // 追踪 interface 块
    const isIfaceStart = /^\s*(export\s+)?interface\s+\w+/.test(trimmedLine);
    if (isIfaceStart) {
      inInterfaceBlock = true;
      interfaceBraceDepth = braceDelta;
    } else if (inInterfaceBlock) {
      interfaceBraceDepth += braceDelta;
      if (interfaceBraceDepth <= 0) {
        inInterfaceBlock = false;
        interfaceBraceDepth = 0;
      }
    }

    // 追踪 type 声明块
    const isTypeDeclStart =
      /^\s*(export\s+)?type\s+\w+\s*=\s*\{/.test(trimmedLine) ||
      isIfaceStart;
    if (isTypeDeclStart) {
      inTypeDeclaration = true;
      typeBraceDepth = braceDelta;
    } else if (inTypeDeclaration) {
      typeBraceDepth += braceDelta;
      if (typeBraceDepth <= 0) {
        inTypeDeclaration = false;
        typeBraceDepth = 0;
      }
    }

    // ===== 1. UTS110111163: interface 被对象字面量赋值 =====
    if (!inWebBlock) {
      for (const ifaceName of interfaceNames) {
        // const x: InterfaceName = { ... }
        const ifaceAssignRegex = new RegExp(
          `\\b(?:const|let|var)\\s+\\w+\\s*:\\s*${ifaceName}\\s*=\\s*\\{`
        );
        if (ifaceAssignRegex.test(trimmedLine)) {
          violations.push({
            file: filePath, line: lineNum, column: 1,
            type: 'UTS110111163',
            code: trimmedLine,
            message: `Interface '${ifaceName}' used as object literal type`,
            fix: `Change 'interface ${ifaceName}' to 'type ${ifaceName}'`
          });
          break;
        }
        // ... as InterfaceName (object literal cast)
        const asIfaceRegex = new RegExp(`\\}\\s*as\\s+${ifaceName}\\b`);
        if (asIfaceRegex.test(trimmedLine)) {
          violations.push({
            file: filePath, line: lineNum, column: 1,
            type: 'UTS110111163',
            code: trimmedLine,
            message: `Object literal cast to interface '${ifaceName}'`,
            fix: `Change 'interface ${ifaceName}' to 'type ${ifaceName}'`
          });
          break;
        }
      }
    }

    // ===== 2. UTS110111120: 非布尔表达式在条件位置 =====

    if (!inWebBlock) {
      // Vue template: v-if/v-show 中的 ?.length
      if (isVue) {
        const templateCondMatch = line.match(/v-(if|show|else-if)="([^"]*?)\?\.length/);
        if (templateCondMatch) {
          const varName = extractVarName(line, templateCondMatch.index!);
          violations.push({
            file: filePath, line: lineNum, column: templateCondMatch.index! + 1,
            type: 'UTS110111120',
            code: trimmedLine,
            message: `Non-boolean in v-${templateCondMatch[1]}: ${varName}?.length`,
            fix: `Use hasLen(${varName}) or ${varName} != null && ${varName}.length > 0`
          });
        }

        const includesMatch = line.match(/v-(if|show|else-if)="([^"]*?)\?\.[\w\.]+\.includes\(/);
        if (includesMatch && !line.includes('!= null')) {
          violations.push({
            file: filePath, line: lineNum, column: includesMatch.index! + 1,
            type: 'UTS110111120',
            code: trimmedLine,
            message: 'Non-boolean in v-if: optional chaining with includes()',
            fix: 'Check null before calling includes()'
          });
        }

        const directRefMatch = line.match(/v-(if|show|else-if)="([^"]*?)\b(\w+)\?\.(\w+)(?!\s*[\|\&])[^"]*"/);
        if (directRefMatch) {
          const fullMatch = directRefMatch[0];
          if (!fullMatch.includes('==') && !fullMatch.includes('!=') && !fullMatch.includes('>')) {
            violations.push({
              file: filePath, line: lineNum, column: directRefMatch.index! + 1,
              type: 'UTS110111120',
              code: trimmedLine,
              message: `Non-boolean in v-${directRefMatch[1]}: ${directRefMatch[3]}?.${directRefMatch[4]}`,
              fix: `Check ${directRefMatch[3]}.${directRefMatch[4]} != null`
            });
          }
        }
      }

      // Script: if/while 中的 ?.length
      const scriptLengthMatch = line.match(/\b(if|while)\s*\(([^)]*?)\?\.length/);
      if (scriptLengthMatch) {
        const varName = extractVarName(line, scriptLengthMatch.index!);
        violations.push({
          file: filePath, line: lineNum, column: scriptLengthMatch.index! + 1,
          type: 'UTS110111120',
          code: trimmedLine,
          message: `Non-boolean in ${scriptLengthMatch[1]}: ${varName}?.length`,
          fix: `Use ${varName} != null && ${varName}.length > 0`
        });
      }

      // Script: !variable 取反（可能违规）
      const negationMatch = line.match(/\b(if|while)\s*\(\s*!\s*([a-zA-Z_]\w*(?:\.\w+)*)\s*\)/);
      if (negationMatch) {
        const knownBooleanPrefixes = ['is', 'has', 'Has', 'enabled', 'disabled', 'visible', 'hidden', 'loading'];
        const varName = negationMatch[2];
        const isBooleanPrefix = knownBooleanPrefixes.some(prefix => {
          const parts = varName.split('.');
          return parts.some(p => p.startsWith(prefix));
        });
        if (!isBooleanPrefix) {
          violations.push({
            file: filePath, line: lineNum, column: negationMatch.index! + 1,
            type: 'UTS110111120',
            code: trimmedLine,
            message: `Possible non-boolean negation: !${varName}`,
            fix: `Use ${varName} == null or ${varName} != true`
          });
        }
      }

      // Script: !ref.value 取反
      const refNegMatch = line.match(/!\s*([a-zA-Z_]\w*)\.value\b/);
      if (refNegMatch && !line.includes('==') && !line.includes('!=')) {
        violations.push({
          file: filePath, line: lineNum, column: refNegMatch.index! + 1,
          type: 'UTS110111120',
          code: trimmedLine,
          message: `Nullable ref negation: !${refNegMatch[1]}.value`,
          fix: `Use ${refNegMatch[1]}.value == null`
        });
      }

      // Script: 非布尔回退（a || b）
      const hasFallbackOr = line.includes('||');
      const isControlLine = /\b(if|while|for)\s*\(/.test(line);
      const looksLikeBooleanExpr = /===|!==|>=|<=|>\s*0|<\s*0|&&/.test(line);
      if (hasFallbackOr && !isControlLine && !looksLikeBooleanExpr) {
        const assignFallbackMatch = line.match(/=\s*[^;]*\|\|\s*(\[\]|\{\}|null|undefined|""|''|0)/);
        const returnFallbackMatch = line.match(/return\s+[^;]*\|\|\s*(\[\]|\{\}|null|undefined|""|''|0)/);
        if (assignFallbackMatch || returnFallbackMatch) {
          violations.push({
            file: filePath, line: lineNum,
            column: (assignFallbackMatch?.index ?? returnFallbackMatch?.index ?? 0) + 1,
            type: 'UTS110111120',
            code: trimmedLine,
            message: 'Non-boolean fallback with || may fail in UTS APP compile',
            fix: 'Replace with explicit null check: x != null ? x : fallback'
          });
        }
      }
    }

    // ===== 3. UTS110111101: 行内对象字面量类型 =====

    if (!inWebBlock) {
      // interface/type 内的属性行内对象类型
      const inlinePropObjMatch = line.match(/^\s*[a-zA-Z_]\w*\??\s*:\s*\{\s*$/);
      if (inlinePropObjMatch && inTypeDeclaration) {
        violations.push({
          file: filePath, line: lineNum, column: inlinePropObjMatch.index! + 1,
          type: 'UTS110111101',
          code: trimmedLine,
          message: 'Inline object literal type in type/interface property',
          fix: 'Extract to named type, then reference it by name'
        });
      }

      // 函数参数中的行内对象类型
      const paramMatch = line.match(/(?:function|fn|async\s+function)?\s*\w+\s*\([^)]*:\s*{/);
      if (paramMatch && !isComment(trimmedLine)) {
        violations.push({
          file: filePath, line: lineNum, column: paramMatch.index! + 1,
          type: 'UTS110111101',
          code: trimmedLine,
          message: 'Inline object literal type in function parameter',
          fix: 'Extract to named type: type MyParam = { ... };'
        });
      }

      // 回调参数中的行内对象类型
      const onLoadMatch = line.match(/onLoad\s*\(\s*(?:async\s+)?\([^)]*:\s*{/);
      if (onLoadMatch) {
        violations.push({
          file: filePath, line: lineNum, column: onLoadMatch.index! + 1,
          type: 'UTS110111101',
          code: trimmedLine,
          message: 'Inline object literal type in onLoad callback',
          fix: 'Extract to: type OnLoadOptions = { ... };'
        });
      }

      // 泛型中的行内对象类型
      const genericMatch = line.match(/(?:ref|Promise|Record|Map|Set)<\s*{/);
      if (genericMatch && !line.includes('=>')) {
        violations.push({
          file: filePath, line: lineNum, column: genericMatch.index! + 1,
          type: 'UTS110111101',
          code: trimmedLine,
          message: 'Inline object literal type in generic parameter',
          fix: 'Extract to named type'
        });
      }

      // 箭头函数参数行内对象类型
      const arrowParamMatch = line.match(/\([^)]*:\s*\{[^}]*\}\s*\)\s*=>/);
      if (arrowParamMatch) {
        violations.push({
          file: filePath, line: lineNum, column: arrowParamMatch.index! + 1,
          type: 'UTS110111101',
          code: trimmedLine,
          message: 'Inline object type in arrow function parameter',
          fix: 'Extract to named type'
        });
      }

      // as { ... } 类型断言中的行内对象类型
      const asObjMatch = line.match(/\bas\s*\{/);
      if (asObjMatch && !isComment(trimmedLine)) {
        violations.push({
          file: filePath, line: lineNum, column: asObjMatch.index! + 1,
          type: 'UTS110111101',
          code: trimmedLine,
          message: 'Inline object literal type in "as { }" cast — extract to named type',
          fix: 'type MyType = { ... }; then use "as MyType"'
        });
      }
    }

    // ===== 4. UTS110111162: type 中嵌套对象字面量 =====
    if (inTypeDeclaration && !inWebBlock) {
      // 属性类型是对象字面量（不提取到独立 type）
      const nestedObjMatch = line.match(/^\s*(\w+)\??\s*:\s*\{[^}]*\w+[^}]*:[^}]*\}/);
      if (nestedObjMatch) {
        violations.push({
          file: filePath, line: lineNum, column: 1,
          type: 'UTS110111162',
          code: trimmedLine,
          message: `Nested object literal in type definition for '${nestedObjMatch[1]}'`,
          fix: 'Extract nested object to a separate named type'
        });
      }
    }

    // ===== 5. UTS110111150: 函数/变量声明提升 =====
    // 只检测 script 区域内的真实函数调用（排除 template 引用、属性名、类型引用等）

    if (!inWebBlock && isVue && filePath.endsWith('.uvue') && index >= scriptStartLine && index <= scriptEndLine && !inTypeDeclaration && !inInterfaceBlock) {
      for (const [name, defLine] of definitions) {
        // 跳过过短或太通用的名称
        if (name.length < 3) continue;
        // 跳过常见的 Vue/uni API 和全局对象
        const globalNames = new Set([
          'console', 'uni', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number',
          'Boolean', 'Promise', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
          'parseInt', 'parseFloat', 'Date', 'Error', 'Map', 'Set', 'RegExp',
          'require', 'exports', 'module', 'process', 'window', 'document',
          // Vue 常用
          'ref', 'reactive', 'computed', 'watch', 'onMounted', 'onUnmounted',
          'onBeforeMount', 'onBeforeUnmount', 'provide', 'inject', 'nextTick',
          'defineProps', 'defineEmits', 'defineExpose', 'withDefaults',
          'onLoad', 'onShow', 'onHide', 'onUnload', 'onReachBottom',
        ]);
        if (globalNames.has(name)) continue;

        // 在当前行使用了这个名称，但定义在后面
        const usageRegex = new RegExp(`\\b${name}\\s*\\(`);
        if (usageRegex.test(trimmedLine) && index < defLine) {
          // 排除定义行自身
          const isDefinition = trimmedLine.match(new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b`)) ||
                               trimmedLine.match(new RegExp(`^(?:export\\s+)?(?:const|let|var)\\s+${name}\\b`));
          const isImport = trimmedLine.includes('import ');
          // 排除属性访问 obj.name()
          const isPropertyAccess = line.match(new RegExp(`\\.\\s*${name}\\s*\\(`));
          // 排除字符串中的引用
          const isStringLiteral = line.match(new RegExp(`["'\`].*\\b${name}\\s*\\(.*["'\`]`));

          if (!isDefinition && !isImport && !isPropertyAccess && !isStringLiteral) {
            violations.push({
              file: filePath, line: lineNum, column: 1,
              type: 'UTS110111150',
              code: trimmedLine,
              message: `'${name}' called before declaration (line ${defLine + 1})`,
              fix: `Move definition of '${name}' before its first usage`
            });
            break; // 每行只报一次 hoisting
          }
        }
      }
    }

    // ===== 6. UTS110111119: 使用 undefined =====

    if (!inWebBlock) {
      // 检测 undefined 的使用（排除注释和字符串中的）
      if (/\bundefined\b/.test(trimmedLine) && !isComment(trimmedLine)) {
        // 排除 typeof x === "undefined"、注释、和字符串字面量
        const isTypeofCheck = /typeof\s+\w+\s*===?\s*["']undefined["']/.test(trimmedLine);
        const isVoidZero = /void\s+0/.test(trimmedLine);
        // 检查是否在字符串内（粗略判断）
        const withoutStrings = trimmedLine
          .replace(/'[^']*'/g, '')
          .replace(/"[^"]*"/g, '')
          .replace(/`[^`]*`/g, '');
        const hasUndefined = /\bundefined\b/.test(withoutStrings);

        if (hasUndefined && !isTypeofCheck && !isVoidZero) {
          violations.push({
            file: filePath, line: lineNum, column: 1,
            type: 'UTS110111119',
            code: trimmedLine,
            message: 'Use of undefined (not supported in UTS)',
            fix: 'Replace undefined with null'
          });
        }
      }
    }

    // ===== 7. UTS110111125: Utility Types =====
    if (!inWebBlock) {
      // Record<string, ...> compiles to an abstract Kotlin class — cannot be instantiated
      const recordMatch = line.match(/\bRecord\s*<[^>]+>/);
      if (recordMatch && !isComment(trimmedLine)) {
        violations.push({
          file: filePath, line: lineNum, column: recordMatch.index! + 1,
          type: 'UTS110111125',
          code: trimmedLine,
          message: 'Record<K,V> is a TS Utility Type not supported in UTS — causes abstract class instantiation error in Kotlin',
          fix: 'Replace with UTSJSONObject (for string maps) or Map<K,V>, or define a named type'
        });
      }

      const utilityTypes = ['Partial', 'Required', 'Readonly', 'Pick', 'Omit',
        'Exclude', 'Extract', 'NonNullable', 'Parameters', 'ConstructorParameters',
        'ReturnType', 'InstanceType', 'NoInfer', 'ThisParameterType', 'OmitThisParameter',
        'ThisType', 'Uppercase', 'Lowercase', 'Capitalize', 'Uncapitalize', 'Awaited'];

      for (const ut of utilityTypes) {
        const regex = new RegExp(`\\b${ut}\\s*<`);
        if (regex.test(trimmedLine)) {
          violations.push({
            file: filePath, line: lineNum, column: 1,
            type: 'UTS110111125',
            code: trimmedLine,
            message: `Utility type '${ut}' not supported in UTS`,
            fix: `Manually define equivalent type with type keyword`
          });
          break;
        }
      }
    }

    // ===== 7.5. UTS110111122: unknown 类型 =====
    // ': unknown' 在类型注解中不支持，应改为 'any'
    // 排除 'as unknown as'（已由 TYPE_AS_UNKNOWN 捕获）、字符串字面量中的 unknown
    if (!inWebBlock && !isComment(trimmedLine)) {
      const codeWithoutStrings = trimmedLine
        .replace(/'[^']*'/g, "''")
        .replace(/"[^"]*"/g, '""')
        .replace(/`[^`]*`/g, '``');
      const unknownTypeMatch = codeWithoutStrings.match(/:\s*unknown\b/);
      if (unknownTypeMatch && !trimmedLine.includes('as unknown as')) {
        violations.push({
          file: filePath, line: lineNum, column: unknownTypeMatch.index! + 1,
          type: 'UTS110111122',
          code: trimmedLine,
          message: 'Type unknown not supported in UTS (only allowed in generics)',
          fix: 'Replace unknown with any'
        });
      }
    }

    // ===== 8. UTS110111126: as const =====

    if (!inWebBlock) {
      if (/\bas\s+const\b/.test(trimmedLine)) {
        violations.push({
          file: filePath, line: lineNum, column: 1,
          type: 'UTS110111126',
          code: trimmedLine,
          message: 'as const assertion not supported in UTS',
          fix: 'Use explicit type annotation instead'
        });
      }
    }

    // ===== 9. UTS110111127: 确定赋值断言 let x!: T =====

    if (!inWebBlock) {
      if (/let\s+\w+\s*!:\s*/.test(trimmedLine)) {
        violations.push({
          file: filePath, line: lineNum, column: 1,
          type: 'UTS110111127',
          code: trimmedLine,
          message: 'Definite assignment assertion (!:) not supported in UTS',
          fix: 'Initialize variable at declaration: let x: T = initialValue'
        });
      }
    }

    // ===== 10. UTS110111149: delete 运算符 =====

    if (!inWebBlock) {
      // 排除：字符串字面量行（locale文件）、属性名（obj.delete = ...）
      const isStringValueLine = trimmedLine.startsWith('"') || trimmedLine.startsWith("'");
      if (!isStringValueLine && /(?<!\.)\bdelete\s+[a-zA-Z_$]/.test(trimmedLine)) {
        violations.push({
          file: filePath, line: lineNum, column: 1,
          type: 'UTS110111149',
          code: trimmedLine,
          message: 'delete operator not supported in UTS',
          fix: 'Set property to null instead: obj.prop = null'
        });
      }
    }

    // ===== 11. UTS110111144: index signature =====

    if (!inWebBlock) {
      if (/^\s*\[\s*(\w+)\s*:\s*string\s*\]\s*:/.test(trimmedLine)) {
        // 排除在 type/interface 定义内
        violations.push({
          file: filePath, line: lineNum, column: 1,
          type: 'UTS110111144',
          code: trimmedLine,
          message: 'Index signature not supported in UTS',
          fix: 'Use Map<string, T> or define explicit properties'
        });
      }
    }

    // ===== 12. UTS110111158: throw 非 Error =====

    if (!inWebBlock) {
      const throwMatch = trimmedLine.match(/\bthrow\s+(?!new\s+Error)/);
      if (throwMatch && !trimmedLine.match(/\bthrow\s+new\s+\w+Error/)) {
        // 排除 throw new Error、throw new CustomError 等
        if (!trimmedLine.match(/\bthrow\s+new\s+/)) {
          // 排除：throw this.method(...) 方法调用返回值、throw typedVar（变量名暗示已是Error类型）
          const throwExpr = trimmedLine.replace(/.*\bthrow\s+/, '').trim();
          const isMethodCall = /^(this\.\w+|[\w$]+)\s*\(/.test(throwExpr);
          const isLikelyErrorVar = /^(normalized|normalized\w+|error|err)\b/.test(throwExpr);
          if (!isMethodCall && !isLikelyErrorVar) {
            violations.push({
              file: filePath, line: lineNum, column: 1,
              type: 'UTS110111158',
              code: trimmedLine,
              message: 'Only Error instances can be thrown in UTS',
              fix: 'Use throw new Error("message") instead'
            });
          }
        }
      }
    }

    // ===== 13. TYPE_AS_UNKNOWN: as unknown as =====

    if (!inWebBlock) {
      if (/\bas\s+unknown\s+as\b/.test(trimmedLine)) {
        violations.push({
          file: filePath, line: lineNum, column: 1,
          type: 'TYPE_AS_UNKNOWN',
          code: trimmedLine,
          message: 'Double type cast (as unknown as T) not supported in UTS',
          fix: 'Use single cast: as T, or restructure code to avoid cast'
        });
      }
    }

    // ===== 14. TYPE_ARROW_DEFAULT: 箭头函数默认参数 =====

    if (!inWebBlock) {
      // (x: T = defaultValue) => 或 (x = defaultValue) =>
      const arrowDefaultMatch = trimmedLine.match(/\(\s*[^)]*=\s*[^,)]+[^)]*\)\s*=>/);
      if (arrowDefaultMatch) {
        // 排除赋值表达式 (如 destructuring with default)
        // 只在参数列表中检测
        const paramList = trimmedLine.match(/\(([^)]*)\)\s*=>/);
        if (paramList) {
          const params = paramList[1];
          // 检查参数默认值（排除 = 在类型注解外的情况）
          const paramParts = params.split(',');
          for (const part of paramParts) {
            const trimmedPart = part.trim();
            // 匹配 paramName: Type = default 或 paramName = default
            if (/^\w+(\s*:\s*\w+(\[\])?)?\s*=\s*/.test(trimmedPart)) {
              const paramName = trimmedPart.match(/^(\w+)/)?.[1];
              if (paramName) {
                violations.push({
                  file: filePath, line: lineNum, column: 1,
                  type: 'TYPE_ARROW_DEFAULT',
                  code: trimmedLine,
                  message: `Arrow function default parameter '${paramName}' not supported in UTS`,
                  fix: `Use nullable param + internal default: (${paramName}: T | null) => { const _${paramName} = ${paramName} != null ? ${paramName} : default; }`
                });
                break;
              }
            }
          }
        }
      }
    }

    // ===== 14.5. TYPE_GENERIC_ARROW: 箭头函数泛型参数 =====
    // const fn = <T>(x: T): T => ... 或 const fn = <T = any,>(...) => ...
    // UTS 不允许箭头函数表达式有泛型参数，需改为 function 声明
    if (!inWebBlock && !isComment(trimmedLine)) {
      const genericArrowMatch = trimmedLine.match(/=\s*<[A-Z]\w*(?:\s*[,=][^>]*)?\s*>\s*\(/);
      if (genericArrowMatch && trimmedLine.includes('=>')) {
        violations.push({
          file: filePath, line: lineNum, column: genericArrowMatch.index! + 1,
          type: 'TYPE_GENERIC_ARROW',
          code: trimmedLine,
          message: 'Generic type parameters on arrow function expressions not supported in UTS',
          fix: 'Convert to function declaration: function fn<T>(...): T { ... }'
        });
      }
    }

    // ===== 15. TYPE_STRING_CTOR: String() 构造 =====

    if (!inWebBlock) {
      // String(expr) 用于类型转换
      const stringCtorMatch = trimmedLine.match(/\bString\s*\(\s*[^)]*\)/);
      if (stringCtorMatch) {
        // 排除 new String() 和 typeof x === "string"
        if (!trimmedLine.includes('new String') && !trimmedLine.includes('typeof')) {
          // 排除字符串方法调用 (如 someString.match(...))
          const isMethodCall = line.match(/\.\s*String\s*\(/);
          if (!isMethodCall) {
            violations.push({
              file: filePath, line: lineNum, column: 1,
              type: 'TYPE_STRING_CTOR',
              code: trimmedLine,
              message: 'String() constructor not supported in UTS for type conversion',
              fix: 'Use template literal: `${expr}`'
            });
          }
        }
      }
    }

    // ===== 16. TYPE_SPREAD: 展开运算符 =====

    if (!inWebBlock) {
      // {...obj, key: val} 或 {...obj} — 对象字面量展开
      const objSpreadMatch = trimmedLine.match(/\{\s*\.\.\.(\w+)/);
      if (objSpreadMatch) {
        violations.push({
          file: filePath, line: lineNum, column: 1,
          type: 'TYPE_SPREAD',
          code: trimmedLine,
          message: `Object spread operator not supported in UTS`,
          fix: 'Modify properties directly or create new object with explicit properties'
        });
      }

      // const { a, ...rest } = obj — 解构 rest 展开
      const destructSpreadMatch = trimmedLine.match(/(?:const|let|var)\s*\{[^}]*\.\.\.\w+[^}]*\}\s*=/);
      if (destructSpreadMatch && !isComment(trimmedLine)) {
        violations.push({
          file: filePath, line: lineNum, column: 1,
          type: 'TYPE_DESTRUCT_SPREAD',
          code: trimmedLine,
          message: 'Destructuring rest spread not supported in UTS',
          fix: 'Access properties individually: const a = obj.a; const b = obj.b; ...'
        });
      }
    }

    // ===== 17. TYPE_VALOR_NULLABLE: valOr(nullableTyped, default) =====

    if (!inWebBlock) {
      // valOr(someNullableTyped, default) where typed value may not be compatible with any param
      const valOrMatch = trimmedLine.match(/valOr\s*\(/);
      if (valOrMatch) {
        // 检查是否传入了可能的 nullable typed 值
        // 简化检测：valOr 调用中包含 ?. 或 类型断言
        const hasNullableAccess = trimmedLine.includes('?.') || trimmedLine.includes(' as ');
        if (hasNullableAccess) {
          violations.push({
            file: filePath, line: lineNum, column: 1,
            type: 'TYPE_VALOR_NULLABLE',
            code: trimmedLine,
            message: 'valOr() with nullable typed value may cause type mismatch',
            fix: 'Use explicit ternary: value != null ? value : defaultValue'
          });
        }
      }
    }

    // ===== 18. TYPE_ENUM_STRING_CMP: enum 与字符串直接比较 =====

    if (!inWebBlock) {
      // 只匹配 PascalCase.PascalCase === "string" 的模式（真正的枚举访问）
      // 排除 obj.prop === "string" 这种普通字符串属性比较
      const enumStrMatch = trimmedLine.match(/([A-Z]\w*\.[A-Z]\w*)\s*(===|!==)\s*["']/);
      const strEnumMatch = trimmedLine.match(/["']\s*(===|!==)\s*([A-Z]\w*\.[A-Z]\w*)/);
      if (enumStrMatch) {
        violations.push({
          file: filePath, line: lineNum, column: 1,
          type: 'TYPE_ENUM_STRING_CMP',
          code: trimmedLine,
          message: `Direct enum-string comparison: ${enumStrMatch[1]}`,
          fix: `Use template string: \`\${${enumStrMatch[1]}}\` === "stringValue"`
        });
      }
      if (strEnumMatch) {
        violations.push({
          file: filePath, line: lineNum, column: 1,
          type: 'TYPE_ENUM_STRING_CMP',
          code: trimmedLine,
          message: 'Direct string-enum comparison',
          fix: 'Use template string conversion for enum side'
        });
      }
    }

    // ===== 19. TYPE_OBJECT_ASSIGN: Object.assign =====

    if (!inWebBlock) {
      if (/\bObject\.assign\s*\(/.test(trimmedLine)) {
        violations.push({
          file: filePath, line: lineNum, column: 1,
          type: 'TYPE_OBJECT_ASSIGN',
          code: trimmedLine,
          message: 'Object.assign() not supported with typed objects in UTS',
          fix: 'Assign properties manually: target.prop = source.prop'
        });
      }
    }

    // ===== 20. TYPE_REF_OPTIONAL: ref 可选链 =====

    if (!inWebBlock) {
      // someRef.value?.method() — ref<any | null> 上使用可选调用
      const refOptionalMatch = trimmedLine.match(/(\w+Ref(?:\.value)?)\?\.\w+\(/);
      if (refOptionalMatch) {
        violations.push({
          file: filePath, line: lineNum, column: 1,
          type: 'TYPE_REF_OPTIONAL',
          code: trimmedLine,
          message: `Optional chaining on ref: ${refOptionalMatch[1]}?.method()`,
          fix: 'Use explicit null check + typed ref: if (ref.value != null) ref.value.method()'
        });
      }
    }

    // ===== 21. TYPE_NPM_IMPORT: 非 UTS 兼容 npm import =====
    // 只在非条件编译块中检测
    if (!inWebBlock) {
      const importMatch = trimmedLine.match(/import\s+.*from\s+['"]([^'"]+)['"]/);
      if (importMatch) {
        const importPath = importMatch[1];
        if (isNpmPackageImport(importPath)) {
          // 检查是否在 #ifdef WEB 块中（简化检测）
          const prevLines = lines.slice(Math.max(0, index - 5), index);
          const inWebIfdef = prevLines.some(l => l.trim().match(/^\/\/\s*#ifdef\s+(WEB|H5)/));
          if (!inWebIfdef) {
            violations.push({
              file: filePath, line: lineNum, column: 1,
              type: 'TYPE_NPM_IMPORT',
              code: trimmedLine,
              message: `Non-UTS-compatible npm import: '${importPath}'`,
              fix: 'Wrap in #ifdef WEB conditional compilation or find UTS-compatible alternative'
            });
          }
        }
      }
    }

    // ===== 22. TYPE_ANY_PROP_ACCESS: any 类型属性访问 =====
    // 检测 (e: any) => { e.something } 或 e["something"] 模式
    // UTS 中 any 类型不能使用 .属性 或 [] 下标访问
    if (!inWebBlock && index >= scriptStartLine && index <= scriptEndLine) {
      // 检查当前行是否在 any 参数的函数体内
      const anyParamMatch = findAnyParamInScope(lines, index);
      if (anyParamMatch) {
        const paramName = anyParamMatch;
        // 检测 paramName.propName 或 paramName["propName"]
        const dotAccessRegex = new RegExp(`\\b${paramName}\\.(\\w+)`);
        const bracketAccessRegex = new RegExp(`\\b${paramName}\\[`);
        const dotMatch = trimmedLine.match(dotAccessRegex);
        const bracketMatch = trimmedLine.match(bracketAccessRegex);

        if (dotMatch && !trimmedLine.includes(' as ')) {
          violations.push({
            file: filePath, line: lineNum, column: 1,
            type: 'TYPE_ANY_PROP_ACCESS',
            code: trimmedLine,
            message: `Property access on 'any' parameter: ${paramName}.${dotMatch[1]}`,
            fix: `Cast to UTSJSONObject first: const obj = ${paramName} as UTSJSONObject; then use obj["${dotMatch[1]}"]`
          });
        }
        if (bracketMatch) {
          violations.push({
            file: filePath, line: lineNum, column: 1,
            type: 'TYPE_ANY_PROP_ACCESS',
            code: trimmedLine,
            message: `Bracket access on 'any' parameter: ${paramName}[...]`,
            fix: `Cast to UTSJSONObject first: const obj = ${paramName} as UTSJSONObject; then use obj["key"]`
          });
        }
      }
    }

    // ===== 23. TYPE_BOOLEAN_NULLABLE_OR: 模板中 nullable 布尔 || =====
    // :class="{ disabled: readonly || item.disabled }"
    // :disabled="readonly || item.disabled"
    if (!inWebBlock && isVue && index < scriptStartLine) {
      const nullableBoolOrMatch = line.match(/(?::class="[^"]*\b(\w+)\s*\|\|\s*(\w+)[^"]*"|:(?:disabled|visible|readonly|loading)="[^"]*\b(\w+)\s*\|\|\s*(\w+)[^"]*")/);
      if (nullableBoolOrMatch) {
        const names = [nullableBoolOrMatch[1], nullableBoolOrMatch[2], nullableBoolOrMatch[3], nullableBoolOrMatch[4]].filter(Boolean);
        violations.push({
          file: filePath, line: lineNum, column: 1,
          type: 'TYPE_BOOLEAN_NULLABLE_OR',
          code: trimmedLine,
          message: `Nullable boolean || in template: ${names.join(' || ')}`,
          fix: `Use == true: ${names.map(n => `${n} == true`).join(' || ')}`
        });
      }
    }

    // ===== 24. TYPE_WATCH_GETTER_BOOL: watch(() => props.bool) 返回类型 =====
    // watch(() => props.visible, ...) — getter 返回 Boolean 但 watch 期望 Function
    if (!inWebBlock && index >= scriptStartLine && index <= scriptEndLine) {
      const watchGetterMatch = trimmedLine.match(/^watch\(\s*$/);
      if (watchGetterMatch) {
        // 检查下一行是否是 () => props.xxx
        const nextLine = index + 1 < lines.length ? lines[index + 1].trim() : '';
        if (/^\(\)\s*=>\s*props\.\w+\b(?!\s*[!=<>])/.test(nextLine)) {
          violations.push({
            file: filePath, line: lineNum, column: 1,
            type: 'TYPE_WATCH_GETTER_BOOL',
            code: `${trimmedLine}\n  ${nextLine}`,
            message: 'watch(() => props.xxx) may cause "Return type mismatch: expected Function, actual Boolean"',
            fix: 'Use computed wrapper: watch(computed(() => props.xxx), ...)'
          });
        }
      }
      // 单行模式: watch(() => props.xxx,
      const inlineWatchMatch = trimmedLine.match(/watch\(\s*\(\)\s*=>\s*props\.\w+\b(?!\s*[!=<>])/);
      if (inlineWatchMatch) {
        violations.push({
          file: filePath, line: lineNum, column: 1,
          type: 'TYPE_WATCH_GETTER_BOOL',
          code: trimmedLine,
          message: 'watch(() => props.xxx) may cause "Return type mismatch: expected Function, actual Boolean"',
          fix: 'Use computed wrapper: watch(computed(() => props.xxx), ...)'
        });
      }
    }

    // ===== 25. TYPE_MAP_INDEX_TYPED: 对象下标访问 Any? 传给类型参数 =====
    // strOr(someMap[key], "default") — someMap[key] 返回 Any? 不能传 String?
    // strOr(uni.getStorageSync(key), "default") — getStorageSync 返回 Any?
    if (!inWebBlock) {
      const mapIndexStrOrMatch = trimmedLine.match(/strOr\(\s*(\w+)\[([^\]]+)\]/);
      if (mapIndexStrOrMatch && !trimmedLine.includes('as string')) {
        violations.push({
          file: filePath, line: lineNum, column: 1,
          type: 'TYPE_MAP_INDEX_TYPED',
          code: trimmedLine,
          message: `strOr(${mapIndexStrOrMatch[1]}[...]) — indexed access returns Any?, expected String?`,
          fix: `Cast result: strOr(${mapIndexStrOrMatch[1]}[${mapIndexStrOrMatch[2]}] as string | null, ...)`
        });
      }
      // uni.getStorageSync() returns Any? — needs explicit cast before typed function
      const getStorageSyncInTyped = trimmedLine.match(/strOr\(\s*uni\.getStorageSync\(/);
      if (getStorageSyncInTyped && !trimmedLine.includes('as string')) {
        violations.push({
          file: filePath, line: lineNum, column: 1,
          type: 'TYPE_MAP_INDEX_TYPED',
          code: trimmedLine,
          message: 'uni.getStorageSync() returns Any?, needs cast before passing to typed param',
          fix: 'Cast: strOr(uni.getStorageSync(key) as string | null, fallback)'
        });
      }
    }

    // ===== 26. TYPE_REF_ANY_METHOD: ref<any> 上调用方法 =====
    // drawerRef.value.close() — any 类型不能调用方法
    if (!inWebBlock && index >= scriptStartLine && index <= scriptEndLine) {
      const refAnyMethodMatch = trimmedLine.match(/(\w+Ref)\.value\s*!?\.\s*(\w+)\s*\(/);
      if (refAnyMethodMatch) {
        // 检查是否 ref 的类型是 any
        const refTypeName = refAnyMethodMatch[1];
        const refDefLine = lines.find(l => {
          const t = l.trim();
          return t.match(new RegExp(`(?:const|let)\\s+${refTypeName}\\s*=\\s*ref<`)) ||
                 t.match(new RegExp(`(?:const|let)\\s+${refTypeName}\\s*=\\s*ref<any`));
        });
        if (refDefLine && refDefLine.includes('any')) {
          violations.push({
            file: filePath, line: lineNum, column: 1,
            type: 'TYPE_REF_ANY_METHOD',
            code: trimmedLine,
            message: `Method call on ref<any>: ${refAnyMethodMatch[1]}.value.${refAnyMethodMatch[2]}()`,
            fix: `Use typed ref: ref<SomeComponentInstance | null> instead of ref<any | null>`
          });
        }
      }
    }

    // ===== 27. TYPE_CURLY_QUOTE: 弯引号代替ASCII引号 =====
    // 编辑器/输入法自动替换后导致 SFC 解析器报 "Unexpected character" 编译失败
    // U+201C " U+201D " U+2018 ' U+2019 '
    {
      // 去除行尾注释再检测（注释中的弯引号是中文排版，无害）
      const commentIdx = line.indexOf('//');
      const codePart = commentIdx >= 0 ? line.slice(0, commentIdx) : line;
      const hasCurly = /[\u201c\u201d\u2018\u2019]/.test(codePart);
      if (hasCurly && !isComment(trimmedLine)) {
        const col = codePart.search(/[\u201c\u201d\u2018\u2019]/);
        const fixed = line
          .replace(/\u201c/g, '"').replace(/\u201d/g, '"')
          .replace(/\u2018/g, "'").replace(/\u2019/g, "'");
        violations.push({
          file: filePath, line: lineNum, column: col + 1,
          type: 'TYPE_CURLY_QUOTE',
          code: trimmedLine,
          message: '代码中含有弯引号/全角引号，SFC 解析器会报 "Unexpected character" 编译失败',
          fix: fixed.trim(),
        });
      }
    }

  }); // end forEach

  return violations;
}

// ---------- 项目扫描 ----------

function scanProject(
  dir: string,
  skipDirs: string[] = ['node_modules', 'dist', '.git', 'unpackage', 'uni_modules']
): Violation[] {
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
        } else if (entry.isFile() && /\.(uvue|uts|vue)$/.test(entry.name)) {
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

// ---------- 报告生成 ----------

function generateStats(violations: Violation[]): ScanResult {
  const byType: Record<string, number> = {};
  const byFile: Record<string, number> = {};

  violations.forEach(v => {
    byType[v.type] = (byType[v.type] || 0) + 1;
    byFile[v.file] = (byFile[v.file] || 0) + 1;
  });

  return { total: violations.length, violations, byType, byFile };
}

const VIOLATION_LABELS: Record<string, string> = {
  'UTS110111120': '非布尔条件',
  'UTS110111101': '行内对象类型',
  'UTS110111163': 'interface 对象字面量',
  'UTS110111162': 'type 嵌套对象',
  'UTS110111150': '声明提升',
  'UTS110111119': '使用 undefined',
  'UTS110111125': 'Utility Types',
  'UTS110111126': 'as const',
  'UTS110111127': '确定赋值断言',
  'UTS110111149': 'delete 运算符',
  'UTS110111144': 'index signature',
  'UTS110111158': 'throw 非 Error',
  'TYPE_AS_UNKNOWN': '双重类型转换',
  'TYPE_ARROW_DEFAULT': '箭头函数默认参数',
  'TYPE_STRING_CTOR': 'String() 构造',
  'TYPE_SPREAD': '展开运算符',
  'TYPE_VALOR_NULLABLE': 'valOr nullable 类型',
  'TYPE_ENUM_STRING_CMP': 'enum-string 比较',
  'TYPE_OBJECT_ASSIGN': 'Object.assign',
  'TYPE_REF_OPTIONAL': 'ref 可选链',
  'TYPE_NPM_IMPORT': '非 UTS 兼容 import',
  'TYPE_ANY_PROP_ACCESS': 'any 属性/下标访问',
  'TYPE_BOOLEAN_NULLABLE_OR': 'nullable 布尔 || 模板',
  'TYPE_WATCH_GETTER_BOOL': 'watch getter 返回类型',
  'TYPE_MAP_INDEX_TYPED': '下标访问 Any? 传类型参数',
  'TYPE_REF_ANY_METHOD': 'ref<any> 方法调用',
  'TYPE_CURLY_QUOTE': '弯引号导致SFC解析失败',
  'UTS110111122': 'unknown 类型',
  'TYPE_GENERIC_ARROW': '箭头函数泛型参数',
  'TYPE_DESTRUCT_SPREAD': '解构 rest 展开',
};

function outputMarkdown(result: ScanResult, outputPath: string): void {
  const priorityGroups = {
    '高优先级 (编译错误)': [
      'TYPE_CURLY_QUOTE',
      'UTS110111163', 'UTS110111120', 'UTS110111101', 'UTS110111162',
      'UTS110111150', 'TYPE_AS_UNKNOWN', 'TYPE_ARROW_DEFAULT', 'TYPE_SPREAD',
      'TYPE_OBJECT_ASSIGN', 'TYPE_REF_OPTIONAL', 'TYPE_ANY_PROP_ACCESS',
      'TYPE_REF_ANY_METHOD', 'TYPE_WATCH_GETTER_BOOL', 'TYPE_BOOLEAN_NULLABLE_OR',
      'UTS110111122', 'TYPE_GENERIC_ARROW', 'TYPE_DESTRUCT_SPREAD',
    ],
    '中优先级 (类型不匹配)': [
      'TYPE_STRING_CTOR', 'TYPE_ENUM_STRING_CMP',
      'UTS110111119', 'UTS110111125', 'TYPE_NPM_IMPORT', 'TYPE_MAP_INDEX_TYPED',
    ],
    '低优先级 (编码规范)': [
      'UTS110111126', 'UTS110111127', 'UTS110111149', 'UTS110111144', 'UTS110111158',
      'TYPE_VALOR_NULLABLE', // valOr(any, any):any — false positive, valOr accepts any types
    ],
  };

  const typeSection = Object.entries(result.byType)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `- **${type}** (${VIOLATION_LABELS[type] || type}): ${count} 处`)
    .join('\n');

  const fileSection = Object.entries(result.byFile)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([file, count]) => `- \`${file}\`: ${count} 处`)
    .join('\n');

  const detailSection = result.violations
    .sort((a, b) => {
      const typeOrder = Object.values(priorityGroups).flat();
      return typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type);
    })
    .map(v => `
### ${v.file}:${v.line}

- **类型**: \`${v.type}\` — ${VIOLATION_LABELS[v.type] || v.type}
- **位置**: 第 ${v.line} 行，第 ${v.column} 列

\`\`\`
${v.code}
\`\`\`

**说明**: ${v.message}
${v.fix ? `**修复**: ${v.fix}` : ''}
---
`).join('\n');

  const prioritySection = Object.entries(priorityGroups)
    .map(([group, types]) => {
      const count = types.reduce((sum, t) => sum + (result.byType[t] || 0), 0);
      return `### ${group}\n\n${types
        .filter(t => result.byType[t])
        .map(t => `- \`${t}\` (${VIOLATION_LABELS[t]}): ${result.byType[t]} 处`)
        .join('\n') || '(无)'}`;
    })
    .join('\n\n');

  const md = `# UTS 违规项扫描报告

生成时间：${new Date().toLocaleString('zh-CN')}

## 概览

- **总违规数**: ${result.total}
- **涉及文件**: ${Object.keys(result.byFile).length}
- **检测规则**: ${Object.keys(VIOLATION_LABELS).length} 种

## 修复优先级

${prioritySection}

## 按类型统计

${typeSection}

## 按文件统计 (Top 20)

${fileSection}

## 详细违规列表

${detailSection}
`;

  fs.writeFileSync(outputPath, md, 'utf-8');
  console.log(`Markdown 报告已生成: ${outputPath}`);
}

function outputJSON(result: ScanResult, outputPath: string): void {
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`JSON 报告已生成: ${outputPath}`);
}

// ---------- 自动修复 ----------

/**
 * 自动修复安全规则（仅修复无需人工判断的简单模式）
 *
 * 可安全自动修复的规则：
 * - UTS110111119: undefined → null
 * - TYPE_AS_UNKNOWN: as unknown as T → as T
 * - UTS110111126: as const → 移除
 * - TYPE_BOOLEAN_NULLABLE_OR: 模板中 a || b → a == true || b == true
 * - TYPE_WATCH_GETTER_BOOL: watch(() => props.x → watch(computed(() => props.x
 *
 * 需要人工判断（不自动修复）：
 * - UTS110111120: 非布尔条件（需判断变量类型）
 * - UTS110111163: interface → type（需确认是否仅用于对象字面量）
 * - TYPE_STRING_CTOR: String() → ``（需理解上下文）
 * - TYPE_SPREAD: 展开运算符（需手动重写）
 * - TYPE_OBJECT_ASSIGN: Object.assign（需手动属性赋值）
 * - UTS110111150: 声明提升（需移动代码）
 * - TYPE_ANY_PROP_ACCESS: any 属性访问（需重写代码逻辑）
 * - TYPE_REF_ANY_METHOD: ref<any> 方法调用（需定义类型）
 */
const SAFE_FIX_TYPES = new Set<ViolationType>([
  'TYPE_CURLY_QUOTE',         // 弯引号 → ASCII引号（100%安全）
  'UTS110111119',           // undefined → null
  'TYPE_AS_UNKNOWN',        // as unknown as → as
  'UTS110111126',           // as const → remove
  'TYPE_BOOLEAN_NULLABLE_OR', // 模板 nullable || → == true ||
  'TYPE_WATCH_GETTER_BOOL',   // watch getter → computed wrapper
]);

type FixResult = {
  file: string;
  line: number;
  type: ViolationType;
  before: string;
  after: string;
};

function applyAutoFixes(violations: Violation[], dryRun: boolean = false): FixResult[] {
  const fixes: FixResult[] = [];

  // 按文件分组，倒序处理（避免行号偏移）
  const byFile = new Map<string, Violation[]>();
  for (const v of violations) {
    if (!SAFE_FIX_TYPES.has(v.type)) continue;
    const list = byFile.get(v.file) || [];
    list.push(v);
    byFile.set(v.file, list);
  }

  for (const [filePath, fileViolations] of byFile) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // 倒序排列，避免修改影响行号
    fileViolations.sort((a, b) => b.line - a.line);

    for (const v of fileViolations) {
      const lineIdx = v.line - 1;
      if (lineIdx >= lines.length) continue;

      const original = lines[lineIdx];
      let fixed = original;

      switch (v.type) {
        case 'TYPE_CURLY_QUOTE': {
          // 弯引号 → ASCII引号
          fixed = original
            .replace(/\u201c/g, '"').replace(/\u201d/g, '"')
            .replace(/\u2018/g, "'").replace(/\u2019/g, "'");
          break;
        }
        case 'UTS110111119': {
          // undefined → null
          fixed = original
            .replace(/\|\s*null\s*\|\s*undefined/g, '| null')
            .replace(/\|\s*undefined\s*\|\s*null/g, '| null')
            .replace(/\bundefined\b/g, 'null');
          break;
        }
        case 'TYPE_AS_UNKNOWN': {
          // as unknown as T → as T
          fixed = original.replace(/\bas\s+unknown\s+as\s+/g, 'as ');
          break;
        }
        case 'UTS110111126': {
          // as const → 移除
          fixed = original.replace(/\bas\s+const\b/g, '');
          break;
        }
        case 'TYPE_BOOLEAN_NULLABLE_OR': {
          // 模板中 nullable boolean || → == true ||
          // 只在模板绑定属性中替换 (:class, :disabled, v-if 等)
          // 匹配 word || word 模式，在模板属性值内替换
          fixed = original.replace(
            /(\b\w+)\s*\|\|\s*(\w+\b)/g,
            (match, a, b) => {
              // 跳过已知布尔操作符上下文
              if (a === 'true' || a === 'false' || b === 'true' || b === 'false') return match;
              return `${a} == true || ${b} == true`;
            }
          );
          break;
        }
        case 'TYPE_WATCH_GETTER_BOOL': {
          // watch(() => props.xxx, → watch(computed(() => props.xxx,
          // 单行模式
          fixed = original.replace(
            /watch\(\s*\(\)\s*=>\s*props\./g,
            'watch(computed(() => props.'
          );
          break;
        }
      }

      if (fixed !== original) {
        fixes.push({
          file: filePath,
          line: v.line,
          type: v.type,
          before: original.trim(),
          after: fixed.trim(),
        });
        lines[lineIdx] = fixed;
      }
    }

    // 写入文件
    if (!dryRun && fixes.some(f => f.file === filePath)) {
      fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
    }
  }

  return fixes;
}

// ---------- 主函数 ----------

function main() {
  const args = process.argv.slice(2);
  const includeUniModules = args.includes('--include-uni-modules');
  const autoFix = args.includes('--fix');
  const dryRun = args.includes('--dry-run');
  const projectArg = args.find(arg => !arg.startsWith('-'));
  const projectRoot = path.resolve(projectArg || '.');
  const skipDirs = includeUniModules
    ? ['node_modules', 'dist', '.git', 'unpackage']
    : ['node_modules', 'dist', '.git', 'unpackage', 'uni_modules'];

  console.log(`开始扫描项目: ${projectRoot}`);
  console.log(`扫描模式: ${includeUniModules ? '含 uni_modules' : '默认(跳过 uni_modules)'}`);

  const violations = scanProject(projectRoot, skipDirs);
  const result = generateStats(violations);

  console.log(`\n扫描完成，发现 ${result.total} 个违规项\n`);

  // 自动修复模式
  if (autoFix || dryRun) {
    const fixes = applyAutoFixes(violations, dryRun);
    console.log(`\n${dryRun ? '[DRY RUN] ' : ''}自动修复: ${fixes.length} 处`);
    console.log(`可自动修复的规则: undefined→null, as unknown as→as, as const→移除, nullable||→==true||, watch getter→computed\n`);

    const fixesByType: Record<string, number> = {};
    for (const f of fixes) {
      fixesByType[f.type] = (fixesByType[f.type] || 0) + 1;
    }
    for (const [type, count] of Object.entries(fixesByType)) {
      console.log(`  ${type} (${VIOLATION_LABELS[type] || type}): ${count} 处`);
    }

    if (fixes.length > 0) {
      console.log(`\n修复预览 (前 20 条):`);
      fixes.slice(0, 20).forEach(f => {
        console.log(`\n  ${path.relative(projectRoot, f.file)}:${f.line} [${f.type}]`);
        console.log(`    - ${f.before}`);
        console.log(`    + ${f.after}`);
      });
    }

    if (dryRun) {
      console.log(`\n[DRY RUN] 未修改任何文件。使用 --fix 实际执行修复。`);
    } else if (fixes.length > 0) {
      console.log(`\n已修复 ${fixes.length} 处。请重新编译验证。`);
    }
    console.log();
  }

  // 输出报告
  const jsonPath = path.join(projectRoot, 'uts-violations.json');
  const mdPath = path.join(projectRoot, 'uts-violations.md');

  outputJSON(result, jsonPath);
  outputMarkdown(result, mdPath);

  // 控制台摘要
  console.log(`\n统计信息:`);
  console.log(`  总违规数: ${result.total}`);
  console.log(`  涉及文件: ${Object.keys(result.byFile).length}`);
  console.log(`  按类型:`);
  Object.entries(result.byType)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(`    - ${type} (${VIOLATION_LABELS[type] || type}): ${count}`);
    });

  if (result.total > 0) {
    process.exit(1);
  }
}

main();
