import { RequestResponse } from '@/types/interfaces/request';
import { ConversationChatSuggestParams, ConversationCreateParams, ConversationInfo, ConversationListParams } from '@/types/interfaces/conversationInfo';
import { AgentConversationUpdateParams } from '@/types/interfaces/agent';
import request from '@/servers/useRequest';

// 查询会话
export async function apiAgentConversation(
  conversationId: number,
){
  return request<RequestResponse<ConversationInfo>>({
    url: `/api/agent/conversation/${conversationId}`,
    method: 'POST',
  });
}

// 停止会话
// 停止会话
export async function apiAgentConversationChatStop(
  conversationId: string,
) {
  return request<RequestResponse<null>>({
    url: `/api/agent/conversation/chat/stop/${conversationId}`,
    method: 'POST',
  });
}

// 根据用户消息更新会话主题
export async function apiAgentConversationUpdate(
  data: AgentConversationUpdateParams,
) {
  return request<RequestResponse<ConversationInfo>>({
    url: '/api/agent/conversation/update',
    method: 'POST',
    data,
  });
}

// 查询用户历史会话
export async function apiAgentConversationList(
  data: ConversationListParams,
) {
  return request<RequestResponse<ConversationInfo[]>>({
    url: '/api/agent/conversation/list',
    method: 'POST',
    data,
  });
}

// 删除会话
export async function apiAgentConversationDelete(
  conversationId: number,
) {
  return request<RequestResponse<null>>({
    url: `/api/agent/conversation/delete/${conversationId}`,
    method: 'POST',
  });
}

// 创建会话
export async function apiAgentConversationCreate(
  data: ConversationCreateParams,
) {
  return request<RequestResponse<ConversationInfo>>({
    url: '/api/agent/conversation/create',
    method: 'POST',
    data,
  });
}

// 智能体会话问题建议
export async function apiAgentConversationChatSuggest(
  data: ConversationChatSuggestParams,
) {
  return request<RequestResponse<string[]>>({
    url: '/api/agent/conversation/chat/suggest',
    method: 'POST',
    data,
  });
}

// 查询临时会话详细
export async function apiTempChatConversationQuery(
  data: TempConversationQueryDto,
) {
  return request<RequestResponse<ConversationInfo>>({
    url: '/api/temp/chat/conversation/query',
    method: 'POST',
    data,
  });
}

// 创建临时会话
export async function apiTempChatConversationCreate(
  data: TempConversationCreateDto,
) {
  return request<RequestResponse<ConversationInfo>>({
    url: '/api/temp/chat/conversation/create', 
    method: 'POST',
    data,
  });
}

// 临时消息会话
export async function apiTempChatCompletions(
  data: TempChatCompletionsParams,
) {
  return request<RequestResponse<ConversationChatResponse>>({
    url: '/api/temp/chat/completions',
    method: 'POST',
    data,
  });
}

// 停止临时会话
export async function apiTempChatConversationStop(
  requestId: string,
) {
  return request<RequestResponse<null>>({
    url: `/api/temp/chat/conversation/${requestId}`,
    method: 'POST',
  });
}