import { deepClone } from './index.js'

const delayCall = (fun, timeout) => {
    if (timeout) setTimeout(fun, timeout)
    else fun()
}

export const navBackAndEvent = (eventChannel, backData, timeout = 0, delta = 1) => {
    delayCall(() => {
        eventChannel.emit('backData', backData)
        uni.navigateBack({
            delta
        })
    }, timeout)
}

export const navToAndEvent = (url, data, acceptCallback, timeout = 0) => {
    return new Promise(resolve => {
        delayCall(() => {
            uni.navigateTo({
                url,
                events: {
                    backData: data => {
                        acceptCallback && acceptCallback(data)
                        resolve(data)
                    }
                },
                success: ({ eventChannel }) => {
                    if (eventChannel && eventChannel.emit) {
                        eventChannel.emit('navData', deepClone(data))
                    }
                },
                fail: console.log,
            })
        }, timeout)
    })
}

export const navTo = (url, options, timeout = 0) => {
    delayCall(() => {
        uni.navigateTo({
            url,
            fail: console.log,
            ...options
        })
    }, timeout)
}

export const redTo = (url, timeout = 0) => {
    delayCall(() => {
        uni.redirectTo({
            url,
            fail: console.log
        })
    }, timeout)
}

export const clearTo = (url, timeout = 0) => {
    delayCall(() => {
        uni.reLaunch({
            url,
            fail: console.log
        })
    }, timeout)
}

export const tabTo = (url, timeout = 0) => {
    delayCall(() => {
        uni.switchTab({
            url,
            fail: console.log
        })
    }, timeout)
}

export const shTab = (url, timeout = 0) => {
    delayCall(() => {
        uni.switchTab({
            url,
            fail: console.log
        })
    }, timeout)
}

export const navBack = (timeout = 0, delta = 1) => {
    delayCall(() => {
        uni.navigateBack({
            delta
        })
    }, timeout)
}