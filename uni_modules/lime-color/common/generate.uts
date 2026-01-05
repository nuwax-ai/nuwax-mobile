// https://github.com/ant-design/ant-design-colors/blob/main/src/generate.ts
import { inputToRGB } from './format-input';
import { rgbToHex, rgbToHsv } from './conversion';
import { HSV, LColorInfo, LGenerateOptions} from '../utssdk/interface.uts';

type DarkColorMapItem = {
	index : number;
	opacity : number;
};
const hueStep = 2; // 色相阶梯
const saturationStep = 0.16; // 饱和度阶梯，浅色部分
const saturationStep2 = 0.05; // 饱和度阶梯，深色部分
const brightnessStep1 = 0.05; // 亮度阶梯，浅色部分
const brightnessStep2 = 0.15; // 亮度阶梯，深色部分
const lightColorCount = 5; // 浅色数量，主色上
const darkColorCount = 4; // 深色数量，主色下
// 暗色主题颜色映射关系表
const darkColorMap = [
	{ index: 7, opacity: 0.15 },
	{ index: 6, opacity: 0.25 },
	{ index: 5, opacity: 0.3 },
	{ index: 5, opacity: 0.45 },
	{ index: 5, opacity: 0.65 },
	{ index: 5, opacity: 0.85 },
	{ index: 4, opacity: 0.9 },
	{ index: 3, opacity: 0.95 },
	{ index: 2, opacity: 0.97 },
	{ index: 1, opacity: 0.98 },
] as DarkColorMapItem[];


// 从 TinyColor.toHsv 移植的包装函数
// 保留这里，因为有 `hsv.h * 360`
function toHsv({ r, g, b } : LColorInfo) : HSV {
	// 将 RGB 值转换为 HSV 值
	const hsv = rgbToHsv(r, g, b);
	// 返回一个 HsvObject，其中 h 值乘以 360
	return { h: hsv.h * 360, s: hsv.s, v: hsv.v } as HSV;
}

// 从 TinyColor.toHexString 移植的包装函数
// 保留这里，因为有前缀 `#`
function toHex({ r, g, b }: LColorInfo) : string {
	// 将 RGB 值转换为十六进制字符串，并添加前缀 `#`
	return `#${rgbToHex(r, g, b, false)}`;
}


// 从 TinyColor.mix 移植的包装函数，无法进行 tree-shaking
// 数量范围为 [0, 1]
// 假设 color1 和 color2 没有透明度，因为以下源代码也是如此
function mix(rgb1 : LColorInfo, rgb2 : LColorInfo, amount : number) : LColorInfo {
	// 将 amount 除以 100，得到一个范围为 [0, 1] 的值
	const p = amount / 100;
	// 计算混合后的 RGB 值
	const rgb = {
		r: (rgb2.r - rgb1.r) * p + rgb1.r,
		g: (rgb2.g - rgb1.g) * p + rgb1.g,
		b: (rgb2.b - rgb1.b) * p + rgb1.b,
		a: 1
	} as LColorInfo;
	// 返回混合后的 RGB 对象
	return rgb;
}

// 根据给定的 HSV 对象和索引值计算新的色相值
// 如果 light 参数为 true，则色相向左转动；否则向右转动
function getHue(hsv : HSV, i : number, light : boolean = false) : number {
	let hue : number;
	// 根据色相不同，色相转向不同
	if (Math.round(hsv.h) >= 60 && Math.round(hsv.h) <= 240) {
		// 如果色相在 60 到 240 之间，向左转动
		hue = light ? Math.round(hsv.h) - hueStep * i : Math.round(hsv.h) + hueStep * i;
	} else {
		hue = light ? Math.round(hsv.h) + hueStep * i : Math.round(hsv.h) - hueStep * i;
	}

	if (hue < 0) {
		// 如果新的色相值小于 0，则加上 360
		hue += 360;
	} else if (hue >= 360) {
		// 如果新的色相值大于等于 360，则减去 360
		hue -= 360;
	}
	return hue;
}


// 根据给定的 HSV 对象和索引值计算新的饱和度值
// 如果 light 参数为 true，则饱和度减小；否则增加
function getSaturation(hsv : HSV, i : number, light : boolean = false) : number {
	// grey color don't change saturation
	// 如果颜色是灰色（色相和饱和度都为 0），则饱和度不变
	if (hsv.h == 0 && hsv.s == 0) {
		return hsv.s;
	}
	let saturation : number;
	// 如果 light 参数为 true，则饱和度减小
	if (light) {
		saturation = hsv.s - saturationStep * i;
	}
	// 如果 i 等于 darkColorCount，则饱和度增加
	else if (i == darkColorCount) {
		saturation = hsv.s + saturationStep;
	}
	// 否则，饱和度增加
	else {
		saturation = hsv.s + saturationStep2 * i;
	}
	// 边界值修正
	if (saturation > 1) {
		saturation = 1;
	}
	// 第一格的 s 限制在 0.06-0.1 之间
	if (light && i == lightColorCount && saturation > 0.1) {
		saturation = 0.1;
	}
	if (saturation < 0.06) {
		saturation = 0.06;
	}
	return parseFloat(saturation.toFixed(2))
}

// 根据给定的 HSV 对象和索引值计算新的亮度值
// 如果 light 参数为 true，则亮度增加；否则减少
function getValue(hsv : HSV, i : number, light : boolean = false) : number {
	let value : number;
	// 如果 light 参数为 true，则亮度增加
	if (light) {
		value = hsv.v + brightnessStep1 * i;
	} else {
		value = hsv.v - brightnessStep2 * i;
	}
	if (value > 1) {
		value = 1;
	}
	// 返回保留两位小数的亮度值
	return parseFloat(value.toFixed(2));
}




/**
 * generate 函数用于生成一组基于给定颜色的色彩模式。
 * 它可以生成亮色、暗色和深色主题颜色模式。
 *
 * @param {string} color - 输入的颜色值，可以是十六进制、RGB、RGBA、HSL、HSLA或颜色名称。
 * @param {LGenerateOptions} [opts] - 可选的生成选项。
 * @returns {string[]} - 返回一个包含生成的颜色模式的字符串数组。
 */
export function generate(color : string, opts : LGenerateOptions = {} as LGenerateOptions) : string[] {
	const patterns : string[] = [];
	const pColor = inputToRGB(color);

	// 生成亮色模式
	for (let i = lightColorCount; i > 0; i -= 1) {
		const hsv = toHsv(pColor);
		const colorString : string = toHex(
			inputToRGB({
				h: getHue(hsv, i, true),
				s: getSaturation(hsv, i, true),
				v: getValue(hsv, i, true),
			}),
		);
		patterns.push(colorString);
	}

	// 添加原始颜色
	patterns.push(toHex(pColor));

	// 生成暗色模式
	for (let i = 1; i <= darkColorCount; i += 1) {
		const hsv = toHsv(pColor);
		const colorString : string = toHex(
			inputToRGB({
				h: getHue(hsv, i),
				s: getSaturation(hsv, i),
				v: getValue(hsv, i),
			}),
		);
		patterns.push(colorString);
	}

	// 如果选项中指定了 dark 主题，则生成深色主题颜色模式
	if (opts.theme == 'dark') {
		return darkColorMap.map(({ index, opacity }, _):string => {
			const darkColorString : string = toHex(
				mix(
					inputToRGB(opts.backgroundColor ?? '#141414'),
					inputToRGB(patterns[index]),
					opacity * 100,
				),
			);
			return darkColorString;
		});
	}

	// 返回默认颜色模式
	return patterns;
}

