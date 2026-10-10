<template>
	<demo-block title="加载" type="ultra">
		<demo-block title="基础">
			<view class="row">
				<l-loading></l-loading>
				<l-loading type="spinner"></l-loading>
				<l-loading inherit-color type="ball"></l-loading>
			</view>
		</demo-block>
		<demo-block title="文字">
			<!-- <l-loading>加载中…</l-loading> -->
			<l-loading text="加载中…"></l-loading>
		</demo-block>
		<demo-block title="垂直">
			<!-- <l-loading :vertical="true">加载中…</l-loading> -->
			<l-loading :vertical="true" text="加载中…"></l-loading>
		</demo-block>
		<demo-block title="尺寸">
			<view class="row">
				<l-loading size="40rpx"></l-loading>
				<l-loading size="60rpx"></l-loading>
			</view>
		</demo-block>
		<demo-block title="颜色">
			<view class="row">
				<!-- #ifndef UNI-APP-X -->
				<l-loading inherit-color></l-loading>
				<l-loading inherit-color type="spinner"></l-loading>
				<l-loading color="red"></l-loading>
				<!-- #endif -->
				<!-- #ifdef UNI-APP-X -->
				<l-loading color="red"></l-loading>
				<l-loading color="red" type="spinner"></l-loading>
				<!-- #endif -->
			</view>
		</demo-block>
	</demo-block>
</template>
<script>
	export default {

	 }
</script>
<style lang="scss">
	.row {
		display: flex;
		flex-direction: row;
		/* #ifndef UNI-APP-X */
		gap: 50rpx;
		/* #endif */
	}
</style>