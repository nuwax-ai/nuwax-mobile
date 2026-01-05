/**
 * GPT 风格数学公式转换工具
 * 支持将 GPT 生成的数学公式标记转换为标准 LaTeX 格式
 * 
 * GPT 通常生成以下格式：
 * - 行内公式: (\( ... \))
 * - 块级公式: (\[ ... \])
 * 
 * 转换为标准 LaTeX 格式：
 * - 行内公式: \( ... \)
 * - 块级公式: \[ ... \]
 */

/**
 * 转换 GPT 风格的数学公式标记
 * @param text 包含 GPT 风格数学公式的文本
 * @returns 转换后的文本
 */
export function convertGptStyleMath(text: string): string {
	if (!text || text.trim() === '') {
		return text
	}
	
	let result = text
	
	// 转换 GPT 风格的行内公式: (\( ... \)) → \( ... \)
	result = result.replace(/\(\\\(/g, '\\(')
	result = result.replace(/\\\)\)/g, '\\)')
	
	// 转换 GPT 风格的块级公式: (\[ ... \]) → \[ ... \]
	result = result.replace(/\(\\\[/g, '\\[')
	result = result.replace(/\\\]\)/g, '\\]')
	
	return result
}

/**
 * 检测文本中是否包含 GPT 风格的数学公式
 * @param text 要检测的文本
 * @returns 是否包含 GPT 风格数学公式
 */
export function hasGptStyleMath(text: string): boolean {
	if (!text || text.trim() === '') {
		return false
	}
	
	// 检查是否包含 GPT 风格的数学公式标记
	return /\(\\\(|\\\)\)|\(\\\[|\\\]\)/.test(text)
}

/**
 * 获取文本中所有 GPT 风格数学公式的位置信息
 * @param text 要分析的文本
 * @returns 数学公式位置信息数组
 */
export interface MathFormulaInfo {
	type: 'inline' | 'block'
	start: number
	end: number
	content: string
	original: string
}

export function findGptStyleMath(text: string): MathFormulaInfo[] {
	if (!text || text.trim() === '') {
		return []
	}
	
	const results: MathFormulaInfo[] = []
	
	// 查找 GPT 风格的行内公式: (\( ... \))
	const inlineRegex = /\(\\\(((?:\\.|[^\)])+?)\\\)\)/g
	let inlineMatch
	while ((inlineMatch = inlineRegex.exec(text)) !== null) {
		results.push({
			type: 'inline',
			start: inlineMatch.index,
			end: inlineMatch.index + inlineMatch[0].length,
			content: inlineMatch[1],
			original: inlineMatch[0]
		})
	}
	
	// 查找 GPT 风格的块级公式: (\[ ... \])
	const blockRegex = /\(\\\[((?:\\.|[^\]])+?)\\\]\)/g
	let blockMatch
	while ((blockMatch = blockRegex.exec(text)) !== null) {
		results.push({
			type: 'block',
			start: blockMatch.index,
			end: blockMatch.index + blockMatch[0].length,
			content: blockMatch[1],
			original: blockMatch[0]
		})
	}
	
	// 按位置排序
	return results.sort((a, b) => a.start - b.start)
}

/**
 * 将 GPT 风格的数学公式转换为 mp-html 支持的格式
 * @param text 原始文本
 * @param displayMode 是否为块级显示
 * @returns 转换后的 HTML 内容
 */
export function convertToMpHtmlFormat(text: string, displayMode: boolean = false): string {
	if (!text || text.trim() === '') {
		return ''
	}
	
	// 先转换 GPT 风格标记
	let convertedText = convertGptStyleMath(text)
	
	// 将 LaTeX 风格的数学公式转换为 KaTeX 能识别的格式
	// LaTeX 风格: \(...\) → $...$ (行内)
	convertedText = convertedText.replace(/\\\(/g, '$')
	convertedText = convertedText.replace(/\\\)/g, '$')
	
	// LaTeX 风格: \[...\] → $$...$$ (块级)
	convertedText = convertedText.replace(/\\\[/g, '$$')
	convertedText = convertedText.replace(/\\\]/g, '$$')
	
	// 根据显示模式包装
	if (displayMode) {
		// 块级显示：如果已经是 $$...$$ 格式，直接返回；否则包装
		if (convertedText.startsWith('$$') && convertedText.endsWith('$$')) {
			return convertedText
		} else {
			return `$$${convertedText}$$`
		}
	} else {
		// 内联显示：如果已经是 $...$ 格式，直接返回；否则包装
		if (convertedText.startsWith('$') && convertedText.endsWith('$')) {
			return convertedText
		} else {
			return `$${convertedText}$`
		}
	}
}

/**
 * 批量转换文本中的数学公式
 * @param text 包含多个数学公式的文本
 * @returns 转换后的文本
 */
export function batchConvertMathFormulas(text: string): string {
	if (!text || text.trim() === '') {
		return text
	}
	
	// 查找所有数学公式
	const mathFormulas = findGptStyleMath(text)
	
	// 从后往前替换，避免位置偏移
	for (let i = mathFormulas.length - 1; i >= 0; i--) {
		const formula = mathFormulas[i]
		const before = text.substring(0, formula.start)
		const after = text.substring(formula.end)
		
		// 根据类型转换
		let replacement: string
		if (formula.type === 'inline') {
			replacement = `\\(${formula.content}\\)`
		} else {
			replacement = `\\[${formula.content}\\]`
		}
		
		text = before + replacement + after
	}
	
	return text
}
