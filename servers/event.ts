/**
 * 事件轮询 API 服务
 * 用于 batch 轮询获取服务端推送事件
 * 
 * 与 PC 端 @/services/event.ts 保持一致
 */
import request from './useRequest';
import { EventTypeEnum } from '@/types/enums/event';

/**
 * 事件列表项
 */
interface EventListItem {
  event: any;
  type: EventTypeEnum;
}

/**
 * 事件收集响应
 */
export interface ApiCollectEventResponse {
  hasEvent: boolean;
  eventList: EventListItem[];
  version?: string; // 版本号
}

/**
 * 轮询获取事件
 */
export async function apiCollectEvent(): Promise<ApiCollectEventResponse> {
  return request<ApiCollectEventResponse>({
    url: '/api/notify/event/collect/batch',
    method: 'GET',
  });
}

/**
 * 清除事件
 */
export async function apiClearEvent(): Promise<any> {
  return request({
    url: '/api/notify/event/clear',
    method: 'GET',
  });
}
