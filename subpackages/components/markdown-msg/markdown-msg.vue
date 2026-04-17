<template>
  <!-- AI校验通过后，需要水平滚动表格时，需要设置 scroll-table="true" -->
  <mp-html 
    :content="processedText" 
    :markdown="true" 
    :container-style="`width: 100%;`"
    :scroll-table="true"
    @linktap="handleLinkTap"
  />
</template>

<script lang="ts" setup>
	import { replaceMathBracket } from '@/utils/markdown'
	import mpHtml from '@/subpackages/uni_modules/mp-html/components/mp-html/mp-html.vue'
	import { handleExternalLink } from '@/utils/system'

	// 定义组件属性
	const props = withDefaults(defineProps<{
		text?: string
	}>(), {
		text: ''
	})

	// 处理文本内容，应用数学公式格式转换
	const processedText = computed(() => {
		if (!props.text || props.text.trim().length === 0) {
			return ''
		}
		return replaceMathBracket(props.text)
	})

	// 处理链接点击事件
	const handleLinkTap = (event: any) => {
		const { href } = event.detail
		if (href && href.length > 0) {
			handleExternalLink(href);
		}
	}
</script>