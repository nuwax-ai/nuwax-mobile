export * as sugar from './sugar'
export * as router from './router'
export * as h5Utils from './h5Utils'
export * as appletUtils from './appletUtils'
export * from './retryAsync'

import pagesJson from '@/pages.json'

export const isPromise = (obj) => {
    return !!obj && (typeof obj === "object" || typeof obj === "function") && typeof obj.then === "function";
}

let promisifyFlag = false
export const promisify = () => {

    if (promisifyFlag) return

    promisifyFlag = true

    // #ifdef VUE2
    uni.addInterceptor({
        returnValue(res) {
            if (isPromise(res)) {
                return new Promise((resolve, reject) => {
                    res.then((res) => {
                        if (Array.isArray(res)) {
                            if (res[0]) reject(res[0])
                            else resolve(res[1])
                        } else {
                            if (typeof res == 'object' && String(res.errMsg).includes(':ok')) {
                                resolve(res)
                            } else {
                                reject(res)
                            }
                        }
                    });
                });
            }
            return res;
        },
    });
    // #endif
}

// 获取类型
export const _typeof = val => Object.prototype.toString.call(val).slice(8, -1).toLowerCase()

// 休眠
export const sleep = ms => new Promise(r => setTimeout(r, ms))

// 获取当前页面信息
export const getCurrentPage = () => {
    const pages = getCurrentPages()
    return pages[pages.length - 1] || {}
}

// 获取当前页面 path
export const getCurrentPagePath = (fullPath = false) => {
    const { route, $page } = getCurrentPage()
    return fullPath ? $page.fullPath : '/' + route
}

// 判断当前页或指定 path 是否是 tabbar 页面
export const isTabBarPage = path => {
    const { tabBar } = pagesJson
    if (!tabBar) return false
    path = path || getCurrentPagePath()
    return !(!tabBar || !tabBar.list || !tabBar.list.length || tabBar.list.findIndex(i => '/' + i.pagePath == path) == -1)
}

// 获取应用运行页面信息
export const getPageInfo = () => {

    // 获取 pages 并去重
    const pages = getCurrentPages().reduce((p, c) => {
        if (!p.find(f => f.route == c.route)) p.push(c)
        return p
    }, [])

    // 启动页
    const startPage = pagesJson.pages[0].path

    // tabBar
    const tabBarList = pagesJson.tabBar?.list || []

    // 首页
    const [page] = pages

    return {
        currentPage: pages[pages.length - 1] || {},
        startPage,
        isSharePage: pages.length == 1 && page.route != startPage && !tabBarList.some(i => i.pagePath == page.route),
        pageStackLen: pages.length,
    }
}

/**
 * @desc 倒计时
 * @func countDown
 * @param {String | Number} endTime 结束时间
 * @param {Function} callback 倒计时字符串更新回调函数 (info, isEnd) => {}
 * @param {String} formatStr 倒计时字符串显示格式 d=天, h=时, m=分, s=秒, 默认(hh:mm:ss)
 * @param {Number} refreshRate 更新频率 默认(100)
 * @return {Number} 定时器 id 用于结束倒计时
 */
export const countDown = function(endTime, callback, formatStr = 'hh:mm:ss', refreshRate = 100) {
    const targetTime = new Date(endTime).getTime();
    let cacheStr
    const intervalId = setInterval(function() {

        const currentTime = new Date().getTime();

        const distance = targetTime - currentTime;

        const date = {
            d: Math.floor(distance / (1000 * 60 * 60 * 24)),
            h: Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
            m: Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)),
            s: Math.floor((distance % (1000 * 60)) / 1000)
        }

        if (!formatStr.includes('d')) {
            date.h += date.d * 24;
            date.d = 0;
        }

        if (!formatStr.includes('h')) {
            date.m += date.h * 60;
            date.h = 0;
        }

        if (!formatStr.includes('m')) {
            date.s += date.m * 60;
            date.m = 0;
        }

        let str = formatStr

        Object.keys(date).forEach(key => {
            if (date[key] < 0) date[key] = 0
            if (str.includes(key)) {
                if (str.includes(key + key)) {
                    str = str.replace(key + key, date[key].toString().padStart(2, 0))
                } else {
                    str = str.replace(key, date[key])
                }
            }
        })
        if (cacheStr != str) {
            cacheStr = str
            if (date.d + date.h + date.m + date.s <= 0) {
                clearInterval(intervalId);
                callback && callback({ str, ...date }, true)
            } else {
                callback && callback({ str, ...date }, false)
            }
        }
    }, refreshRate);
    return intervalId
}


