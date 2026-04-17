<template>
  <view class="h-full flex flex-col border-b">
    <!-- 顶部导航栏 -->
    <custom-nav-bar :title="t('Mobile.Nav.home')" className="border-b">
      <template v-slot:left>
        <view class="flex flex-row items-center gap-4">
          <header-menu
            v-if="isLoggedIn"
            :userInfo="userInfo"
            ref="headerMenuRef"
          />
          <view v-else class="login-btn-wrapper" @click="handleLogin">
            <text class="login-btn-text">{{
              t("Mobile.Common.loginRegister")
            }}</text>
          </view>
          <!-- #ifdef MP-WEIXIN -->
          <view class="icon-search-box" @click="handleSearch">
            <text class="iconfont iconfont icon-Search font-48"></text>
          </view>
          <!-- #endif -->
        </view>
      </template>

      <!-- #ifdef H5 || WEB -->
      <template v-slot:right>
        <view class="icon-search-box" @click="handleSearch">
          <text class="iconfont iconfont icon-Search font-48"></text>
        </view>
      </template>
      <!-- #endif -->
    </custom-nav-bar>
    <uni-notice-bar
      v-if="!isLoggedIn"
      single
      show-close
      show-icon
      :text="t('Mobile.Common.noticeExperience')"
    ></uni-notice-bar>

    <!-- 未登录时只显示智能体列表，不显示标签页 -->
    <agent-list-content
      v-if="!isLoggedIn"
      class="h-full w-full"
      ref="agentListContentRef"
      :is-logged-in="isLoggedIn"
      @agent-click="handleAgentClick"
    />

    <!-- 登录后显示标签页：最近使用 + 会话记录 -->
    <pane-tabs
      v-if="isLoggedIn"
      :key="currentLang"
      v-model="activeTab"
      :lazy-load="false"
      with-bottom-padding
      @change="handleTabChange"
    >
      <pane-tab key-value="recent" tab="Mobile.Common.recentUsed">
        <agent-list-content
          class="h-full w-full"
          ref="agentListContentRef"
          :is-logged-in="isLoggedIn"
          @agent-click="handleAgentClickLast"
        />
      </pane-tab>

      <pane-tab
        key-value="history"
        tab="Mobile.Common.conversationHistory"
      >
        <conversation-list-content
          class="h-full w-full"
          ref="conversationListContentRef"
          :is-logged-in="isLoggedIn"
          @conversation-click="handleConversationClick"
        />
      </pane-tab>
    </pane-tabs>

    <!-- 登录弹窗 -->
    <auth-login-popup ref="loginPopupRef" />
  </view>
</template>

