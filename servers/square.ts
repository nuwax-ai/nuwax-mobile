import { Page, RequestResponse } from '../types/interfaces/request';
import { SquarePublishedListParams, SquarePublishedItemInfo, SquareCategoryInfo } from '../types/interfaces/square';
import request from './useRequest';
import { AgentDetailDto } from '../types/interfaces/agent';

// 广场-已发布智能体列表接口
export async function apiPublishedAgentList(
  data: SquarePublishedListParams,
) {
  return request<RequestResponse<Page<SquarePublishedItemInfo>>>({
    url: '/api/published/agent/list',
    method: 'POST',
    data,
  });
}

// 获取广场分类列表
export async function apiPublishedCategoryList() {
  return request<RequestResponse<SquareCategoryInfo[]>>({
    url: '/api/published/category/list',
    method: 'GET',
  });
}

// 获取已发布的智能体详情
export async function apiSquareAgentDetail(
  agentId: number,
) {
  return request<RequestResponse<AgentDetailDto>>({
    url: `/api/published/agent/${agentId}`,
    method: 'GET',
  });
}
