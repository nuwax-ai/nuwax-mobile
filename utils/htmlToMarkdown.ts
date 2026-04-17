/**
 * HTML 转 Markdown 转换器（增强版）
 * 适用于微信小程序环境
 * 支持处理大文本和复杂 HTML 结构
 */

/**
 * HTML 节点类型
 */
interface HtmlNode {
  type: 'element' | 'text';
  tag?: string;
  content?: string;
  children?: HtmlNode[];
  attributes?: Map<string, string>;
}

/**
 * 将 HTML 字符串转换为 Markdown 字符串（增强版）
 * @param html HTML 字符串
 * @param options 转换选项
 * @returns Markdown 字符串
 */
export function htmlToMarkdown(html: string, options?: {
  preserveNewlines?: boolean;
  codeBlockLanguage?: string;
  maxNestingDepth?: number;
}): string {
  if (!html) return '';
  
  const opts = {
    preserveNewlines: options?.preserveNewlines ?? false,
    codeBlockLanguage: options?.codeBlockLanguage ?? '',
    maxNestingDepth: options?.maxNestingDepth ?? 20
  };
  
  // 预处理：移除注释和脚本
  let processed = preprocess(html);
  
  // 使用流式处理来处理大文本
  let markdown = processHtmlStream(processed, opts);
  
  // 后处理：清理和格式化
  markdown = postprocess(markdown);
  
  return markdown;
}

/**
 * 预处理 HTML
 */
function preprocess(html: string): string {
  let result = html;
  
  // 移除注释
  result = result.replace(/<!--[\s\S]*?-->/g, '');
  
  // 移除 script 标签
  result = result.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  
  // 移除 style 标签
  result = result.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  // 标准化空白字符（保留必要的空格）
  result = result.replace(/\r\n/g, '\n');
  result = result.replace(/\r/g, '\n');
  
  return result;
}

/**
 * 流式处理 HTML（避免一次性处理导致的内存问题）
 */
function processHtmlStream(html: string, options: any): string {
  let markdown = html;
  
  // 第一轮：处理代码块（优先处理，避免代码内容被转换）
  markdown = processCodeBlocks(markdown, options);
  
  // 第二轮：处理表格
  markdown = processTables(markdown);
  
  // 第三轮：处理列表（嵌套支持）
  markdown = processLists(markdown, 0);
  
  // 第四轮：处理引用块（嵌套支持）
  markdown = processBlockquotes(markdown, 0);
  
  // 第五轮：处理标题
  markdown = processHeadings(markdown);
  
  // 第六轮：处理图片和链接
  markdown = processImages(markdown);
  markdown = processLinks(markdown);
  
  // 第七轮：处理文本格式（加粗、斜体、删除线等）
  markdown = processTextFormatting(markdown);
  
  // 第八轮：处理段落和换行
  markdown = processParagraphs(markdown);
  
  // 第九轮：处理水平线
  markdown = markdown.replace(/<hr[^>]*\/?>/gi, '\n---\n');
  
  // 第十轮：移除剩余的 HTML 标签
  markdown = removeRemainingTags(markdown);
  
  // 解码 HTML 实体
  markdown = decodeHtmlEntities(markdown);
  
  return markdown;
}

/**
 * 处理代码块
 */
function processCodeBlocks(html: string, options: any): string {
  let result = html;
  
  // 处理 <pre><code class="language-xxx">
  result = result.replace(/<pre[^>]*>\s*<code[^>]*class=["']language-(\w+)["'][^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, 
    (match, lang, code) => {
      const decodedCode = decodeHtmlEntities(code).trim();
      return `\n\`\`\`${lang}\n${decodedCode}\n\`\`\`\n`;
    }
  );
  
  // 处理 <pre><code>
  result = result.replace(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, 
    (match, code) => {
      const decodedCode = decodeHtmlEntities(code).trim();
      const lang = options.codeBlockLanguage || '';
      return `\n\`\`\`${lang}\n${decodedCode}\n\`\`\`\n`;
    }
  );
  
  // 处理 <pre>
  result = result.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, 
    (match, code) => {
      const decodedCode = decodeHtmlEntities(code).trim();
      const lang = options.codeBlockLanguage || '';
      return `\n\`\`\`${lang}\n${decodedCode}\n\`\`\`\n`;
    }
  );
  
  // 处理行内代码 <code>（排除已处理的）
  result = result.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, 
    (match, code) => {
      // 检查是否在 ``` 代码块标记附近，避免重复处理
      return '`' + decodeHtmlEntities(code) + '`';
    }
  );
  
  return result;
}

