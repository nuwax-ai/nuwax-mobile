import { AgentComponentTypeEnum } from '../enums/agent';
import type {
  AgentStatisticsInfo,
  CreatorInfo,
} from './agent';

// 智能体分类信息
export interface CategoryInfo {
  name: string;
  type: string;
}

// 智能体分类项详细信息
export interface CategoryItemInfo {
  targetType: AgentComponentTypeEnum;
  targetId: number;
  name: string;
  description: string;
  icon: string;
  statistics: AgentStatisticsInfo;
  publishUser: CreatorInfo;
  collect: boolean;
}

// 主页智能体分类列表
export interface HomeAgentCategoryInfo {
  // 首页分类
  categories: CategoryInfo[];
  // 首页分类数据列表
  categoryItems: {
    [key: string]: CategoryItemInfo[];
  };
}

/**
 * 静态文件相关类型定义
 */
export interface StaticFileInfo {
  // 文件ID(自定义文件ID)
  fileId?: string;
  // 文件名称
  name: string;
  // 是否为二进制文件
  binary: boolean;
  // 文件大小是否超过限制
  sizeExceeded: boolean;
  // 文件内容
  contents: string;
  // 文件代理URL
  fileProxyUrl: string;
  // 是否为目录
  isDir: boolean;
}

// 静态文件列表
export interface StaticFileListResponse {
  // 文件列表
  files: StaticFileInfo[];
}