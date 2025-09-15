<template>
	<view class="demo-block">
		<text class="demo-block__title-text ultra">Tabs 选项卡</text>
		<text class="demo-block__desc-text">用于在不同的内容区域之间进行切换</text>
		<view class="demo-block__body">
			<!-- <view class="demo-block">
				<text class="demo-block__title-text">基础用法</text>
				<view class="demo-block__body">
					<l-tabs v-model="value" :list="list"></l-tabs>
				</view>
			</view> -->
			<view class="demo-block">
				<text class="demo-block__title-text">组合</text>
				<view class="demo-block__body ">
					<l-tabs>
					    <l-tab-panel :value="0" label="选项" />
					    <l-tab-panel :value="1" label="选项" />
					    <l-tab-panel :value="2" label="选项" />
					</l-tabs>
				</view>
			</view>
			<view class="demo-block">
				<text class="demo-block__title-text">等距</text>
				<view class="demo-block__body ">
					<l-tabs :space-evenly="false">
					    <l-tab-panel :value="0" label="选项" />
					    <l-tab-panel :value="1" label="选项" />
					    <l-tab-panel :value="2" label="选项" />
					    <l-tab-panel :value="3" label="选项" />
					    <l-tab-panel :value="4" label="选项" />
					    <l-tab-panel :value="5" label="选项" />
					    <l-tab-panel :value="6" label="选项" />
					</l-tabs>
				</view>
			</view>
			<view class="demo-block">
				<text class="demo-block__title-text">徽标</text>
				<view class="demo-block__body ">
					<l-tabs :space-evenly="false">
					    <l-tab-panel :value="0" label="选项" />
					    <l-tab-panel :value="1" label="选项" :dot="true" />
					    <l-tab-panel :value="2" label="选项" />
					    <l-tab-panel :value="3" label="选项" badge="8" :offset="[-8,3]"/>
					    <l-tab-panel :value="4" label="选项" />
					    <l-tab-panel :value="5" label="选项" />
					    <l-tab-panel :value="6" label="选项" />
					</l-tabs>
				</view>
			</view>
			<view class="demo-block">
				<text class="demo-block__title-text">徽标</text>
				<view class="demo-block__body ">
					<l-tabs v-model="value" :space-evenly="false" animated>
						<template #right>
							<text>11212</text>
						</template>
						<l-tab-panel :value="0" label="选项">
							<text>选项选项选项选项选项选项选项选项选项选项选项选项选项选项选项选项选项选项选项选项选项选项选项选项选项选项选项选项选项1</text>
						</l-tab-panel>
						<l-tab-panel :value="1" label="选项">
							<text>12选项选项2</text>
						</l-tab-panel>
						<l-tab-panel :value="2" label="选项">
							<text>选项3</text>
						</l-tab-panel>
						<l-tab-panel :value="3" label="选项">
							<text>选项4</text>
						</l-tab-panel>
						<l-tab-panel :value="4" label="选项">
							<text>选项4</text>
						</l-tab-panel>
						<l-tab-panel :value="5" label="选项">
							<text>选项5</text>
						</l-tab-panel>
						<l-tab-panel :value="6" label="选项">
							<text>选项6</text>
						</l-tab-panel>
					</l-tabs>
				</view>
			</view>
			<view class="demo-block">
				<text class="demo-block__title-text">等距</text>
				<view class="demo-block__body ">
					<l-tabs v-model="value" :space-evenly="false" color="red" active-color="yellow" line-color="yellow">
						<l-tab-panel v-for="item, index in list3" :badge="item['badge']" :value="item['value']"
							:disabled="item['disabled']" :label="item['label']" />
					</l-tabs>
				</view>
			</view>
		</view>
	</view>
</template>

<script>
	export default {
		data() {
			return {
				value: 1,
				list: [{
						value: 1,
						label: '选项',
					},
					{
						value: 2,
						label: '选项',
					},
					{
						value: 3,
						label: '选项',
					},
					{
						value: 4,
						label: '选项',
					}
				],
				list2: [],
				list3: [{
						value: 1,
						label: '选项1',
					},
					{
						value: 2,
						label: '选项2',
						badge: 5,
					},
					{
						value: 3,
						label: '选项3',
					},
					{
						value: 4,
						label: '选项4',
						badge: 'new',
						offset: [-8, 3]
					},
					{
						value: 5,
						label: '选项5',
						disabled: true,
					},
					{
						value: 6,
						label: '选项6',
					},

					{
						value: 7,
						label: '选项7',
					},
					{
						value: 8,
						label: '选项8',
					},
					{
						value: 9,
						label: '选项9',
					},
				]
			}
		}
	}
</script>

<style lang="scss">
	.btn {
		margin-bottom: 20rpx;
		margin-right: 20rpx;
		align-self: center;
	}

	.demo-block {
		margin: 32px 0 0;

		// overflow: visible;
		&.card {
			background-color: white;
			padding: 30rpx;
			margin-left: 10px !important;
			margin-right: 10px !important;
			margin-bottom: 20rpx !important;
		}

		&__title {
			margin: 0;
			margin-top: 8px;

			&-text {
				color: rgba(0, 0, 0, 0.6);
				font-weight: 400;
				font-size: 14px;
				line-height: 16px;
				display: flex;
				margin-left: 20px;

				&.large {
					color: rgba(0, 0, 0, 0.9);
					font-size: 18px;
					font-weight: 700;
					line-height: 26px;
					margin-left: 20px;
				}

				&.ultra {
					color: rgba(0, 0, 0, 0.9);
					font-size: 24px;
					font-weight: 700;
					line-height: 32px;
				}
			}
		}

		&__desc-text {
			color: rgba(0, 0, 0, 0.6);
			margin: 8px 16px 0 0;
			font-size: 14px;
			line-height: 22px;
			margin-left: 20px;
		}

		&__body {
			margin: 16px 0;
			overflow: visible;

			.demo-block {
				// margin-top: 0px;
				margin: 0;
			}
		}
	}
</style>