<template>
  <web-view :src="src" @message="onMessage"></web-view>
</template>

<script>
  import { API_BASE_URL } from "@/constants/config";
  const path = "/static/aliyun-captcha.html";
  export default {
    computed: {
      src() {
        return API_BASE_URL + path;
      },
    },
    methods: {
      onMessage(e) {
        const captchaVerifyParam = e.detail.data[0];
        const eventChannel = this.getOpenerEventChannel();
        // 通过事件通道，触发在业务页面中定义的 'getCaptchaVerifyParam' 事件，并把验证参数发送至业务页面
        eventChannel &&
          eventChannel.emit("getCaptchaVerifyParam", captchaVerifyParam);
      },
    },
  };
</script>
