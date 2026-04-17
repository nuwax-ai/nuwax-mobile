<template>
  <login-layout
    :title="tenantConfigInfo?.siteName"
    :logo="tenantConfigInfo?.siteLogo"
    :show-back="false"
    :show-nav-bar="true"
    form-content-height="800rpx"
  >
    <view class="container-weixin">
      <view class="sub-title-wrapper">
        <text class="sub-title">
          {{
            t("Mobile.Auth.welcomeUse", {
              siteName: tenantConfigInfo?.siteName || "",
            })
          }}
        </text>
      </view>

      <!-- 底部登录区域 -->
      <view class="login-section">
        <!-- 协议勾选 -->
        <agreement-checkbox v-model="isAgreed" />

        <!-- 登录按钮 -->
        <button
          class="login-btn"
          :open-type="isAgreed ? 'getPhoneNumber' : ''"
          @getphonenumber="onGetPhoneNumber"
          @tap="onLoginClick"
        >
          {{ t("Mobile.Auth.oneClickLogin") }}
        </button>
      </view>

      <!-- 手机号登录链接 -->
      <view class="phone-login-link" @tap="goToPhoneLogin">
        {{ t("Mobile.Auth.phoneLoginRegister") }}
      </view>
    </view>
  </login-layout>
</template>

<script setup lang="ts">
import { apiWechatLogin } from "@/servers/account";
import { SUCCESS_CODE } from "@/constants/codes.constants";
import { redirectTo } from "@/utils/common";
import { ref } from "vue";
import { ACCESS_TOKEN } from "@/constants/home.constants";
import AgreementCheckbox from "@/components/agreement-checkbox/agreement-checkbox.vue";
import { apiTenantConfig } from "@/servers/account";
import type { TenantConfigInfo } from "@/types/interfaces/login";
import LoginLayout from "@/subpackages/pages/login/components/login-layout/login-layout.vue";
import { useI18n } from "@/utils/i18n";
const { t } = useI18n();
const redirectUrl = ref("");
const isAgreed = ref(false);

const tenantConfigInfo = ref<TenantConfigInfo>(null);
function onLoginClick() {
  if (!isAgreed.value) {
    uni.showModal({
      title: t("Mobile.Common.tip"),
      content: t("Mobile.Auth.pleaseAgreeProtocol"),
      confirmText: t("Mobile.Common.agree"),
      cancelText: t("Mobile.Common.disagree"),
      success: function (res) {
        if (res.confirm) {
          isAgreed.value = true;
        }
      },
    });
  }
}

function goToPhoneLogin() {
  const url = `/subpackages/pages/login/login?redirect=${encodeURIComponent(redirectUrl.value)}`;
  uni.navigateTo({ url });
}

async function onGetPhoneNumber(event: Any) {
  // 1. 检查用户是否取消授权
  if (!event?.detail || event.detail.errMsg !== "getPhoneNumber:ok") {
    uni.showToast({ title: t("Mobile.Auth.userCancelAuthorize"), icon: "none" });
    return;
  }

  // 2. 微信新版返回的 phoneCode
  const phoneCode = event.detail.code;

  try {
    uni.showLoading({ title: t("Mobile.Page.loading") });
    // 3. 请求后端登录接口
    const { code, data, message } = await apiWechatLogin({ code: phoneCode });

    handleLoginSuccess(code, data, message);
  } finally {
    uni.hideLoading();
  }
}

function handleLoginSuccess(code: string, data: any, message: string) {
  // 4. 登录成功
  if (code === SUCCESS_CODE) {
    uni.setStorageSync(ACCESS_TOKEN, data.token);
    uni.showToast({
      title: t("Mobile.Auth.loginSuccess"),
      icon: "success",
    });
    setTimeout(() => {
      redirectTo(redirectUrl.value);
    }, 1000);
  } else {
    uni.showToast({
      title: message ?? t("Mobile.Auth.loginFailed"),
      icon: "none",
    });
  }
}

// 获取用户配置
const fetchTenantConfig = async () => {
  const { code, data } = await apiTenantConfig();
  if (code === SUCCESS_CODE) {
    tenantConfigInfo.value = data;
  }
};

onMounted(() => {
  fetchTenantConfig();
});

onLoad((query) => {
  // 登录成功后跳转的页面
  if (query.redirect) {
    redirectUrl.value = decodeURIComponent(query.redirect);
    console.log("登录成功后跳转的页面:", redirectUrl.value);
  }
});
</script>

<style lang="scss" scoped>
.container-weixin {
  height: 100%;
  display: flex;
  flex-direction: column;

  .sub-title-wrapper {
    margin-top: 120rpx;
    margin-bottom: 48rpx;
    text-align: center;
    flex: 1;

    .sub-title {
      color: #000;
      text-align: center;
      font-size: 40rpx;
      font-style: normal;
      font-weight: 600;
      line-height: 56rpx;
    }
  }

  .login-section {
    margin-bottom: 180rpx;
    .login-btn {
      margin-top: 20rpx;
      width: 100%;
      border-radius: 16rpx;
      padding: 25rpx 24rpx;
      font-size: 32rpx;
      font-weight: 400;
      margin-bottom: 32rpx;
      line-height: 48rpx;
      text-align: center;
      background: #5147ff;
      color: #ffffff;
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: center;
    }
  }

  .phone-login-link {
    width: 100%;
    text-align: center;
    font-size: 32rpx;
    color: rgba(21, 23, 31, 0.5);
    margin-top: 20rpx;
  }
}
</style>
