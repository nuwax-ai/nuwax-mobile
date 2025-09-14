// @ts-nocheck
export interface PopupProps {
	/**
	 * 是否展示关闭按钮，值为 `true` 显示默认关闭按钮；值为 `false` 则不显示关闭按钮；也可以自定义关闭按钮
	 */
	closeable : boolean;
	/**
	 * 点击遮罩层是否关闭
	 */
	closeOnClickOverlay : boolean;
	/**
	 * 是否在关闭浮层时销毁浮层
	 */
	destroyOnClose : boolean;
	/**
	 * 遮罩层的属性，透传至 overlay
	 */
	overlayStyle ?: string | UTSJSONObject;
	// overlayProps ?: {
	// 	preventScrollThrough: boolean
	// 	zIndex: number
	// 	lStyle: string
	// };
	/**
	 * 浮层出现位置
	 */
	position : 'top' | 'left' | 'right' | 'bottom' | 'center' | '';
	/**
	 * 防止滚动穿透
	 */
	preventScrollThrough : boolean;
	/**
	 * 是否显示遮罩层
	 */
	overlay : boolean;
	/**
	 * 弹出层内容区的动画名，等价于transition组件的name属性
	 */
	transitionName ?: string;
	/**
	 * 是否显示浮层
	 */
	visible ?: boolean;
	/**
	 * 组件层级，Web 侧样式默认为 999，移动端和小程序样式默认为 999
	 */
	zIndex : number;
	duration : number;
	bgColor?: string;
	closeIcon: string;
	iconColor?: string;
	lStyle?: string | UTSJSONObject;
	safeAreaInsetBottom:boolean;
	safeAreaInsetTop:boolean;
	
	radius?: string | number | (string|number)[]
}

export type PopupSource = 'close-btn' | 'overlay';