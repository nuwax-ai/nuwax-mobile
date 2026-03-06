/**
 * @fileoverview highlight 插件
 * Include prismjs (https://prismjs.com)
 */
import prism from "./prism.min";
import config from "./config";
import Parser from "../parser";

function Highlight(vm) {
  this.vm = vm;
}

Highlight.prototype.onParse = function (node, vm) {
  if (node.name === "pre") {
    if (vm.options.editable) {
      node.attrs.class = (node.attrs.class || "") + " hl-pre";
      return;
    }
    let i;
    for (i = node.children.length; i--; ) {
      if (node.children[i].name === "code") break;
    }
    if (i === -1) return;
    const code = node.children[i];
    let className = code.attrs.class + " " + node.attrs.class;
    i = className.indexOf("language-");
    if (i === -1) {
      i = className.indexOf("lang-");
      if (i === -1) {
        className = "language-text";
        i = 9;
      } else {
        i += 5;
      }
    } else {
      i += 9;
    }
    let j;
    for (j = i; j < className.length; j++) {
      if (className[j] === " ") break;
    }
    const lang = className.substring(i, j);
    if (code.children.length) {
      const text = this.vm.getText(code.children).replace(/&amp;/g, "&");
      if (!text) return;
      // #ifndef H5
      // 非 H5 平台：将 pre 节点标记为 c=1，并调用 vm.expose() 向上传播，
      // 强制整个祖先链使用递归渲染，确保 pre 运在任何嵌套层级中都能被独立渲染
      node.c = 1;
      vm.expose();
      // #endif
      // #ifdef H5
      if (node.c) {
        node.c = undefined;
      }
      // #endif
      if (prism.languages[lang]) {
        code.children = new Parser(this.vm).parse(
          // 加一层 pre 保留空白符
          "<pre>" +
            prism
              .highlight(text, prism.languages[lang], lang)
              .replace(/token /g, "hl-") +
            "</pre>"
        )[0].children;
      }
      node.attrs.class = "hl-pre";
      code.attrs.class = "hl-code";
      // Create hl-body wrapper
      const hlBody = {
        name: "div",
        attrs: { class: "hl-body" },
        children: []
      };

      // Create inner hl-container for stretching
      const hlContainer = {
        name: "div",
        attrs: { class: "hl-container" },
        children: []
      };

      if (config.showLineNumber) {
        const line = text.split("\n").length;
        const children = [];
        for (let k = 1; k <= line; k++) {
          children.push({
            name: "div",
            attrs: { class: "span" },
            children: [{ type: "text", text: String(k) }],
          });
        }
        hlContainer.children.push({
          name: "div",
          attrs: { class: "line-numbers-rows" },
          children,
        });
      }
      
      code.name = "div";
      hlContainer.children.push(code);
      hlBody.children.push(hlContainer);
      node.children = [];

      if (config.showLanguageName) {
        const langChildren = [{ type: "text", text: lang }];
        // #ifdef H5
        // H5: 复制按钮放入 rich-text 内部，通过 srcElement.dataset 实现点击复制
        langChildren.push({
          name: "div",
          attrs: {
            class: "hl-copy-btn",
            "data-content": text,
            "data-action": "copy",
          },
          children: [{ type: "text", text: "复制代码" }],
        });
        // #endif
        // #ifndef H5
        // 非 H5 平台：将代码文本存储到节点上，由 node.vue 渲染真实的可交互复制按钮
        node._copyText = text;
        // #endif
        node.children.push({
          name: "div",
          attrs: {
            class: "hl-language",
          },
          children: langChildren,
        });
      }

      if (config.copyByLongPress) {
        node.attrs.style += (node.attrs.style || "") + ";user-select:none";
        // node.attrs["data-content"] = text;
        // vm.expose();
      }

      node.children.push(hlBody);
    }
  }
};

export default Highlight;
