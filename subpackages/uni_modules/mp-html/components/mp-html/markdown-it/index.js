/**
 * @fileoverview markdown 插件 - uni-app x APP-Android stub
 * 原始 markdown-it 实现见 ./index.h5.js（仅在 H5 / 小程序使用）
 * APP 端 mp-html 走原生 rich-text 渲染分支，不需要这个 markdown 插件
 */
function Markdown(vm) {
  this.vm = vm;
}
Markdown.prototype.onUpdate = function () {};
Markdown.prototype.onParse = function () {};

export default Markdown;
