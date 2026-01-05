export const log = console.log

export const upx2px = val => uni.upx2px(parseInt(val))

export const toast = (title, options = { duration: 2000, icon: 'none' }) => uni.showToast({ title, fail: console.log, ...options })

export const makePhoneCall = phoneNumber => uni.makePhoneCall({ phoneNumber, fail: console.log });

export const previewImage = (urls, current, options) => uni.previewImage({ urls, current, fail: console.log, ...options });

export const copy = (str, options) => uni.setClipboardData({ data: String(str), fail: console.log, ...options })

export const openMap = (lng, lat, name, address, options) => uni.openLocation({ longitude: parseFloat(lng), latitude: parseFloat(lat), name, address, fail: console.log, ...options })

export const setStorage = (key, value) => uni.setStorageSync(key, value)

// 判断空值
export const isEmpty = value => {
    if (value === null || value === undefined || value === '') {
        return true;
    }
    if (Array.isArray(value)) {
        return value.length === 0;
    }
    if (typeof value === 'object') {
        return Object.keys(value).length === 0;
    }
    return false;
}

// 返回对象属性为空的 property path
const getEmptyValuePropertyPath = (obj, excludedKeys = []) => {
    for (let key in obj) {
        if (obj.hasOwnProperty(key) && !excludedKeys.includes(key)) {
            let value = obj[key];
            if (Array.isArray(value)) {
                // 判断是否为数组对象
                for (let item of value) {
                    const childrenKey = getEmptyValuePropertyPath(item, excludedKeys)
                    if (item instanceof Object && childrenKey) {
                        return key + '.' + childrenKey;
                    }
                }
                if (value.length === 0) {
                    return key;
                }
            } else if (value instanceof Object) {
                const childrenKey = getEmptyValuePropertyPath(value, excludedKeys)
                if (childrenKey) {
                    return key + '.' + childrenKey;
                }
            } else if (isEmpty(value)) {
                return key;
            }
        }
    }
    return null;
}

// 有无空字段
export const hasEmptyField = (obj, excludedKeys = []) => getEmptyValuePropertyPath(obj, excludedKeys)

// 跳转企业微信客服
export const toCustomerService = (corpId, url) => {
    // #ifdef MP-WEIXIN
    wx.openCustomerServiceChat({
        extInfo: {
            url
        },
        corpId,
        success(res) {},
        fail: (err) => {
            console.log(err);
            uni.showToast({
                title: err?.errMsg
            })
        }
    })
    // #endif

    // #ifdef APP
    plus.share.getServices(services => {
        const sweixin = services.find(i => i.id === 'weixin')
        if (sweixin) {
            sweixin.openCustomerServiceChat({
                corpid: corpId,
                url,
            }, res => {
                console.log("success", JSON.stringify(res))
            }, err => {
                console.log("error", JSON.stringify(err))
            })
        } else {
            plus.nativeUI.alert('当前环境不支持微信操作!')
        }
    }, function() {
        uni.showToast({ title: "获取服务失败，不支持该操作。" + JSON.stringify(e), icon: 'error' })
    })
    // #endif

    // #ifdef H5
    window.location.href = url
    // #endif
}

// 保存图片
export const saveImage = async (url, tips = true) => {
    try {
        console.log('saveImage', url);
        // #ifdef H5

        const link = document.createElement('a');
        link.href = url;
        link.download = url.substring(url.lastIndexOf('/') + 1);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // #endif

        // #ifndef H5

        if (url.startsWith('http')) {
            const { statusCode, tempFilePath: filePath } = await uni.downloadFile({
                url
            })

            if (statusCode == 200) {
                await uni.saveImageToPhotosAlbum({
                    filePath
                })
            } else {
                throw Error('图片下载失败')
            }

        } else {
            await uni.saveImageToPhotosAlbum({
                filePath: url
            })
        }

        // #endif

        tips && uni.showToast({
            title: '保存成功',
            icon: 'success'
        })
    } catch (e) {
        console.log(e);

        tips && uni.showToast({
            title: '保存失败',
            icon: 'error'
        })
    }
}
// 获取页面通信管道（支持 vue2 需绑定this）
export const pageEvent = function() {
    // #ifdef VUE2
    return this.getOpenerEventChannel()
    // #endif
    // #ifdef VUE3
    console.error('vue3 不支持这种使用方式')
    // #endif
}

// 对象转查询字符串
export const object2queryStr = (obj) => {
    if (!obj) return obj
    return Object.keys(obj).reduce((val, key) => {
        return `${val}${key}=${obj[key]}&`
    }, '?').slice(0, -1)
}

// html 转纯文本
export const html2text = (html) => {
    return String(html).replace(/<[^>]+>|&[^;]+;/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * @Func dataMask
 * @Desc 数据脱敏
 * @param {String} str 字符串
 * @param {Number} head 头部保留位数
 * @param {Number} tail 尾部保留位数
 * @return {String} 脱敏后的数据
 */
export const dataMask = (str, head, tail) => {
    if (!str) return str
    const arr = String(str).split('')
    tail = arr.length - tail
    if (head < 0) head = 0
    if (head > tail) return str
    for (let i = head; i < tail; i++) {
        arr[i] = '*'
    }
    return arr.join('')
}

// 查询元素信息
export const queryElementRect = function(selector) {
    if (Array.isArray(selector)) return Promise.all(selector.map(i => queryElementRect.call(this, i)))
    return new Promise(resolve => {
        uni.createSelectorQuery()
            .in(this).select(selector)
            .boundingClientRect(resolve)
            .exec();
    })
}