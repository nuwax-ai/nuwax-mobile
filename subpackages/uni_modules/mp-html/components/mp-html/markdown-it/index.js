/**
 * @fileoverview markdown 插件（全平台）
 * Include markdown-it (https://github.com/markdown-it/markdown-it)
 */
import MarkdownIt from "markdown-it";
import markdownItContainer from "markdown-it-container";

let index = 0;

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: false,
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
        if (key && value !== undefined) {
          acc[key] = value.replace(/^"|"$/g, "");
        }
        return acc;
      }, {}) || {};
    if (tokens[idx].nesting === 1) {
      return `<container data=${JSON.stringify(data)}>`;
    } else {
      return `</container>`;
    }
  },
});

md.use(markdownItContainer, "container-group", {
  validate: function (params) {
    return params.trim().match(/^\s*container-group\s*(.*)$/);
  },
  render: function (tokens, idx) {
    if (tokens[idx].nesting === 1) {
      return `<container-group>`;
    } else {
      return `</container-group>`;
    }
  },
});

md.use(markdownItContainer, "task-result", {
  validate: function (params) {
    return params.trim().match(/^task-result\b/);
  },
  render: function (tokens, idx) {
    if (tokens[idx].nesting === 1) {
      return "<task-result>";
    } else {
      return "</task-result>";
    }
  },
});

function Markdown(vm) {
  this.vm = vm;
  vm._ids = {};
}

Markdown.prototype.onUpdate = function (content) {
  if (this.vm.markdown) {
    content = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    content = content.replace(
      /\*\*([^*]+)\*\*([，。！？；：])/g,
      "**$1**&#8203;$2"
    );
    return md.render(content);
  }
};

Markdown.prototype.onParse = function (node, vm) {
  if (vm.options.markdown) {
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
      // APP 仅支持 flex/none，表格滚动由 md-table 样式类处理
      if (node.name === "table") {
        node.f = "display:flex;flex-direction:column;overflow:hidden";
      }
      node.attrs.class = `md-${node.name} ${node.attrs.class || ""}`;
    }
  }
};

export default Markdown;
