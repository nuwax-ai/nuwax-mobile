<template>
  <view class="sidebar">
    <scroll-view class="content-scroll" scroll-y="true" :show-scrollbar="false">
      <!-- 用户信息 -->
      <view class="user-info">
        <image :src="props.user?.avatar" class="avatar" mode="aspectFill" :alt="t('Mobile.Common.avatarAlt')"></image>
        <text class="nickname text-ellipsis">{{ props.user?.nickname }}</text>
      </view>

      <!-- 会话记录 -->
      <view class="session-recording">
        <view class="section-header">
          <view class="section-title">{{ t('Mobile.Common.conversationHistory') }}</view>
        </view>
        <custom-nav-bar-speak :chat-list="props.chatList" :is-app-details="true" />
      </view>
    </scroll-view>

    <!-- 退出 -->
    <view class="logout">
      <view class="logout-item" @click="handleLogout">
        <text class="iconfont icon-Exit"></text>
        <text class="logout-text">{{ t('Mobile.Header.logout') }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import type { ConversationInfo} from '@/types/interfaces/conversationInfo';
import { SUCCESS_CODE } from '@/constants/codes.constants';
import { apiLogout } from '@/servers/account';
import { t } from '@/utils/i18n';
import CustomNavBarSpeak from '@/components/custom-nav-bar/custom-nav-bar-speak/custom-nav-bar-speak.vue'

// 定义props
const props = defineProps<{
  user: {avatar: string, nickname: string},
  chatList: ConversationInfo[]
}>()

// 对象转 query 字符串
function objectToQuery(obj) {
  return Object.keys(obj)
    .map(key => `${key}=${encodeURIComponent(obj[key])}`)
    .join('&');
}

// 获取当前页面信息
function getCurrentPageInfo() {
  // #ifdef H5 || WEB
  /**
   * 此处获取完整路径，因为H5端页面跳转redirectTo方法中需要完整路径
   */
  return window.location.href;
  // #endif

  // #ifdef MP-WEIXIN
  const pages = getCurrentPages();
  if (pages.length === 0) return '';
  // 获取当前页面
  const current = pages[pages.length - 1];

  // 判断参数对象是否为空
  const isEmptyObject = Object.keys(current.options).length === 0;
  // current.route 页面路径，如 pages/index/index
  // current.options 参数对象，如 {id: "123", conversationId: "456"}
  // fullPath 完整路径，如 /pages/index/index?id=123&conversationId=456
  return isEmptyObject ? `/${current.route}` : `/${current.route}?${objectToQuery(current.options)}`;
  // #endif
}

// 退出登录
const handleLogout = async ()=>{

  try {
    const result = await apiLogout()
    if (result.code === SUCCESS_CODE) {
      uni.showToast({
        title: t('Mobile.Header.logoutSuccess'),
        icon: 'success'
      })

      uni.clearStorageSync()
      // 获取当前页面完整路径
      const fullPath = getCurrentPageInfo();
      
      // #ifdef H5 || WEB
      const url = `/subpackages/pages/login/login?redirect=${encodeURIComponent(fullPath)}`;
      uni.reLaunch({ url });
      // #endif

      // #ifdef MP-WEIXIN
      uni.reLaunch({ url: `/subpackages/pages/login-weixin/login-weixin?redirect=${encodeURIComponent(fullPath)}` });
      // #endif
    }

  } catch (error) {
    uni.showToast({
      title: t('Mobile.Header.logoutFailed'),
      icon: 'none'
    })
    return
  }
}

</script>

<style lang="scss" scoped>
.sidebar {
  width: 100%;
  height: 100%;
  background-color: #fff;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;

  .content-scroll {
    flex: 1;
    min-height: 0;
  }

  // 用户信息
  .user-info {
    display: flex;
    flex-direction: row;
    align-items: center;
    margin-bottom: 40rpx;
    padding: 0 16rpx 0 32rpx;

    .avatar {
      width: 100rpx;
      height: 100rpx;
      border-radius: 50%;
      margin-right: 20rpx;
    }

    .nickname {
      flex:1;
      font-size: 36rpx;
      font-weight: bold;
    }
  }

  // 会话记录
  .session-recording {
    padding: 0 16rpx;
    .section-header {
      display: flex;
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
      padding: 0 16rpx;
      margin-bottom: 16rpx;

      .section-title {
        flex: 1;
        font-size: 28rpx;
        font-weight: bold;
        color: rgba(21, 23, 31, 0.5);
      }
    }
  }

  // 退出
  .logout {
    flex-shrink: 0;
    padding: 20rpx 0;
    border-top: 2rpx solid rgba(21, 23, 31, 0.06);
    background-color: #fff;

    .logout-item {
      margin: 0 auto;
      display: flex;
      flex-direction: row;
      align-items: center;
      .iconfont {
        font-size: 40rpx;
        margin-right: 10rpx;
        color: rgba(21, 23, 31, 0.7) !important;
      }
      .logout-text {
        font-size: 28rpx;
        line-height: 44rpx;
        color: rgba(21, 23, 31, 0.7);
      }
    }
  }
}
</style>
