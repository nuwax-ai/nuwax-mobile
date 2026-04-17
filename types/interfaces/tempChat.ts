// import React from 'react';
import { AgentSelectedComponentInfo } from './agent';
import { AttachmentFile } from './conversationInfo';
/**
 * 查询临时会话详细输入参数
 */
export interface TempConversationQueryDto {
  // 链接Key
  chatKey: string;
  // 会话唯一标识
  conversationUid?: string;
}

/**
 * 创建临时会话输入参数
 */
export interface TempConversationCreateDto {
  // 链接Key
  chatKey: string;
  // 验证码参数
  captchaVerifyParam?: string;
}

/**
 * TempChatMessage
 */
export interface TempChatCompletionsParams {
  // 附件列表
  attachments?: AttachmentFile[];
  // 链接Key
  chatKey: string;
  // 会话唯一标识
  conversationUid: number;
  // chat消息
  message?: string;
  selectedComponents?: AgentSelectedComponentInfo[];
  // 变量参数，前端需要根据agent配置组装参数
  variableParams?: {
    [key: string]: any;
  };
}
