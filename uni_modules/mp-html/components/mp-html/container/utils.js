/**
 * 按优先级从 processingList 中获取数据
 * 优先级顺序：FINISHED -> FAILED -> EXECUTING
 * @param executeId 执行ID
 * @param processingList 处理列表
 * @returns 按优先级排序后的数据
 */
export const getProcessingDataByPriority = (executeId, processingList) => {
  if (!processingList || !Array.isArray(processingList)) {
    return {};
  }

  // 过滤出匹配 executeId 的项目
  const matchedItems = processingList.filter(
    (item) => item.executeId === executeId
  );

  if (matchedItems.length === 0) {
    return {};
  }

  // 定义状态优先级（数字越小优先级越高）
  const statusPriority = {
    FINISHED: 1,
    FAILED: 2,
    EXECUTING: 3,
  };

  // 按优先级排序，优先级高的在前
  const sortedItems = matchedItems.sort((a, b) => {
    const priorityA = statusPriority[a.status] || 999;
    const priorityB = statusPriority[b.status] || 999;
    return priorityA - priorityB;
  });

  // 返回优先级最高的项目
  return sortedItems[0] || {};
};