/**
 * @desc 轮询函数(等待结果)
 * @func pollingForResult
 * @param {Function} fun 返回值为 Promise 的函数
 * @param {Array} params fun函数调用的参数列表 ( 例: [param,param] )
 * @param {Function} judgeFun 拿到 fun 函数返回结果 res, 然后调用 judgeFun(res), judgeFun函数应返回 success 或 fail , 没有返回值即忽略本次
 * @param {Number} ms 最快多长时间调用一次 ( 默认 1000ms )
 * @param {Number} timeout 超时时间 ( 默认 1min )
 * @return {Promise} judgeFun 函数返回 success 或 fail 的调用结果
 */
export const pollingForResult = function(fun, params, judgeFun, ms = 1000, timeout = 1000 * 60) {
    // console.time('polling-time')
    console.log('polling-params', arguments);
    let startTime = Date.now()
    let prevCallTime = 0
    if (typeof judgeFun != 'function') throw new Error('judgeFun 参数应为一个 function');
    if (!(params instanceof Array)) params = [params]
    if (ms <= 0) ms = 1
    return new Promise((resolve, reject) => {
        function fun_call() {
            if ((prevCallTime + ms) > Date.now()) {
                setTimeout(() => {
                    fun_call()
                }, (prevCallTime + ms) - Date.now());
                return
            }
            if ((timeout + startTime) < Date.now()) {
                reject('Timeout')
                return
            }
            prevCallTime = Date.now()
            // console.time('fun-call-time')
            fun(...params).then(res => {
                console.log('fun-call-res', res);
                // console.timeEnd('fun-call-time')
                if (judgeFun(res) === 'success') {
                    resolve(res)
                    // console.timeEnd('polling-time')
                } else if (judgeFun(res) === 'fail') {
                    reject(res)
                    // console.timeEnd('polling-time')
                } else {
                    fun_call()
                }
            }).catch(err => {
                console.log('fun-call-err', err);
                // console.timeEnd('fun-call-time')
                fun_call()
            })
        }
        fun_call()
    })
}

/**
 * @desc 轮询函数(获取数据)
 * @func pollingForData
 * @param {Function} fun 返回值为 Promise 的函数
 * @param {Array} params fun函数调用的参数列表 ( 例: [param,param] )
 * @param {Function} callback 每次调用的结果  ( 例: (err, res, count) => {} )
 * @param {Number} ms 最快多长时间调用一次 ( 默认 1000ms )
 * @return {Function} 结束轮询函数
 */
export const pollingForData = function(fun, params, callback, ms = 1000) {
    console.log('polling-params', arguments);
    let prevCallTime = 0
    let endFlag = false
    let count = 0
    if (typeof callback != 'function') throw new Error('callback 参数应为一个 function');
    if (!(params instanceof Array)) params = [params]
    if (ms <= 0) ms = 1

    function fun_call() {
        if (endFlag) return
        if ((prevCallTime + ms) > Date.now()) {
            setTimeout(() => {
                fun_call()
            }, (prevCallTime + ms) - Date.now());
            return
        }
        prevCallTime = Date.now()
        count++
        fun(...params).then(res => {
            callback && callback(null, res, count)
            fun_call()
        }).catch(err => {
            callback && callback(err, null, count)
            fun_call()
        })
    }
    fun_call()
    return () => {
        console.log('polling-end');
        endFlag = true
    }
}

/**
 * @desc 深拷贝
 * @func deepClone
 * @param {Object} target 被拷贝的对象
 * @return {Object} 新对象
 */
export const deepClone = (target, map = new WeakMap()) => {
    if (target === null || typeof target !== 'object') {
        return target;
    }

    if (target instanceof Date) {
        return new Date(target);
    }

    if (target instanceof RegExp) {
        return new RegExp(target.source, target.flags);
    }

    if (target instanceof Map) {
        const newMap = new Map();
        target.forEach((value, key) => {
            newMap.set(deepClone(key, map), deepClone(value, map));
        });
        return newMap;
    }

    if (target instanceof Set) {
        const newSet = new Set();
        target.forEach(value => {
            newSet.add(deepClone(value, map));
        });
        return newSet;
    }

    if (typeof target === 'function') {
        return target;
    }

    if (map.has(target)) {
        return map.get(target);
    }

    const cloneTarget = Array.isArray(target) ? [] : {};

    map.set(target, cloneTarget);

    const symbolKeys = Object.getOwnPropertySymbols(target);
    if (symbolKeys.length > 0) {
        symbolKeys.forEach(symKey => {
            cloneTarget[symKey] = deepClone(target[symKey], map);
        });
    }

    for (let key in target) {
        if (Object.prototype.hasOwnProperty.call(target, key)) {
            cloneTarget[key] = deepClone(target[key], map);
        }
    }

    return cloneTarget;
}