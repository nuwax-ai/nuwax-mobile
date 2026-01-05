<template>
	<view class="demo-block">
		<text class="demo-block__title-text ultra">Popup 弹出层</text>
		<text class="demo-block__desc-text">弹出层容器，用于展示弹窗、信息提示等内容</text>
		<view class="demo-block__body">

			<view class="demo-block">
				<text class="demo-block__title-text">基础类型{{visible}}</text>
				<view class="demo-block__body">
					<button class="button" 
						v-for="item in placement" 
						@click="onClick(item.value)"
						:key="item.value">{{item.text}}</button>
					<l-popup v-model="visible" 
						:position="currentPlacement" 
						:closeable="true">
						<view style="padding: 100px;"></view>
					</l-popup>
				</view>
			</view>

			<view class="demo-block">
				<text class="demo-block__title-text">其它</text>
				<view class="demo-block__body">

					<button class="button" @click="visible1 = true">底部弹出层-带标题及操作</button>
					<l-popup v-model="visible1" position="bottom" lStyle="height: 258px">
						<view class="header">
							<text class="btn btn--cancel" aria-role="button" @click="onHide">取消</text>
							<text class="title">标题文字</text>
							<text class="btn btn--confirm" aria-role="button" @click="onHide">确定</text>
						</view>
					</l-popup>

					<button class="button" @click="visible2 = true">居中弹出层-带自定义关闭按钮</button>
					<l-popup v-model="visible2" position="center" @change="change">
						<view style="width: 240px; height: 240px; overflow: visible;">
						</view>
						<view class="close-btn">
							<l-icon name="close-circle" size="32" color="white" @click="onClose" />
						</view>
					</l-popup>
				</view>
			</view>

		</view>
	</view>
</template>
<script>
	
	export default {
		data() {
			return {
				visible: false,
				visible1: false,
				visible2: false,
				currentPlacement: 'top',
				placement: [
					{ value: 'top', text: '顶部弹出' },
					{ value: 'left', text: '左侧弹出' },
					{ value: 'center', text: '中间弹出' },
					{ value: 'bottom', text: '底部弹出' },
					{ value: 'right', text: '右侧弹出' },
				]
			}
		},
		methods: {
			onClick(type) {
				this.visible = true
				this.currentPlacement = type
			},
			onHide() {
				this.visible1 = !this.visible1
			},
			onClose() {
				this.visible2 = !this.visible2
			},
			change() {
				console.log('change')
			}
		}
	}
</script>
<style lang="scss" scoped>
	popup-demo {
		padding: 0 16px;
	}

	.header {
		display: flex;
		align-items: center;
		height: 116rpx;
	}

	.title {
		flex: 1;
		text-align: center;
		// font-weight: 600;
		font-size: 18px;
	}

	.btn {
		font-size: 16px;
		padding: 16px;
	}

	.btn--cancel {
		color: rgba(0, 0, 0, 0.6);
	}

	.btn--confirm {
		color: #0052d9;
	}


	.close-btn {
		position: absolute;
		left: 50%;
		margin-left: -16px;
		bottom: calc(-1 * (24px + 32px));
	}

	.wrapper {
		margin: 16px;
		display: block;
	}
	.demo-block {
		margin: 32px 20px 0;
		overflow: visible;
	
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