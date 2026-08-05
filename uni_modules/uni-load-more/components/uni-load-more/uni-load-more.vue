<template>
	<view class="uni-load-more" @click="onClick">
		<!-- #ifdef APP-NVUE -->
		<loading-indicator v-if="!webviewHide && status === 'loading' && showIcon"
			:style="{color: color,width:iconSize+'px',height:iconSize+'px'}" :animating="true"
			class="uni-load-more__img uni-load-more__img--nvue"></loading-indicator>
		<!-- #endif -->
		<!-- #ifdef H5 -->
		<svg width="24" height="24" viewBox="25 25 50 50"
			v-if="!webviewHide && (iconType==='circle' || iconType==='auto' && platform === 'android') && status === 'loading' && showIcon"
			:style="{width:iconSize+'px',height:iconSize+'px'}"
			class="uni-load-more__img uni-load-more__img--android-H5">
			<circle cx="50" cy="50" r="20" fill="none" :style="{color:color}" :stroke-width="3"></circle>
		</svg>
		<!-- #endif -->
		<!-- #ifndef APP-NVUE || H5 -->
		<view
			v-if="showAndroidCircleLoading"
			:style="{width:iconSize+'px',height:iconSize+'px'}"
			class="uni-load-more__img uni-load-more__img--android-MP">
			<view class="uni-load-more__img-icon" :style="{borderTopColor:color,borderTopWidth:iconSize/12}"></view>
			<view class="uni-load-more__img-icon" :style="{borderTopColor:color,borderTopWidth:iconSize/12}"></view>
			<view class="uni-load-more__img-icon" :style="{borderTopColor:color,borderTopWidth:iconSize/12}"></view>
		</view>
		<!-- #endif -->
		<!-- #ifndef APP-NVUE -->
		<view v-else-if="showIosSnowLoading"
			:style="{width:iconSize+'px',height:iconSize+'px'}" class="uni-load-more__img uni-load-more__img--ios-H5">
			<image class="image" :src="imgBase64" mode="widthFix"></image>
		</view>
		<!-- #endif -->
		<text v-if="showText" class="uni-load-more__text"
			:style="{color: color}">{{ statusDisplayText }}</text>
	</view>
</template>

