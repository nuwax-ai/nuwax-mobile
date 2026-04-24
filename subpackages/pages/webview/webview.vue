<template>
  <view class="webview-page page-container">
    <!-- #ifdef H5 || WEB -->
    <!-- 自定义导航栏 -->
    <custom-nav-bar class="webview-nav" :title="displayPageTitle">
      <template v-slot:left>
        <text class="iconfont icon-a-Chevronleft" @tap="onBackClick"></text>
      </template>
    </custom-nav-bar>
    <!-- #endif -->

    <view class="webview-content">
      <web-view
        class="web-view"
        v-if="url.length != 0"
        :src="url"
        id="webview"
        @error="handleWebviewError"
        @load="handleWebviewLoad"
        @message="handleWebviewMessage"
      ></web-view>
    </view>
  </view>
</template>

<script lang="ts" setup>
  import { computed, ref } from "vue";
  import { removeQueryCompat, isHttpUrl } from "@/utils/common";
  import { NO_LOGIN_CHECK_URL } from "@/constants/config";
  import { apiUserTicketCreate } from "@/servers/agentDev";
  import { SUCCESS_CODE } from "@/constants/codes.constants";
  import { onLoad, onShareAppMessage, onAddToFavorites } from "@dcloudio/uni-app";
  import { isTabPage } from "@/utils/commonBusiness";
  import { useI18n } from "@/utils/i18n";

  const { t } = useI18n();

  const url = ref<string>("");
  const method = ref<string>("");
  const data_type = ref<string>("");
  const request_id = ref<string>("");
  const pageTitle = ref<string>("");

  const displayPageTitle = computed(
    () => pageTitle.value || t("Mobile.Webview.defaultTitle"),
  );

  const getQueryParams = (url) => {
    const queryString = url.split("?")[1] || "";
    const pairs = queryString.split("&");
    const params = {};
    for (let pair of pairs) {
      if (!pair) continue;
      const [k, v] = pair.split("=");
      params[decodeURIComponent(k)] = decodeURIComponent(v || "");
    }
    return params;
  };

  // 判断是否需要调用接口
  const isNeedCallApi = computed(() => {
    return !!(
      method.value === "browser_navigate_page" &&
      data_type.value &&
      request_id.value
    );
  });

  // WebView 加载错误处理
  const handleWebviewError = (e: any) => {
    console.error("WebView 加载错误:", e);
    uni.showToast({
      title: t("Mobile.Webview.loadFailed"),
      icon: "none",
      duration: 2000,
    });
  };

  // WebView 加载完成
  const handleWebviewLoad = (e: any) => {
    // #ifdef MP-WEIXIN || APP
    if (isNeedCallApi.value) {
      uni.showLoading({
        title: t("Mobile.Webview.aiReading"),
        mask: true,
      });
      setTimeout(() => {
        uni.navigateBack({ delta: 1 });
        uni.hideLoading();
      }, 4000);
    }
    // #endif
  };

  /**
   * WebView 消息处理
   *
   * ⚠️ 重要：微信小程序的 @message 不会实时触发！
   * 触发时机：
   * 1. 用户点击返回按钮（最常用）
   * 2. 组件销毁时
   * 3. 分享时
   *
   * 调试方法：
   * 1. 网页发送消息后，点击小程序的返回按钮
   * 2. 查看控制台是否有 "收到消息" 日志
   * 3. 如果没有，检查网页端代码是否正确调用 wx.miniProgram.postMessage
   */
  const handleWebviewMessage = (e: any) => {
    // #ifdef MP-WEIXIN || APP

    // e.detail.data 是一个数组，包含所有 postMessage 发送的消息
    const messages = e.detail.data;

    if (isNeedCallApi.value && messages && messages.length > 0) {
      // 处理最后一条消息 - 读取首页内容
      uni.$emit("browser_navigate_page", {
        method: method.value,
        data_type: data_type.value,
        html: messages[messages.length - 1].html,
        request_id: request_id.value,
      });
    } else {
      console.warn("消息数组为空");
    }
    // #endif
  };

  /**
   * 获取分享链接
   */
  const getSharingLink = () => {
    const newUrl = removeQueryCompat(url.value, ["_ticket", "jump_type"]);
    const andStr = newUrl.includes("?") ? "&" : "?";
    const currentUrl = newUrl + andStr + "jump_type=outer";
    return encodeURIComponent(currentUrl);
  };

  const onBackClick = () => {
    const backUrl = uni.getStorageSync("backUrl");
    // 首页是 tabbar 页面，必须使用 switchTab 跳转
    const toUrl = backUrl && backUrl !== "/" ? backUrl : "/pages/index/index";

    if (isTabPage(toUrl)) {
      uni.switchTab({ url: toUrl });
    } else {
      uni.redirectTo({ url: toUrl });
    }
    uni.removeStorageSync("backUrl");
  };

  // 初始化加载
  const onLoadInit = async (params: Record<string, any>) => {
    if (params.url) {
      let currentUrl = decodeURIComponent(params.url);
      const queryParams = getQueryParams(currentUrl);

      // 设置页面标题
      const title = queryParams.title || t("Mobile.Webview.defaultTitle");
      pageTitle.value = title;
      uni.setNavigationBarTitle({
        title: title,
      });

      // #ifdef H5 || WEB
      if (isHttpUrl(currentUrl)) {
        url.value = currentUrl;
      } else {
        url.value = window.location.origin + currentUrl;
      }
      // #endif

      // #ifdef MP-WEIXIN || APP
      // 判断当前url是否不需要登录检查
      if (NO_LOGIN_CHECK_URL.includes(currentUrl)) {
        url.value = currentUrl;
        return;
      }

      if (queryParams.method) {
        method.value = queryParams.method;
      }
      if (queryParams.data_type) {
        data_type.value = queryParams.data_type;
      }
      if (queryParams.request_id) {
        request_id.value = queryParams.request_id;
      }

      // 判断是否存在 _ticket
      if (queryParams._ticket) {
        url.value = currentUrl;
      } else {
        // 暂存当前url
        globalThis.appConfig.redirectUrl = params.url; // 未解码
        const ticketResult = await apiUserTicketCreate();
        if (ticketResult.code === SUCCESS_CODE && ticketResult.data) {
          const andStr = currentUrl.includes("?") ? "&" : "?";
          url.value = currentUrl + andStr + `_ticket=${ticketResult.data}`;
        }
      }
      // #endif
    }
  };

  onLoad((params) => {
    // 加载初始化数据
    onLoadInit(params);
  });

  // #ifdef MP-WEIXIN
  // 转发给朋友
  onShareAppMessage(() => {
    return {
      title:
        getQueryParams(url.value)?.["title"] || t("Mobile.Common.appName"),
      path: "/subpackages/pages/webview/webview?url=" + getSharingLink(),
    };
  });

  // 收藏
  onAddToFavorites(() => {
    return {
      title:
        getQueryParams(url.value)?.["title"] || t("Mobile.Common.appName"),
      query: "url=" + getSharingLink(),
    };
  });
  // #endif
</script>

<style lang="scss" scoped>
  .webview-page {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .webview-nav {
    flex-shrink: 0;
    position: relative;
    z-index: 20;
    background: #fff;
  }

  .webview-content {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .web-view {
    width: 100%;
    height: 100%;
  }
</style>
