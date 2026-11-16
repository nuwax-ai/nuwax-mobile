import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/uni_modules/uni-ai-x/sdk/proxy-web.uts", () => ({
  default: { callMethod: vi.fn(), isReady: () => true },
}));
vi.mock("@/uni_modules/uni-ai-x/sdk/parseCode.uts", () => ({
  parseLineCode: vi.fn((callback, _source, language) => {
    callback({ tokens: [], language, error: "unsupported language" });
  }),
}));

import { parseAppMarkdownFallback } from "@/subpackages/components/ai-msg/appMarkdownFallback.uts";
import { replaceMathBracket } from "@/utils/markdown.uts";
import proxyWeb from "@/uni_modules/uni-ai-x/sdk/proxy-web.uts";
import { mapMarkdownOutsideCodeFences } from "@/utils/markdownCodeFence.uts";

function parseCode(source: string, language = "yaml", closed = true) {
  const items = parseAppMarkdownFallback(
    "```" + language + "\n" + source + (closed ? "\n```" : ""),
    () => {},
  );
  expect(items).toHaveLength(1);
  expect(items[0].type).toBe("code_block");
  return items[0].datasList[0][0];
}

function renderedCode(token: ReturnType<typeof parseCode>): string {
  return token.codeTokens!.map(row => row.map(part => part.text).join("")).join("\n");
}

beforeEach(() => vi.clearAllMocks());

describe("Agent YAML 代码块原文保真", () => {
  it("保留中文、emoji、缩进、空行、HTML 实体和反斜杠", () => {
    const source = String.raw`# 女娲配置 🤖
app:
  name: "中文助手"
  path: 'C:\\new\\config.yaml'

  pattern: '\\[中文\\]'
  html: '<div>&amp; &#x4E2D;</div>'`;
    const token = parseCode(source);
    expect(token.text).toBe(source);
    expect(renderedCode(token)).toBe(source);
  });

  it.each(["yaml", "yml", "ymal", "YAML", "text"])("%s 内的 $$ 保持在原行，不被拆成公式", language => {
    const source = 'password: "$$nuwax$$"\ncommand: "echo $$ && echo $$"';
    const token = parseCode(source, language);
    expect(token.text).toBe(source);
    expect(renderedCode(token)).toBe(source);
    expect(proxyWeb.callMethod).not.toHaveBeenCalled();
  });

  it("流式未闭合的 YAML 也不被公式预处理改写", () => {
    const source = 'password: "$$nuwax$$"\n  name: "中文 🤖"';
    const token = parseCode(source, "yaml", false);
    expect(token.text).toBe(source);
    expect(renderedCode(token)).toBe(source);
  });

  it("YAML 多行字符串中的数学定界符和换行不被修复", () => {
    const source = 'prompt: |\n  $\nabla$\n  \\[\neq\\]\n  `\\alpha`';
    const token = parseCode(source);
    expect(token.text).toBe(source);
    expect(renderedCode(token)).toBe(source);
  });

  it("H5 公式定界符替换同样跳过代码块", () => {
    const code = '```yaml\npattern: "\\[中文\\]"\n```';
    expect(replaceMathBracket(code)).toBe(code);
    expect(replaceMathBracket("正文 \\(x\\)\n\n" + code)).toBe("正文 $x$\n\n" + code);
  });

  it("代码块之外的公式仍正常解析", () => {
    const items = parseAppMarkdownFallback('正文公式 $$x^2$$ 完成\n\n```yaml\nname: 女娲\n```', () => {});
    expect(items.some(item => item.type == "math")).toBe(true);
    expect(items.find(item => item.type == "code_block")?.datasList[0][0].text).toBe("name: 女娲");
    expect(proxyWeb.callMethod).toHaveBeenCalledTimes(1);
  });

  it("兼容 Windows 换行，不向代码行混入回车", () => {
    const token = parseCode('name: 女娲\r\n  enabled: true');
    expect(token.text).toBe('name: 女娲\n  enabled: true');
    expect(renderedCode(token)).toBe(token.text);
  });
});

describe("代码围栏边界", () => {
  it.each(["```", "````", "~~~"])("保护 %s 围栏并继续处理后续正文", fence => {
    const code = fence + 'yaml\npattern: "\\[中文\\]"\n' + fence;
    expect(replaceMathBracket('公式 \\(x\\)\n' + code + '\n公式 \\[y\\]')).toBe(
      '公式 $x$\n' + code + '\n公式 $$y$$',
    );
  });

  it("代码字符串中的反引号和过短围栏不会提前结束保护", () => {
    const code = '````yaml\ntext: "```"\n```\npassword: "$$nuwax$$"\n````\n';
    expect(mapMarkdownOutsideCodeFences(code + "body", text => text.toUpperCase())).toBe(code + "BODY");
    expect(replaceMathBracket(code)).toBe(code);
  });

  it("多段代码中的内容分别保留，围栏外仍能转换公式", () => {
    const a = '```yaml\npattern: "\\[中文\\]"\n```\n';
    const b = '```ymal\ncommand: "echo $HOME"\n```\n';
    expect(replaceMathBracket(a + '公式 \\(x\\)\n' + b)).toBe(a + '公式 $x$\n' + b);
  });
});
