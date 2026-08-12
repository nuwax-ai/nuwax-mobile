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
const MATH_EX_PX = 8
function init () {
  _ad = liteAdaptor()
  RegisterHTMLHandler(_ad)
  _doc = mathjax.document('', {
    InputJax: new TeX({ packages: AllPackages }),
    OutputJax: new SVG({ fontCache: 'local' })
  })
}
// MathJax 的 viewBox 使用内部字形坐标（约 442 units/ex），不是 CSS 像素。
// AndroidSVG 不解析 ex 时会退回 viewBox 尺寸，导致短公式也生成接近 1600px 的位图。
// bundle 已以 ex=8 渲染，因此在跨原生边界前把根节点尺寸显式归一为 px。
function normalizeRootCssSize (svg) {
  const rootEnd = svg.indexOf('>')
  if (rootEnd < 0) return svg
  let root = svg.slice(0, rootEnd + 1)
  root = root.replace(/\bwidth="([\d.]+)ex"/, (_, value) => {
    return `width="${Number(value) * MATH_EX_PX}px"`
  })
  root = root.replace(/\bheight="([\d.]+)ex"/, (_, value) => {
    return `height="${Number(value) * MATH_EX_PX}px"`
  })
  return root + svg.slice(rootEnd + 1)
}
// 单条 LaTeX → 自包含 SVG 字符串。display=true 块级、false 行内。
function renderLatexToSvg (latex, display) {
  if (!_doc) init()
  const node = _doc.convert(latex, { display: display !== false, em: 16, ex: 8, containerWidth: 1000 })
  return normalizeRootCssSize(_ad.innerHTML(node))
}
// 批量（一次调用多条，摊薄 QuickJS 边界开销）
function renderLatexToSvgBatch (list, display) {
  return list.map((s) => renderLatexToSvg(s, display))
}
// QuickJS 无 module.exports；挂 globalThis
globalThis.renderLatexToSvg = renderLatexToSvg
globalThis.renderLatexToSvgBatch = renderLatexToSvgBatch
