<template>
  <!--
    主路径：groupMarkdownContainers 已把 OpenUI 留在组外，本组件只渲普通工具。
    兜底：历史正文若仍把 OpenUI 包进 group，且 processCount=0，跳过折叠壳，
    避免 group-content 折叠态把原位 openui-card 藏死。
    processCount<=1 同样不加折叠壳：单工具不显示「1 项」组头（与 App 端一致）。
  -->
  <view v-if="processCount <= 1" class="openui-loose-group">
    <slot />
  </view>
  <view v-else class="markdown-custom-process-group">
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
    <view
      class="group-content"
      :class="{ 'is-expanded': isExpanded, 'has-openui': hasOpenUiChild }"
    >
      <slot />
    </view>
  </view>
</template>

<script>
  import { t } from "@/utils/i18n";
  import { getProcessingDataByPriority } from "./utils";
  import { isOpenUiRenderToolName } from "@/utils/openUiSchema.uts";

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
      // 仅当前 SSE 消息允许根据执行态自动展开；历史消息始终从折叠态加载。
      isCurrentStreaming: {
        type: Boolean,
        default: false,
      },
      // 流式正文开始输出时由 Markdown 分组层传入，表示当前工具调用组已完成。
      autoCollapse: {
        type: [Boolean, String],
        default: false,
      },
    },
    data() {
      return {
        isExpanded: true,
      };
    },
    computed: {
      processCount() {
        // 与 markdown-container 渲染一致：先按 executeId 从 processingList 取最终数据，
        // 再排除 Event 与 OpenUI（后者走 openui-card，不计普通工具数）。
        return (this.childs || []).filter((n) => {
          if (!(
            n.name === "container" || n.name === "markdown-custom-process"
          )) {
            return false;
          }
          const data = this.getRenderData(n);
          if (data?.type === "Event") {
            // OpenUI renderUI 可能仍带 Event type，但由 openui-card 展示，不计入工具数
            return false;
          }
          const name = `${data?.name || ""}`;
          if (isOpenUiRenderToolName(name)) {
            return false;
          }
          return true;
        }).length;
      },
      /** 组内是否仍含 OpenUI（历史正文可能已包进 group） */
      hasOpenUiChild() {
        return (this.childs || []).some((n) => {
          if (
            !(n.name === "container" || n.name === "markdown-custom-process")
          ) {
            return false;
          }
          const data = this.getRenderData(n);
          return isOpenUiRenderToolName(`${data?.name || ""}`);
        });
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
      syncExecutionExpanded() {
        if (!this.isCurrentStreaming) {
          this.isExpanded = false;
          return;
        }
        const hasExecuting = (this.childs || []).some((n) => {
          if (!(n.name === "container" || n.name === "markdown-custom-process")) {
            return false;
          }
          const data = this.getRenderData(n);
          const name = `${data?.name || ""}`;
          if (data?.type === "Event" || isOpenUiRenderToolName(name)) {
            return false;
          }
          return data?.status !== "FINISHED" && data?.status !== "FAILED";
        });
        this.isExpanded = hasExecuting;
      },
    },
    watch: {
      processingList: {
        deep: true,
        immediate: true,
        handler() {
          this.syncExecutionExpanded();
        },
      },
      isCurrentStreaming: {
        immediate: true,
        handler() {
          this.syncExecutionExpanded();
        },
      },
      autoCollapse: {
        immediate: true,
        handler(value) {
          // 组内有 OpenUI 时禁止折叠，否则 openui-card 会被 opacity:0 藏住
          if (this.hasOpenUiChild) {
            this.isExpanded = true;
            return;
          }
          if (`${value}`.toLowerCase() === "true") {
            this.isExpanded = false;
          }
        },
      },
      hasOpenUiChild: {
        immediate: true,
        handler(v) {
          if (v) {
            this.isExpanded = true;
          }
        },
      },
    },
  };
</script>

<style lang="scss" scoped>
  .openui-loose-group {
    width: 100%;
  }

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
      max-height: 0;
      padding: 0 24rpx;
      border-top: 0 solid rgba(0, 0, 0, 0.05);
      opacity: 0;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      transition:
        max-height 0.3s ease,
        padding 0.3s ease,
        opacity 0.2s ease,
        border-top-width 0.3s ease;

      &.is-expanded {
        max-height: 500rpx;
        padding: 12rpx 24rpx;
        border-top-width: 1rpx;
        opacity: 1;
      }

      /* 含 OpenUI 时放开高度，避免多卡被 500rpx 裁切 */
      &.is-expanded.has-openui {
        max-height: none;
        overflow: visible;
      }
    }
  }
</style>