<script setup lang="ts">
  import { SUCCESS_CODE } from "@/constants/codes.constants";
  import { apiUserInfo } from "@/servers/account";
  import type { AgentInfo } from "@/types/interfaces/agent";
  import HeaderMenu from "./header-menu/header-menu.vue";
  import AgentListContent from "./agent-list-content/agent-list-content.vue";
  import ConversationListContent from "./conversation-list-content/conversation-list-content.vue";
  import type { UserInfo } from "@/types/interfaces/login";
  import { apiTenantConfig } from "@/servers/account";
  import { onAddToFavorites } from "@dcloudio/uni-app";
  import {
    getCurrentPagePath,
    jumpToAgentDetailPage,
  } from "@/utils/commonBusiness";
  import AuthLoginPopup from "@/components/auth-login-popup/auth-login-popup.vue";
  import { useAuthInterceptor } from "@/hooks/useAuthInterceptor";
  import { getCurrentPageFullPath } from "@/utils/common";
  import { setCurrentPageNavigationBarTitle } from "@/utils/system";
  import PaneTabs from "@/components/pane-tabs/pane-tabs.vue";
  import PaneTab from "@/components/pane-tabs/pane-tab.vue";
  import { TENANT_CONFIG_INFO } from "@/constants/home.constants";
  import { useI18n, applyTabBarI18n } from "@/utils/i18n";

  const { t, syncLanguageFromUser } = useI18n();

  const activeTab = ref("recent");
  // 分享标题
  const shareTitle = ref("");
  const fallbackShareTitle = computed(() => t("Mobile.Nav.home"));

  const handleTabChange = (key: string) => {
    if (key === "recent" && agentListContentRef.value) {
      // 切换到最近使用时加载数据
      agentListContentRef.value.loadData();
    } else if (key === "history" && conversationListContentRef.value) {
      // 切换到会话记录时加载数据
      conversationListContentRef.value.loadData();
    }
  };

  // 处理会话项点击
  const handleConversationClick = (item: any) => {
    // 跳转到智能体详情页面，并传递消息数据
    jumpToAgentDetailPage(item.agentId, item.id);
  };

  // 头部菜单ref
  const headerMenuRef = ref<any>(null);
  // 智能体列表组件ref
  const agentListContentRef = ref<any>(null);
  // 会话列表组件ref
  const conversationListContentRef = ref<any>(null);
  // 使用登录拦截 composable
  const {
    loginPopupRef,
    handleAgentClick: baseHandleAgentClick,
    checkAuthAndShowPopup,
    hasToken,
  } = useAuthInterceptor();

  // 包装 handleAgentClick 以适配 AgentInfo 类型
  const handleAgentClick = (info: AgentInfo) => {
    baseHandleAgentClick({
      agentId: info.agentId,
      name: info.name,
      agentType: info.agentType,
      icon: info.icon, // 跳转临时会话页面时使用
      description: info.description, // 跳转临时会话页面时使用
    });
  };

  // 最近使用
  const handleAgentClickLast = (info: AgentInfo) => {
    const { lastConversationId, agentId, name, agentType } = info || {};
    if (lastConversationId) {
      jumpToAgentDetailPage(agentId, lastConversationId);
    } else {
      baseHandleAgentClick({
        agentId: agentId,
        name: name,
        agentType: agentType,
        icon: info.icon, // 跳转临时会话页面时使用
        description: info.description, // 跳转临时会话页面时使用
      });
    }
  };

  // 处理登录点击
  const handleLogin = () => {
    // #ifdef MP-WEIXIN
    if (loginPopupRef.value) {
      loginPopupRef.value.open();
    }
    // #endif

    // #ifdef H5 || WEB
    const currentUrl = getCurrentPageFullPath();
    uni.navigateTo({
      url:
        "/subpackages/pages/login/login?redirect=" +
        encodeURIComponent(currentUrl),
    });
    // #endif
  };

  // 用户信息
  const userInfo = ref<UserInfo>();

  // 判断是否登录
  const isLoggedIn = ref<boolean>(false);

  // 查询当前登录用户信息
  const fetchUserInfo = async () => {
    const res = await apiUserInfo();
    const { code, data } = res || {};
    if (code === SUCCESS_CODE) {
      userInfo.value = data;
      await syncLanguageFromUser(data?.lang || "");
    }
  };

  // 设置分享标题
  const setCurrentShareTitle = async () => {
    // 获取本地用户配置
    const tenantConfigInfoString = await uni.getStorageSync(TENANT_CONFIG_INFO);
    if (tenantConfigInfoString) {
      try {
        const { siteName, siteDescription } = JSON.parse(
          tenantConfigInfoString,
        );

        const titleList = [];
        if (siteName) {
          titleList.push(siteName);
        }
        if (siteDescription) {
          titleList.push(siteDescription);
        }
        shareTitle.value = titleList.join(" ");
      } catch (error) {
        console.error("获取本地用户配置失败:", error);
      }
    }
  };

  onLoad((options: { cId?: string; fileProxyUrl?: string }) => {
    // 检测是否为文件预览分享跳转
    // #ifdef MP-WEIXIN
    if (options?.cId && options?.fileProxyUrl) {
      // 跳转到文件预览页面
      // 注意：fileProxyUrl 在分享时已经被 encodeURIComponent 编码过了
      // 这里不需要再次编码，直接传递即可
      uni.navigateTo({
        url: `/subpackages/pages/file-preview-page/file-preview-page?cId=${options.cId}&fileProxyUrl=${encodeURIComponent(options.fileProxyUrl)}`,
      });
      return;
    }
    // #endif

    // 设置当前页面导航栏标题
    setCurrentPageNavigationBarTitle();

    // 设置分享标题
    setCurrentShareTitle();
  });

  onPageShow(async () => {
    // 确保每次回到首页都刷新一次 TabBar 翻译，
    // 解决语言切换重载后 TabBar 对象可能未就绪导致 uni.setTabBarItem 失效的问题。
    applyTabBarI18n();

    const loggedIn = await hasToken();
    isLoggedIn.value = loggedIn || false;
    // 如果是登录状态，需要等待 pane-tabs 内的组件初始化
    if (isLoggedIn.value) {
      await nextTick();
      fetchUserInfo();
    }
  });

  // 处理搜索
  const handleSearch = () => {
    // 检查登录状态，如果未登录则显示登录弹窗
    if (!checkAuthAndShowPopup()) {
      return;
    }
    const currentUrl = getCurrentPagePath();
    uni.navigateTo({
      url:
        "/subpackages/pages/agent-search/agent-search?type=Home&backUrl=" +
        encodeURIComponent(currentUrl),
    });
  };

  // #ifdef MP-WEIXIN
  // 转发给朋友
  onShareAppMessage(() => {
    return {
      title: shareTitle.value || fallbackShareTitle.value,
      path: "/pages/index/index",
    };
  });

  // 收藏
  onAddToFavorites(() => {
    return {
      title: shareTitle.value || fallbackShareTitle.value,
    };
  });
  // #endif

  onHide(() => {
    if (headerMenuRef.value) {
      headerMenuRef.value.closeDropdown();
    }
  });
</script>

<style lang="scss" scoped>
  .h-full {
    height: 100%;
  }

  .w-full {
    width: 100%;
  }

  .icon-search-box {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-left: 12rpx;
  }

  .login-btn-wrapper {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    padding: 15rpx 20rpx;
    background-color: rgba(0, 0, 0, 0.05);
    border-radius: 100rpx;
    margin-right: 8rpx;

    &:active {
      background-color: rgba(0, 0, 0, 0.1);
    }

    .login-btn-text {
      color: #333333;
      font-size: 26rpx;
      font-weight: 400;
    }
  }
</style>
