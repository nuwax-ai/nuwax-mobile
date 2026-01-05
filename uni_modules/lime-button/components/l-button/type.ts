// @ts-nocheck
export type SizeEnum = 'small' | 'medium' | 'large';
export interface ButtonProps {
	ariaLabel?: string;
	lId ?: string;
	content ?: string
	/**
	 * 是否为块级元素
	 */
	block : boolean;
	/**
	 * 禁用状态
	 */
	disabled : boolean;
	/**
	 * 是否为幽灵按钮（镂空按钮）
	 */
	ghost : boolean;
	/**
	 * 按钮内部图标，可完全自定义
	 */
	icon ?: string;
	iconSize ?: string;

	/**
	 * 是否显示为加载状态
	 */
	loading : boolean;
	/**
	 * 透传加载组件全部属性
	 */
	loadingProps ?: UTSJSONObject//LoadingProps;
	/**
	 * 按钮形状：长方形、正方形、圆角长方形、圆形
	 */
	shape : 'rectangle' | 'square' | 'round' | 'circle';
	/**
	 * 组件尺寸
	 */
	size : SizeEnum;
	/**
	 * 右侧内容，可用于定义右侧图标
	 */
	suffix ?: string;
	/**
	 * 组件风格，依次为品牌色、危险色、
	 */
	type : 'default' | 'primary' | 'danger' | 'warning' | 'success' | 'info';
	/**
	 * 按钮形式，基础、线框、文字、高亮、虚线
	 */
	variant ?: 'solid' | 'outline' | 'text' | 'light' | 'dashed';
	radius ?: string
	fontSize ?: string;
	textColor ?: string;
	color ?: string;
	lStyle?: string;
	gap?: string;
	formType ?: string
	openType ?: string

	/** 指定按钮按下去的样式类，按钮不为加载或禁用状态时有效。当 `hover-class="none"` 时，没有点击态效果 */
	hoverClass ?: string
	/** 指定是否阻止本节点的祖先节点出现点击态 */
	hoverStopPropagation : boolean
	/** 按住后多久出现点击态，单位毫秒 */
	hoverStartTime : number
	/** 手指松开后点击态保留时间，单位毫秒 */
	hoverStayTime : number
	/** 指定返回用户信息的语言，zh_CN 简体中文，zh_TW 繁体中文，en 英文。。<br />具体释义：<br />`en` 英文；<br />`zh_CN` 简体中文；<br />`zh_TW` 繁体中文。<br />[小程序官方文档](https://developers.weixin.qq.com/miniprogram/dev/component/button.html) */
	lang :string
	/** 会话来源，open-type="contact"时有效 */
	sessionFrom : string,
	/** 会话内消息卡片标题，open-type="contact"时有效 */
	sendMessageTitle : string,
	/** 会话内消息卡片点击跳转小程序路径，open-type="contact"时有效 */
	sendMessagePath : string,
	/** 会话内消息卡片图片，open-type="contact"时有效 */
	sendMessageImg : string,
	/** 打开 APP 时，向 APP 传递的参数，open-type=launchApp时有效 */
	appParameter : string,
	/** 是否显示会话内消息卡片，设置此参数为 true，用户进入客服会话会在右下角显示"可能要发送的小程序"提示，用户点击后可以快速发送小程序消息，open-type="contact"时有效 */
	showMessageCard : boolean,
}