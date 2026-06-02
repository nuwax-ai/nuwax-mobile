/**
 * 历史消息适配器
 * 将PC端历史会话消息中的自定义HTML标签转换为移动端支持的Markdown容器语法
 * 
 * PC端格式: <div><markdown-custom-process executeId="xxx" type="xxx" status="xxx" name="xxx"></markdown-custom-process></div>
 * 移动端格式: :::container executeId="xxx" type="xxx" status="xxx" name="xxx"\n:::\n
 */

import type { MessageInfo, ProcessingInfo, ExecuteResultInfo } from '@/types/interfaces/conversationInfo'
import { ProcessingEnum } from '@/types/enums/common'
import { AssistantRoleEnum, MessageTypeEnum, AgentComponentTypeEnum } from '@/types/enums/agent'

/**
 * 组件执行列表项接口（来自API返回）
 */
export interface ComponentExecutedItem {
  name: string
  result: {
    executeId: string
    id: number
    name: string
    type: string  // "Plan", "ToolCall", "Skill", "Workflow", "Page", etc.
    startTime: number
    endTime?: number
    success?: boolean
    data?: any
    input?: any
  }
  status: string  // "FINISHED" | "FAILED" | "EXECUTING"
  targetId: number
  type: string  // "Plan", "ToolCall", "Skill", "Workflow", "Page", etc.
}

/**
 * 解析的自定义标签信息
 */
interface ParsedCustomTag {
  executeId: string
  type: string
  status: string
  name: string
  fullMatch: string  // 完整的匹配字符串，用于替换
}

/**
 * 解析PC端的markdown-custom-process HTML标签
 * @param text 包含HTML标签的文本
 * @returns 解析出的标签信息数组
 */
export function parseMarkdownCustomProcess(text: string): ParsedCustomTag[] {
  if (!text) return []
  
  const results: ParsedCustomTag[] = []
  
  // 匹配 <div><markdown-custom-process ...></markdown-custom-process></div> 格式
  // 以及 <markdown-custom-process ...></markdown-custom-process> 格式（无div包裹）
  const regex = /<div>[\s\n]*<markdown-custom-process([^>]*)><\/markdown-custom-process>[\s\n]*<\/div>|<markdown-custom-process([^>]*)><\/markdown-custom-process>/g
  
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    const attrString = match[1] || match[2] || ''
    const fullMatch = match[0]
    
    // 解析属性
    const executeId = extractAttribute(attrString, 'executeId')
    const type = extractAttribute(attrString, 'type')
    const status = extractAttribute(attrString, 'status')
    const name = extractAttribute(attrString, 'name')
    
    if (executeId) {
      results.push({
        executeId,
        type: type || '',
        status: status || '',
        name: name || '',
        fullMatch
      })
    }
  }
  
  return results
}

/**
 * 从属性字符串中提取指定属性的值
 * @param attrString 属性字符串，如 ' executeId="xxx" type="yyy"'
 * @param attrName 属性名
 * @returns 属性值
 */
function extractAttribute(attrString: string, attrName: string): string {
  const regex = new RegExp(`${attrName}="([^"]*)"`)
  const match = attrString.match(regex)
  return match ? match[1] : ''
}

/**
 * 将PC端HTML标签转换为移动端Markdown容器语法
 * @param tag 解析的标签信息
 * @returns Markdown容器语法字符串
 */
export function convertToMobileContainerSyntax(tag: ParsedCustomTag): string {
  const attrs = [
    `executeId="${tag.executeId}"`,
    tag.type ? `type="${tag.type}"` : '',
    tag.status ? `status="${tag.status}"` : '',
    tag.name ? `name="${tag.name}"` : ''
  ].filter(Boolean).join(' ')
  
  return `\n\n:::container ${attrs}\n:::\n\n`
}

/**
 * 解析状态字符串为ProcessingEnum
 * @param status 状态字符串
 * @returns ProcessingEnum值
 */
function parseStatus(status: string): ProcessingEnum {
  switch (status) {
    case 'FINISHED':
      return ProcessingEnum.FINISHED
    case 'FAILED':
      return ProcessingEnum.FAILED
    case 'EXECUTING':
    default:
      return ProcessingEnum.EXECUTING
  }
}

/**
 * 解析组件类型字符串为AgentComponentTypeEnum
 * @param type 类型字符串
 * @returns AgentComponentTypeEnum值
 */
