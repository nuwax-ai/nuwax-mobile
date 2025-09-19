export const ariaProps = {
	ariaHidden: Boolean,
	ariaRole: String,
	ariaLabel: String,
	ariaLabelledby: String,
	ariaDescribedby: String,
	ariaBusy: Boolean,
	lStyle: String
}
export default {
	...ariaProps,
	// lClass:String,
	lId: String,
	type: {
		type: String,
		default: 'default',
		validator(val : string) : boolean {
			return ['default', 'primary', 'danger', 'success', 'warning'].includes(val);
		},
	},
	variant: {
		type: String,
		default: null,
		validator(val : string) : boolean {
			return ['solid', 'outline', 'dashed','text', 'light'].includes(val);
		},
	},
	disabled: {
		type: Boolean,
		default: false
	},
	loading: {
		type: Boolean,
		default: false
	},
	size: {
		type: String,
		default: 'medium',
		validator(val : string) : boolean {
			if (val == '') return true;
			return ['mini', 'small', 'medium', 'large'].includes(val);
		},
	},
	shape: {
		type: String,
		default: 'rectangle',
		validator(val : string) : boolean {
			return ['rectangle', 'square', 'round', 'circle'].includes(val);
		},
	},
	icon: {
		type: String
	},
	iconSize: {
		type: String
	},
	block: {
		type: Boolean,
		default: false
	},
	ghost: {
		type: Boolean,
		default: false
	},
	content: {
		type: String,
		default: null
	},
	color: {
		type: String,
		default: null
	},
	radius: {
		type: String,
		default: null
	},
	fontSize: {
		type: String,
		default: null
	},
	textColor: {
		type: String,
		default: null
	},
	formType: {
		type: String,
		default: null
	},
	openType: {
		type: String,
		default: null
	},

	/** 指定按钮按下去的样式类，按钮不为加载或禁用状态时有效。当 `hover-class="none"` 时，没有点击态效果 */
	hoverClass: {
		type: String,
		default: '',
	},
	/** 指定是否阻止本节点的祖先节点出现点击态 */
	hoverStopPropagation: {
		type: Boolean,
		default: false,
	},
	/** 按住后多久出现点击态，单位毫秒 */
	hoverStartTime: {
		type: Number,
		default: 20,
	},
	/** 手指松开后点击态保留时间，单位毫秒 */
	hoverStayTime: {
		type: Number,
		default: 70,
	},
	/** 指定返回用户信息的语言，zh_CN 简体中文，zh_TW 繁体中文，en 英文。。<br />具体释义：<br />`en` 英文；<br />`zh_CN` 简体中文；<br />`zh_TW` 繁体中文。<br />[小程序官方文档](https://developers.weixin.qq.com/miniprogram/dev/component/button.html) */
	lang: {
		type: String,
		default: 'en',
	},
	/** 会话来源，open-type="contact"时有效 */
	sessionFrom: {
		type: String,
		default: '',
	},
	/** 会话内消息卡片标题，open-type="contact"时有效 */
	sendMessageTitle: {
		type: String,
		default: '',
	},
	/** 会话内消息卡片点击跳转小程序路径，open-type="contact"时有效 */
	sendMessagePath: {
		type: String,
		default: '',
	},
	/** 会话内消息卡片图片，open-type="contact"时有效 */
	sendMessageImg: {
		type: String,
		default: '',
	},
	/** 打开 APP 时，向 APP 传递的参数，open-type=launchApp时有效 */
	appParameter: {
		type: String,
		default: '',
	},
	/** 是否显示会话内消息卡片，设置此参数为 true，用户进入客服会话会在右下角显示"可能要发送的小程序"提示，用户点击后可以快速发送小程序消息，open-type="contact"时有效 */
	showMessageCard: {
		type: Boolean,
		default: false,
	},
	gap: {
		type: String
	}
}