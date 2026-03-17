import type { AgentStatisticsInfo, CreatorInfo } from './agent';

// 已收藏的技能列表接口 - 参数接口
export interface SkillListForAtParams {
  /*目标类型，Agent,Plugin,Workflow,可用值:Agent,Plugin,Workflow,Knowledge,Table,Skill */
  targetType?: string;

  /*子类型,可用值:Multi,Single,WorkflowChat,ChatBot,TaskAgent,Agent,PageApp */
  targetSubType?: string;

  /*页码 */
  page?: number;

  /*每页数量 */
  pageSize?: number;

  /*分类名称 */
  category?: string;

  /*关键字搜索 */
  kw?: string;

  /*空间ID（可选）需要通过空间过滤时有用 */
  spaceId?: number;

  /*只返回空间的组件 */
  justReturnSpaceData?: boolean;

  /*访问控制过滤，0 无需过滤，1 过滤出需要权限管控的内容 */
  accessControl?: number;

  /*是否只返回官方标识的内容 */
  official?: boolean;
}

// 技能信息
export interface SkillInfoForAt {
  id: number;
  tenantId: number;
  spaceId: number;
  targetType: string;
  targetId: number;
  name: string;
  description: string;
  icon: string;
  remark: string;
  modified: string;
  created: string;
  statistics: AgentStatisticsInfo;
  publishUser: CreatorInfo;
  category: string;
  allowCopy: number;
  accessControl: number;
  pluginType: string;
  agentType: string;
  coverImg: string;
  coverImgSourceType: string;
  collect: boolean;
}
