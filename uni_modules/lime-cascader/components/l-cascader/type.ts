// @ts-nocheck
// #ifndef UNI-APP-X
type UTSJSONObject = Record<string, any>
// #endif

export type ChildrenInfoType = {
		value: string;
		level: number;
	}
export type KeysType = {
	label : string,
	value : string,
	children : string
}
export type CascaderOption = {
	children ?: Array<CascaderOption>;
	/** option label content */
	label ?: string;
	/** option search text */
	text ?: string;
	/** option value */
	value ?: string;
	/** option node content */
	content ?: string;
	color?: string;
	disabled: boolean;
}

export interface CascaderProps {
	visible: boolean;
	/**
	  * 父子节点选中状态不再关联，可各自选中或取消
	  */
	checkStrictly: boolean;
	/**
	  * 是否支持多选
	  */
	multiple?: boolean;
	options : UTSJSONObject[];
	/**
		* 标题
		*/
	title ?: string;
	keys?: UTSJSONObject;
	/**
		* 选项值
		*/
	value ?: string;
	/**
		* 选项值，非受控属性
		*/
	defaultValue ?: string;
	/**
		* 未选中时的提示文案
		*/
	placeholder : string;
	/**
		* 每级展示的次标题
		*/
	subTitles : string[];
	/**
		* 关闭按钮
		*/
	closeable: boolean;
	uniCloud: boolean;
	swipeable ?: boolean;
	
	
	fontSize?: string;
	color?: string;
	bgColor?: string;
	// #ifdef APP
	iconSize: string;
	activeColor: string;
	// #endif
	// #ifndef APP
	iconSize?: string;
	activeColor?: string;
	// #endif
	
	
	/**
	 * 确认按钮。值为 null 则不显示确认按钮。值类型为字符串，则表示自定义按钮文本，值类型为 Object 则表示透传 Button 组件属性
	 * @default ''
	 */
	confirmBtn ?: string | UTSJSONObject // string | ButtonProps | null
	/**
	 * 确认按钮处于禁用状态时的文字
	 */
	confirmDisabledText ?: string;
}