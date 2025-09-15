<template>
	<view class="l-tabs">
		<view class="l-tabs__wrap" :style="[styles, lStyle]">
			<slot name="left"></slot>
			<scroll-view class="l-tabs__scroll" :class="{'l-tabs__scroll--split': split}" enhanced enable-flex
				:scroll-left="scrollLeft" scroll-x scroll-anchoring scroll-with-animation enable-passive
				:show-scrollbar="false" @scroll="onScroll">
				<view class="l-tabs__nav">
					<view class="l-tabs__item"
						:style="{color: !item.disabled && (index == currentIndex ? activeColor : color)}" :class="[
							'l-tabs__item-text--' + size, 
							{
								
								'l-tabs__item--active': index == currentIndex, 
								'l-tabs__item--evenly': spaceEvenly, 
								'l-tabs__item--disabled': item.disabled
							}
						]" v-for="(item, index) in tabs" :key="index" @tap="onClick(index, item)" aria-role="tab">
						<slot name="label" :item="item" :active="index == currentIndex" :disabled="item.disabled">
							<l-badge v-if="item.dot == true || item.badge" :dot="item.dot" :offset="item.offset"
								:content="item.badge">
								<view class="l-tabs__item-text l-ellipsis">
									{{item.label}}
								</view>
							</l-badge>
							<view v-else class="l-tabs__item-text l-ellipsis">
								{{item.label}}
							</view>
						</slot>

					</view>
					<view class="l-tabs__track" :style="[trackStyle]"></view>
				</view>
			</scroll-view>
			<slot name="right"></slot>
		</view>
		<view class="l-tabs__content" @touchstart="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd"
			@touchcancel="onTouchEnd" :class="{'l-tabs__content--animated': animated}" v-if="$slots['default']">
			<view class="l-tabs__content-inner" :style="[innerStyle]" ref="innerRef">
				<slot></slot>
			</view>
		</view>
	</view>
