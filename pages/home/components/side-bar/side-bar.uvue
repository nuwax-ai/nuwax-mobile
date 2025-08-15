<template>
  <view class="sidebar">
    <!-- 用户信息 -->
    <view class="user-info">
      <image :src="user.avatar" class="avatar" mode="aspectFill"></image>
      <text class="nickname">{{ user.nickname }}</text>
    </view>

    <!-- 菜单 -->
    <view class="menu">
      <view
        class="menu-item"
        v-for="(item, index) in menuList"
        :key="index"
        @click="emitMenuClick(item)"
      >
        <image v-if="item.icon" :src="item.icon" class="menu-icon" />
        <text class="menu-text">{{ item.text }}</text>
      </view>
    </view>

    <!-- 最近使用 -->
    <view class="section">
      <text class="section-title">最近使用</text>
      <view
        class="recent-item"
        v-for="(item, index) in recentList"
        :key="index"
        @click="emitRecentClick(item)"
      >
        <image v-if="item.icon" :src="item.icon" class="recent-icon" />
        <text class="recent-text">{{ item.text }}</text>
      </view>
    </view>

    <!-- 会话记录 -->
    <view class="section">
      <view class="section-header">
        <text class="section-title">会话记录</text>
        <text class="more" @click="emitViewAll">查看全部 ></text>
      </view>
      <view
        class="chat-item"
        v-for="(item, index) in chatList"
        :key="index"
        @click="emitChatClick(item)"
      >
        <text class="chat-text">{{ item.text }}</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import {  reactive } from "vue";


const user = reactive({
  avatar: "/static/logo.png",
  nickname: "aMos"
});

const menuList = reactive([
  { text: "首页", icon: "Home" },
  { text: "智能体", icon: "stars" }
]);

const recentList = reactive([
  { text: "Mermaid转换器", icon: "/static/icons/y.png" },
  { text: "Ollama", icon: "/static/icons/ollama.png" }
]);

const chatList = reactive([
  { text: "Ai for UX design" },
  { text: "稳定币的价值分析" },
  { text: "比特币投资建议" }
]);

const onMenuClick = (item) => {
  console.log("点击菜单：", item);
};
const onRecentClick = (item) => {
  console.log("点击最近使用：", item);
};
const onChatClick = (item) => {
  console.log("点击会话记录：", item);
};
const onViewAll = () => {
  console.log("查看全部会话");
};
</script>

<style lang="scss" scoped>
.sidebar {
  width: 100%;
  background-color: #fff;
  height: 100vh;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.user-info {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-bottom: 40rpx;

  .avatar {
    width: 100rpx;
    height: 100rpx;
    border-radius: 50%;
    margin-right: 20rpx;
  }
  .nickname {
    font-size: 36rpx;
    font-weight: bold;
  }
}

.menu {
  margin-bottom: 40rpx;

  .menu-item {
    display: flex;
    align-items: center;
    padding: 16rpx 0;
  }
  .menu-icon {
    width: 40rpx;
    height: 40rpx;
    margin-right: 16rpx;
  }
  .menu-text {
    font-size: 26rpx;
  }
}

.section {
  margin-bottom: 30rpx;

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .section-title {
    font-size: 24rpx;
    font-weight: bold;
    margin-bottom: 10rpx;
  }

  .more {
    font-size: 22rpx;
    color: #666;
  }

  .recent-item,
  .chat-item {
    display: flex;
    align-items: center;
    padding: 12rpx 0;
  }
  .recent-icon {
    width: 36rpx;
    height: 36rpx;
    margin-right: 12rpx;
  }
  .recent-text,
  .chat-text {
    font-size: 24rpx;
    color: #333;
  }
}
</style>
