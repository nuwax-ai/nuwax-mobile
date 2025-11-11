/**
 * 异步操作重试工具函数
 * @param {Function} asyncFn - 需要重试的异步函数
 * @param {Object} options - 重试配置选项
 * @param {number} options.maxRetries - 最大重试次数 (默认: 3)
 * @param {number} options.delay - 重试延迟时间(ms) (默认: 1000)
 * @param {string} options.backoffStrategy - 退避策略 ('fixed' | 'exponential' | 'linear') (默认: 'fixed')
 * @param {number} options.backoffFactor - 退避因子 (默认: 2)
 * @param {Function} options.shouldRetry - 自定义重试条件函数 (默认: 所有错误都重试)
 * @param {Function} options.onRetry - 重试回调函数
 * @param {number} options.timeout - 单次操作超时时间(ms)
 * @returns {Promise} 返回异步操作的结果
 */
export async function retryAsync(asyncFn, options = {}) {
    const {
        maxRetries = 3,
            delay = 1000,
            backoffStrategy = 'fixed',
            backoffFactor = 2,
            shouldRetry = () => true,
            onRetry = () => {},
            timeout
    } = options;

    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            // 如果设置了超时时间，包装函数添加超时控制
            const result = timeout ?
                await withTimeout(asyncFn, timeout) :
                await asyncFn();

            return result;
        } catch (error) {
            lastError = error;

            // 如果是最后一次尝试，直接抛出错误
            if (attempt === maxRetries) {
                throw error;
            }

            // 检查是否应该重试
            if (!shouldRetry(error, attempt + 1)) {
                throw error;
            }

            // 执行重试回调
            onRetry(error, attempt + 1, maxRetries);

            // 计算延迟时间并等待
            const waitTime = calculateDelay(delay, attempt, backoffStrategy, backoffFactor);
            await sleep(waitTime);
        }
    }

    throw lastError;
}

/**
 * 计算重试延迟时间
 */
function calculateDelay(baseDelay, attempt, strategy, factor) {
    switch (strategy) {
        case 'exponential':
            return baseDelay * Math.pow(factor, attempt);
        case 'linear':
            return baseDelay * (attempt + 1);
        case 'fixed':
        default:
            return baseDelay;
    }
}

/**
 * 延迟函数
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 为异步函数添加超时控制
 */
function withTimeout(asyncFn, timeoutMs) {
    return new Promise((resolve, reject) => {
        let isResolved = false;

        const timer = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                reject(new Error(`Operation timed out after ${timeoutMs}ms`));
            }
        }, timeoutMs);

        asyncFn()
            .then(result => {
                if (!isResolved) {
                    isResolved = true;
                    clearTimeout(timer);
                    resolve(result);
                }
            })
            .catch(error => {
                if (!isResolved) {
                    isResolved = true;
                    clearTimeout(timer);
                    reject(error);
                }
            });
    });
}