</template>
<script lang="ts">
	// @ts-nocheck
	/**
	 * Tabs 标签页组件
	 * @description 用于内容分类展示和切换，支持多种样式和交互效果
	 * <br>插件类型：LTabsComponentPublicInstance 
	 * @tutorial https://ext.dcloud.net.cn/plugin?name=lime-tabs
	 * 
	 * @property {TabPanel[]} list 选项卡配置数组
	 * @property {boolean} ellipsis 是否省略超长文本（默认：true）
	 * @property {boolean} animated 是否启用切换动画（默认：false）
	 * @property {number} duration 动画时长（ms，默认：300）
	 * @property {boolean} showLine 显示底部激活线条（默认：true）
	 * @property {'medium' | 'large'} size 组件尺寸（默认："medium"）
	 * @value medium
	 * @value large
	 * @property {boolean} spaceEvenly 均分选项卡宽度（默认：false）
	 * @property {boolean} swipeable 支持滑动切换（默认：true）
	 * @property {number} value 当前激活选项卡索引（支持v-model）
	 * @property {string} color 默认文字颜色（默认："#333"）
	 * @property {string} activeColor 激活状态颜色（默认：主题色）
	 * @property {string} lineColor 激活线条颜色（默认：跟随activeColor）
	 * @property {string} lineWidth 激活线条宽度（默认："20px"）
	 * @property {string} lineHeight 激活线条高度（默认："3px"）
	 * @property {string} bgColor 背景颜色
	 * @property {string} fontSize 文字大小（支持CSS单位）
	 * @property {string} padding 内边距（支持CSS简写）
	 * @property {boolean} split 显示分隔线（默认：false）
	 * @property {boolean} visible 是否显示组件（默认：true）
	 * @event {Function} change 选项卡切换时触发（返回激活索引）
	 * @event {Function} click 点击时触发（返回激活索引）
	 */


	import { defineComponent, ref, provide, reactive, getCurrentInstance, watch, watchEffect, computed, type ComputedRef, onUnmounted, nextTick, onMounted } from '@/uni_modules/lime-shared/vue';
	import tabsProps from './props'
	import { TabPanel } from './type';
	import { getRect, getAllRect } from '@/uni_modules/lime-shared/getRect'
	import { clamp } from '@/uni_modules/lime-shared/clamp'
	import { calcScrollOffset, ease, calculateTabPositions } from './utils'
	import { useTouch } from './touch';
	// import { onReady } from '@dcloudio/uni-app'
	export default defineComponent({
		name: 'l-tabs',
		props: tabsProps,
		options: {
			addGlobalClass: true,
			virtualHost: true,
		},
		emits: ['update:modelValue', 'change', 'input', 'click', 'total-width'],
		setup(props, { emit }) {
			const context = getCurrentInstance().proxy!
			const scrollLeft = ref(0)
			const lastLeft = ref(0)
			const trackDistance = ref(0)
			const children = ref([])
			const innerStyle = reactive({
				width: '',
				'transition-duration': ``,
				'transform': ``,
			})
			const defaultValue = ref(props.value ?? props.modelValue ?? 0)
			const currentValue = computed({
				set(value : number) {
					defaultValue.value = value
					emit('update:modelValue', value)
					emit('change', value)
					// #ifdef VUE2
					emit('input', value)
					// #endif
				},
				get() : number {
					return props.value ?? props.modelValue ?? defaultValue.value
				}
			} as WritableComputedOptions<number>);

			const styles = computed(() => {
				const style : Record<string, any> = {};
				if (props.bgColor) {
					style['--l-tab-nav-bg-color'] = props.bgColor
				}
				if (!['medium', 'large'].includes(props.size)) {
					style['--l-tab-item-height'] = props.size
				}
				if (props.padding) {
					style['--l-tab-item-padding'] = props.padding
				}
				if (props.fontSize) {
					style['--l-tab-font-size'] = props.fontSize
				}
				return style
			})

			const trackStyle = computed(() : Map<string, any> => {
				const style : Record<string, any> = {
					'-webkit-transform': `translateX(${trackDistance.value}px)`,
					'transform': `translateX(${trackDistance.value}px)`,
				};
				if (props.lineColor) {
					style['background'] = props.lineColor!
				}
				if (props.lineWidth) {
					style['width'] = props.lineWidth!
				}
				if (props.lineHeight) {
					style['height'] = props.lineHeight!
				}
				return style
			})

			const tabs : ComputedRef<TabPanel[]> = computed(() => {
				if (props.list) return props.list as TabPanel[]
				return children.value
			})

			const currentIndex = computed(() => {
				const index = tabs.value.findIndex((child, index) => (child.value || index) == currentValue.value)
				if (index >= 0) return index
				return 0
			})
			
			const tabRects = ref<DOMRect[]>([])  // 存储每个tab的尺寸位置
			
			const totalTabsWidth = computed(() : number => {
				if (tabRects.value.length == 0) return 0
				return tabRects.value.reduce((sum : number, rect : DOMRect) : number => sum + rect.width, 0)
			})
			const moveToActiveTab = () => {
				nextTick(() => {
					try {
						Promise.all([
							getRect(`.l-tabs__scroll`, context),
							getRect(`.l-tabs__track`, context),
							getAllRect(`.l-tabs__item`, context)
						]).then(([scrollRect, trackRect, tabsRects]) => {
							const index = currentIndex.value
							const tabRect = tabsRects[index];
							tabRects.value = tabsRects
							if (!tabRect) return;
							
							let [distance] = calculateTabPositions(tabsRects, index)
						
							if (totalTabsWidth.value == 0) return
							const offset = calcScrollOffset(scrollRect.width, tabRect.left, tabRect.width, lastLeft.value);
							const maxOffset = totalTabsWidth.value - scrollRect.width;
							scrollLeft.value = clamp(offset, 0, maxOffset)

							// distance += (tabRect.width - trackRect.width) / 2;
							trackDistance.value = distance + (tabRect.width - trackRect.width) / 2;
						})
					} catch (e) {
						console.error(e)
					}
				})
			}
			const updateInnerStyle = (offset : number) => {
				if (props.list && props.list.length > 0) return
				nextTick(() => {
					Promise.all(
						[
							getRect('.l-tabs__content', context),
							getRect('.l-tabs__content-inner', context)
						]).then(([parent, inner]) => {
							const left = -parent.width * currentIndex.value + offset;
							if (offset != 0) {
								innerStyle.transform = `translateX(${left}px)`
								innerStyle['transition-duration'] = `0s`
							} else {
								if (props.animated) {
									innerStyle['transition-duration'] = offset != 0 || !props.animated ? '0s' : `${props.duration}s`
								}
								innerStyle.transform = `translateX(${left}px)`
							}
						})
				})
			}


			const onScroll = (e) => {
				lastLeft.value = e.detail.scrollLeft
			}

			const onClick = (index : number, item : TabPanel) => {
				const { value = index, disabled, label } = item;
				if (disabled || currentValue.value === value) { return }
				currentValue.value = value
				emit('click', value)
				moveToActiveTab()
			}
			const getAvailableTabIndex = (deltaX : number) : number => {
				const step = deltaX > 0 ? -1 : 1;
				const len = tabs.value.length;
				for (let i = step; currentIndex.value + step >= 0 && currentIndex.value + step < len; i += step) {
					const newIndex = currentIndex.value + i;

					if (newIndex >= 0 && newIndex < len && tabs.value.length > newIndex && !tabs.value[newIndex].disabled) {
						return newIndex;
					}
				}
				return -1;
			}
			const touch = useTouch();
			const onTouchStart = (event : UniTouchEvent) => {
				if (!props.swipeable) return;
				touch.start(event);
			}
			const onTouchMove = (event : UniTouchEvent) => {
				if (!props.swipeable) return;
				touch.move(event);
				const { direction, deltaX, startX } = touch
				if (direction.value != 'horizontal') return
				if (!props.animated) return
				const isAtFirstTab = currentIndex.value == 0;
				const isAtLastTab = currentIndex.value == tabs.value.length - 1;

				if ((isAtFirstTab && deltaX.value > 0) || (isAtLastTab && deltaX.value < 0)) {
					const base = isAtFirstTab ? 1 : -1;
					const adjustedDelta = ease(deltaX.value, base);
					updateInnerStyle(adjustedDelta);
				} else {
					updateInnerStyle(deltaX.value);
				}
			}
			const onTouchEnd = () => {
				if (!props.swipeable) return;
				const { direction, deltaX, offsetX } = touch
				const minSwipeDistance = 50;
				if (direction.value == 'horizontal' && offsetX.value >= minSwipeDistance) {
					const index = getAvailableTabIndex(deltaX.value);
					if (index != -1) {
						onClick(index, tabs.value[index])
					}
				}
				updateInnerStyle(0)
			}

			watchEffect(() => {
				// console.log('tabs', tabs.value)
				if (tabs.value.length == 0) return
				moveToActiveTab()
			})
			// const stopWatch = watch(tabs, (v) => {
			// 	moveToActiveTab()
			// })
			const stopValueWatch = watch(currentValue, (_v : number) => {
				moveToActiveTab()
				updateInnerStyle(0)
			})

			const stopVisibleWatch = watch(() => props.visible, (v) => {
				if (!v) return
				setTimeout(() => {
					moveToActiveTab()
					updateInnerStyle(0)
				}, 100)
			})


			// 添加监听器，当总宽度变化时emit事件
			watch(totalTabsWidth, (newWidth : number, oldWidth : number) => {
				if (newWidth !== oldWidth && newWidth > 0) {
					emit('total-width', newWidth)
				}
			})

			onMounted(() => {
				nextTick(() => {
					setTimeout(() => {
						if (tabs.value.length == 0) return
						moveToActiveTab()
						updateInnerStyle(0)
					}, 100)
				})
			})
			onUnmounted(() => {
				// stopWatch()
				stopVisibleWatch()
				stopValueWatch()
			})


			provide('LimeTabs', children)
			return {
				styles,

				tabs,
				scrollLeft,
				currentValue,
				currentIndex,
				trackStyle,
				innerStyle,
				onScroll,
				onClick,
				onTouchStart,
				onTouchMove,
				onTouchEnd
			}
		}
	})
</script>
<style lang="scss">
	@import './index';
</style>