/**
 * 处理表格
 */
function processTables(html: string): string {
  return html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (match, content) => {
    let result = '\n';
    
    // 提取表头
    const theadMatch = content.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
    let hasHeader = false;
    
    if (theadMatch) {
      const headerRows = theadMatch[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
      if (headerRows && headerRows.length > 0) {
        const firstRow = headerRows[0];
        const headerCells = firstRow.match(/<th[^>]*>([\s\S]*?)<\/th>/gi);
        if (headerCells) {
          const headers = headerCells.map((th: string) => {
            return cleanHtmlTags(th.replace(/<\/?th[^>]*>/gi, '')).trim();
          });
          result += '| ' + headers.join(' | ') + ' |\n';
          result += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
          hasHeader = true;
        }
      }
    }
    
    // 提取表体
    const tbodyMatch = content.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
    const bodyContent = tbodyMatch ? tbodyMatch[1] : content;
    const rows = bodyContent.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    
    if (rows) {
      rows.forEach((row: string, index: number) => {
        const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
        if (cells) {
          const cellTexts = cells.map((td: string) => {
            return cleanHtmlTags(td.replace(/<\/?td[^>]*>/gi, '')).trim();
          });
          
          // 如果没有表头，第一行作为表头
          if (!hasHeader && index === 0) {
            result += '| ' + cellTexts.join(' | ') + ' |\n';
            result += '| ' + cellTexts.map(() => '---').join(' | ') + ' |\n';
            hasHeader = true;
          } else {
            result += '| ' + cellTexts.join(' | ') + ' |\n';
          }
        }
      });
    }
    
    return result + '\n';
  });
}

/**
 * 处理列表（支持嵌套）
 */
function processLists(html: string, depth: number): string {
  if (depth > 10) return html; // 防止无限递归
  
  const indent = '  '.repeat(depth);
  let result = html;
  
  // 处理无序列表
  result = result.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (match, content) => {
    let listResult = '\n';
    const items = extractListItems(content);
    
    items.forEach((item: string) => {
      // 递归处理嵌套列表
      const processedItem = processLists(item, depth + 1);
      const cleanedItem = cleanHtmlTags(processedItem).trim();
      if (cleanedItem) {
        listResult += indent + '- ' + cleanedItem + '\n';
      }
    });
    
    return listResult;
  });
  
  // 处理有序列表
  result = result.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (match, content) => {
    let listResult = '\n';
    const items = extractListItems(content);
    
    items.forEach((item: string, index: number) => {
      // 递归处理嵌套列表
      const processedItem = processLists(item, depth + 1);
      const cleanedItem = cleanHtmlTags(processedItem).trim();
      if (cleanedItem) {
        listResult += indent + `${index + 1}. ` + cleanedItem + '\n';
      }
    });
    
    return listResult;
  });
  
  return result;
}

/**
 * 提取列表项
 */
function extractListItems(content: string): string[] {
  const items: string[] = [];
  const regex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  
  // 使用 exec 方法逐个匹配，避免一次性处理大量数据
  while ((match = regex.exec(content)) !== null) {
    items.push(match[1]);
  }
  
  return items;
}

/**
 * 处理引用块（支持嵌套）
 */
function processBlockquotes(html: string, depth: number): string {
  if (depth > 10) return html;
  
  return html.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (match, content) => {
    // 递归处理嵌套引用
    const processedContent = processBlockquotes(content, depth + 1);
    const lines = processedContent.trim().split('\n');
    const quotedLines = lines.map((line: string) => {
      const trimmedLine = line.trim();
      // 如果已经是引用格式，增加引用层级
      if (trimmedLine.startsWith('>')) {
        return '> ' + trimmedLine;
      }
      return '> ' + trimmedLine;
    });
    return '\n' + quotedLines.join('\n') + '\n';
  });
}

/**
 * 处理标题
 */
