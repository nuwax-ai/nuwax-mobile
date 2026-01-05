<template>
	<view class="l-tab__panel" aria-role="tabpanel">
		<slot/>
	</view>
</template>
<script lang="ts">
	// @ts-nocheck
	/**
	 * TabPanel 标签页面板组件
	 * @description 用于构建Tabs组件的单个内容面板，必须作为Tabs的子组件使用
	 * <br>插件类型：LTabPanelComponentPublicInstance 
	 * @tutorial https://ext.dcloud.net.cn/plugin?name=lime-tabs
	 * 
	 * @property {any} badge 徽标配置
	 * @property {number[]} offset 徽标位置偏移量[x,y]
	 * @property {boolean} dot 是否显示圆点徽标（默认：false）
	 * @property {boolean} destroyOnHide 内容隐藏时销毁DOM（默认：false）
	 * @property {boolean} disabled 禁用当前选项卡（默认：false）
	 * @property {string} label 选项卡标题内容
	 * @property {boolean} lazy 启用懒加载（默认：false）
	 * @property {number} value 选项卡唯一标识
	 */
	import {onMounted, defineComponent, inject, onUnmounted} from '@/uni_modules/lime-shared/vue';
	import panelProps from './props';
	export default defineComponent({
		name: 'l-tab-panel',
		props: panelProps,
		setup(props) {
			const children = inject<LTabPanelComponentPublicInstance[]|null>('LimeTabs', null) as Ref<LTabPanelComponentPublicInstance[]>|null;
			onMounted(()=>{
				if(!children) return
				children.value.push(props)
			})
			
			onUnmounted(()=>{
				if(!children) return
				children.value = children.value.filter((it):boolean => it != props)
			})
			
			return {
				
			}
		}
	})
</script>
<style lang="scss">
	@import './index';
</style>