function parseComponentType(type: string): AgentComponentTypeEnum {
  switch (type) {
    case 'Plan':
      return AgentComponentTypeEnum.Plan
    case 'ToolCall':
      return AgentComponentTypeEnum.ToolCall
    case 'Skill':
      return AgentComponentTypeEnum.Skill
    case 'Workflow':
      return AgentComponentTypeEnum.Workflow
    case 'Knowledge':
      return AgentComponentTypeEnum.Knowledge
    case 'Page':
      return AgentComponentTypeEnum.Page
    case 'Plugin':
      return AgentComponentTypeEnum.Plugin
    case 'Event':
      return AgentComponentTypeEnum.Event
    case 'Agent':
      return AgentComponentTypeEnum.Agent
    case 'Mcp':
    case 'MCP':
      return AgentComponentTypeEnum.MCP
    default:
      // 默认返回 ToolCall，因为这是最常见的类型
      return AgentComponentTypeEnum.ToolCall
  }
}

/**
 * 将componentExecutedList转换为processingList
 * @param componentExecutedList 组件执行列表
 * @returns ProcessingInfo数组
 */
export function convertComponentExecutedListToProcessingList(
  componentExecutedList: ComponentExecutedItem[] | null | undefined
): ProcessingInfo[] {
  if (!componentExecutedList || !Array.isArray(componentExecutedList)) {
    return []
  }
  
  return componentExecutedList.map((item): ProcessingInfo => {
    const result = item.result || {}
    const status = parseStatus(item.status)
    const componentType = parseComponentType(item.type)
    
    // 构建ExecuteResultInfo
    const executeResult: ExecuteResultInfo = {
      kind: result?.kind || '',
      id: result.id || -1,
      icon: '',
      name: result.name || item.name || '',
      type: componentType,
      success: result.success ?? (item.status === 'FINISHED'),
      error: '',
      data: result.data || null,
      startTime: result.startTime || 0,
      endTime: result.endTime || 0,
      input: result.input || null
    }
    
    return {
      executeId: result.executeId || '',
      name: item.name || result.name || '',
      type: componentType,
      status: status,
      targetId: item.targetId || result.id || -1,
      result: executeResult,
      cardBindConfig: null as any
    } as ProcessingInfo
  })
}

/**
 * 适配单条历史消息
 * 将PC端格式的自定义标签转换为移动端支持的格式
 * @param message 原始消息
 * @returns 适配后的消息
 */
export function adaptHistoryMessage(message: MessageInfo): MessageInfo {
  if (!message) return message
  
  // 只处理ASSISTANT消息，非ASSISTANT消息确保text有值后直接返回
  if (message.role !== AssistantRoleEnum.ASSISTANT && message.messageType !== MessageTypeEnum.ASSISTANT) {
    // 确保 text 字段有值
    if (message.text === undefined || message.text === null) {
      return { ...message, text: '' }
    }
    return message
  }
  
  let adaptedText = message.text || ''
  let processingList = message.processingList || []
  
  // 1. 从componentExecutedList转换processingList
  const componentExecutedList = (message as any).componentExecutedList as ComponentExecutedItem[] | null
  if (componentExecutedList && componentExecutedList.length > 0) {
    const convertedProcessingList = convertComponentExecutedListToProcessingList(componentExecutedList)
    // 合并已有的processingList（如果有的话）
    processingList = [...processingList, ...convertedProcessingList]
  }
  
  // 2. 解析并转换PC端HTML标签为移动端Markdown容器语法
  const parsedTags = parseMarkdownCustomProcess(adaptedText)
  
  for (const tag of parsedTags) {
    const containerSyntax = convertToMobileContainerSyntax(tag)
    // 替换HTML标签为Markdown容器语法
    adaptedText = adaptedText.replace(tag.fullMatch, containerSyntax)
  }
  
  // 3. 清理多余的空行（超过2个连续换行符的情况）
  adaptedText = adaptedText.replace(/\n{3,}/g, '\n\n')
  
  return {
    ...message,
    text: adaptedText || '',  // 确保 text 始终有值
    processingList
  }
}

/**
 * 批量适配历史消息列表
 * @param messageList 原始消息列表
 * @returns 适配后的消息列表
 */
export function adaptHistoryMessageList(messageList: MessageInfo[]): MessageInfo[] {
  if (!messageList || !Array.isArray(messageList)) {
    return []
  }
  
  return messageList.map(message => adaptHistoryMessage(message))
}
