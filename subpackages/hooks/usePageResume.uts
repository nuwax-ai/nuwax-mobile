/**
 * 页面唤醒检测 Hook
 * 
 * 用于检测页面从后台恢复到前台的场景，适配 H5 和小程序
 * 
 * 使用场景：
 * - H5：页面切换到后台（visibilitychange）或切换标签页时触发
 * - 小程序：需要配合 onShow/onHide 生命周期使用
 * 
 * 使用方式：
 * ```typescript
 * const { isHidden, cleanup } = usePageResume({
 *   onResume: () => {
 *     console.log('页面恢复');
 *     // 执行恢复逻辑
 *   },
 *   onHide: () => {
 *     console.log('页面进入后台');
 *   }
 * });
 * 
 * // 在 onUnmounted 中调用 cleanup()
 * ```
 */
import { ref, onMounted, onUnmounted } from 'vue';

export interface PageResumeOptions {
  /** 页面恢复时的回调 */
  onResume: () => void;
  /** 页面进入后台时的回调（可选） */
  onHide?: () => void;
  /** 最小隐藏时间（毫秒），超过此时间才触发恢复回调，默认 3000ms */
  minHiddenDuration?: number;
}

export interface PageResumeResult {
  /** 页面是否处于隐藏状态 */
  isHidden: Ref<boolean>;
  /** 页面隐藏时间戳 */
  hiddenTimestamp: Ref<number>;
  /** 清理函数，用于移除事件监听 */
  cleanup: () => void;
  /** 手动触发恢复检测（用于小程序 onShow） */
  triggerResume: () => void;
  /** 手动触发隐藏检测（用于小程序 onHide） */
  triggerHide: () => void;
}

/**
 * 页面唤醒检测 Hook
 */
export function usePageResume(options: PageResumeOptions): PageResumeResult {
  const { onResume, onHide, minHiddenDuration = 3000 } = options;
  
  // 页面是否隐藏
  const isHidden = ref<boolean>(false);
  // 页面隐藏时间戳
  const hiddenTimestamp = ref<number>(0);
  // 是否已初始化
  let isInitialized = false;

  /**
   * 处理页面隐藏
   */
  const handleHide = (): void => {
    console.log('[PageResume] 页面进入后台');
    isHidden.value = true;
    hiddenTimestamp.value = Date.now();
    onHide?.();
  };

  /**
   * 处理页面恢复
   */
  const handleResume = (): void => {
    if (!isHidden.value) {
      return;
    }

    const now = Date.now();
    const hiddenDuration = now - hiddenTimestamp.value;

    console.log(`[PageResume] 页面恢复，隐藏时长: ${hiddenDuration}ms`);

    // 只有隐藏时间超过阈值才触发恢复回调
    if (hiddenDuration >= minHiddenDuration) {
      console.log('[PageResume] 超过最小隐藏时长，触发恢复回调');
      onResume();
    }

    // 重置状态
    isHidden.value = false;
    hiddenTimestamp.value = 0;
  };

  /**
   * H5 visibilitychange 事件处理
   */
  const handleVisibilityChange = (): void => {
    // #ifdef H5 || WEB
    if (document.hidden) {
      handleHide();
    } else {
      handleResume();
    }
    // #endif
  };

  /**
   * 初始化监听
   */
  const init = (): void => {
    if (isInitialized) {
      return;
    }

    // #ifdef H5 || WEB
    document.addEventListener('visibilitychange', handleVisibilityChange);
    console.log('[PageResume] H5 visibilitychange 监听已初始化');
    // #endif

    isInitialized = true;
  };

  /**
   * 清理监听
   */
  const cleanup = (): void => {
    // #ifdef H5 || WEB
    if (isInitialized) {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      console.log('[PageResume] H5 visibilitychange 监听已移除');
    }
    // #endif

    isInitialized = false;
    isHidden.value = false;
    hiddenTimestamp.value = 0;
  };

  // 在组件挂载时初始化
  onMounted(() => {
    init();
  });

  // 在组件卸载时清理
  onUnmounted(() => {
    cleanup();
  });

  return {
    isHidden,
    hiddenTimestamp,
    cleanup,
    // 手动触发（用于小程序）
    triggerResume: handleResume,
    triggerHide: handleHide,
  };
}

export default usePageResume;