<script lang="uts" setup>
	import { ref, computed, onMounted } from 'vue'

	const platform = ref("")
	setTimeout(() => {
		// #ifdef MP-WEIXIN
		platform.value = uni.getDeviceInfo().platform
		// #endif
		// #ifndef MP-WEIXIN
		platform.value = uni.getSystemInfoSync().platform
		// #endif
	}, 16)

	// #ifndef APP-ANDROID
	import {
		initVueI18n
	} from '@dcloudio/uni-i18n'
	import messages from './i18n/index.js'
	const {
		t
	} = initVueI18n(messages)
	// #endif

	/** 本组件默认 contentText 类型（UTS：禁止对 any 点属性 / 下标） */
	class LoadMoreContentText {
		contentdown: string = "";
		contentrefresh: string = "";
		contentnomore: string = "";
	}

	/**
	 * contentText 为空时的默认文案。
	 * Android：Options API computed 里不能引用外层 const t（会编成 IndexKt.t 静态调用 → NoSuchMethodError），
	 * 因此 App-Android 直接返回本地默认，勿再调 t()。
	 */
	function resolveLoadMoreFallbackText(kind: string): string {
		// #ifdef APP-ANDROID
		if (kind == "contentdown") {
			return "上拉显示更多";
		}
		if (kind == "contentrefresh") {
			return "正在加载...";
		}
		if (kind == "contentnomore") {
			return "没有更多数据了";
		}
		return "";
		// #endif
		// #ifndef APP-ANDROID
		if (kind == "contentdown") {
			return t("uni-load-more.contentdown");
		}
		if (kind == "contentrefresh") {
			return t("uni-load-more.contentrefresh");
		}
		if (kind == "contentnomore") {
			return t("uni-load-more.contentnomore");
		}
		return "";
		// #endif
	}

	/**
	 * 读取 contentText 文案。
	 * Android：可能是 LoadMoreContentText / UniLoadMoreContentText / Map / UTSJSONObject。
	 * 禁止对 any 做 .field 或 [key]；禁止把生成类型直接 as UTSJSONObject。
	 */
	function readContentTextField(raw: any | null, key: string): string {
		if (raw == null || key.length == 0) {
			return "";
		}
		// 1) 本组件 class
		try {
			const typed = raw as LoadMoreContentText;
			if (typed != null) {
				if (key == "contentdown" && typed.contentdown != "") {
					return typed.contentdown;
				}
				if (key == "contentrefresh" && typed.contentrefresh != "") {
					return typed.contentrefresh;
				}
				if (key == "contentnomore" && typed.contentnomore != "") {
					return typed.contentnomore;
				}
			}
		} catch (_eTyped) {
			// ignore
		}
		// 2) Map（Android Record）
		try {
			const m = raw as Map<string, any | null>;
			if (m != null) {
				const fromMap = m.get(key);
				if (fromMap != null && `${fromMap}` != "") {
					return `${fromMap}`;
				}
			}
		} catch (_eMap) {
			// ignore
		}
		// 3) JSON 中转成 UTSJSONObject 再 bracket（勿 as 原对象）
		try {
			const jsonStr = JSON.stringify(raw);
			if (jsonStr != null && jsonStr.length > 2 && jsonStr != "null" && jsonStr != "{}") {
				const parsed = JSON.parse(jsonStr) as UTSJSONObject | null;
				if (parsed != null) {
					const fromJson = parsed[key];
					if (fromJson != null && `${fromJson}` != "") {
						return `${fromJson}`;
					}
				}
			}
		} catch (_eJson) {
			// ignore
		}
		return "";
	}

	/**
	 * LoadMore 加载更多
	 * @description 用于列表中，做滚动加载使用，展示 loading 的各种状态
	 * @tutorial https://ext.dcloud.net.cn/plugin?id=29
	 * @property {String} status = [more|loading|noMore] loading 的状态
	 * @property {Number} iconSize 指定图标大小
	 * @property {Boolean} showIcon = [true|false] 是否显示 loading 图标
	 * @property {String} iconType = [snow|circle|auto] 指定图标样式
	 * @property {String} color 图标和文字颜色
	 * @property {Object} contentText 各状态文字说明
	 * @event {Function} clickLoadMore 点击加载更多时触发
	 */
	type Props = {
		status ?: string
		showIcon ?: boolean
		iconType ?: string
		iconSize ?: number
		color ?: string
		contentText ?: LoadMoreContentText | null
		showText ?: boolean
	}
	const props = withDefaults(defineProps<Props>(), {
		status: 'more',
		showIcon: true,
		iconType: 'auto',
		iconSize: 24,
		color: '#777777',
		contentText: null,
		showText: true
	})
	const emit = defineEmits(['clickLoadMore'])

	const webviewHide = ref(false)
	const imgBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyJpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMy1jMDExIDY2LjE0NTY2MSwgMjAxMi8wMi8wNi0xNDo1NjoyNyAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tYSIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENTNiAoV2luZG93cykiIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6QzlBMzU3OTlEOUM0MTFFOUI0NTZDNERBQURBQzI4RkUiIHhtcE1NOkRvY3VtZW50SUQ9InhtcC5kaWQ6QzlBMzU3OUFEOUM0MTFFOUI0NTZDNERBQURBQzI4RkUiPiA8eG1wTU06RGVyaXZlZEZyb20gc3RSZWY6aW5zdGFuY2VJRD0ieG1wLmlpZDpDOUEzNTc5N0Q5QzQxMUU5QjQ1NkM0REFBREFDMjhGRSIgc3RSZWY6ZG9jdW1lbnRJRD0ieG1wLmRpZDpDOUEzNTc5OEQ5QzQxMUU5QjQ1NkM0REFBREFDMjhGRSIvPiA8L3JkZjpEZXNjcmlwdGlvbj4gPC9yZGY6UkRGPiA8L3htcDpNZXRhZGF0YT4gPC94OnhtcG1ldGE+IDw/eHBhY2tldCBlbmQ9InIiPz7fgC0A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'

	const iconSnowWidth = computed((): number => {
		const base = Math.floor(props.iconSize / 24);
		if (base == 0) {
			return 2;
		}
		return base * 2;
	})
	const contentdownText = computed((): string => {
		const text = readContentTextField(props.contentText as any, "contentdown");
		if (text != "") {
			return text;
		}
		return resolveLoadMoreFallbackText("contentdown");
	})
	const contentrefreshText = computed((): string => {
		const text = readContentTextField(props.contentText as any, "contentrefresh");
		if (text != "") {
			return text;
		}
		return resolveLoadMoreFallbackText("contentrefresh");
	})
	const contentnomoreText = computed((): string => {
		const text = readContentTextField(props.contentText as any, "contentnomore");
		if (text != "") {
			return text;
		}
		return resolveLoadMoreFallbackText("contentnomore");
	})
	/** 是否展示 Android 圆环 loading */
	const showAndroidCircleLoading = computed((): boolean => {
		if (webviewHide.value == true) {
			return false;
		}
		if (props.status != 'loading') {
			return false;
		}
		if (props.showIcon != true) {
			return false;
		}
		if (props.iconType == 'circle') {
			return true;
		}
		if (props.iconType == 'auto') {
			if (platform.value == 'android') {
				return true;
			}
		}
		return false;
	})
	/** 是否展示 iOS 雪花 loading */
	const showIosSnowLoading = computed((): boolean => {
		if (webviewHide.value == true) {
			return false;
		}
		if (props.status != 'loading') {
			return false;
		}
		if (props.showIcon != true) {
			return false;
		}
		return true;
	})
	/** 状态文案 */
	const statusDisplayText = computed((): string => {
		if (props.status == 'more') {
			return contentdownText.value;
		}
		if (props.status == 'loading') {
			return contentrefreshText.value;
		}
		return contentnomoreText.value;
	})

	onMounted(() => {
		// #ifdef APP-PLUS
		var pages = getCurrentPages();
		var page = pages[pages.length - 1];
		var currentWebview = page.$getAppWebview();
		currentWebview.addEventListener('hide', () => {
			webviewHide.value = true
		})
		currentWebview.addEventListener('show', () => {
			webviewHide.value = false
		})
		// #endif
	})

	function onClick() {
		emit('clickLoadMore', {
			detail: {
				status: props.status,
			}
		})
	}
