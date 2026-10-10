<template>
  <!--
    H5/小程序 mp-html 专用 OpenUI 卡片（纯 .vue，避免 node.vue 直接挂 .uvue 组件）。
    行为对齐 subpackages/components/openui-card：点击 → file-preview-page。
  -->
  <view
    class="openui-card"
    :class="{ 'openui-card--pending': !isReady }"
    @tap="handleClick"
  >
    <view class="openui-card__icon">
      <text class="iconfont openui-card__icon-text">&#xe64e;</text>
    </view>
    <view class="openui-card__content">
      <text class="openui-card__title">{{ displayTitle }}</text>
      <text class="openui-card__hint">{{ displayHint }}</text>
    </view>
    <view v-if="isReady" class="openui-card__arrow">
      <text class="iconfont openui-card__arrow-text">&#xe63f;</text>
    </view>
  </view>
</template>

<script>
  import { openOpenUiArtifact } from "@/utils/system.uts";

  export default {
    name: "OpenUiCard",
    props: {
      /** OpenUI artifactId（UUID）；空串表示 EXECUTING 占位。 */
      artifactId: {
        type: String,
        default: "",
      },
      /** 卡片标题（artifact.title）。 */
      title: {
        type: String,
        default: "",
      },
      /** 当前会话 ID，可带 chat- 前缀。 */
      conversationId: {
        type: [String, Number],
        default: "",
      },
    },
    computed: {
      displayTitle() {
        const t = this.title != null ? `${this.title}` : "";
        return t.length > 0 ? t : "OpenUI 界面";
      },
      isReady() {
        const id = this.artifactId != null ? `${this.artifactId}` : "";
        return id.length > 0;
      },
      displayHint() {
        return this.isReady ? "点击查看界面" : "界面生成中";
      },
    },
    methods: {
      /**
       * 点击 → file-preview-page（与文件树点击 .openui.json 同一页面）。
       * EXECUTING 阶段无 artifactId，仅占位不可点。
       */
      async handleClick() {
        if (!this.isReady) {
          return;
        }
        const cid =
          this.conversationId != null ? `${this.conversationId}` : "";
        if (cid.length === 0) {
          uni.showToast({ title: "无法打开 OpenUI", icon: "none" });
          return;
        }
        const id = `${this.artifactId}`;
        const title = this.title != null ? `${this.title}` : "";
        await openOpenUiArtifact(cid, id, title);
      },
    },
  };
</script>

<style lang="scss" scoped>
  .openui-card {
    display: flex;
    flex-direction: row;
    align-items: center;
    width: 100%;
    min-height: 72rpx;
    margin: 16rpx 0 0 0;
    padding: 10rpx 14rpx;
    border-radius: 10rpx;
    background-color: rgba(12, 20, 102, 0.045);
    box-sizing: border-box;

    &--pending {
      opacity: 0.68;
    }

    &__icon,
    &__arrow {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    &__icon {
      width: 40rpx;
      height: 40rpx;
      margin-right: 12rpx;
    }

    &__icon-text,
    &__arrow-text {
      font-size: 28rpx;
      color: #333333;
    }

    &__content {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
    }

    &__title {
      color: #333333;
      font-size: 28rpx;
      font-weight: 600;
      line-height: 40rpx;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &__hint {
      margin-top: 4rpx;
      color: #8b8e96;
      font-size: 23rpx;
      line-height: 32rpx;
    }

    &__arrow {
      width: 32rpx;
      height: 32rpx;
      margin-left: 12rpx;
    }
  }
</style>
