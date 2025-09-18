<template>
	<view class="demo-block">
		<text class="demo-block__title-text ultra">复选框</text>
		<text class="demo-block__desc-text" style="display: flex;">在一组备选项中进行多选。</text>
		<view class="demo-block__body">
			<view class="demo-block card">
				<text class="demo-block__title-text large">基本用法{{checked}}</text>
				<view class="demo-block__body row">
					<l-checkbox v-model="checked" style="margin-right: 7px">复选框</l-checkbox>
					<l-checkbox style="margin-right: 7px" icon="circle">复选框</l-checkbox>
					<l-checkbox style="margin-right: 7px" icon="dot">复选框</l-checkbox>
					<l-checkbox icon="line">复选框</l-checkbox>
				</view>
			</view>
			<view class="demo-block card">
				<text class="demo-block__title-text large">状态样式</text>
				<view class="demo-block__body row">
					<l-checkbox style="margin-right: 7px" disabled>复选框</l-checkbox>
					<l-checkbox style="margin-right: 7px" disabled checked>复选框</l-checkbox>
					<l-checkbox style="margin-right: 7px" indeterminate>复选框</l-checkbox>
					<l-checkbox disabled indeterminate>复选框</l-checkbox>
					<view style="width: 7px; height: 20px;  width: 100%;"></view>
					<l-checkbox style="margin-right: 7px" disabled icon="circle">复选框</l-checkbox>
					<l-checkbox style="margin-right: 7px" disabled checked icon="circle">复选框</l-checkbox>
					<l-checkbox style="margin-right: 7px" indeterminate icon="circle">复选框</l-checkbox>
					<l-checkbox disabled indeterminate icon="circle">复选框</l-checkbox>
					<view style="width: 7px; height: 20px;  width: 100%;"></view>
					<l-checkbox style="margin-right: 7px" disabled icon="dot">复选框</l-checkbox>
					<l-checkbox style="margin-right: 7px" disabled checked icon="dot">复选框</l-checkbox>
					<l-checkbox style="margin-right: 7px" indeterminate icon="dot">复选框</l-checkbox>
					<l-checkbox disabled indeterminate icon="dot">复选框</l-checkbox>
					<view style="width: 7px; height: 20px;  width: 100%;"></view>
					<l-checkbox style="margin-right: 7px" disabled icon="line">复选框</l-checkbox>
					<l-checkbox style="margin-right: 7px" disabled checked icon="line">复选框</l-checkbox>
					<l-checkbox style="margin-right: 7px" indeterminate icon="line">复选框</l-checkbox>
					<l-checkbox disabled indeterminate icon="line">复选框</l-checkbox>
				</view>
			</view>
			<view class="demo-block card">
				<text class="demo-block__title-text large">选项组</text>
				<view class="demo-block__body row">
					<text>{{checked2}}</text>
					<l-checkbox-group v-model="checked2" @change="onChange">
						<l-checkbox style="margin-right: 20px" value="Beijing" label="北京" />
						<l-checkbox style="margin-right: 20px" value="Shanghai" label="上海" />
						<l-checkbox style="margin-right: 20px" value="Guangzhou" label="广州" />
						<l-checkbox value="Shenzen" label="深圳" />
					</l-checkbox-group>
				</view>
			</view>
			<view class="demo-block card">
				<text class="demo-block__title-text large">禁用</text>
				<view class="demo-block__body row">
					<l-checkbox-group @change="onChange" disabled>
						<l-checkbox style="margin-right: 20px" value="Beijing" label="北京" />
						<l-checkbox style="margin-right: 20px" value="Shanghai" label="上海" />
						<l-checkbox style="margin-right: 20px" value="Guangzhou" label="广州" />
						<l-checkbox value="Shenzen" label="深圳" />
					</l-checkbox-group>
				</view>
			</view>
			<view class="demo-block card">
				<text class="demo-block__title-text large">自定义颜色</text>
				<view class="demo-block__body row">
					<l-checkbox-group @change="onChange" checked-color="#ee0a24">
						<l-checkbox style="margin-right: 20px" value="Beijing" label="北京" />
						<l-checkbox style="margin-right: 20px" value="Shanghai" label="上海" />
						<l-checkbox style="margin-right: 20px" value="Guangzhou" label="广州" />
						<l-checkbox disabled value="Shenzen" label="深圳" />
					</l-checkbox-group>
				</view>
			</view>
			<view class="demo-block card">
				<text class="demo-block__title-text large">自定义大小</text>
				<view class="demo-block__body row">
					<l-checkbox-group @change="onChange">
						<l-checkbox style="margin-right: 20px" icon-size="44px" value="Beijing" label="北京" />
						<l-checkbox style="margin-right: 20px" icon-size="34px" value="Shanghai" label="上海" />
						<l-checkbox style="margin-right: 20px" icon-size="24px" value="Guangzhou" label="广州" />
						<l-checkbox value="Shenzen" icon-size="16px" font-size="12px" label="深圳" />
					</l-checkbox-group>
				</view>
			</view>
			<view class="demo-block card">
				<text class="demo-block__title-text large">自定义图标</text>
				<view class="demo-block__body row">
					<l-checkbox-group @change="onChange">
						<l-checkbox style="margin-right: 20px"  value="Beijing" label="北京">
							<template #icon="{checked}">
								<image v-show="checked" style="width:20px; height:20px" src="https://fastly.jsdelivr.net/npm/@vant/assets/user-active.png"></image>
								<image v-show="!checked" style="width:20px; height:20px" src="https://fastly.jsdelivr.net/npm/@vant/assets/user-inactive.png"></image>
							</template>
						</l-checkbox>
						<l-checkbox style="margin-right: 20px"  value="Guangzhou" label="广州">
							<template #icon="{checked}">
								<image v-show="checked" style="width:20px; height:20px" src="https://fastly.jsdelivr.net/npm/@vant/assets/user-active.png"></image>
								<image v-show="!checked" style="width:20px; height:20px" src="https://fastly.jsdelivr.net/npm/@vant/assets/user-inactive.png"></image>
							</template>
						</l-checkbox>
						<l-checkbox style="margin-right: 20px"  value="Shenzen" label="深圳">
							<template #icon="{checked}">
								<image v-show="checked" style="width:20px; height:20px" src="https://fastly.jsdelivr.net/npm/@vant/assets/user-active.png"></image>
								<image v-show="!checked" style="width:20px; height:20px" src="https://fastly.jsdelivr.net/npm/@vant/assets/user-inactive.png"></image>
							</template>
						</l-checkbox>
					</l-checkbox-group>
				</view>
			</view>
			<view class="demo-block card">
				<text class="demo-block__title-text large">限制最大可选数</text>
				<view class="demo-block__body row">
					<l-checkbox-group @change="onChange" :max="3">
						<l-checkbox style="margin-right: 20px" value="Beijing" label="北京" />
						<l-checkbox style="margin-right: 20px" value="Shanghai" label="上海" />
						<l-checkbox style="margin-right: 20px" value="Guangzhou" label="广州" />
						<l-checkbox value="Shenzen" label="深圳" />
					</l-checkbox-group>
				</view>
			</view>
			<view class="demo-block card">
				<text class="demo-block__title-text large">全选反选</text>
				<view class="demo-block__body row">
					<l-checkbox-group ref="checkboxGroupRef" @change="onChange" direction="vertical">
						<l-checkbox style="margin-bottom: 20px" value="all" checkAll label="全选" />
						<l-checkbox style="margin-bottom: 20px" value="Beijing" label="北京" />
						<l-checkbox style="margin-bottom: 20px" value="Shanghai" label="上海" />
						<l-checkbox style="margin-bottom: 20px" value="Guangzhou" label="广州" />
						<l-checkbox value="Shenzen" label="深圳" />
					</l-checkbox-group>
					<view style="width: 100%;">
						<button type="primary" style="margin-top:10px; margin-bottom:10px" @click="checkAll">全选</button>
						<button @click="toggleAll">反选</button>
					</view>
				</view>
			</view>
		</view>
	</view>
</template>

<script>
	
	export default {
		data() {
			return {
				checked: false,
				checked2: ['Beijing'],
			}
		},
		methods: {
			onChange(e) {
				console.log('onChange', e)
			},
			checkAll() {
				this.$refs.checkboxGroupRef.toggleAll(true)
			},
			toggleAll() {
				this.$refs.checkboxGroupRef.toggleAll(false)
			}
		}
	}
	
</script>

<style lang="scss">
	.row {
		flex-direction: row;
		flex-wrap: wrap;
	}

	.custom-checkbox {
		padding: 20rpx 30rpx;
		border-radius: 5rpx;
		border: 1rpx solid #ddd;
		transition: background-color 0.3s;
		color: black;

		&.checked {
			background-color: #007aff;
			color: white;
			border-color: #007aff;
		}
	}

	.demo-block {
		margin: 32px 10px 0;

		// overflow: visible;
		&.card {
			background-color: white;
			padding: 30rpx;
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

				&.large {
					color: rgba(0, 0, 0, 0.9);
					font-size: 18px;
					font-weight: 700;
					line-height: 26px;
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