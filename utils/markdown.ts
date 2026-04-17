
const defaultDelimiters = [
  { left: '\\[', right: '\\]', display: true },
  { left: '\\(', right: '\\)', display: false },
];

// 转义括号规则 - 通用数学公式解析器
function escapedBracketRule(delimiters: any) {
  return (text: string, startPos: number = 0) => {
    const max = text.length;
    const start = startPos;

    for (const { left, right, display } of delimiters) {
      // 检查是否以左标记开始
      if (!text.slice(start).startsWith(left)) continue;

      // 跳过左标记的长度
      let pos = start + left.length;

      // 寻找匹配的右标记
      while (pos < max) {
        if (text.slice(pos).startsWith(right)) {
          break;
        }
        pos++;
      }

      // 没找到匹配的右标记，跳过，进入下个匹配
      if (pos >= max) continue;

      // 提取数学公式内容
      const content = text.slice(start + left.length, pos);
      const endPos = pos + right.length;

      return {
        formula: content,
        display,
        start,
        end: endPos,
        left,
        right,
        success: true,
      };
    }

    return {
      formula: '',
      display: false,
      start: 0,
      end: 0,
      left: '',
      right: '',
      success: false,
    };
  };
}

// 新的数学公式替换函数 - 直接替换为 $$ 分隔符
export function replaceMathBracket(text: string): string {
  // return text; //临时关闭

  // 创建只包含非美元符号分隔符的选项
  const nonDollarDelimiters = defaultDelimiters.filter(
    (delimiter) =>
      !delimiter.left.includes('$') && !delimiter.right.includes('$'),
  );

  const rule = escapedBracketRule(nonDollarDelimiters);
  let result = '';
  let pos = 0;

  while (pos < text.length) {
    const match = rule(text, pos);
    if (match.success) {
      // 添加匹配前的文本
      result += text.slice(pos, match.start);
      // 替换为 $$ 分隔符
      const delimiter = match.display ? '$$' : '$';
      result += `${delimiter}${match.formula}${delimiter}`;
      pos = match.end;
    } else {
      // 没有匹配，添加当前字符
      result += text[pos];
      pos++;
    }
  }

  return result;
}