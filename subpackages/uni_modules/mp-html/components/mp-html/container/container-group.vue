<template>
  <view class="markdown-custom-process-group">
    <view class="group-header" @tap="toggleExpanded">
      <view class="header-left">
        <text class="group-title">{{ getI18nText('Mobile.ThirdParty.MpHtml.toolCall') }}</text>
      </view>
      <view class="header-right">
        <text class="process-count">{{ processCount + ' ' + getI18nText('Mobile.ThirdParty.MpHtml.itemCount') }}</text>
        <text class="iconfont icon-a-Chevrondown expand-icon" :class="{ 'is-expanded': isExpanded }"></text>
      </view>
    </view>
    <view v-if="isExpanded" class="group-content">
      <slot />
    </view>
  </view>
</template>

<script>
import { t } from '@/utils/i18n'

export default {
  name: 'MarkdownContainerGroup',
  props: {
    // 仅用于计算数量，不再直接渲染
    childs: {
      type: Array,
      default: () => []
    }
  },
  data() {
    return {
      isExpanded: false
    }
  },
  computed: {
    processCount() {
      // 过滤掉可能的空白节点，支持原生 container 和 PC 端 HTML 标签名
      return (this.childs || []).filter(n => n.name === 'container' || n.name === 'markdown-custom-process').length
    }
  },
  methods: {
    getI18nText(key, params) {
      return t(key, params)
    },
    toggleExpanded() {
      this.isExpanded = !this.isExpanded
    }
  }
}
</script>

<style lang="scss" scoped>
.markdown-custom-process-group {
  margin: 16rpx 0;
  border-radius: 12rpx;
  border: 1rpx solid rgba(0, 0, 0, 0.08);
  background-color: #ffffff;
  overflow: hidden;

  .group-header {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    padding: 20rpx 24rpx;
    background-color: rgba(0, 0, 0, 0.02);

    .header-left {
      display: flex;
      flex-direction: row;
      align-items: center;

      .group-title {
        font-size: 26rpx;
        color: #333333;
      }
    }

    .header-right {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 12rpx;

      .process-count {
        font-size: 24rpx;
        color: #8c8c8c;
      }

      .expand-icon {
        font-size: 24rpx;
        color: #8c8c8c;
        transition: transform 0.3s ease;

        &.is-expanded {
          transform: rotate(180deg);
        }
      }
    }
  }

  .group-content {
    padding: 12rpx 24rpx;
    border-top: 1rpx solid rgba(0, 0, 0, 0.05);
    max-height: 500rpx;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
}
</style>
