// DOM-free MathJax (TeX→SVG) 入口，用于 esbuild 打包成单文件 IIFE 给 QuickJS 运行。
// 关键：用 liteAdaptor（无 DOM 依赖），SVG 输出 fontCache:'local'（字形内嵌，自包含）。
// 打包命令见 regen.sh；打包产物 mathjax-tex-svg.js 由 UTS QuickJS 插件加载。
const { mathjax } = require('mathjax-full/js/mathjax.js')
const { TeX } = require('mathjax-full/js/input/tex.js')
const { SVG } = require('mathjax-full/js/output/svg.js')
const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js')
const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js')
const { AllPackages } = require('mathjax-full/js/input/tex/AllPackages.js')

let _doc = null, _ad = null
function init () {
  _ad = liteAdaptor()
  RegisterHTMLHandler(_ad)
  _doc = mathjax.document('', {
    InputJax: new TeX({ packages: AllPackages }),
    OutputJax: new SVG({ fontCache: 'local' })
  })
}
// 单条 LaTeX → 自包含 SVG 字符串。display=true 块级、false 行内。
function renderLatexToSvg (latex, display) {
  if (!_doc) init()
  const node = _doc.convert(latex, { display: display !== false, em: 16, ex: 8, containerWidth: 1000 })
  return _ad.innerHTML(node)
}
// 批量（一次调用多条，摊薄 QuickJS 边界开销）
function renderLatexToSvgBatch (list, display) {
  return list.map((s) => renderLatexToSvg(s, display))
}
// QuickJS 无 module.exports；挂 globalThis
globalThis.renderLatexToSvg = renderLatexToSvg
globalThis.renderLatexToSvgBatch = renderLatexToSvgBatch
