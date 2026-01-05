/**
 * 工具调用容器辅助函数
 * 用于生成和管理工具调用相关的自定义容器块
 */

/**
 * 生成 markdown 自定义容器块
 * @param blockName 容器块名称
 * @param data 属性数据
 * @returns 格式化的容器块字符串
 */
export function getBlockWrapper(blockName: string, data: Record<string, any>): string {
  const attrs = Object.entries(data)
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ");

  // 修复DOM嵌套验证错误：使用div代替p标签，因为自定义组件包含块级元素
  return `\n\n:::${blockName} ${attrs}\n:::\n\n`;
}

/**
 * 获取容器块名称
 * @returns 容器块名称
 */
export function getBlockName(): string {
  return `container`;
}

/**
 * 生成工具调用自定义块
 * @param beforeText 之前的文本内容
 * @param toolCallData 工具调用数据
 * @returns 包含自定义块的完整文本
 */
export function getCustomBlock(
  beforeText: string,
  toolCallData: { type?: string; name?: string; executeId?: string; status?: string }
): string {
  const { type, executeId } = toolCallData;
  
  // 如果 type 或 executeId 不存在，则返回原文本
  if (!type || !executeId) {
    return beforeText;
  }

  const blockName = getBlockName();
  const hasBlock = beforeText.includes(`executeId="${executeId}"`);

  if (hasBlock) {
    // 如果已经存在相同的执行ID，则不重复添加
    return beforeText;
  }

  const blockContent = getBlockWrapper(blockName, {
    executeId,
    type,
    status: toolCallData.status || "",
    name: toolCallData.name || "",
  });

  return `${beforeText}${blockContent}`;
}

