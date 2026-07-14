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

export const str2px = str => {
    if (!str) return 0
    str = String(str)
    if (str.endsWith('rpx')) {
        const val = parseInt(str)
        if (typeof uni.upx2px === 'function') {
            return uni.upx2px(val)
        }
        // 兼容 App 等不支持 uni.upx2px 的平台
        try {
            const sysInfo = uni.getSystemInfoSync()
            const ratio = sysInfo.windowWidth / 750
            return val * ratio
        } catch (e) {
            return val
        }
    }
    if (str.endsWith('px')) return parseInt(str)
    return parseInt(str)
}