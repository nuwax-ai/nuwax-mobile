<template>
	<view class="demo-block">
		<text class="demo-block__title-text ultra">Transition 动画</text>
		<text class="demo-block__desc-text">使元素从一种样式逐渐变化为另一种样式的效果。</text>
		<view class="demo-block__body">
			<view class="demo-block">
				<text class="demo-block__title-text large">基础使用</text>
				<view class="demo-block__body">
					<l-transition :visible="true" :appear="true" name="fade-up">
						<view class="box1">内容</view>
					</l-transition>
				</view>
			</view>

			<view class="demo-block">
				<text class="demo-block__title-text large">动画类型</text>
				<view class="demo-block__body">
					<button style="margin-bottom:20rpx"  @click="onClick('fade')">Fade</button>
					<button style="margin-bottom:20rpx"  @click="onClick('fade-up')">Fade Up</button>
					<button style="margin-bottom:20rpx"  @click="onClick('fade-down')">Fade Down</button>
					<button style="margin-bottom:20rpx"  @click="onClick('fade-left')">Fade Left</button>
					<button style="margin-bottom:20rpx"  @click="onClick('fade-right')">Fade Right</button>
					<button style="margin-bottom:20rpx"  @click="onClick('slide-up')">Slide Up</button>
					<button style="margin-bottom:20rpx"  @click="onClick('slide-down')">Slide Down</button>
					<button style="margin-bottom:20rpx"  @click="onClick('slide-left')">Slide Left</button>
					<button style="margin-bottom:20rpx"  @click="onClick('slide-right')">slide right</button>
					<l-transition 
						:visible="visible" 
						:name="name" 
						 :destoryOnClose="true"
						l-style="position: fixed; top: 50%;left: 50%;width: 300rpx; height: 300rpx; margin: -150rpx 0 0 -150rpx; background-color: #ffb400; display: flex; justify-content: center; align-items: center; z-index: 10;"
						@after-enter="enter">
						<view class="content">内容{{name}}</view>
					</l-transition>
				</view>
			</view>
			<view class="demo-block">
				<text class="demo-block__title-text large">高级用法</text>
				<view class="demo-block__body">
					<view 
						v-if="display"
						:class="classes"
						class="box">
						<view class="content">内容</view>
					</view>
					
					<button @click="toggle">切换</button>
				</view>
			</view>
		</view>
	</view>
</template>
<script>
	import { useTransition } from '@/uni_modules/lime-transition';
	let timer = -1;
	
	
	
	export default {
		data() {
			return {
				show: false,
				visible: false,
				name: '',
				display: false,
				classes: ''
			}
		},
		mounted() {
			const {state,inited, display, classes, finished} = useTransition({
				defaultName: 'fade',
				enterClass: 'custom-enter-class',
				enterActiveClass: 'custom-enter-active-class',
				leaveActiveClass: 'custom-leave-active-class',
				leaveToClass: 'custom-leave-to-class',
				appear: false,
				duration: 300,
			})	
			this.$watch(()=> display.value, (v)=>{
				this.display = v
			})
			this.$watch(()=> classes.value, (v)=>{
				this.classes = v
			})
			this.$watch('show', (v)=>{
				state.value = v
			})
			this.finished = finished
			
		},
		methods: {
			finished(){
				
			},
			toggle() {
				this.show = !this.show
			},
			enter() {
				setTimeout(()=>{
					this.visible = false;	
				},300)
			},
			onClick(v) {
				if (v.length > 0) {
					clearTimeout(timer)
					this.name = v;
					this.visible = true;
					// timer = setTimeout(() => {
					// 	this.visible = false;
					// }, 600)
				}
			}
		}
	}

</script>
<style lang="scss">
	.custom-enter-active-class,
	.custom-leave-active-class {
		transition-duration: 300ms;
		transition-property: background-color, transform, opacity;
	}
	
	.custom-enter-class,
	.custom-leave-to-class {
	  background-color: red;
	  transform-origin: center;
	  opacity: 1;
	  transform: rotate(-360deg) translate(-100%, -100%);
	}
	.box {
		position: fixed;
		top: 50%;
		left: 50%;
		width: 300rpx;
		height: 300rpx;
		margin: -150rpx 0 0 -150rpx;
		background-color: #ffb400;
		display: flex;
		justify-content: center;
		align-items: center;
		z-index: 10;
	}
	.box1{
		display: flex;
		width: 300rpx;
		height: 300rpx;
		background-color: #ffb400;
		justify-content: center;
		align-items: center;
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