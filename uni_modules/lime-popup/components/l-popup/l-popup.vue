<template>
	<view>
		<l-overlay
			:visible="innerValue" 
			:zIndex="overlayZIndex"
			:preventScrollThrough="preventScrollThrough"
			:l-style="overlayStyle"
			@click="handleOverlayClick"
			v-if="destroyOnClose ? display && overlay : overlay">
		</l-overlay>
		<view class="l-popup" 
			v-if="destroyOnClose ? display : inited"
			:class="rootClass" 
			:style="[styles, lStyle]"
			@transitionend="finished">
			<slot></slot>
			<view class="l-popup__close" v-if="closeable" @click="handleClose">
				<slot name="close-btn">
					<l-icon class="l-popup__close-icon" :name="closeIcon" v-if="closeable" size="54rpx" :color="iconColor" />
				</slot>
			</view>
		</view>
	</view>
</template>
<script lang="ts">
	// @ts-nocheck
	/**
	 * Popup 弹出层组件
	 * @description 提供多种位置的弹窗展示能力，支持自定义内容和动画效果
	 * <br>插件类型：LPopupComponentPublicInstance 
	 * @tutorial https://ext.dcloud.net.cn/plugin?name=lime-popup
	 * 
	 * @property {boolean} closeable 显示关闭按钮（默认：false）
	 * @property {boolean} closeOnClickOverlay 点击遮罩关闭（默认：true）
	 * @property {boolean} destroyOnClose 关闭时销毁内容（默认：false）
	 * @property {string} overlayStyle 遮罩层样式（支持CSS字符串）
	 * @property {'top' | 'left' | 'right' | 'bottom' | 'center' | ''} position 弹出位置
	 * @value top    从顶部滑入
	 * @value bottom 从底部滑入
	 * @value left   从左侧滑入  
	 * @value right  从右侧滑入
	 * @value center 居中显示（默认）
	 * @property {boolean} preventScrollThrough 阻止滚动穿透（默认：true）
	 * @property {boolean} overlay 显示遮罩层（默认：true）
	 * @property {string} transitionName 自定义动画名称（配合transition使用）
	 * @property {string|number|Array} radius 圆角 可以是字符，数值，数组
	 * @property {boolean} visible 控制显示/隐藏（支持v-model）
	 * @property {number} zIndex 组件层级（默认：999）
	 * @property {number} duration 动画时长（单位ms，默认：300）
	 * @property {string} bgColor 内容区域背景色（默认：#ffffff）
	 * @property {string} closeIcon 关闭图标名称/路径（默认：'close'）
	 * @property {string} iconColor 关闭图标颜色（默认：#333）
	 * @property {string} lStyle 自定义内容区样式（支持CSS字符串）
	 * @property {boolean} safeAreaInsetBottom 适配底部安全区域（默认：true）
	 * @property {boolean} safeAreaInsetTop 适配顶部安全区域（默认：true）
	 * @event {Function} close 关闭时触发（返回触发来源：'close-btn' | 'overlay'）
	 * @event {Function} change 切换时触发
	 * @event {Function} click-overlay 点击遮罩触发
	 * @event {Function} click-close 点击关闭触发
	 * @event {Function} open 打开触发
	 * @event {Function} opened 打开完成触发
	 * @event {Function} closed 关闭完成触发
	 * @event {Function} before-enter
	 * @event {Function} enter 
	 * @event {Function} after-enter
	 * @event {Function} before-leave
	 * @event {Function} leave
	 * @event {Function} after-leave
	 */
	import { computed, defineComponent } from '@/uni_modules/lime-shared/vue';
	import { useTransition, type UseTransitionOptions, type TransitionEmitStatus } from '@/uni_modules/lime-transition';
	import popupProps from './props'
	import { convertRadius } from './utils'
	export default defineComponent({
		name: 'l-popup',
		props: popupProps,
		options: {
			addGlobalClass: true,
			virtualHost: true,
		},
		externalClasses: ['l-class'],
		emits: ['change', 'click-overlay', 'click-close', 'open', 'opened','close','closed','update:modelValue', 'input', 'before-enter', 'enter', 'after-enter', 'before-leave', 'leave', 'after-leave'],
		setup(props, { emit }) {
			const innerValue = computed({
				set(value: boolean) {
					emit('change', value)
					emit('update:modelValue', value)
					// #ifdef VUE2
					emit('input', value)
					// #endif
				},
				get():boolean {
					return props.visible || props.modelValue || props.value || false
				}
			} as WritableComputedOptions<boolean>)
		
			const {inited, display, classes, finished} = useTransition({
				defaultName: props.transitionName || 'popup-fade',
				appear: innerValue.value,
				emits: (name:TransitionEmitStatus) => { 
					if(name == 'before-enter') {
						emit('open')
					} else if(name == 'after-enter') {
						emit('opened')
					} else if(name == 'before-leave') {
						emit('close')
					} else if(name == 'after-leave') {
						emit('closed')
					}
					emit(name) 
				},
				visible: (): boolean => innerValue.value,
				duration: props.duration,
			} as UseTransitionOptions)
			
			const overlayZIndex = computed(():number =>  props.zIndex > 0?  props.zIndex - 1 : 998);
			
			const rootClass = computed(():string=>{
				const safe = props.safeAreaInsetTop && props.position == 'top'
					?  'l-safe-area-top' 
					:  props.safeAreaInsetBottom && props.position == 'bottom' 
						? 'l-safe-area-bottom'
						: ''
					
				return `l-popup--${props.position} ${safe} ${classes.value}`
				// return `l-popup--${props.position} ${classes.value}`
			})
			
			const styles = computed(() => {
				const style:Record<string, any> = {}
				style['transition-duration'] = props.duration + 'ms'
				if (props.bgColor != null) {
					style["background"] = props.bgColor!
				}
				if (props.zIndex > 0) {
					style["z-index"] = props.zIndex
				}
				if (!display.value) {
					style["display"] = "none"
				}
				
				if(props.radius) {
					const values = convertRadius(props.radius!)
					
					style['border-top-left-radius'] = values[0]
					style['border-top-right-radius'] = values[1]
					style['border-bottom-right-radius'] = values[2]
					style['border-bottom-left-radius'] = values[3]
				}
				
				return style
			})
			
			const handleOverlayClick = () => {
				if(props.closeOnClickOverlay) {
					innerValue.value = false
					emit('click-overlay')
				}
			}
			const handleClose = () => {
				innerValue.value = false
				emit('click-close')
			}
			
			return {
				innerValue,
				inited,
				display,
				finished,
				overlayZIndex,
				rootClass,
				styles,
				handleOverlayClick,
				handleClose
			}
		}
	})
</script>
<style lang="scss">
	@import "./index-u";
</style>