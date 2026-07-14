export const commonProps = {
    bgColor: {
        type: String,
        default: '#fff'
    },
    customStyle: {
        type: Object,
        default: () => ({})
    }
}

export const rpx2px = val => {
    // uni.upx2px 在部分平台（APP-Android）上可能不存在
    if (typeof uni.upx2px === 'function') return uni.upx2px(val)
    // 兜底：750rpx = 屏幕宽度 px
    const sysInfo = uni.getSystemInfoSync()
    const winWidth = (sysInfo != null && sysInfo.windowWidth != null) ? sysInfo.windowWidth : 375
    return (val * winWidth) / 750
}

export const str2px = str => {
    if (!str) return 0
    str = String(str)
    if (str.endsWith('rpx')) return rpx2px(parseInt(str))
    if (str.endsWith('px')) return parseInt(str)
    return parseInt(str)
}