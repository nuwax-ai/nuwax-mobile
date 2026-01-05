<template>
	<button class="l-button l-class"
		:id="lId"
		:style="[styles, lStyle]"
		:class="[
			'l-button--' + size,
			'l-button--' + type,
			'l-button--' + shape,
			'l-button--' + computedVariant,
			{
				'l-button--ghost': ghost,
				'l-button--block': block,
				'l-button--disabled': disabled,
				'l-button--loading': loading,
			}
		]" 
		:form-type="disabled || loading ? '' : formType"
		:open-type="disabled || loading ? '' : openType" 
		:hover-stop-propagation="hoverStopPropagation"
		:hover-start-time="hoverStartTime" 
		:hover-stay-time="hoverStayTime" :lang="lang" 
		:session-from="sessionFrom"
		:hover-class="hoverClasses" 
		:send-message-title="sendMessageTitle" 
		:send-message-path="sendMessagePath"
		:send-message-img="sendMessageImg" 
		:app-parameter="appParameter" 
		:show-message-card="showMessageCard"
		@tap.stop="handleTap" 
		@getuserinfo="getuserinfo" 
		@contact="contact" 
		@getphonenumber="getphonenumber"
		@error="error" 
		@opensetting="opensetting" 
		@launchapp="launchapp" 
		@chooseavatar="chooseavatar"
		@agreeprivacyauthorization="agreeprivacyauthorization" 
		:aria-label="ariaLabel"
		:data-disabled="disabled||loading">
		<view class="l-button__loading"  v-if="loading">
			<l-loading inheritColor></l-loading>
		</view>
		<l-icon class="l-button__icon" v-if="icon" :name="icon"></l-icon>
		<view class="l-button__content" v-if="content || $slots.default">
			<slot>{{content}}</slot>
		</view>
	</button>
