export default {
	visible: {
		type: Boolean,
		default: false,
	},
	/**
	  * 父子节点选中状态不再关联，可各自选中或取消
	  */
	checkStrictly: {
		type: Boolean,
		default: false,
	},
	uniCloud: {
		type: Boolean,
		default: false,
	},
	options: {
		type: Array,
		default: () => [{ }]
	},
	/**
	* 标题
	*/
	title: {
		type: String,
		default: null
	},
	keys: {
		type: Object,
		default: () => { }
	},
	/**
	* 选项值
	*/
	value: {
		type: String,
		default: null
	},
	/**
	* 选项值
	*/
	modelValue: {
		type: String,
		default: null
	},
	/**
	* 选项值，非受控属性
	*/
	defaultValue: {
		type: String,
		default: null
	},
	/**
	* 未选中时的提示文案
	*/
	placeholder: {
		type: String,
		default: '选择选项'
	},
	/**
	* 每级展示的次标题
	*/
	subTitles: {
		type: Array,
		default: () => []
	},
	/**
	* 关闭按钮
	*/
	closeable: {
		type: Boolean,
		default: true
	},
	swipeable: {
		type: Boolean,
		default: false
	},
	fontSize: {
		type: String,
		default: null
	},
	color: {
		type: String,
		default: null
	},
	bgColor: {
		type: String,
		default: null
	},
	iconSize: {
		type: String,
		default: null
	},
	activeColor: {
		type: String,
		default: null
	},
	confirmBtn: {
		type: [String, Object],
		default: null
	}
}