/**
 * 事件总线封装
 * 
 * 对外提供与 PC 端一致的 API：on / off / emit / once
 * 内部使用 uni-app x 原生事件系统：uni.$on / uni.$off / uni.$emit / uni.$once
 * 
 * 参考文档：https://doc.dcloud.net.cn/uni-app-x/api/event-bus.html
 */

type EventCallback = (...args: any[]) => void;

/**
 * 事件总线类
 * 封装 uni-app 原生事件 API，提供统一接口
 */
class EventBus {
  /**
   * 订阅事件
   * @param eventName 事件名称
   * @param callback 回调函数
   */
  on(eventName: string, callback: EventCallback): void {
    uni.$on(eventName, callback);
  }

  /**
   * 取消订阅事件
   * @param eventName 事件名称
   * @param callback 回调函数
   */
  off(eventName: string, callback: EventCallback): void {
    uni.$off(eventName, callback);
  }

  /**
   * 发布事件
   * @param eventName 事件名称
   * @param args 参数
   */
  emit(eventName: string, ...args: any[]): void {
    uni.$emit(eventName, ...args);
  }

  /**
   * 一次性订阅事件（触发一次后自动取消）
   * @param eventName 事件名称
   * @param callback 回调函数
   */
  once(eventName: string, callback: EventCallback): void {
    uni.$once(eventName, callback);
  }
}

// 创建全局事件总线实例
const eventBus = new EventBus();

export default eventBus;

// 定义常用的事件名称常量（与 PC 端保持一致）
export const EVENT_NAMES = {
  // 发送聊天消息事件
  SEND_CHAT_MESSAGE: 'send_chat_message',
  // 清空聊天输入框事件
  CLEAR_CHAT_INPUT: 'clear_chat_input',
} as const;
