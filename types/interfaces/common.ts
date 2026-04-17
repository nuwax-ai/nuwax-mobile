import type {
  AgentComponentTypeEnum,
  OptionDataSourceEnum,
} from '../enums/agent';
import type {
  BindValueType,
  InputTypeEnum,
  UploadFileStatus,
} from '../enums/common';
import { DataTypeEnum } from '../enums/common';
import type {
  AgentManualComponentInfo,
  AgentSelectedComponentInfo,
} from './agent';

/**
 * 定义键值对接口，用于表示具有标签和值的对象。
 */
export interface KeyValuePairs {
  // 键值对的标签
  label: string;
  // 键值对对应的值
  value: string;
}

// 级联选项类型
export interface CascaderOption {
  value?: string | number | null;
  // label?: React.ReactNode;
  children?: CascaderOption[];
  disabled?: boolean;
  disableCheckbox?: boolean;
}

/**
 * 定义 Child 接口，用于描述子节点的数据结构。
 */
export interface Child {
  // 子节点标题
  title: string;
  // 子节点显示的图像路径
  // icon: string | React.ReactNode; // 直接使用 SVGProps
  // 唯一标识符
  key: string;
  // 子节点的类型，可能用于区分不同种类的节点
  type: string;
  // 节点的内容，可能是纯文本或键值对数组
  content: string | KeyValuePairs[];
  // 描述
  desc?: string;
  // 节点宽度，可选
  width?: number;
  // 节点高度，可选
  height?: number;
  // 标记该节点是否可以作为父节点嵌套其他节点，可选
  isParent?: boolean;
  // 节点背景颜色，可选
  backgroundColor?: string;
  // 没有操作栏
  noPopover?: boolean;
}

// 插件的单个内容
export interface PlugInItem {
  // 名称
  label: string;
  desc: string;
  id: string;
  // 子选项
  children: PlugInItem[];
}

// 上传文件信息
export interface UploadFileInfo {
  url: string;
  name: string;
  type: string;
  key?: string;
  size: number;
  width?: number;
  height?: number;
  percent?: number;
  status?: UploadFileStatus;
  uid?: string;
  response?: any;
}

// 查询特定数量输入参数
export interface ListParams {
  size: number;
  pageIndex?: number;
  // 关键字搜索
  keyword?: string;
}

// 手动选择组件属性
export interface ManualComponentItemProps {
  // 可手动选择的组件列表
  manualComponents?: AgentManualComponentInfo[];
  selectedComponentList?: AgentSelectedComponentInfo[];
  onSelectComponent?: (infos: AgentSelectedComponentInfo) => void;
}

// 变量下拉参数配置
export interface VariableSelectConfig {
  // 数据源类型,可用值:MANUAL,PLUGIN
  dataSourceType: OptionDataSourceEnum;
  // 数据源类型,可用值:Agent,Plugin,Workflow,Knowledge,Table
  targetType: AgentComponentTypeEnum;
  // 插件或工作流ID，dataSource选择PLUGIN时有用
  targetId: number;
  // 插件或工作流名称
  targetName: string;
  // 插件或工作流描述
  targetDescription: string;
  // 插件或工作流图标
  targetIcon: string;
  // 下拉选项配置
  options: CascaderOption[];
}

export interface BindConfigWithSub {
  // key: React.Key;
  // 参数名称，符合函数命名规则
  name: string;
  // 参数展示名称，供前端展示使用
  displayName: string;
  // 参数详细描述信息
  description: string;
  // 数据类型
  dataType?: DataTypeEnum;
  // 是否必须
  require?: boolean;
  // 是否为开启，如果不开启，插件使用者和大模型均看不见该参数；如果bindValueType为空且require为true时，该参数必须开启
  enable?: boolean;
  // 是否为系统内置变量参数，内置变量前端只可展示不可修改
  systemVariable?: boolean;
  // 值引用类型，Input 输入；Reference 变量引用,可用值:Input,Reference
  bindValueType?: BindValueType;
  // 参数值，当类型为引用时，示例 1.xxx 绑定节点ID为1的xxx字段；当类型为输入时，该字段为最终使用的值
  bindValue?: string;
  // 输入类型, Http插件有用,可用值:Query,Body,Header,Path
  inputType?: InputTypeEnum;
  subArgs?: BindConfigWithSub[];
  // 下拉参数配置
  selectConfig?: VariableSelectConfig;
  loopId?: number;
  children?: BindConfigWithSub[];
  [key: string]: any;
}

// 菜单列表项
export interface MenuListItem {
  label: string;
  value: string | number | null;
  icon?: string | null;
  disabled?: boolean;
  onClick?: (value: string | number | null) => void;
}