</template>
<script lang="ts">
	// @ts-nocheck
	/**
	 * Button 按钮组件
	 * @description 提供丰富的按钮样式和交互功能，支持多种形态和平台特性
	 * <br> 插件类型：LButtonComponentPublicInstance 
	 * @tutorial https://ext.dcloud.net.cn/plugin?name=lime-button
	 * 
	 * @property {string} ariaLabel 无障碍标签（用于屏幕阅读器）
	 * @property {boolean} block 块级布局（占满父容器宽度）
	 * @property {boolean} disabled 禁用状态
	 * @property {boolean} ghost 幽灵模式（透明背景+边框）
	 * @property {string} icon 左侧图标名称/路径
	 * @property {string} iconSize 图标尺寸（支持CSS单位）
	 * @property {boolean} loading 加载状态（显示加载动画）
	 * @property {UTSJSONObject} loadingProps 加载动画配置
	 * @property {'rectangle' | 'square' | 'round' | 'circle'} shape 按钮形状
	 * @value rectangle 长方形（默认）
	 * @value square 正方形
	 * @value round 圆角矩形
	 * @value circle 圆形
	 * @property {SizeEnum} size 按钮尺寸
	 * @value small 小号
	 * @value medium 中号（默认）
	 * @value large 大号
	 * @property {string} suffix 右侧附加内容（图标/文本）
	 * @property {'default' | 'primary' | 'danger' | 'warning' | 'success' | 'info'} type 色彩类型
	 * @value default
	 * @value primary
	 * @value danger 
	 * @value warning
	 * @value success
	 * @value info
	 * @property {'solid' | 'outline' | 'text' | 'light' | 'dashed'} variant 样式变体
	 * @value solid 
	 * @value outline
	 * @value text 
	 * @value light
	 * @value dashed
	 * @property {string} radius 自定义圆角（覆盖shape设置）
	 * @property {string} fontSize 文字字号（支持CSS单位）
	 * @property {string} textColor 文字颜色（支持CSS颜色值）
	 * @property {string} color 主色（背景/边框色）
	 * 
	 * @platform 微信小程序
	 * @property {string} formType 表单类型（submit/reset）
	 * @property {string} openType 开放能力（contact/share等）
	 * @property {string} lang 用户信息语言（zh_CN/zh_TW/en）
	 * @property {string} sessionFrom 会话来源（contact模式有效）
	 * @property {string} sendMessageTitle 消息卡片标题（contact模式有效）
	 * @property {string} sendMessagePath 消息跳转路径（contact模式有效）
	 * @property {string} sendMessageImg 消息卡片图片（contact模式有效）
	 * @property {string} appParameter APP启动参数（launchApp模式）
	 * @property {boolean} showMessageCard 显示消息卡片提示
	 * 
	 * @property {string} hoverClass 点击态样式类（默认：button-hover）
	 * @property {boolean} hoverStopPropagation 阻止祖先点击态
	 * @property {number} hoverStartTime 点击态延迟（默认：20ms）
	 * @property {number} hoverStayTime 点击态保留时间（默认：70ms）
	 * @event {Function} click 点击事件（禁用状态下不触发）
	 * @event {Function} getuserinfo 用户信息授权回调
	 * @event {Function} contact 客服会话回调
	 * @event {Function} agreeprivacyauthorization
	 * @event {Function} chooseavatar
	 * @event {Function} getphonenumber
	 * @event {Function} error
	 * @event {Function} opensetting
	 * @event {Function} launchapp
	 */
	import { computed, defineComponent } from '@/uni_modules/lime-shared/vue';
	import ButtonProps from './props'
	const name = 'l-button'
	export default defineComponent({
		name,
		options: {
			addGlobalClass: true,
		    virtualHost: true
		},
		behaviors: ['wx://form-field-button'],
		externalClasses: ['l-class',`l-class-icon`, `l-class-loading`],
		props: ButtonProps,
		emits: ['click','agreeprivacyauthorization', 'chooseavatar', 'getuserinfo','contact', 'getphonenumber', 'error', 'opensetting', 'launchapp'],
		setup(props, { emit }) {
			
			const computedVariant  = computed(():string => props.variant || (props.color ? 'solid' : (props.type == 'default' ? 'outline': 'solid')))
			const classes = computed(() => {
				return {
					[`${name}--${props.size}`]: true,
					[`${name}--${props.type}`]: true,
					[`${name}--${props.shape}`]: true,
					[`${name}--${computedVariant .value}`]: true,
					// [`${name}--color`]: props.color,
					[`${name}--ghost`]: props.ghost,
					[`${name}--block`]: props.block,
					[`${name}--disabled`]: props.disabled,
					[`${name}--loading`]: props.loading,
				}
			})
			const hoverClasses = computed(() => {
				return props.disabled || props.loading ? '' : (props.hoverClass || `l-button--hover`)
			})
			const styles = computed(()=>{
				const style:Record<string, any> = {}
				if(props.gap) {
					style['--l-button-gap'] = props.gap
				}
				if(props.color){
					if(['outline'].includes(props.variant) ){
						style['--l-button-border-color'] = props.color
						style['color'] = props.color
					} else {
						style['--l-button-border-color'] = props.color
						style['background'] = props.color
						style['color'] = 'white'
					}
				}
				
				return style
			})
			const getuserinfo = (e) => {
				emit('getuserinfo', e);
			}
			const contact = (e) => {
				emit('contact', e);
			}
			const getphonenumber = (e) => {
				emit('getphonenumber', e);
			}
			const error = (e) => {
				emit('error', e);
			}
			const opensetting = (e) => {
				emit('opensetting', e);
			}
			const launchapp = (e) => {
				emit('launchapp', e);
			}
			const chooseavatar = (e) => {
				emit('chooseavatar', e);
			}
			const agreeprivacyauthorization = (e) => {
				emit('agreeprivacyauthorization', e);
			}
			const handleTap = (e)=>{
				if (props.disabled || props.loading) return;
				emit('click', e);
			}
			
			return {
				classes,
				hoverClasses,
				styles,
				computedVariant,
				agreeprivacyauthorization,
				chooseavatar,
				getuserinfo,
				launchapp,
				opensetting,
				error,
				getphonenumber,
				contact,
				handleTap
			}
		}
	})
</script>
<style lang="scss">
	@import './index-u';
</style>