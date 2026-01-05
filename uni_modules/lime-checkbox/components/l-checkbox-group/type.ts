// @ts-nocheck
export type CheckerDirection = 'horizontal' | 'vertical';
export type CheckboxGroupValue = any[]//Array<string | number | boolean>;

export interface CheckboxGroupProps {
	/** 是否禁用组件，默认为 false。CheckboxGroup.disabled 优先级低于 Checkbox.disabled */
	disabled : boolean;
	readonly : boolean;
	/** 支持最多选中的数量 */
	max?: number;
	/** 唯一标识 */
	name?: any;//string;
	/** 选中值 */
	value?: any[];
	modelValue?: any[];
	/** 选中值，非受控属性 */
	defaultValue?: any[];
	
	size: 'small' | 'medium' | 'large';
	direction : CheckerDirection;
	gap?: string;
	icon: 'circle' | 'line' | 'rectangle' | 'dot';
	
	//未实现
	// options: Array<unknown>,
	fontSize?: string;
	iconSize?: string;
	checkedColor?: string;
	iconBgColor?: string;
	iconBorderColor?: string;
	iconDisabledColor?: string;
	iconDisabledBgColor?: string;
}

// #ifndef APP-ANDROID || APP-IOS
export type {ComputedRef} from 'vue';
// #endif
// #ifdef APP-ANDROID || APP-IOS
export type ComputedRef<T> = ComputedRefImpl<T>;
// #endif