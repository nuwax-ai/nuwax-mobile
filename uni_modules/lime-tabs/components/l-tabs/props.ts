export default {
	list: {
		type: Array,
	},
	ellipsis: {
		type: Boolean,
		default: false
	},
	animated: {
		type: Boolean,
		default: false
	},
	duration: {
		type: [Number, String],
		default: 0.3,
	},
	showLine: {
		type: Boolean,
		default: true,
	},
	size: {
		type: String,
		default: 'medium' // large
	},
	/** 选项卡头部空间是否均分 */
	spaceEvenly: {
		type: Boolean,
		default: true,
	},
	split: {
		type: Boolean,
		default: true,
	},
	/** 是否可以滑动切换 */
	swipeable: {
		type: Boolean,
		default: true,
	},
	/** 激活的选项卡值 */
	value: {
		type: [String, Number],
		default: undefined,
	},
	modelValue: {
		type: [String, Number],
		default: undefined,
	},
	color: {
		type: String,
		default: null
	},
	activeColor: {
		type: String,
		default: null
	},
	lineColor: {
		type: String,
		default: null
	},
	lineWidth: {
		type: String,
		default: null
	},
	lineHeight: {
		type: String,
		default: null
	},
	bgColor: {
		type: String,
		default: null
	},
	fontSize: {
		type: String,
		default: null
	},
	padding: {
		type: String,
		default: null
	},
	/**
	 * 由于小程序popup会一开始就渲染导致下划线位置不对，所以增加这个值
	 */
	visible: {
		type: Boolean,
		default: false
	},
	lStyle: { 
		type: [String, Object],
	}
}