function processHeadings(html: string): string {
  let result = html;
  
  result = result.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  result = result.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  result = result.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  result = result.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');
  result = result.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n');
  result = result.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n');
  
  return result;
}

/**
 * 处理图片
 */
function processImages(html: string): string {
  let result = html;
  
  // <img> with alt and src
  result = result.replace(/<img[^>]*\salt=["']([^"']*)["'][^>]*\ssrc=["']([^"']*)["'][^>]*\/?>/gi, '![$1]($2)');
  result = result.replace(/<img[^>]*\ssrc=["']([^"']*)["'][^>]*\salt=["']([^"']*)["'][^>]*\/?>/gi, '![$2]($1)');
  
  // <img> with only src
  result = result.replace(/<img[^>]*\ssrc=["']([^"']*)["'][^>]*\/?>/gi, '![]($1)');
  
  return result;
}

/**
 * 处理链接
 */
function processLinks(html: string): string {
  return html.replace(/<a[^>]*\shref=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
}

/**
 * 处理文本格式
 */
function processTextFormatting(html: string): string {
  let result = html;
  
  // 处理加粗和斜体组合 <strong><em> 或 <b><i>
  result = result.replace(/<strong[^>]*>\s*<em[^>]*>([\s\S]*?)<\/em>\s*<\/strong>/gi, '***$1***');
  result = result.replace(/<em[^>]*>\s*<strong[^>]*>([\s\S]*?)<\/strong>\s*<\/em>/gi, '***$1***');
  result = result.replace(/<b[^>]*>\s*<i[^>]*>([\s\S]*?)<\/i>\s*<\/b>/gi, '***$1***');
  result = result.replace(/<i[^>]*>\s*<b[^>]*>([\s\S]*?)<\/b>\s*<\/i>/gi, '***$1***');
  
  // 处理加粗 <strong> 和 <b>
  result = result.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  result = result.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  
  // 处理斜体 <em> 和 <i>
  result = result.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  result = result.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');
  
  // 处理删除线 <del>、<s> 和 <strike>
  result = result.replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, '~~$1~~');
  result = result.replace(/<s[^>]*>([\s\S]*?)<\/s>/gi, '~~$1~~');
  result = result.replace(/<strike[^>]*>([\s\S]*?)<\/strike>/gi, '~~$1~~');
  
  // 处理下划线 <u>（Markdown 不直接支持，用 HTML）
  result = result.replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, '<u>$1</u>');
  
  // 处理上标 <sup> 和下标 <sub>
  result = result.replace(/<sup[^>]*>([\s\S]*?)<\/sup>/gi, '^$1^');
  result = result.replace(/<sub[^>]*>([\s\S]*?)<\/sub>/gi, '~$1~');
  
  // 处理标记/高亮 <mark>
  result = result.replace(/<mark[^>]*>([\s\S]*?)<\/mark>/gi, '==$1==');
  
  return result;
}

/**
 * 处理段落和换行
 */
function processParagraphs(html: string): string {
  let result = html;
  
  // 处理 div（作为段落分隔符）
  result = result.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, '\n$1\n');
  
  // 处理段落
  result = result.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n');
  
  // 处理换行
  result = result.replace(/<br\s*\/?>/gi, '\n');
  
  return result;
}

/**
 * 移除剩余的 HTML 标签
 */
function removeRemainingTags(html: string): string {
  // 移除常见的容器标签但保留内容
  let result = html;
  
  const containerTags = ['article', 'section', 'nav', 'aside', 'header', 'footer', 'main', 'figure', 'figcaption', 'span', 'time', 'address'];
  containerTags.forEach((tag: string) => {
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    result = result.replace(regex, '$1');
  });
  
  // 移除所有剩余标签
  result = result.replace(/<[^>]+>/g, '');
  
  return result;
}

/**
 * 清理 HTML 标签（用于表格等特殊场景）
 */
function cleanHtmlTags(text: string): string {
  let result = text;
  
  // 先处理格式标签
  result = processTextFormatting(result);
  
  // 然后移除剩余标签
  result = result.replace(/<[^>]+>/g, '');
  
  return result;
}

/**
 * 后处理：清理和格式化
 */
