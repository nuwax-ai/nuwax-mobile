// @ts-nocheck
export interface BadgeProps {
  /**
   * 颜色
   * @default ''
   */
  color?: string;
  /**
   * 徽标内容
   */
  // #ifndef APP-ANDROID
  content?: string|number;
  // #endif
  // #ifdef APP-ANDROID
  content?: any;
  // #endif
  /**
   * 是否为红点
   */
  dot: boolean;
  /**
   * 封顶的数字值
   * @default 99
   */
  max: number;
  /**
   * 设置状态点的位置偏移，示例：[-10, 20] 或 ['10rpx', '8rpx']
   */
  // #ifndef APP-ANDROID
  offset?: Array<string | number>;
  // #endif
  // #ifdef APP-ANDROID
  offset?: any[];
  // #endif
  position: string;
  /**
   * 形状 未实现
   * @default circle
   */
  shape?: 'circle' | 'square' | 'bubble' | 'ribbon';
  /**
   * 当数值为 0 时，是否展示徽标
   */
  showZero: boolean;
  /**
   * 尺寸 未实现
   * @default medium
   */
  size?: 'medium' | 'large';
}
