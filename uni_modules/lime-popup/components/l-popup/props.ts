// @ts-nocheck
export default {
	/** 是否展示关闭按钮，值为 `true` 显示默认关闭按钮；值为 `false` 则不显示关闭按钮；也可以自定义关闭按钮 */
	closeable: {
		type: Boolean,
		default: false
	},
	/** 点击遮罩层是否关闭 */
	closeOnClickOverlay: {
		type: Boolean,
		default: true,
	},
	/** 是否在关闭浮层时销毁浮层 */
	destroyOnClose: Boolean,
	/** 浮层出现位置 */
	position: {
		type: String,
		default: 'center',
		validator(val: string) : boolean {
			if (!val) return true;
			return ['top', 'left', 'right', 'bottom', 'center'].includes(val);
		},
	},
	/** 防止滚动穿透 */
	preventScrollThrough: {
		type: Boolean,
		default: true,
	},
	overlayStyle: {
		type: [String, Object]
	},
	/** 是否显示遮罩层 */
	overlay: {
		type: Boolean,
		default: true,
	},
	/** 弹出层内容区的动画名，等价于transition组件的name属性 */
	transitionName: {
		type: String,
		default: '',
	},
	/** 是否显示浮层 */
	visible: {
		type: Boolean,
		default: undefined,
	},
	// vue2
	value: {
		type: Boolean,
		default: undefined,
	},
	modelValue: {
		type: Boolean,
		default: undefined,
	},
	/** 组件层级 默认为 999 */
	zIndex: {
		type: Number,
		default: 999
	},
	duration: {
		type: Number,
		default: 300
	},
	bgColor: {
		type: String
	},
	iconColor: {
		type: String
	},
	lStyle: {
		type: String
	},
	closeIcon: {
		type: String,
		default: 'close'
	},
	radius: {
		type: [String, Number, Array],
		default: undefined
	}
};