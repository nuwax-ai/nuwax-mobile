import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import MarkdownIt from "markdown-it";
import { replaceMathBracket } from "@/utils/markdown.uts";

const { renderMath } = vi.hoisted(() => ({
  renderMath: vi.fn((latex: string) => [{ type: "text", text: "FORMULA(" + latex + ")" }]),
}));
vi.mock("@/subpackages/uni_modules/mp-html/components/mp-html/latex/katex.min", () => ({
  default: { default: renderMath },
}));

let Parser: any;
let Highlight: any;
let Latex: any;
const markdown = new MarkdownIt();

beforeAll(async () => {
  Object.assign(uni, {
    canIUse: () => false,
    getSystemInfoSync: () => ({ windowWidth: 375, system: "Android" }),
  });
  Parser = (await import("@/subpackages/uni_modules/mp-html/components/mp-html/parser.js")).default;
  Highlight = (await import("@/subpackages/uni_modules/mp-html/components/mp-html/highlight/index.js")).default;
  Latex = (await import("@/subpackages/uni_modules/mp-html/components/mp-html/latex/index.js")).default;
});

beforeEach(() => vi.clearAllMocks());

function textOf(nodes: any[]): string {
  return nodes.map(node => node.type == "text" ? node.text.replace(/&amp;/g, "&") : textOf(node.children ?? [])).join("");
}

function render(source: string) {
  const vm: any = { nodes: [], imgList: [], plugins: [], getText: textOf };
  vm.plugins = [new Highlight(vm), new Latex()];
  return new Parser(vm).parse(markdown.render(replaceMathBracket(source)));
}

function codeNode(nodes: any[]): any {
  for (const node of nodes) {
    if (node.attrs?.class == "hl-code") return node;
    const child = codeNode(node.children ?? []);
    if (child != null) return child;
  }
  return null;
}

describe("App 内嵌 H5 的 Markdown → mp-html → 公式/高亮链路", () => {
  it.each(["yaml", "yml", "ymal", "YAML", "unknown", "javascript"])("%s 代码块内的美元符和中文保持原文", language => {
    const source = 'name: "女娲 🤖"\npassword: "$$nuwax$$"\ncommand: "echo $HOME and $PATH"\npattern: "\\[中文\\]"';
    const nodes = render("```" + language + "\n" + source + "\n```");
    expect(textOf(codeNode(nodes).children).trimEnd()).toBe(source);
    expect(renderMath).not.toHaveBeenCalled();
  });

  it("行内代码不解析公式，正文中的公式继续渲染", () => {
    const nodes = render('`echo $HOME and $PATH`\n\n正文公式 $x^2$。');
    expect(textOf(nodes)).toContain('echo $HOME and $PATH');
    expect(renderMath).toHaveBeenCalledTimes(1);
    expect(renderMath).toHaveBeenCalledWith("x^2");
  });

  it("ymal 流式未闭合时也保留 YAML 引用、缩进和多行字符串", () => {
    const source = String.raw`# 中文配置 🤖
$schema: "https://example.test/schema.json"
app:
  $ref: "#/definitions/助手"
  prompt: |
    使用 \\[方括号\\] 和 <中文标签>
    保留 &amp; 与 &#x4E2D;

  enabled: true`;
    const nodes = render("```ymal\n" + source);
    expect(textOf(codeNode(nodes).children).trimEnd()).toBe(source);
    expect(renderMath).not.toHaveBeenCalled();
  });
});
