// @ts-nocheck
export interface OverlayProps {
	ariaLabel: string;
	ariaRole: string;
	lClass?: string;
	/**
	 * 遮罩层的背景色
	 */
	bgColor ?: string;
	/**
	 * 遮罩层自定义样式。优先级低于其他属性
	 */
	lStyle ?: string|UTSJSONObject;
	/**
	 * 背景色过渡时间，单位毫秒
	 */
	duration : number;
	/**
	 * 防止滚动穿透，即不允许点击和滚动
	 */
	preventScrollThrough : boolean;
	/**
	 * 是否展示
	 */
	visible : boolean;
	/**
	 * 遮罩的层级
	 */
	zIndex : number;
}