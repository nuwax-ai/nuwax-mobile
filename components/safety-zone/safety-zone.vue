<template>
    <!-- 微信安全区 -->
	<!-- #ifdef MP-WEIXIN || APP -->
	<view :style="{height:getStatusBarHeight()+ addHeight+'px'}"></view>
	<!-- #endif -->
</template>
<script setup lang="ts">
import { getStatusBarHeight } from '@/utils/system'
const props = defineProps({
    addHeight: {
        type: Number,
        default: 0
    }
})

</script>

