/** 
 * 小程序工具
 */
import { getQueryParams } from './h5Utils.js'

// 跳转视频号直播
export const toChannelsLive = (finderUserName = '') => {
    // #ifdef MP-WEIXIN
    wx.getChannelsLiveInfo({
        finderUserName,
        success: info => {
            const { feedId, nonceId } = info
            wx.openChannelsLive({
                finderUserName,
                feedId,
                nonceId,
                fail: (err) => {
                    console.log(err);
                    uni.showToast({
                        title: err?.errMsg
                    })
                }
            })
        },
        fail: (err) => {
            console.log(err);
            uni.showToast({
                title: err?.errMsg
            })
        }
    })
    // #endif
    // #ifndef MP-WEIXIN
    console.error('只支持在微信小程序中调用')
    // #endif
}

// 获取小程序分享参数
export const getWxShareParams = (queryParams, title, imageUrl, path) => {
    const { appName } = uni.getSystemInfoSync()
    const pages = getCurrentPages()
    const { route, options, $page } = pages[pages.length - 1]
    const params = queryParams || options || getQueryParams($page?.fullPath)
    title = title || appName
    path = path || '/' + route
    path += Object.keys(params).reduce((prev, curr) => curr ? `${prev}${curr}=${params[curr]}&` : prev, path.includes('?') ? '&' : '?').slice(0, -1)
    console.log('getWxShareParams', title, path, imageUrl);
    return {
        title,
        path,
        imageUrl
    }
}

// 获取场景参数
export const getSceneParams = () => {
    const { query } = uni.getLaunchOptionsSync()
    return getQueryParams(decodeURIComponent(query.scene))
}