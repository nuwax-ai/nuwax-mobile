// @ts-nocheck
export type TabPanel = {
	/**
	 * 透传至 Badge 组件
	 */
	badge ?: any;
	dot ?: boolean;
	offset ?: any[];
	/**
	 * 选项卡内容隐藏时是否销毁
	 */
	destroyOnHide ?: boolean;
	/**
	 * 是否禁用当前选项卡
	 */
	disabled : boolean;
	/**
	 * 选项卡名称，可自定义选项卡导航内容
	 */
	label ?: string;
	/**
	 * 是否启用选项卡懒加载
	 */
	lazy ?: boolean;
	/**
	 * 选项卡的值，唯一标识
	 */
	value ?: number;
	ccs?: UTSJSONObject
	
	node: UTSJSONObject
}


export interface TabsProps {
	/**
	 * 选项卡列表
	 */
	list ?: UTSJSONObject[];
	ellipsis : boolean;
	/**
	 * 动画效果设置
	 */
	animated : boolean;

	duration : number
	
	/**
	 * 是否展示底部激活线条
	 */
	showLine : boolean;
	/**
	 * 组件尺寸
	 */
	size : 'medium' | 'large';
	/**
	 * 选项卡头部空间是否均分
	 */
	spaceEvenly : boolean;
	/**
	 * 是否可以滑动切换
	 */
	swipeable : boolean;
	/**
	 * 激活的选项卡值
	 */
	value?: number;

	color?: string;
	activeColor ?: string;
	lineColor ?: string;
	lineWidth ?: string;
	lineHeight ?: string;
	bgColor ?: string;
	fontSize ?: string;
	padding ?: string;
	split: boolean;
	visible: boolean;
	/**
	 * 和swiper联动 暂时未实现
	 */
	swiperProgress : number
	syncSwiper: boolean
	
	lStyle ?: string | UTSJSONObject
}