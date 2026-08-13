/**
 * mp-html node 层 OpenUI 纯函数（从 node.vue 抽出，降低通用 node 侵入）。
 * Vue 方法只做 this 绑定薄包装；卡片 UI 用 openui-card.vue。
 */
import {
  isOpenUiRenderToolName,
  extractOpenUiArtifactInfo,
  extractOpenUiArtifactFromProcessingListByExecuteId,
} from '@/utils/openUiSchema.uts'

/** container 的 attrs 在 data 上，其余过程标签在 attrs。 */
export function openuiAttrsOfNode (n) {
  const attrs = (n && n.attrs) || {}
  if (n && n.name === 'container') {
    return attrs.data != null ? attrs.data : attrs
  }
  return attrs
}

/**
 * @param n 过程节点
 * @param getRenderData (attrs) => merged attrs+processingList
 */
export function openuiToolNameOfNode (n, getRenderData) {
  const attrs = openuiAttrsOfNode(n)
  const resolved = typeof getRenderData === 'function' ? getRenderData(attrs) : attrs
  return `${(resolved && resolved.name) || (attrs && attrs.name) || ''}`
}

/**
 * 是否展示 OpenUI 原位卡。
 * 终态以 processingList 合并后的 status / artifact 为准。
 */
export function isOpenUiProcessNode (n, getRenderData, processingList) {
  if (n == null) {
    return false
  }
  if (n.name !== 'container' && n.name !== 'markdown-custom-process') {
    return false
  }
  const name = openuiToolNameOfNode(n, getRenderData)
  if (isOpenUiRenderToolName(name) == false) {
    return false
  }
  const attrs = openuiAttrsOfNode(n) || {}
  const resolved = typeof getRenderData === 'function' ? getRenderData(attrs) : attrs
  const status = `${(resolved && resolved.status) || (attrs && attrs.status) || ''}`.toUpperCase()
  const info = openuiInfoOfNode(n, getRenderData, processingList)
  const artifactId = info != null ? info.artifactId : ''
  if (artifactId) {
    return true
  }
  // FINISHED/FAILED 无产物：不展示假 pending
  if (status === 'FINISHED' || status === 'FAILED') {
    return false
  }
  return true
}

export function openuiInfoOfNode (n, getRenderData, processingList) {
  const attrs = openuiAttrsOfNode(n)
  const resolved = typeof getRenderData === 'function' ? getRenderData(attrs) : attrs
  const name = `${(resolved && resolved.name) || (attrs && attrs.name) || ''}`
  if (isOpenUiRenderToolName(name) == false) {
    return null
  }
  const exact = extractOpenUiArtifactInfo(resolved && resolved.result, name)
  if (exact != null) {
    return exact
  }
  const execId = `${(resolved && (resolved.executeId || resolved.executeid)) || (attrs && (attrs.executeId || attrs.executeid)) || ''}`
  return extractOpenUiArtifactFromProcessingListByExecuteId(processingList, execId)
}

export function openuiArtifactIdOfNode (n, getRenderData, processingList) {
  const info = openuiInfoOfNode(n, getRenderData, processingList)
  return info != null ? info.artifactId : ''
}

export function openuiTitleOfNode (n, getRenderData, processingList) {
  const info = openuiInfoOfNode(n, getRenderData, processingList)
  return info != null ? info.title : ''
}

export function openuiIsPendingOfNode (n, getRenderData, processingList) {
  return !openuiArtifactIdOfNode(n, getRenderData, processingList)
}

/**
 * 子节点是否会产生可见 UI（供空壳 p 判定）。
 * OpenUI 仅在 isOpenUiProcessNode 为真时可见；否则 container 会藏掉。
 */
export function childNodeHasVisibleContent (n, getRenderData, processingList) {
  if (n == null) {
    return false
  }
  if (n.type === 'text') {
    const text = n.text != null ? `${n.text}` : ''
    return text.trim().length > 0
  }
  const name = n.name != null ? `${n.name}` : ''
  if (name === 'br' || name === 'img' || name === 'video' || name === 'audio' || name === 'hr') {
    return true
  }
  if (name === 'markdown-custom-process' || name === 'container') {
    if (isOpenUiProcessNode(n, getRenderData, processingList)) {
      return true
    }
    const toolName = openuiToolNameOfNode(n, getRenderData)
    if (isOpenUiRenderToolName(toolName)) {
      return false
    }
    return true
  }
  if (
    name === 'markdown-custom-process-group' ||
    name === 'container-group' ||
    name === 'task-result'
  ) {
    return true
  }
  const nested = n.children
  if (nested != null && Array.isArray(nested) && nested.length > 0) {
    for (let i = 0; i < nested.length; i++) {
      if (childNodeHasVisibleContent(nested[i], getRenderData, processingList)) {
        return true
      }
    }
    return false
  }
  return false
}

/** 空壳段落：仅 p，且无可见子。 */
export function isBlockShellEmpty (tagName, children, getRenderData, processingList) {
  const tag = tagName != null ? `${tagName}` : ''
  if (tag !== 'p') {
    return false
  }
  const kids = children != null && Array.isArray(children) ? children : []
  if (kids.length === 0) {
    return true
  }
  for (let i = 0; i < kids.length; i++) {
    if (childNodeHasVisibleContent(kids[i], getRenderData, processingList)) {
      return false
    }
  }
  return true
}
