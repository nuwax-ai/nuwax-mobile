<template>
  <view class="page-example h-full flex flex-col">
    <!-- 页面标题 -->
    <view class="page-header">
      <text class="title">{{ t("Mobile.Common.appName") }} Tab</text>
    </view>

    <!-- Tab 组件 - 新的子组件方式 -->
    <view class="flex-1">
      <pane-tabs v-model="activeTab" @change="handleTabChange">
        <pane-tab key-value="recent" :tab="t('Mobile.Common.recentUsed')">
          <scroll-view class="scroll-content" scroll-y>
            <view class="content-wrapper">
              <view class="demo-card" v-for="item in 10" :key="item">
                <text class="card-title">{{ t("Mobile.Common.recentUsed") }} {{ item }}</text>
                <text class="card-desc">{{ t("Mobile.Common.noData") }}</text>
              </view>
            </view>
          </scroll-view>
        </pane-tab>

        <pane-tab key-value="history" :tab="t('Mobile.Common.conversationHistory')">
          <scroll-view class="h-full" scroll-y>
            <view class="content-wrapper">
              <view class="demo-card" v-for="item in 15" :key="item">
                <text class="card-title">{{ t("Mobile.Common.conversationHistory") }} {{ item }}</text>
                <text class="card-desc">{{ t("Mobile.Common.noData") }}</text>
              </view>
            </view>
          </scroll-view>
        </pane-tab>

        <pane-tab key-value="favorites" :tab="t('Mobile.Conversation.favorite')" :force-render="true">
          <scroll-view class="h-full" scroll-y>
            <view class="content-wrapper">
              <view class="demo-card" v-for="item in 8" :key="item">
                <text class="card-title">{{ t("Mobile.Conversation.favorite") }} {{ item }}</text>
                <text class="card-desc">{{ t("Mobile.Common.noData") }}</text>
              </view>
            </view>
          </scroll-view>
        </pane-tab>
      </pane-tabs>
    </view>
  </view>
</template>

<script setup lang="ts">
  import PaneTabs from "@/components/pane-tabs/pane-tabs.vue";
  import PaneTab from "@/components/pane-tabs/pane-tab.vue";
  import { useI18n } from "@/utils/i18n";

  const { t } = useI18n();
  const activeTab = ref("recent");

  const handleTabChange = (key: string) => {
    console.log("tab changed:", key);
  };
</script>

<style lang="scss" scoped>
  .page-example {
    background: #f5f5f5;

    .page-header {
      height: 88rpx;
      background: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      border-bottom: 1rpx solid #f0f0f0;

      .title {
        font-size: 32rpx;
        font-weight: 600;
        color: #333;
      }
    }

    .h-full {
      height: 100%;
    }

    .scroll-content {
      width: 100%;
      height: 100%;
    }

    .content-wrapper {
      padding: 24rpx;

      .demo-card {
        background: #fff;
        border-radius: 12rpx;
        padding: 32rpx;
        margin-bottom: 24rpx;

        .card-title {
          font-size: 28rpx;
          font-weight: 600;
          color: #333;
          display: block;
          margin-bottom: 16rpx;
        }

        .card-desc {
          font-size: 24rpx;
          color: #999;
          display: block;
        }
      }
    }
  }
</style>
