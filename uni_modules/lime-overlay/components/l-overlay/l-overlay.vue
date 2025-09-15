<template>
	<view 
		v-if="inited" 
		class="l-overlay" 
		:class="[lClass, classes]"
		:style="[styles, lStyle]"
		@click.stop="onClick" 
		@touchmove.stop="noop" 
		@transitionend="finished"
		:aria-role="ariaRole || 'button'" 
		:aria-label="ariaLabel || '关闭'">
		<slot></slot>
	</view>
</template>

<script lang="ts">
	// @ts-nocheck
	/**
	 * Overlay 遮罩层组件
	 * @description 用于创建模态遮罩层，通常配合弹窗、对话框等组件使用
	 * <br>插件类型：LOverlayComponentPublicInstance 
	 * @tutorial https://ext.dcloud.net.cn/plugin?name=lime-overlay
	 * 
	 * @property {string} ariaLabel 无障碍访问标签（需语义化描述作用）
	 * @property {string} ariaRole ARIA角色属性（默认：'presentation'）
	 * @property {string} lClass 自定义类名（会覆盖默认样式）
	 * @property {string} bgColor 背景颜色（默认：'rgba(0, 0, 0, 0.7)'）
	 * @property {string} lStyle 自定义样式（最高优先级，支持CSS字符串）
	 * @property {number} duration 背景过渡动画时长（单位：ms，默认：300）
	 * @property {boolean} preventScrollThrough 阻止滚动穿透（默认：true）
	 * @property {boolean} visible 是否显示遮罩层（支持v-model）
	 * @property {number} zIndex 层级（默认：1000）
	 * @event {Function} click 点击遮罩层时触发（常用于关闭操作）
	 * @event {Function} before-enter 
	 * @event {Function} enter 
	 * @event {Function} after-enter
	 * @event {Function} before-leave
	 * @event {Function} leave
	 * @event {Function} after-leave
	 */

	import { computed, defineComponent } from '@/uni_modules/lime-shared/vue';
	import { useTransition, type UseTransitionOptions, type TransitionEmitStatus } from '@/uni_modules/lime-transition';
	import overlayProps from './props';

	export default defineComponent({
		props: overlayProps,
		emits: ['click', 'before-enter', 'enter', 'after-enter', 'before-leave', 'leave', 'after-leave'],
		options: {
			addGlobalClass: true,
			virtualHost: true,
			externalClasses: true,
		},
		externalClasses: ['l-class'],
		setup(props, { emit }) {
			
			const {inited, display, classes, finished} = useTransition({
				defaultName: 'fade',
				appear: props.visible,
				emits: (name:TransitionEmitStatus) => { emit(name) },
				visible: (): boolean => props.visible,
				duration: props.duration,
			} as UseTransitionOptions)


			const styles = computed(() => ({
				'transition-duration': props.duration + 'ms',
				'background': props.bgColor,
				'z-index': props.zIndex,
				'display': !display.value ? 'none' : '',
			}))

			const onClick = () => {
				emit('click', !props.visible)
			}
			const noop = (e) => {
				e?.preventDefault();
				return
			}

			return {
				inited,
				styles,
				classes,
				noop,
				onClick,
				finished
			}
		}
	})
</script>
<style lang="scss">
	@import './index';
</style>