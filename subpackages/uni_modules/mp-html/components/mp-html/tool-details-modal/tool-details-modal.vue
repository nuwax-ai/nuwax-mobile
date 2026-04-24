<template>
  <modal-popup ref="modal" :title="title" :enable-swipe-close="false">
    <template #header-extra>
      <view class="copy-btn" @tap="copy">
        <text class="iconfont icon-CopyOutlined"></text>
      </view>
    </template>
    <view class="details-content">
      <mp-html :content="formattedDetailData" :markdown="true" :show-header="false"></mp-html>
    </view>
  </modal-popup>
</template>

<script lang="uts" setup>
  import { ref, computed } from 'vue';
  import { t } from '@/utils/i18n';
  import modalPopup from "@/components/modal-popup/modal-popup.vue";
  import mpHtml from '@/subpackages/uni_modules/mp-html/components/mp-html/mp-html.vue'

  /**
   * 工具详情弹窗组件
   */
  defineOptions({
    name: "ToolDetailsModal"
  })

  // 定义组件属性
  const props = withDefaults(defineProps<{
    title?: string,
    detailData?: any
  }>(), {
    title: "",
    detailData: null
  })

  // 引用子组件
  const modal = ref<any>(null);

  // 计算属性：格式化详情展示
  const formattedDetailData = computed(() : string => {
    const data = props.detailData;
    if (data == null) {
      return "";
    }
    let content = '';
    try {
      content = JSON.stringify(data, null, 2);
    } catch (e) {
      content = String(data);
    }
    return `\`\`\`json\n${content}\n\`\`\``;
  })

  /**
   * 复制数据到剪贴板
   */
  const copy = () => {
    const data = props.detailData;
    if (data == null) {
      return;
    }
    let content = '';
    try {
      content = JSON.stringify(data, null, 2);
    } catch (e) {
      content = String(data);
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
  }

  /**
   * 打开弹窗
   */
  const open = () => {
    modal.value?.open();
  }

  /**
   * 关闭弹窗
   */
  const close = () => {
    modal.value?.close();
  }

  // 暴露组件方法
  defineExpose({
    open,
    close
  })
</script>

<style lang="scss" scoped>
  .copy-btn {
    margin: 0 25rpx;
    .iconfont {
      color: #333;
      font-size: 32rpx;
    }
  }

  .details-content {
    /* 可以在这里添加额外的样式 */
  }
</style>
