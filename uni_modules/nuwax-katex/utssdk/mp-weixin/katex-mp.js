/**
 * nuwax-katex 小程序桥：KaTeX → HTML → 关键 CSS 内联 → rich-text 可直接渲染的 HTML 字符串。
 *
 * 背景：小程序 rich-text 只认内联 style / 页面 wxss；uni-app x 组件样式带作用域，
 * 无法稳定命中 rich-text 内部节点，故把 KaTeX 布局关键样式直接内联进每个节点
 * （与 lime-katex 的「KaTeX.js → rich-text」同级别方案）。
 *
 * 已知限制（readme 说明）：小程序无 KaTeX 字体，\mathcal/\mathbb 等回退系统字体；
 * 超大定界符走 SVG（rich-text 不支持 svg 标签）会缺失，属平台限制。
 */
import katex from './katex.min.js'

// ---- KaTeX 字号缩放表（katex.min.css size1=1em 起）----
const KATEX_SIZE = [0, 1, 1.2, 1.4, 1.6, 1.8, 2, 2.4, 2.88, 3.456, 4.148, 4.976]

// ---- 关键样式规则表 ----
// classes:        元素同时含有全部类名时应用
// parentClasses:  子标签规则（parentClasses + childTag [+ childClasses]）
// grandParentClasses: 孙子标签规则（grandParentClasses + parentTag + childTag）
const RULES = [
  // 根与隐藏 mathml（必须：否则富文本里公式重复/错乱）
  { classes: ['katex'], css: 'font-family:serif;font-size:1.21em;line-height:1.2;text-indent:0;text-rendering:auto;' },
  { classes: ['katex-mathml'], css: 'position:absolute;clip:rect(1px,1px,1px,1px);border:0;height:1px;width:1px;overflow:hidden;padding:0;' },
  { parentClasses: ['katex-html'], childTag: 'span', childClasses: ['newline'], css: 'display:block;' },
  // 基线盒
  { classes: ['base'], css: 'position:relative;white-space:nowrap;display:inline-block;' },
  { classes: ['strut'], css: 'display:inline-block;' },
  // 字体族（无 KaTeX 字体时回退系统字体；粗/斜保留）
  { classes: ['textbf'], css: 'font-weight:700;' },
  { classes: ['textit'], css: 'font-style:italic;' },
  { classes: ['textrm'], css: 'font-family:serif;' },
  { classes: ['textsf'], css: 'font-family:sans-serif;' },
  { classes: ['texttt'], css: 'font-family:monospace;' },
  { classes: ['mathnormal'], css: 'font-family:serif;font-style:italic;' },
  { classes: ['mathit'], css: 'font-family:serif;font-style:italic;' },
  { classes: ['mathrm'], css: 'font-style:normal;' },
  { classes: ['mathbf'], css: 'font-family:serif;font-weight:700;' },
  { classes: ['boldsymbol'], css: 'font-family:serif;font-style:italic;font-weight:700;' },
  { classes: ['amsrm', 'mathbb', 'textbb'], css: 'font-family:serif;' },
  { classes: ['mathcal'], css: 'font-family:cursive;' },
  { classes: ['mathfrak', 'textfrak'], css: 'font-family:serif;' },
  { classes: ['mathboldfrak', 'textboldfrak'], css: 'font-family:serif;font-weight:700;' },
  { classes: ['mathtt'], css: 'font-family:monospace;' },
  { classes: ['mathscr', 'textscr'], css: 'font-family:cursive;' },
  { classes: ['mathsf', 'textsf'], css: 'font-family:sans-serif;' },
  { classes: ['mathboldsf', 'textboldsf'], css: 'font-family:sans-serif;font-weight:700;' },
  { classes: ['mathitsf', 'mathsfit', 'textitsf'], css: 'font-family:sans-serif;font-style:italic;' },
  { classes: ['mainrm'], css: 'font-family:serif;font-style:normal;' },
  // 垂直堆叠（分数/上下标核心布局）
  { classes: ['vlist-t'], css: 'display:inline-table;table-layout:fixed;border-collapse:collapse;' },
  { classes: ['vlist-t2'], css: 'margin-right:-2px;' },
  { classes: ['vlist-r'], css: 'display:table-row;' },
  { classes: ['vlist'], css: 'display:table-cell;position:relative;vertical-align:bottom;' },
  { parentClasses: ['vlist'], childTag: 'span', css: 'display:block;height:0;position:relative;' },
  { grandParentClasses: ['vlist'], parentTag: 'span', childTag: 'span', css: 'display:inline-block;' },
  { classes: ['pstrut'], css: 'overflow:hidden;width:0;' },
  { classes: ['vlist-s'], css: 'display:table-cell;font-size:1px;min-width:2px;vertical-align:bottom;width:2px;' },
  { classes: ['vbox'], css: 'display:inline-flex;flex-direction:column;align-items:baseline;' },
  { classes: ['hbox'], css: 'display:inline-flex;flex-direction:row;' },
  { classes: ['thinbox'], css: 'display:inline-flex;flex-direction:row;max-width:0;width:0;' },
  { classes: ['msupsub'], css: 'text-align:left;' },
  // 分数线 / 根号线 / 上下划线
  { classes: ['frac-line'], css: 'display:inline-block;width:100%;min-height:1px;border-bottom-style:solid;' },
  { classes: ['overline-line', 'underline-line', 'hline'], css: 'display:inline-block;width:100%;min-height:1px;border-bottom-style:solid;' },
  { classes: ['hdashline'], css: 'display:inline-block;width:100%;min-height:1px;border-bottom-style:dashed;' },
  { classes: ['rule'], css: 'display:inline-block;position:relative;min-height:1px;border-style:solid;' },
  { grandParentClasses: ['mfrac'], parentTag: 'span', childTag: 'span', css: 'text-align:center;' },
  // 间距 / 行内盒子
  { classes: ['mspace'], css: 'display:inline-block;' },
  { classes: ['mord', 'mop', 'mbin', 'mrel', 'mopen', 'mclose', 'mpunct', 'minner'], css: 'display:inline-block;' },
  // 叠置（\stackrel/\overset 等）
  { classes: ['clap', 'llap', 'rlap'], css: 'position:relative;width:0;' },
  { parentClasses: ['llap', 'clap', 'rlap'], childTag: 'span', childClasses: ['inner'], css: 'position:absolute;' },
  { parentClasses: ['llap'], childTag: 'span', childClasses: ['inner'], css: 'right:0;' },
  { parentClasses: ['clap', 'rlap'], childTag: 'span', childClasses: ['inner'], css: 'left:0;' },
  { grandParentClasses: ['clap'], parentTag: 'span', childTag: 'span', css: 'margin-left:-50%;margin-right:50%;' },
  { parentClasses: ['clap', 'llap', 'rlap'], childTag: 'span', childClasses: ['fix'], css: 'display:inline-block;' },
  // 定界符 / 上下限 / 重音
  { classes: ['nulldelimiter'], css: 'display:inline-block;width:.12em;' },
  { classes: ['delimcenter', 'op-symbol'], css: 'position:relative;' },
  { parentClasses: ['accent', 'op-limits'], childTag: 'span', childClasses: ['vlist-t'], css: 'text-align:center;' },
  { classes: ['accent-body'], css: 'position:relative;' },
  { classes: ['overlay'], css: 'display:block;' },
  // 矩阵 / 阵列
  { classes: ['vertical-separator'], css: 'display:inline-block;min-width:1px;border-style:solid;' },
  { classes: ['arraycolsep'], css: 'display:inline-block;' },
  { parentClasses: ['col-align-c'], childTag: 'span', childClasses: ['vlist-t'], css: 'text-align:center;' },
  { parentClasses: ['col-align-l'], childTag: 'span', childClasses: ['vlist-t'], css: 'text-align:left;' },
  { parentClasses: ['col-align-r'], childTag: 'span', childClasses: ['vlist-t'], css: 'text-align:right;' },
  { classes: ['svg-align'], css: 'text-align:left;' },
  { classes: ['mover', 'munder', 'x-arrow'], css: 'text-align:center;' },
  { classes: ['stretchy', 'hide-tail'], css: 'display:block;overflow:hidden;position:relative;width:100%;' },
  // 方框 / 删除线
  { classes: ['boxpad'], css: 'padding:0 .3em;' },
  { classes: ['fbox', 'fcolorbox'], css: 'border:.04em solid;box-sizing:border-box;' },
  { classes: ['sout'], css: 'border-bottom-style:solid;border-bottom-width:.08em;' },
  { classes: ['cancel-pad'], css: 'padding:0 .2em;' },
  { classes: ['cancel-lap'], css: 'margin-left:-.2em;margin-right:-.2em;' },
  // 块级（displayMode）
  { classes: ['katex-display'], css: 'display:block;text-align:center;margin:0;' },
  { parentClasses: ['katex-display'], childTag: 'span', childClasses: ['katex'], css: 'display:block;text-align:center;white-space:nowrap;' },
  { grandParentClasses: ['katex-display'], parentTag: 'span', childTag: 'span', css: 'display:block;position:relative;' },
]

