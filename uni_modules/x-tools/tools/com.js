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

const convertRpxToPx = (value) => {
    const num = Number(value)
    if (Number.isNaN(num)) return 0

    if (typeof uni?.upx2px === 'function') return uni.upx2px(num)
    if (typeof uni?.rpx2px === 'function') return uni.rpx2px(num)

    try {
        const info = uni?.getSystemInfoSync?.()
        const windowWidth = Number(info?.windowWidth || 0)
        if (windowWidth > 0) return (windowWidth / 750) * num
    } catch (e) {}

    return num
}

export const str2px = str => {
    if (!str) return 0
    str = String(str)
    if (str.endsWith('rpx')) return convertRpxToPx(parseFloat(str))
    if (str.endsWith('upx')) return convertRpxToPx(parseFloat(str))
    if (str.endsWith('px')) return parseFloat(str)
    return parseFloat(str) || 0
}
