/**
 * 节流函数工具
 * 用于限制函数的执行频率，在指定时间间隔内只执行一次
 */

/**
 * 创建一个节流函数
 * @param func 需要节流的函数
 * @param delay 节流时间间隔（毫秒）
 * @returns 节流后的函数
 *
 * @example
 * const handleClick = throttle(() => {
 *   console.log('点击事件');
 * }, 1000);
 *
 * // 即使快速点击多次，1秒内只会执行一次
 * button.addEventListener('click', handleClick);
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let lastTime = 0;

  return function (this: any, ...args: Parameters<T>) {
    const now = Date.now();

    // 如果距离上次执行时间超过了延迟时间，则执行函数
    if (now - lastTime >= delay) {
      lastTime = now;
      func.apply(this, args);
    }
  };
}

/**
 * 创建一个防抖函数
 * @param func 需要防抖的函数
 * @param delay 防抖时间间隔（毫秒）
 * @returns 防抖后的函数
 *
 * @example
 * const handleInput = debounce((value: string) => {
 *   console.log('搜索:', value);
 * }, 500);
 *
 * // 用户停止输入 500ms 后才会执行
 * input.addEventListener('input', (e) => handleInput(e.target.value));
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let timer: number = 0;

  return function (this: any, ...args: Parameters<T>) {
    // 清除之前的定时器
    if (timer) {
      clearTimeout(timer);
    }

    // 设置新的定时器
    timer = setTimeout(() => {
      func.apply(this, args);
      timer = 0;
    }, delay);
  };
}

/**
 * 创建一个节流函数（立即执行版本）
 * 第一次调用时立即执行，之后在时间间隔内的调用会被忽略
 * @param func 需要节流的函数
 * @param delay 节流时间间隔（毫秒）
 * @returns 节流后的函数
 */
export function throttleImmediate<T extends (...args: any[]) => any>(
  func: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let lastTime = 0;
  let isFirstCall = true;

  return function (this: any, ...args: Parameters<T>) {
    const now = Date.now();

    // 第一次调用立即执行
    if (isFirstCall) {
      isFirstCall = false;
      lastTime = now;
      func.apply(this, args);
      return;
    }

    // 如果距离上次执行时间超过了延迟时间，则执行函数
    if (now - lastTime >= delay) {
      lastTime = now;
      func.apply(this, args);
    }
  };
}
