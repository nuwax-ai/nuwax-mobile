<template>
  <modal-popup ref="modal" :title="title">
    <template #header-extra>
      <view class="copy-btn" @tap="copy">
        <text class="iconfont icon-CopyOutlined"></text>
      </view>
    </template>
     <view class="details-content">
        <text>{{ detailData }}</text>
      </view>
  </modal-popup>
</template>

<script>
  import modalPopup from "@/components/modal-popup/modal-popup.vue";
  import { t } from '@/utils/i18n';

  export default {
    name: "ToolDetailsModal",
    components: {
      modalPopup,
    },
    props: {
      title: {
        type: String,
        default: "",
      },
      detailData: {
        type: Object,
        default: () => ({}),
      },
    },
    methods: {
      copy() {
        let content = '';
        try {
          content = JSON.stringify(this.detailData, null, 2);
        } catch (e) {
          content = String(this.detailData);
        }
        
        uni.setClipboardData({
          data: content,
          success: () => {
            uni.showToast({
              title: t('Mobile.Common.copySuccess'),
              icon: "none",
            });
          },
          fail: () => {
            uni.showToast({
              title: t('Mobile.Common.copyFailed'),
              icon: "none",
            });
          }
        });
      },
      open() {
        this.$refs.modal.open();
      },
      close() {
        this.$refs.modal.close();
      },
    },
  };
</script>

<style lang="scss" scoped>
  .copy-btn {
    margin: 0 25rpx;
    .iconfont {
      color: #333;
      font-size: 32rpx;
    }
  }
</style>