</script>

<style lang="scss" >
/* #ifdef H5 */
	.uni-load-more {
		/* #ifndef APP-NVUE */
		display: flex;
		/* #endif */
		flex-direction: row;
		height: 40px;
		align-items: center;
		justify-content: center;
	}

	.uni-load-more__text {
		font-size: 14px;
		margin-left: 8px;
	}

	.uni-load-more__img {
		width: 24px;
		height: 24px;
		// margin-right: 8px;
	}

	.uni-load-more__img--nvue {
		color: #666666;
	}

	.uni-load-more__img--android,
	.uni-load-more__img--ios {
		width: 24px;
		height: 24px;
		transform: rotate(0deg);
	}

	/* #ifndef APP-NVUE */
	.uni-load-more__img--android {
		animation: loading-ios 1s 0s linear infinite;
	}

	@keyframes loading-android {
		0% {
			transform: rotate(0deg);
		}

		100% {
			transform: rotate(360deg);
		}
	}

	.uni-load-more__img--ios-H5 {
		position: relative;
		animation: loading-ios-H5 1s 0s step-end infinite;
	}

	.uni-load-more__img--ios-H5 .image {
		position: absolute;
		width: 100%;
		height: 100%;
		left: 0;
		top: 0;
	}

	@keyframes loading-ios-H5 {
		0% {
			transform: rotate(0deg);
		}

		8% {
			transform: rotate(30deg);
		}

		16% {
			transform: rotate(60deg);
		}

		24% {
			transform: rotate(90deg);
		}

		32% {
			transform: rotate(120deg);
		}

		40% {
			transform: rotate(150deg);
		}

		48% {
			transform: rotate(180deg);
		}

		56% {
			transform: rotate(210deg);
		}

		64% {
			transform: rotate(240deg);
		}

		73% {
			transform: rotate(270deg);
		}

		82% {
			transform: rotate(300deg);
		}

		91% {
			transform: rotate(330deg);
		}

		100% {
			transform: rotate(360deg);
		}
	}

	/* #endif */

	/* #ifdef H5 */
	.uni-load-more__img--android-H5 {
		animation: loading-android-H5-rotate 2s linear infinite;
		transform-origin: center center;
	}

	.uni-load-more__img--android-H5 circle {
		display: inline-block;
		animation: loading-android-H5-dash 1.5s ease-in-out infinite;
		stroke: currentColor;
		stroke-linecap: round;
	}

	@keyframes loading-android-H5-rotate {
		0% {
			transform: rotate(0deg);
		}

		100% {
			transform: rotate(360deg);
		}
	}

	@keyframes loading-android-H5-dash {
		0% {
			stroke-dasharray: 1, 200;
			stroke-dashoffset: 0;
		}

		50% {
			stroke-dasharray: 90, 150;
			stroke-dashoffset: -40;
		}

		100% {
			stroke-dasharray: 90, 150;
			stroke-dashoffset: -120;
		}
	}

	/* #endif */

	/* #ifndef APP-NVUE || H5 */
	.uni-load-more__img--android-MP {
		position: relative;
		width: 24px;
		height: 24px;
		transform: rotate(0deg);
		animation: loading-ios 1s 0s ease infinite;
	}

	.uni-load-more__img--android-MP .uni-load-more__img-icon {
		position: absolute;
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		border-radius: 50%;
		border: solid 2px transparent;
		border-top: solid 2px #777777;
		transform-origin: center;
	}

	.uni-load-more__img--android-MP .uni-load-more__img-icon:nth-child(1) {
		animation: loading-android-MP-1 1s 0s linear infinite;
	}

	.uni-load-more__img--android-MP .uni-load-more__img-icon:nth-child(2) {
		animation: loading-android-MP-2 1s 0s linear infinite;
	}

	.uni-load-more__img--android-MP .uni-load-more__img-icon:nth-child(3) {
		animation: loading-android-MP-3 1s 0s linear infinite;
	}

	@keyframes loading-android {
		0% {
			transform: rotate(0deg);
		}

		100% {
			transform: rotate(360deg);
		}
	}

	@keyframes loading-android-MP-1 {
		0% {
			transform: rotate(0deg);
		}

		50% {
			transform: rotate(90deg);
		}

		100% {
			transform: rotate(360deg);
		}
	}

	@keyframes loading-android-MP-2 {
		0% {
			transform: rotate(0deg);
		}

		50% {
			transform: rotate(180deg);
		}

		100% {
			transform: rotate(360deg);
		}
	}

	@keyframes loading-android-MP-3 {
		0% {
			transform: rotate(0deg);
		}

		50% {
			transform: rotate(270deg);
		}

		100% {
			transform: rotate(360deg);
		}
	}

	/* #endif */
/* #endif */
</style>
