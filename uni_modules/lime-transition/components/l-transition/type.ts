// @ts-nocheck
export interface TransitionProps {
	/**
	 * 首次出现是否展示动画
	 */
	appear : boolean;
	/**
	 * 自定义容器类名
	 */
	lClass ?: string;
	lStyle ?: string;
	/**
	 * 隐藏时是否销毁内容
	 */
	destoryOnClose : boolean;
	/**
	 * 层级
	 */
	zIndex: number;
	/**
	 * 指定过渡时间
	 */
	duration : number;
	/**
	 * 过渡类名
	 */
	name : string;
	/**
	 * 是否显示
	 */
	visible : boolean;
	enterClass: string;
	enterActiveClass: string;
	enterToClass: string;
	leaveClass: string;
	leaveActiveClass: string;
	leaveToClass: string;
};