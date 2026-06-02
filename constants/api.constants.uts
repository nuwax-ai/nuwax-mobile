import { API_BASE_URL } from './config';
import { COMMON_HEADERS ,TEMP_CONVERSATION_CONNECTION_URL,CONVERSATION_CONNECTION_URL} from './common.constants';

// 聊天相关API
export const CHAT_API = {
  // 流式聊天
  STREAM: CONVERSATION_CONNECTION_URL,
  // 临时会话流式聊天
  TEMP_STREAM: TEMP_CONVERSATION_CONNECTION_URL,
}

// 请求头配置
export const API_HEADERS = {
  ...COMMON_HEADERS,
  'Accept': 'application/json, text/plain, */*'
}

// 超时配置
export const API_TIMEOUT = 30000 // 30秒

// 重试配置
export const API_RETRY = {
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000 // 1秒
}
