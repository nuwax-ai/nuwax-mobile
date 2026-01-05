/**
 * @fileoverview markdown 插件
 * Include markdown-it (https://github.com/markdown-it/markdown-it)
 * Include github-markdown-css (https://github.com/sindresorhus/github-markdown-css)
 */
import MarkdownIt from "markdown-it";
import markdownItContainer from "markdown-it-container";
let index = 0;

// 初始化 markdown-it 实例
const md = new MarkdownIt({
  html: true, // 允许 HTML 标签
  linkify: true, // 自动将 URL 转换为链接
  typographer: true, // 启用智能排版
  breaks: false, // 将换行符转换为 <br> 标签
  langPrefix: "language-",
});

md.use(markdownItContainer, "container", {
  validate: function (params) {
    return params.trim().match(/^\s*container\s+(.*)$/);
  },
  render: function (tokens, idx) {
    var m = tokens[idx].info.trim().match(/^container\s+(.*)$/);
    const data =
      m?.[1]?.split(" ").reduce((acc, item) => {
        const [key, value] = item.split("=");
        // 防止 value 为 undefined 导致 replace 调用失败
        if (key && value !== undefined) {
          acc[key] = value.replace(/^"|"$/g, "");
        }
        return acc;
      }, {}) || {};
    if (tokens[idx].nesting === 1) {
      // opening tag
      return `<container data=${JSON.stringify(data)}>`;
    } else {
      // closing tag
      return `</container>`;
    }
  },
});
function Markdown(vm) {
  this.vm = vm;
  vm._ids = {};
}

Markdown.prototype.onUpdate = function (content) {
  if (this.vm.markdown) {
    // 解决中文标点符号后粗体失效的问题，增加零宽空格
    content = content.replace(
      /\*\*([^*]+)\*\*([，。！？；：])/g,
      "**$1**&#8203;$2"
    );
    const result = md.render(content);
    return result;
  }
};

Markdown.prototype.onParse = function (node, vm) {
  if (vm.options.markdown) {
    // 中文 id 需要转换，否则无法跳转
    if (
      vm.options.useAnchor &&
      node.attrs &&
      /[\u4e00-\u9fa5]/.test(node.attrs.id)
    ) {
      const id = "t" + index++;
      this.vm._ids[node.attrs.id] = id;
      node.attrs.id = id;
    }

    if (
      [
        "p",
        "table",
        "tr",
        "th",
        "td",
        "blockquote",
        "pre",
        "hr",
        "code",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
      ].includes(node.name)
    ) {
      if (node.name === "table") node.f = "overflow-x: auto;display:block";
      node.attrs.class = `md-${node.name} ${node.attrs.class || ""}`;
    }
  }
};

export default Markdown;
