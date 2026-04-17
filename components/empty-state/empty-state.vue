<template>
    <view class="empty-state">
        <image
          class="empty-image"
          :src="noData"
          mode="aspectFit"
          :alt="t('Mobile.Common.noDataImageAlt')"
        />
        <text class="empty-text">{{ displayText }}</text>
    </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
  import noData from '@/static/assets/no_data.png'
import { useI18n, translateText } from '@/utils/i18n'

const { t } = useI18n()

const props = defineProps({
    text: {
        type: String,
        default: "Mobile.Common.noData"
    }
})

const displayText = computed(() => translateText(props.text || "Mobile.Common.noData"))
</script>


<style lang="scss" scoped>

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 160rpx 40rpx;
      text-align: center;
      
      .empty-image {
        width: 172rpx;
        height: 172rpx;
      }

        .empty-text {
            font-size: 32rpx;
            line-height: 48rpx;
            color: #000;
        }
    }
    

</style>
