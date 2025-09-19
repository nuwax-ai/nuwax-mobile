// @ts-nocheck
export default {
	checked: {
		type: Boolean,
		default: undefined,
	},
	modelValue: {
		type: Boolean,
		default: undefined,
	},
	/** 是否选中，非受控属性 */
	defaultChecked: {
		type: Boolean,
		default: false,
	},
	/** 是否禁用组件。如果父组件存在 CheckboxGroup，默认值由 CheckboxGroup.disabled 控制。Checkbox.disabled 优先级高于 CheckboxGroup.disabled */
	disabled: {
		type: Boolean,
		default: false,
	},
	readonly: {
		type: Boolean,
		default: false,
	},
	/** 主文案 */
	label: {
		type: String,
		default: null
	},
	indeterminate: {
		type: Boolean,
		default: false
	},
	name: {
		type: String,
		default: null
	},
	/** 用于标识是否为「全选选项」。单独使用无效，需在 CheckboxGroup 中使用 */
	checkAll: {
		type: Boolean,
		default: false,
	},
	/** 多选框的值 */
	value: {
		type: [String, Number, Boolean],
		default: null
	},
	checkedColor: {
		type: String,
		default: null
	},
	iconBgColor: {
		type: String,
		default: null
	},
	iconBorderColor: {
		type: String,
		default: null
	},
	iconDisabledColor: {
		type: String,
		default: null
	},
	iconDisabledBgColor: {
		type: String,
		default: null
	},
	icon: {
		type: String,
		default: 'rectangle'
	}, //?: 'circle' | 'line' | 'dot';
	size: {
		type: String,
		default: 'medium'
	}, //?: 'small' | 'medium' | 'large';
	iconSize: {
		type: String,
		defalut: null
	},
	fontSize: {
		type: String,
		defalut: null
	},
	labelStyle: {
		type: [String, Object]
	}
}