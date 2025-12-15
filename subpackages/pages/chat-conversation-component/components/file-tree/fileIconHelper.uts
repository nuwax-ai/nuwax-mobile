// 导入所有文件图标
import iconDefault from '@/static/filetree/icon_default.svg'
import iconTsx from '@/static/filetree/icon_tsx.svg'
import iconTs from '@/static/filetree/icon_ts.svg'
import iconJs from '@/static/filetree/icon_js.svg'
import iconCss from '@/static/filetree/icon_css.svg'
import iconJson from '@/static/filetree/icon_json.svg'
import iconHtml from '@/static/filetree/icon_html.svg'
import iconMd from '@/static/filetree/icon_md.svg'
import iconPy from '@/static/filetree/icon_py.svg'
import iconSql from '@/static/filetree/icon_sql.svg'
import iconPng from '@/static/filetree/icon_png.svg'
import iconSvg from '@/static/filetree/icon_svg.svg'

/**
 * 根据文件名获取文件图标路径
 * @param fileName 文件名
 * @returns 图标路径
 */
export function getFileIcon(fileName: string): string {
  if (!fileName || fileName.length === 0) {
    return iconDefault
  }

  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  
  // TypeScript 文件
  if (ext === 'tsx') {
    return iconTsx
  }
  if (ext === 'ts') {
    return iconTs
  }
  
  // JavaScript 文件
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) {
    return iconJs
  }
  
  // CSS 文件
  if (['css', 'less', 'scss', 'sass'].includes(ext)) {
    return iconCss
  }
  
  // JSON 文件
  if (['json', 'jsonc'].includes(ext)) {
    return iconJson
  }
  
  // HTML 文件
  if (['html', 'htm'].includes(ext)) {
    return iconHtml
  }
  
  // Markdown 文件
  if (['md', 'markdown'].includes(ext)) {
    return iconMd
  }
  
  // Python 文件
  if (ext === 'py') {
    return iconPy
  }
  
  // SQL 文件
  if (['sql', 'mysql', 'pgsql'].includes(ext)) {
    return iconSql
  }
  
  // 图片文件
  if (ext === 'png') {
    return iconPng
  }
  if (ext === 'svg') {
    return iconSvg
  }
  if (['jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico', 'tiff'].includes(ext)) {
    return iconPng
  }
  
  // 默认文件图标
  return iconDefault
}