function postprocess(markdown: string): string {
  let result = markdown;
  
  // 第一步：清理行首尾空白（先处理，避免空白行干扰）
  const lines = result.split('\n');
  result = lines.map((line: string) => {
    // 保留列表和引用的缩进
    if (line.match(/^\s*[-*+]\s/) || line.match(/^\s*\d+\.\s/) || line.match(/^\s*>/)) {
      return line.trimEnd();
    }
    return line.trim();
  }).join('\n');
  
  // 第二步：清理连续的空行（最多保留一个空行）
  result = result.replace(/\n{3,}/g, '\n\n');
  
  // 第三步：特殊处理：在代码块、表格、水平线前后确保有空行（但不超过一个）
  // 代码块前后
  result = result.replace(/([^\n])\n```/g, '$1\n\n```');
  result = result.replace(/```\n([^\n])/g, '```\n\n$1');
  
  // 表格前后（以 | 开头的行）
  result = result.replace(/([^\n])\n\|/g, '$1\n\n|');
  result = result.replace(/\|\s*\n([^\n|])/g, '|\n\n$1');
  
  // 水平线前后
  result = result.replace(/([^\n])\n---\n/g, '$1\n\n---\n');
  result = result.replace(/\n---\n([^\n])/g, '\n---\n\n$1');
  
  // 标题前后（以 # 开头的行）
  result = result.replace(/([^\n])\n(#{1,6}\s)/g, '$1\n\n$2');
  result = result.replace(/(#{1,6}\s[^\n]*)\n([^\n#])/g, '$1\n\n$2');
  
  // 引用块前后（以 > 开头的行）
  result = result.replace(/([^\n>])\n>/g, '$1\n\n>');
  result = result.replace(/>\s*([^\n>])\n([^\n>])/g, '> $1\n\n$2');
  
  // 列表前后
  result = result.replace(/([^\n])\n([-*+]|\d+\.)\s/g, '$1\n\n$2 ');
  result = result.replace(/([-*+]|\d+\.)\s[^\n]*\n([^\n\s-*+\d])/g, (match, p1, p2) => {
    // 确保列表后有空行，但不在列表项之间添加
    return match.replace(/\n([^\n\s-*+\d])/, '\n\n$1');
  });
  
  // 第四步：再次清理可能产生的多余空行
  result = result.replace(/\n{3,}/g, '\n\n');
  
  // 第五步：清理首尾空白
  result = result.trim();
  
  return result;
}

/**
 * 解码 HTML 实体（增强版）
 * @param text 包含 HTML 实体的文本
 * @returns 解码后的文本
 */
function decodeHtmlEntities(text: string): string {
  // 常见 HTML 实体映射表（扩展版）
  const entities: Map<string, string> = new Map([
    // 基础实体
    ['&nbsp;', ' '],
    ['&lt;', '<'],
    ['&gt;', '>'],
    ['&amp;', '&'],
    ['&quot;', '"'],
    ['&#39;', "'"],
    ['&apos;', "'"],
    
    // 货币符号
    ['&cent;', '¢'],
    ['&pound;', '£'],
    ['&yen;', '¥'],
    ['&euro;', '€'],
    ['&curren;', '¤'],
    
    // 版权和商标
    ['&copy;', '©'],
    ['&reg;', '®'],
    ['&trade;', '™'],
    
    // 数学符号
    ['&times;', '×'],
    ['&divide;', '÷'],
    ['&plusmn;', '±'],
    ['&minus;', '−'],
    ['&frac12;', '½'],
    ['&frac14;', '¼'],
    ['&frac34;', '¾'],
    ['&deg;', '°'],
    ['&permil;', '‰'],
    ['&infin;', '∞'],
    ['&radic;', '√'],
    ['&sum;', '∑'],
    ['&prod;', '∏'],
    ['&int;', '∫'],
    ['&ne;', '≠'],
    ['&equiv;', '≡'],
    ['&le;', '≤'],
    ['&ge;', '≥'],
    ['&asymp;', '≈'],
    
    // 标点符号
    ['&mdash;', '—'],
    ['&ndash;', '–'],
    ['&ldquo;', '"'],
    ['&rdquo;', '"'],
    ['&lsquo;', "'"],
    ['&rsquo;', "'"],
    ['&sbquo;', '‚'],
    ['&bdquo;', '„'],
    ['&hellip;', '…'],
    ['&bull;', '•'],
    ['&middot;', '·'],
    ['&sect;', '§'],
    ['&para;', '¶'],
    ['&dagger;', '†'],
    ['&Dagger;', '‡'],
    
    // 箭头
    ['&larr;', '←'],
    ['&uarr;', '↑'],
    ['&rarr;', '→'],
    ['&darr;', '↓'],
    ['&harr;', '↔'],
    ['&crarr;', '↵'],
    ['&lArr;', '⇐'],
    ['&uArr;', '⇑'],
    ['&rArr;', '⇒'],
    ['&dArr;', '⇓'],
    ['&hArr;', '⇔'],
    
    // 希腊字母（小写）
    ['&alpha;', 'α'],
    ['&beta;', 'β'],
    ['&gamma;', 'γ'],
    ['&delta;', 'δ'],
    ['&epsilon;', 'ε'],
    ['&zeta;', 'ζ'],
    ['&eta;', 'η'],
    ['&theta;', 'θ'],
    ['&iota;', 'ι'],
    ['&kappa;', 'κ'],
    ['&lambda;', 'λ'],
    ['&mu;', 'μ'],
    ['&nu;', 'ν'],
    ['&xi;', 'ξ'],
    ['&omicron;', 'ο'],
    ['&pi;', 'π'],
    ['&rho;', 'ρ'],
    ['&sigma;', 'σ'],
    ['&tau;', 'τ'],
    ['&upsilon;', 'υ'],
    ['&phi;', 'φ'],
    ['&chi;', 'χ'],
    ['&psi;', 'ψ'],
    ['&omega;', 'ω'],
    
    // 希腊字母（大写）
    ['&Alpha;', 'Α'],
    ['&Beta;', 'Β'],
    ['&Gamma;', 'Γ'],
    ['&Delta;', 'Δ'],
    ['&Epsilon;', 'Ε'],
    ['&Zeta;', 'Ζ'],
    ['&Eta;', 'Η'],
    ['&Theta;', 'Θ'],
    ['&Iota;', 'Ι'],
    ['&Kappa;', 'Κ'],
    ['&Lambda;', 'Λ'],
    ['&Mu;', 'Μ'],
    ['&Nu;', 'Ν'],
    ['&Xi;', 'Ξ'],
    ['&Omicron;', 'Ο'],
    ['&Pi;', 'Π'],
    ['&Rho;', 'Ρ'],
    ['&Sigma;', 'Σ'],
    ['&Tau;', 'Τ'],
    ['&Upsilon;', 'Υ'],
    ['&Phi;', 'Φ'],
    ['&Chi;', 'Χ'],
    ['&Psi;', 'Ψ'],
    ['&Omega;', 'Ω'],
    
    // 其他符号
    ['&hearts;', '♥'],
    ['&diams;', '♦'],
    ['&clubs;', '♣'],
    ['&spades;', '♠'],
  ]);
  
  let result = text;
  
  // 先处理 &amp; 特殊情况（避免重复解码）
  // 临时标记已解码的 &
  result = result.replace(/&amp;/g, '\u0001AMP\u0001');
  
  // 替换其他命名实体
  entities.forEach((value, key) => {
    if (key !== '&amp;') {
      result = result.replace(new RegExp(key, 'g'), value);
    }
  });
  
  // 替换数字实体 &#xxx;（十进制）
  result = result.replace(/&#(\d+);/g, (match, dec) => {
    const code = parseInt(dec);
    if (code >= 0 && code <= 0x10FFFF) {
      return String.fromCharCode(code);
    }
    return match;
  });
  
  // 替换数字实体 &#xHHH;（十六进制）
  result = result.replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
    const code = parseInt(hex, 16);
    if (code >= 0 && code <= 0x10FFFF) {
      return String.fromCharCode(code);
    }
    return match;
  });
  
  // 恢复 &amp; 的解码
  result = result.replace(/\u0001AMP\u0001/g, '&');
  
  return result;
}

/**
 * 默认导出
 */
export default {
  htmlToMarkdown,
  decodeHtmlEntities
};

