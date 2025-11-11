export class CodeUtil {

    codeType = []

    constructor(codeType) {
        if (!Array.isArray(codeType)) {
            console.error('codeType should be an array')
            return
        }
        this.codeType = codeType
    }

    scan(options = {}) {
        return uni.scanCode(options)
    }

    async getCodeInfo(options) {
        const { scanType, result } = await this.scan(options)
        return this.parseCode(result)
    }

    makeCode(type, content) {
        const t = this.codeType.indexOf(type)

        if (t == -1) {
            console.error(`codeType ${type} is undefined`, this.codeType)
            return null
        }

        return JSON.stringify({
            t,
            c: content
        })
    }

    parseCode(codeInfo) {
        try {
            const info = JSON.parse(codeInfo)
            
            const { t, c } = info
            
            const type = this.codeType[t]

            if (type) return { type, content: c }

            return { type: 'unknown', content: info }

        } catch (err) {

            console.error('parseCode error', err)

            return { type: 'error', content: codeInfo }
        }
    }
}

export const codeUtil = new CodeUtil([])