// @ts-nocheck
export interface TabPanelProps {
  /**
   * 透传至 Badge 组件
   */
  badge?: any;
  offset?: any[];
  dot?: boolean;
  /**
   * 选项卡内容隐藏时是否销毁
   */
  destroyOnHide?: boolean;
  /**
   * 是否禁用当前选项卡
   */
  disabled?: boolean;
  /**
   * 选项卡名称，可自定义选项卡导航内容
   */
  label?: string;
  /**
   * 是否启用选项卡懒加载
   */
  lazy?: boolean;
  /**
   * 选项卡的值，唯一标识
   */
  value?: number;
}

