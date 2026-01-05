<template>
	<view class="demo-block">
		<text class="demo-block__title-text ultra">按钮</text>
		<text class="demo-block__desc-text">按钮用于开始一个即时操作。</text>	
		<view class="demo-block__body">
			<view class="demo-block card">
				<text class="demo-block__title-text large">按钮主题</text>
				<view class="demo-block__body row">
					<l-button class="btn" type="primary">品牌色</l-button>
					<l-button class="btn" type="success">成功色</l-button>
					<l-button class="btn" type="warning">警告色</l-button>
					<l-button class="btn" type="danger">危险色</l-button>
					<l-button class="btn">通用色</l-button>
				</view>	
			</view>	
			<view class="demo-block card">
				<text class="demo-block__title-text large">图标</text>
				<view class="demo-block__body row">
					<l-button class="btn" icon="app" :type="theme" >默认按钮</l-button>
					<l-button class="btn" icon="search" type="warning" shape="square"></l-button>
				</view>	
			</view>
			<view class="demo-block card">
				<text class="demo-block__title-text large">按钮形状</text>
				<view class="demo-block__body row">
					<l-button class="btn" type="primary" shape="circle">圆</l-button>
					<l-button class="btn" type="primary" shape="round">圆角</l-button>
					<l-button class="btn" type="primary" shape="square">正</l-button>
					<l-button class="btn" type="primary">默认</l-button>
				</view>	
			</view>	
			<view class="demo-block card">
				<text class="demo-block__title-text large">按钮尺寸</text>
				<view class="demo-block__body row">
					<l-button class="btn" style="margin-right: 0;" type="primary" size="large" data-block :block="true">通栏</l-button>
					<l-button class="btn" type="primary" size="large">大</l-button>
					<l-button class="btn" type="warning" size="medium">中</l-button>
					<l-button class="btn" type="primary" size="small">小</l-button>
					<l-button class="btn" type="success" size="mini">细</l-button>
				</view>	
			</view>	
			<view class="demo-block card">
				<text class="demo-block__title-text large">按钮类型</text>
				<view class="demo-block__body row">
					<l-button class="btn" type="primary">Solid</l-button>
					<l-button class="btn" type="primary" variant="outline">outline</l-button> 
					<l-button class="btn" type="primary" variant="light">light</l-button>
					<l-button class="btn" type="primary" variant="text">text</l-button>
					<view style="width: 100%;"></view>
					<l-button class="btn" type="success">Solid</l-button>
					<l-button class="btn" type="success" variant="outline">outline</l-button> 
					<l-button class="btn" type="success" variant="light">light</l-button>
					<l-button class="btn" type="success" variant="text">text</l-button>
					<view style="width: 100%;"></view>
					<l-button class="btn" type="warning">Solid</l-button>
					<l-button class="btn" type="warning" variant="outline">outline</l-button> 
					<l-button class="btn" type="warning" variant="light">light</l-button>
					<l-button class="btn" type="warning" variant="text">text</l-button>
					<view style="width: 100%;"></view>
					<l-button class="btn" type="danger">Solid</l-button>
					<l-button class="btn" type="danger" variant="outline">outline</l-button> 
					<l-button class="btn" type="danger" variant="light">light</l-button>
					<l-button class="btn" type="danger" variant="text">text</l-button>
					<view style="width: 100%;"></view>
					<l-button class="btn" variant="solid">Solid</l-button>
					<l-button class="btn" variant="outline">outline</l-button> 
					<l-button class="btn" variant="light">light</l-button>
					<l-button class="btn" variant="text">text</l-button>
				</view>	
			</view>	
			<view class="demo-block card">
				<text class="demo-block__title-text large">加载状态</text>
				<view class="demo-block__body row">
					<l-button class="btn" :loading="true" type="primary">默认按钮</l-button>
					<l-button class="btn" :loading="true" type="primary" size="mini" variant="outline">镂空按钮</l-button> 
					<l-button class="btn" :loading="true" type="primary" variant="light">高亮按钮</l-button>
					<l-button class="btn" :loading="true" type="primary" variant="text">文本按钮</l-button>
					
				</view>	
			</view>
			<view class="demo-block card">
				<text class="demo-block__title-text large">禁用状态</text>
				<view class="demo-block__body row">
					<l-button class="btn" :disabled="true" type="primary">默认按钮</l-button>
					<l-button class="btn" :disabled="true" type="primary" variant="outline">镂空按钮</l-button> 
					<l-button class="btn" :disabled="true" type="primary" variant="light">高亮按钮</l-button>
					<l-button class="btn" :disabled="true" type="primary" variant="text">文本按钮</l-button>
				</view>	
			</view>
			<view class="demo-block card">
				<text class="demo-block__title-text large">自定义颜色</text>
				<view class="demo-block__body row">
					<l-button class="btn" color="#7232dd" >默认按钮</l-button>
					<l-button class="btn" color="#7232dd"  variant="outline">镂空按钮</l-button> 
					<l-button class="btn" color="linear-gradient(to right, #ff6034, #ee0a24)">渐变按钮</l-button>
				</view>	
			</view>
		</view>	
	</view>
</template>

<script>
	export default {
		data() {
			return {
				theme: 'primary'
			}
		},
		methods: {
			
		},
		mounted() {
			setTimeout(()=>{
				this.theme ='danger'
				setTimeout(()=>{
					this.theme ='primary'
				},2000)
			},1000)
		}
	}
</script>

<style lang="scss">
	.row{
		display: flex;
		gap: 20rpx;
		flex-direction: row;
		flex-wrap: wrap;
	}
	
	.demo-block {
		margin: 32px 10px 0;
		// overflow: visible;
		&.card{
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
					display: flex;
				}
				&.ultra {
					color: rgba(0, 0, 0, 0.9);
					font-size: 24px;
					font-weight: 700;
					line-height: 32px;
					display: flex;
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