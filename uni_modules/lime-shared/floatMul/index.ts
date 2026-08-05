// @ts-nocheck
import {isNumber} from '../isNumber';

/**
 * 乘法函数，用于处理浮点数乘法并保持精度。
 * @param {number} num1 - 第一个乘数。
 * @param {number} num2 - 第二个乘数。
 * @returns {number} 乘法运算的结果，保留正确的精度。
 * 快速验证版：5.23 蒸汽 SDK 下 java.math.BigDecimal 无法解析，统一用模板串转字符串（放弃科学计数法特判）。
 */
export function floatMul(num1 : number, num2 : number) : number {
	if (!(isNumber(num1) || isNumber(num2))) {
		console.warn('Please pass in the number type');
		return NaN;
	}
	let m = 0;
	let	s1:string = `${num1}`
	let	s2:string = `${num2}`

	try {
		m += s1.split('.')[1].length;
	} catch (error) { }
	try {
		m += s2.split('.')[1].length;
	} catch (error) { }

	// #ifdef APP-ANDROID
	return parseFloat(s1.replace('.', '')) * parseFloat(s2.replace('.', '')) / Math.pow(10, m);
	// #endif
	// #ifndef APP-ANDROID
	return Number(s1.replace('.', '')) * Number(s2.replace('.', '')) / Math.pow(10, m);
	// #endif
}