// ---- 运行时生成字号缩放规则：.sizing/.fontsize-ensurer.reset-sizeN.sizeM ----
function buildSizingRules() {
  const rules = []
  for (let n = 1; n <= 11; n++) {
    for (let m = 1; m <= 11; m++) {
      const em = Math.round((KATEX_SIZE[m] / KATEX_SIZE[n]) * 1e10) / 1e10
      const css = 'font-size:' + em + 'em;'
      rules.push({ classes: ['sizing', 'reset-size' + n, 'size' + m], css: css })
      rules.push({ classes: ['fontsize-ensurer', 'reset-size' + n, 'size' + m], css: css })
    }
  }
  return rules
}
RULES.push.apply(RULES, buildSizingRules())

// ---- HTML 工具 ----

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
    return c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;'
  })
}

function escapeAttr(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function hasClass(clsList, cls) {
  return clsList.indexOf(cls) > -1
}

function matchClasses(nodeClasses, required) {
  for (let i = 0; i < required.length; i++) {
    if (!hasClass(nodeClasses, required[i])) return false
  }
  return true
}

/**
 * 合并样式：规则中已存在于内联 style 的属性不覆盖（保留 KaTeX 内联布局值，如 top/height/宽度）。
 */
function mergeStyle(inline, css) {
  const props = {}
  if (inline) {
    const parts = inline.split(';')
    for (let i = 0; i < parts.length; i++) {
      const kv = parts[i].split(':')
      if (kv.length >= 2) {
        props[kv[0].trim()] = kv.slice(1).join(':').trim()
      }
    }
  }
  if (css) {
    const parts = css.split(';')
    for (let i = 0; i < parts.length; i++) {
      const kv = parts[i].split(':')
      if (kv.length >= 2) {
        const name = kv[0].trim()
        if (!(name in props)) {
          props[name] = kv.slice(1).join(':').trim()
        }
      }
    }
  }
  const out = []
  for (const name in props) {
    out.push(name + ':' + props[name])
  }
  return out.join(';')
}

/** 解析标签属性，返回 { attrs, end }（end 指向 '>' 或 '/>' 的 '/'） */
function parseAttrs(html, start) {
  const attrs = {}
  const n = html.length
  let end = start
  while (end < n && html[end] !== '>') {
    if (html[end] === '/' && html[end + 1] === '>') {
      end++
      break
    }
    end++
  }
  const seg = html.slice(start, end)
  const re = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g
  let m
  while ((m = re.exec(seg)) !== null) {
    const val = m[3] != null ? m[3] : m[4] != null ? m[4] : m[5] != null ? m[5] : ''
    attrs[m[1].toLowerCase()] = val
  }
  return { attrs: attrs, end: end }
}

function splitClassList(cls) {
  if (!cls) return []
  return cls.split(/\s+/).filter(function (c) {
    return c.length > 0
  })
}

const VOID_TAGS = { br: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1 }

/** 主函数：把 KaTeX HTML 内联关键样式（供 rich-text 渲染） */
function inlineKatexStyles(html) {
  let out = ''
  const stack = [] // { tag, classes }
  let i = 0
  const n = html.length
  while (i < n) {
    const lt = html.indexOf('<', i)
    if (lt < 0) {
      out += html.slice(i)
      break
    }
    out += html.slice(i, lt) // 文本原样透传
    if (html[lt + 1] === '!') {
      // 注释/doctype
      const gt = html.indexOf('>', lt)
      if (gt < 0) break
      out += html.slice(lt, gt + 1)
      i = gt + 1
      continue
    }
    const closing = html[lt + 1] === '/'
    let tagStart = lt + 1
    if (closing) tagStart = lt + 2
    let j = tagStart
    while (j < n && !/[\s/>]/.test(html[j])) j++
    const tag = html.slice(tagStart, j)
    if (closing) {
      const gt = html.indexOf('>', j)
      if (gt < 0) break
      out += html.slice(lt, gt + 1)
      if (stack.length > 0) stack.pop()
      i = gt + 1
      continue
    }
    const parsed = parseAttrs(html, j)
    const classes = splitClassList(parsed.attrs['class'])
    let style = parsed.attrs['style'] || ''

    // 1) 类规则
    for (let r = 0; r < RULES.length; r++) {
      const rule = RULES[r]
      if (rule.classes && !rule.parentClasses && matchClasses(classes, rule.classes)) {
        style = mergeStyle(style, rule.css)
      }
    }
    // 2) 父级规则（直接子标签）
    if (stack.length > 0) {
      const parent = stack[stack.length - 1]
      for (let r = 0; r < RULES.length; r++) {
        const rule = RULES[r]
        if (rule.parentClasses && !rule.grandParentClasses) {
          if (tag === rule.childTag && (!rule.childClasses || matchClasses(classes, rule.childClasses)) && matchClasses(parent.classes, rule.parentClasses)) {
            style = mergeStyle(style, rule.css)
          }
        }
      }
      // 3) 祖级规则（孙子标签）
      if (stack.length > 1) {
        const grand = stack[stack.length - 2]
        for (let r = 0; r < RULES.length; r++) {
          const rule = RULES[r]
          if (rule.grandParentClasses && tag === rule.childTag && parent.tag === rule.parentTag && matchClasses(grand.classes, rule.grandParentClasses)) {
            style = mergeStyle(style, rule.css)
          }
        }
      }
    }

    // 组装输出
    let attrsOut = ''
    for (const name in parsed.attrs) {
      if (name === 'class' || name === 'style') continue
      attrsOut += ' ' + name + '="' + escapeAttr(parsed.attrs[name]) + '"'
    }
    const classOut = classes.length > 0 ? ' class="' + classes.join(' ') + '"' : ''
    const styleOut = style.length > 0 ? ' style="' + style + '"' : ''
    out += '<' + tag + classOut + styleOut + attrsOut + '>'

    const selfClose = html[parsed.end] === '/' || VOID_TAGS[tag] != null
    if (!selfClose) {
      stack.push({ tag: tag, classes: classes })
    }
    i = parsed.end + 1
  }
  return out
}

// ---- 对外接口 ----
export default {
  /**
   * 渲染 LaTeX → rich-text 可用的 HTML（已内联关键样式）
   */
  renderToRichTextHtml(tex, displayMode, errorColor) {
    let html
    try {
      html = katex.renderToString(String(tex == null ? '' : tex), {
        displayMode: displayMode === true,
        throwOnError: false,
        errorColor: typeof errorColor === 'string' && errorColor.length > 0 ? errorColor : '#cc0000',
        output: 'html',
        strict: false,
      })
    } catch (err) {
      return escapeHtml(tex)
    }
    return inlineKatexStyles(html)
  },
}
