<template>
	<view class="l-class l-loading" :class="['l-loading--' + type, {'is-vertical': vertical}]" :style="{color: inheritColor ? 'inherit': ''}">
		<!-- #ifdef APP-NVUE -->
		<loading-indicator class="l-loading__circular" :style="[spinnerStyle]" :animating="true"/>
		<!-- #endif -->
		<!-- #ifndef APP-NVUE -->
		<view class="l-loading__ball" v-if="type == 'ball'" :style="[spinnerStyle]"></view>
		<view class="l-loading__circular" v-if="type == 'circular'" :style="[spinnerStyle]"></view>
		<view class="l-loading__spinner" v-if="type == 'spinner'" :style="[spinnerStyle]">
			<view class="l-loading__dot" v-for="item in 12" :key="item" :style="{'--l-loading-dot': item}"></view>
		</view>
		<!-- #endif -->
		<text class="l-loading__text" v-if="$slots['default']||text" :style="[textStyle]">
			{{text}}<slot></slot>
		</text>
	</view>
</template>
<script lang="ts">
	/**
	 * Loading 加载指示器
	 * @description 用于表示加载中的过渡状态，支持多种动画类型和布局方式
	 * @tutorial https://ext.dcloud.net.cn/plugin?name=lime-loading
	 * 
	 * @property {string} color 加载图标颜色（默认：主题色）
	 * @property {'circular' | 'spinner' | 'failed'} type 加载状态类型
	 * @value circular  环形旋转动画（默认）
	 * @value spinner   菊花转动画
	 * @value failed    加载失败提示
	 * @property {string} text 提示文字内容
	 * @property {string} textColor 文字颜色（默认同color）
	 * @property {string} textSize 文字字号（默认：14px）
	 * @property {boolean} vertical 是否垂直排列图标和文字
	 * @property {boolean} animated 是否启用旋转动画（failed类型自动禁用）
	 * @property {string} size 图标尺寸（默认：'40px'）
	 */
	import {computed, defineComponent} from '@/uni_modules/lime-shared/vue';
	import {addUnit} from '@/uni_modules/lime-shared/addUnit';
	import {unitConvert} from '@/uni_modules/lime-shared/unitConvert';
	import LoadingProps from './props';
	const name = 'l-loading';
	
	export default defineComponent({
		// name,
		props:LoadingProps,
		setup(props) {
			const classes = computed(() => {
				const {type, vertical} = props
				return {
					[name + '--' + type]: type,
					['is-vertical']: vertical,
				}
			})
			const spinnerStyle = computed(() => {
				const size = unitConvert(props.size ?? 0) * (props.type == 'ball' ? 0.6 : 1);
				return {
					color: props.color,
					width: size != 0 && (props.type == 'ball' ? addUnit(size * 2.1) : addUnit(size)),
					height: size != 0 && addUnit(size),
					'--l-loadding-ball-size': size != 0 && addUnit(size)
				}
			})
			const textStyle = computed(() => {
				return {
					color: props.textColor,
					fontSize: props.textSize,
				}
			})
			return {
				classes,
				spinnerStyle,
				textStyle
			}
		}
	})
</script>

<style lang="scss">
	@import './index.scss';
</style>