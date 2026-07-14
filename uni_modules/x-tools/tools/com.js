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
    if (str.endsWith('rpx')) return uni.upx2px(parseInt(str))
    if (str.endsWith('px')) return parseInt(str)
    return parseInt(str)
}