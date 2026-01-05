// 完整类型定义
export interface LoadingProps {
  color?: string;
  type: 'circular' | 'spinner' | 'failed';
  // #ifndef APP
  size?: string;
  // #endif
  // #ifdef APP
  size: string;
  // #endif
  text?: string;
  textColor?: string;
  textSize?: string;
  mode: 'raf' | 'animate';
  vertical: boolean;
  animated: boolean;
}
