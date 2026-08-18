/**
 * 按优先级从 processingList 中获取数据
 * 优先级顺序：FINISHED -> FAILED -> EXECUTING
 * @param executeId 执行ID
 * @param processingList 处理列表
 * @param expectedType 当前容器声明的组件类型
 * @returns 按优先级排序后的数据
 */
export const getProcessingDataByPriority = (
  executeId,
  processingList,
  expectedType
) => {
  if (!processingList || !Array.isArray(processingList)) {
    return {};
  }

  // 过滤出匹配 executeId 的项目（统一转字符串：后端 id 常为 number，HTML attrs 为 string）
  // 兼容 executeId / executeid（HTML 标签属性常小写）
  const execKey = executeId != null ? `${executeId}` : "";
  const matchedItems = processingList.filter((item) => {
    if (item == null) return false;
    const raw =
      item.executeId != null
        ? item.executeId
        : item.executeid != null
          ? item.executeid
          : null;
    const itemId = raw != null ? `${raw}` : "";
    return execKey.length > 0 && itemId === execKey;
  });

  if (matchedItems.length === 0) {
    return {};
  }

  const normalizedExpectedType =
    typeof expectedType === "string" ? expectedType.trim().toLowerCase() : "";
  const isExpectedType = (item) => {
    if (!normalizedExpectedType) return false;
    const itemType = `${item?.type || item?.result?.type || ""}`
      .trim()
      .toLowerCase();
    return itemType === normalizedExpectedType;
  };

  // 定义状态优先级（数字越小优先级越高）
  const statusPriority = {
    FINISHED: 1,
    FAILED: 2,
    EXECUTING: 3,
  };

  // 按类型和状态优先级排序，优先匹配当前容器类型，避免同 executeId 的 Event 覆盖 ToolCall
  const sortedItems = matchedItems.sort((a, b) => {
    const typePriorityA = isExpectedType(a) ? 0 : 1;
    const typePriorityB = isExpectedType(b) ? 0 : 1;
    if (typePriorityA !== typePriorityB) {
      return typePriorityA - typePriorityB;
    }

    const priorityA = statusPriority[a.status] || 999;
    const priorityB = statusPriority[b.status] || 999;
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }

    const eventPriorityA =
      `${a?.type || a?.result?.type || ""}` === "Event" ? 1 : 0;
    const eventPriorityB =
      `${b?.type || b?.result?.type || ""}` === "Event" ? 1 : 0;
    return eventPriorityA - eventPriorityB;
  });

  // 返回优先级最高的项目
  return sortedItems[0] || {};
};
