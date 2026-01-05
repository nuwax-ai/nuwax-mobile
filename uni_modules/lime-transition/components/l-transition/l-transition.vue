<template>
	<view class="l-transition l-class"
		v-if="destoryOnClose ? display && inited : inited"
		:class="[lClass, classes]" 
		:style="styles + lStyle"
		@transitionend="finished">
		<slot/>
	</view>
</template>
<script lang="ts">
	// @ts-nocheck
	/**
	 * Transition 过渡动画组件
	 * @description 用于实现元素显示/隐藏的过渡动画效果，支持自定义动画类名和参数
	 * <br>插件类型：LTransitionComponentPublicInstance 
	 * @tutorial https://ext.dcloud.net.cn/plugin?name=lime-transition
	 * 
	 * @property {boolean} appear 初始渲染是否应用动画（默认：false）
	 * @property {string} lClass 自定义容器类名
	 * @property {string} lStyle 自定义容器样式（CSS字符串）
	 * @property {boolean} destoryOnClose 隐藏时销毁内容（默认：false）
	 * @property {number} zIndex 层级（默认：100）
	 * @property {number} duration 过渡持续时间（ms，默认：300）
	 * @property {string} name 基础过渡类名前缀（默认："fade"）
	 * @property {boolean} visible 是否显示（支持v-model）
	 * @property {string} enterClass 进入动画初始状态类名
	 * @property {string} enterActiveClass 进入动画激活状态类名
	 * @property {string} enterToClass 进入动画结束状态类名
	 * @property {string} leaveClass 离开动画初始状态类名
	 * @property {string} leaveActiveClass 离开动画激活状态类名
	 * @property {string} leaveToClass 离开动画结束状态类名
	 * @event {Function} before-enter 进入动画开始前触发
	 * @event {Function} enter 进入动画开始触发
	 * @event {Function} after-enter 进入动画完成后触发
	 * @event {Function} before-leave 离开动画开始前触发
	 * @event {Function} leave 离开动画开始触发
	 * @event {Function} after-leave 离开动画完成后触发
	 */
	import { computed, defineComponent} from '@/uni_modules/lime-shared/vue';
	import { useTransition, type UseTransitionOptions } from '@/uni_modules/lime-transition';
	import transitionsProps from './props';
	
	export default defineComponent({
		props: transitionsProps,
		options: {
			styleIsolation: "apply-shared",
			addGlobalClass: true,
			externalClasses: true,
			virtualHost: true,
		},
		externalClasses: ['l-class'],
		emits: ['before-enter', 'enter', 'after-enter', 'before-leave', 'leave', 'after-leave'],
		setup(props, {emit}) {

			const {inited, display, classes, finished, toggle} = useTransition({
				name: (): string => props.name,
				emits: (name:string) => {
					emit(name)
				},
				visible: (): boolean => props.visible,
				enterClass: props.enterClass,
				enterActiveClass: props.enterActiveClass,
				enterToClass: props.enterToClass,
				leaveClass: props.leaveClass,
				leaveActiveClass: props.leaveActiveClass,
				leaveToClass: props.leaveToClass,
				appear: props.appear,
				duration: props.duration,
			} as UseTransitionOptions)
			
			const styles = computed(()=>{
				let style = `transition-duration:${props.duration}ms; z-index:${props.zIndex};`
				if (!display.value) {
					style+=`display:none;`
				}
				return style
			})
			
			return {
				inited,
				styles,
				display,
				classes,
				finished
			}
		}
	})
	
</script>
<style lang="scss">
 @import './index';
</style>
