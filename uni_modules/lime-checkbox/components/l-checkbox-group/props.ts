// @ts-nocheck
export default {
	/** 是否禁用组件，默认为 false。CheckboxGroup.disabled 优先级低于 Checkbox.disabled */
	disabled: {
		type: Boolean,
		default: false
	},
	/** 支持最多选中的数量 */
	max: {
		type: Number,
		default: null,
	},
	/** 唯一标识 */
	name: {
		type: String,
		default: null,
	},
	/** 选中值 */
	value: {
		type: Array,
		default: null,
	},
	modelValue: {
		type: Array,
		default: null,
	},
	/** 选中值，非受控属性 */
	defaultValue: {
		type: Array,
		default: () => [],
	},
	direction: {
		type: String,
		default: 'horizontal'
	},
	// 未实现
	/** 以配置形式设置子元素。示例1：`['北京', '上海']` ，示例2: `[{ label: '全选', checkAll: true }, { label: '上海', value: 'shanghai' }]`。checkAll 值为 true 表示当前选项为「全选选项」 */
	options: {
		type: Array,
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
	readonly: {
		type: Boolean,
		default: false,
	},
}