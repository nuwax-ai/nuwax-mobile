<template>
  <view class="markdown-custom-process-group">
    <view class="group-header" @tap="toggleExpanded">
      <view class="header-left">
        <text class="group-title">{{
          getI18nText("Mobile.ThirdParty.MpHtml.toolCall")
        }}</text>
      </view>
      <view class="header-right">
        <text class="process-count">{{
          processCount + " " + getI18nText("Mobile.ThirdParty.MpHtml.itemCount")
        }}</text>
        <text
          class="iconfont icon-a-Chevrondown expand-icon"
          :class="{ 'is-expanded': isExpanded }"
        ></text>
      </view>
    </view>
    <view v-if="isExpanded" class="group-content">
      <slot />
    </view>
  </view>
</template>

<script>
  import { t } from "@/utils/i18n";
  import { getProcessingDataByPriority } from "./utils";

  export default {
    name: "MarkdownContainerGroup",
    props: {
      // 仅用于计算数量，不再直接渲染
      childs: {
        type: Array,
        default: () => [],
      },
      processingList: {
        type: Array,
        default: () => [],
      },
    },
    data() {
      return {
        isExpanded: false,
      };
    },
    computed: {
      processCount() {
        // 与 markdown-container 渲染一致：先按 executeId 从 processingList 取最终数据，
        // 再排除 container.vue 中不会展示的 Event 类型，避免标题数量和展开项不一致。
        return (this.childs || []).filter((n) => {
          if (
            !(n.name === "container" || n.name === "markdown-custom-process")
          ) {
            return false;
          }
          const data = this.getRenderData(n);
          return data?.type !== "Event";
        }).length;
      },
    },
    methods: {
      getI18nText(key, params) {
        return t(key, params);
      },
      getRenderData(node) {
        let data = node?.attrs || {};
        if (node?.name === "container") {
          data = node?.attrs?.data || {};
        }

        if (typeof data === "string") {
          try {
            data = JSON.parse(data);
          } catch (e) {
            return {};
          }
        }

        if (typeof data !== "object" || data === null) {
          return {};
        }

        const executeId = data.executeId || data.executeid;
        return {
          ...data,
          ...getProcessingDataByPriority(
            executeId,
            this.processingList,
            data.type,
          ),
        };
      },
      toggleExpanded() {
        this.isExpanded = !this.isExpanded;
      },
    },
  };
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
