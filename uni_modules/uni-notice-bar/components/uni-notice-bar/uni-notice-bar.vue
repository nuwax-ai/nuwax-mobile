<template>
  <view
    v-if="show"
    class="uni-noticebar"
    :style="{ backgroundColor: backgroundColor }"
    @click="onClick"
  >
    <slot v-if="showIcon === true || showIcon === 'true'" name="noticebarIcon">
      <text
        class="iconfont icon-voice-1"
        :style="{
          fontSize: fontSize * 1.2 + 'px',
          color: color,
          marginRight: '10rpx',
        }"
      ></text>
    </slot>
    <view
      class="uni-noticebar__content-wrapper"
      :class="{
        'uni-noticebar__content-wrapper--single':
          !scrollable && (single || moreText.length > 0),
      }"
    >
      <view
        class="uni-noticebar__content"
        :class="{
          'uni-noticebar__content--single': !scrollable && (single || moreText.length > 0),
        }"
      >
        <text
          class="uni-noticebar__content-text"
          :class="{
            'uni-noticebar__content-text--single':
              !scrollable && (single || showGetMore),
          }"
          :style="{
            color: color,
            fontSize: fontSize + 'px',
            lineHeight: fontSize * 1.5 + 'px',
          }"
          >{{ text }}</text
        >
      </view>
    </view>
    <view
      v-if="isShowGetMore"
      class="uni-noticebar__more"
      @click="clickMore"
    >
      <text
        v-if="moreText.length > 0"
        :style="{ color: moreColor, fontSize: fontSize + 'px' }"
        >{{ moreText }}</text
      >
      <uni-icons v-else type="right" :color="moreColor" :size="fontSize * 1.1" />
    </view>
    <view class="uni-noticebar-close" v-if="isShowClose">
      <text
        class="iconfont icon-X"
        @click="close"
        :style="{
          fontSize: fontSize * 1 + 'px',
          color: color,
          marginRight: '10rpx',
        }"
      ></text>
    </view>
  </view>
</template>

<script lang="uts" setup>
  import { ref, computed } from 'vue'

  /**
   * NoticeBar 通告栏（uni-app x 蒸汽模式兼容版）
   * @description 单行通告展示 / 关闭 / 查看更多。原 nvue 滚动动画与 $getAppWebview 在 uni-app x 不适用，已移除。
   * @property {String} text 显示文字
   * @property {String} backgroundColor 背景颜色
   * @property {String} color 文字颜色
   * @property {String} moreColor 查看更多文字的颜色
   * @property {String} moreText 设置“查看更多”的文本
   * @property {Boolean|String} single 是否单行
   * @property {Boolean|String} scrollable 是否滚动（uni-app x 暂不支持跑马灯，按单行处理）
   * @property {Boolean|String} showIcon 是否显示左侧喇叭图标
   * @property {Boolean|String} showClose 是否显示关闭按钮
   * @property {Boolean|String} showGetMore 是否显示右侧查看更多
   * @event {Function} click 点击 NoticeBar 触发事件
   * @event {Function} close 关闭 NoticeBar 触发事件
   * @event {Function} getmore 点击”查看更多“时触发事件
   */
  type Props = {
    text ?: string
    moreText ?: string
    backgroundColor ?: string
    speed ?: number
    color ?: string
    fontSize ?: number
    moreColor ?: string
    single ?: boolean | string
    scrollable ?: boolean | string
    showIcon ?: boolean | string
    showGetMore ?: boolean | string
    showClose ?: boolean | string
  }
  const props = withDefaults(defineProps<Props>(), {
    text: '',
    moreText: '',
    backgroundColor: '#FFF9EA',
    speed: 100,
    color: '#FF9A43',
    fontSize: 14,
    moreColor: '#FF9A43',
    single: false,
    scrollable: false,
    showIcon: false,
    showGetMore: false,
    showClose: false,
  })
  const emit = defineEmits(['click', 'getmore', 'close'])

  const show = ref(true)

  function toBool(v: boolean | string): boolean {
    return v === true || v === 'true'
  }

  const isShowGetMore = computed((): boolean => toBool(props.showGetMore))
  const isShowClose = computed((): boolean => toBool(props.showClose) && !toBool(props.showGetMore))

  function clickMore() {
    emit('getmore')
  }
  function close() {
    show.value = false
    emit('close')
  }
  function onClick() {
    emit('click')
  }
</script>

<style lang="scss" scoped>
  .uni-noticebar {
    display: flex;
    width: 100%;
    box-sizing: border-box;
    flex-direction: row;
    align-items: center;
    padding: 10px 12px;
    margin-bottom: 10px;
  }

  .uni-noticebar-close {
    margin-left: 8px;
    margin-right: 5px;
  }

  .uni-noticebar__content-wrapper {
    flex: 1;
    flex-direction: column;
    overflow: hidden;
  }

  .uni-noticebar__content-wrapper--single {
    flex-direction: row;
  }

  .uni-noticebar__content--single {
    flex: 1;
    overflow: hidden;
  }

  .uni-noticebar__content-text {
    font-size: 14px;
    line-height: 18px;
  }

  .uni-noticebar__content-text--single {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .uni-noticebar__more {
    flex-direction: row;
    flex-wrap: nowrap;
    align-items: center;
    padding-left: 5px;
  }
</style>
