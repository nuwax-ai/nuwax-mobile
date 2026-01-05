// @ts-nocheck
export type CheckboxProps = {
	/**
	 * 是否选中
	 */
	// checked ?: boolean;
	/**
	 * 是否选中，非受控属性
	 */
	defaultChecked: boolean;
	/**
	 * 是否选中
	 */
	// modelValue ?: boolean;
	/**
	 * 主文案
	 */
	label ?: string;
	/**
	 * 是否为半选
	 */
	indeterminate: boolean;
	/**
	 * 是否禁用组件。如果父组件存在 CheckboxGroup，默认值由 CheckboxGroup.disabled 控制。Checkbox.disabled 优先级高于 CheckboxGroup.disabled
	 */
	disabled : boolean;
	/**
	 * 只读
	 */
	readonly : boolean;
	size : 'small' | 'medium' | 'large'
	/**
	 * 标识符，通常为一个唯一的字符串或数字
	 */
	name ?: any //string,
	/**
	 * 用于标识是否为「全选选项」。单独使用无效，需在 CheckboxGroup 中使用
	 */
	checkAll : boolean
	/**
	 * 多选框的值
	 */
	value?: any; // string | number 
	icon: 'circle' | 'line' | 'rectangle' | 'dot';
	
	fontSize?: string;
	iconSize?: string;
	checkedColor?: string;
	iconBgColor?: string;
	iconBorderColor?: string;
	iconDisabledColor?: string;
	iconDisabledBgColor?: string;
	
	labelStyle?: string | UTSJSONObject
}

export type ManageChildInList = (child: LCheckboxComponentPublicInstance, shouldAdd: boolean) => void;
export type CheckboxStatus = 'checked' | 'uncheck' | 'indeterminate';
export type CheckboxChangeOptions = {
	checked : boolean,
	checkAll : boolean,
	value?: any
};

export type OnCheckedChange = (options: CheckboxChangeOptions) => void
// #ifndef APP-ANDROID || APP-IOS
export type {ComputedRef} from 'vue';
// #endif
// #ifdef APP-ANDROID || APP-IOS
export type ComputedRef<T> = ComputedRefImpl<T>;
// export type WritableComputedRef<T> = ComputedRefImpl<T>;
// #endif