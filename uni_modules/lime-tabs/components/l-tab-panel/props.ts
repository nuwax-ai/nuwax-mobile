export default {
	/**
	 * 透传至 Badge 组件
	 */
	badge: {
		type: [String, Number]
	},
	offset: {
		type: Array
	},
	dot: {
		type: Boolean,
		defalut: false
	},
	/**
	 * 选项卡内容隐藏时是否销毁
	 */
	destroyOnHide: {
		type: Boolean,
		defalut: false
	},
	/**
	 * 是否禁用当前选项卡
	 */
	disabled: {
		type: Boolean,
		defalut: false
	},
	/**
	 * 选项卡名称，可自定义选项卡导航内容
	 */
	label: {
		type: String
	},
	/**
	 * 是否启用选项卡懒加载
	 */
	lazy: {
		type: Boolean,
		defalut: false
	},
	/**
	 * 选项卡的值，唯一标识
	 */
	value: {
		type: [Number, String]
	}
}