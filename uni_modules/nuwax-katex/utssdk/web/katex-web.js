/**
 * nuwax-katex H5 桥：封装内置 KaTeX。
 * uts 侧只传原始参数（字符串/布尔），options 对象在此 JS 侧拼装，避免 UTS 对象与 JS 对象互转问题。
 */
// katex.min.js 为 UMD 包：import 执行即挂载 window.katex。
// 直接用 window.katex 而非 import 的 namespace 兜底——Vite 对 UMD 的 namespace 互操作会拿到
// 损坏/分离的 KaTeX 实例（renderToString 全部返回 katex-error），而 window.katex 是原始全局实例。
import './katex.min.js'
const katex = window.katex

export default {
  /**
   * 渲染 LaTeX → HTML 字符串（v-html 使用）
   * @param {string} tex 原始 LaTeX
   * @param {boolean} displayMode 块级/行内
   * @param {string} errorColor 错误兜底颜色
   * @returns {string} KaTeX HTML
   */
  renderToString(tex, displayMode, errorColor) {
    try {
      return katex.renderToString(String(tex == null ? '' : tex), {
        displayMode: displayMode === true,
        throwOnError: false,
        errorColor: typeof errorColor === 'string' && errorColor.length > 0 ? errorColor : '#cc0000',
        output: 'html',
        strict: false,
      })
    } catch (err) {
      // throwOnError:false 下 renderToString 基本不抛错，这里兜底返回转义后的原文
      const raw = String(tex == null ? '' : tex)
      return `<span class="katex-error">${raw.replace(/[<>&"]/g, (c) => ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
      })[c])}</span>`
    }
  },
}
