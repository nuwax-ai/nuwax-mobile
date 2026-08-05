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
      <!-- 蒸汽模式：scrollable 时用 scroll-view + JS 驱动 transform: translateX 实现跑马灯。
           布尔属性按蒸汽模式要求显式赋值（scroll-view 的 scroll-x 等默认值已从 true 改为 false）。 -->
      <scroll-view
        v-if="scrollableBool"
        ref="scrollRef"
        class="uni-noticebar__content-scroll"
        :scroll-x="true"
        :show-scrollbar="false"
        :scroll-with-animation="false"
      >
        <text
          ref="textRef"
          class="uni-noticebar__content-text uni-noticebar__content-text--scroll"
          :style="{
            color: color,
            fontSize: fontSize + 'px',
            lineHeight: fontSize * 1.5 + 'px',
          }"
          >{{ text }}</text
        >
      </scroll-view>
      <!-- 非 scrollable：保持原有单行省略号布局 -->
      <view
        v-else
        class="uni-noticebar__content"
        :class="{
          'uni-noticebar__content--single': single || moreText.length > 0,
        }"
      >
        <text
          class="uni-noticebar__content-text"
          :class="{
            'uni-noticebar__content-text--single':
              single || showGetMore,
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
  import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'

  /**
   * NoticeBar 通告栏（uni-app x 蒸汽模式兼容版）
   * @description 单行通告展示 / 关闭 / 查看更多。
   *  蒸汽模式下 scrollable=true 且文本溢出时，通过 scroll-view + JS 驱动 transform: translateX
   *  实现跑马灯（原 nvue/CSS @keyframes/$getAppWebview 在 uni-app x 不可用）。
   *  驱动方式参考 lime-tabs 的 scroll-view + 内联 transform 模式。
   * @property {String} text 显示文字
   * @property {String} backgroundColor 背景颜色
   * @property {String} color 文字颜色
   * @property {String} moreColor 查看更多文字的颜色
   * @property {String} moreText 设置“查看更多”的文本
   * @property {Boolean|String} single 是否单行（非 scrollable 时生效，启用单行省略号）
   * @property {Boolean|String} scrollable 是否滚动（true 且文本溢出时启用跑马灯）
   * @property {Number} speed 滚动速度（px/秒，默认 100，仅 scrollable 时生效）
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
  const scrollRef = ref<UniScrollViewElement | null>(null)
  const textRef = ref<UniElement | null>(null)

  // 跑马灯运行时状态（无需响应式，全部通过 style.setProperty 直接驱动 DOM）
  let animationTimer = 0
  let containerWidth = 0
  let textWidth = 0
  let isMounted = false

  function toBool(v: boolean | string): boolean {
    return v === true || v === 'true'
  }

  const scrollableBool = computed((): boolean => toBool(props.scrollable))
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

  /**
   * 直接驱动文本元素的 transform 与 transition。
   * 顺序很关键：必须先 set transition-duration 再 set transform，浏览器看到新 duration 后才会按它处理 transform 变化，
   * 否则从「有过渡」切到「无过渡」时会被旧 duration 拖一次动画。
   * 与 lime-tabs 的 trackRef.value?.style.setProperty(...) 用法一致。
   */
  function applyTextStyle(x: number, durationSeconds: number) {
    const el = textRef.value
    if (el == null) return
    el.style.setProperty('transition-property', 'transform')
    el.style.setProperty('transition-timing-function', 'linear')
    el.style.setProperty('transition-duration', `${durationSeconds}s`)
    el.style.setProperty('transform', `translateX(${x}px)`)
  }

  function clearTimer() {
    if (animationTimer != 0) {
      clearTimeout(animationTimer)
      animationTimer = 0
    }
  }

  function stopAnimation() {
    clearTimer()
    applyTextStyle(0, 0)
  }

  /**
   * 测量容器与文本宽度。
   * APP/WEB 走 element ref 的 offsetWidth / getBoundingClientRect（参考 lime-tabs measureTabs）；
   * 其它平台退回 offsetWidth。返回 true 表示两者均测到正宽度。
   */
  function measure(): boolean {
    const sv = scrollRef.value
    const tx = textRef.value
    if (sv == null || tx == null) return false
    containerWidth = sv.offsetWidth
    // #ifdef APP || WEB
    const rect = tx.getBoundingClientRect()
    textWidth = rect.width
    // #endif
    // #ifndef APP || WEB
    textWidth = tx.offsetWidth
    // #endif
    return containerWidth > 0 && textWidth > 0
  }

  /**
   * 跑马灯循环：起点停顿 → 滚到终点 → 终点停顿 → 滚回起点 → 递归。
   * duration 单位秒；每次 schedule 下一段前都 clearTimeout 上一次的 timer，避免 restart 时叠加。
   */
  function runLoop(distance: number, duration: number) {
    // Phase 1：起点停顿，duration=0 保证 transform 立即归零（避免上次循环的 transform 还被过渡）
    applyTextStyle(0, 0)

    clearTimer()
    animationTimer = setTimeout(() => {
      if (!isMounted) return
      // Phase 2：平滑滚到终点
      applyTextStyle(-distance, duration)

      animationTimer = setTimeout(() => {
        if (!isMounted) return
        // Phase 3：终点停顿 1.5s
        animationTimer = setTimeout(() => {
          if (!isMounted) return
          // Phase 4：平滑滚回起点（duration 已是 duration，仅改 transform）
          applyTextStyle(0, duration)

          animationTimer = setTimeout(() => {
            if (!isMounted) return
            // 循环
            runLoop(distance, duration)
          }, duration * 1000 + 50)
        }, 1500)
      }, duration * 1000 + 50)
    }, 800)
  }

  function startAnimation() {
    if (!isMounted) return
    if (!scrollableBool.value) return
    if (props.text.length == 0) return
    if (!measure()) {
      // refs 尚未就绪或宽度还是 0（组件未渲染完成），稍后重试。onUnmounted 会清 timer，不会泄漏。
      clearTimer()
      animationTimer = setTimeout(startAnimation, 200)
      return
    }
    const distance = textWidth - containerWidth
    if (distance <= 0) return // 文本未溢出，无需滚动

    // speed 视为 px/秒，至少 1 防 0/极小值导致时长爆炸
    const duration = distance / Math.max(props.speed, 1)
    runLoop(distance, duration)
  }

  function restartAnimation() {
    clearTimer()
    applyTextStyle(0, 0)
    nextTick(() => {
      setTimeout(() => {
        startAnimation()
      }, 50)
    })
  }

  onMounted(() => {
    isMounted = true
    if (scrollableBool.value) {
      // 首帧 layout 后再测，参考 lime-tabs onMounted 内 nextTick + setTimeout(100) 的做法
      nextTick(() => {
        setTimeout(() => {
          startAnimation()
        }, 100)
      })
    }
  })

  onUnmounted(() => {
    isMounted = false
    clearTimer()
  })

  // 文案变化（如 i18n 切换）→ 重新测量并重启循环
  watch(
    () => props.text,
    () => {
      if (scrollableBool.value) {
        restartAnimation()
      }
    },
  )

  // scrollable 切换：true → 启动；false → 停止并复位
  watch(
    () => props.scrollable,
    (v: boolean | string) => {
      if (toBool(v)) {
        restartAnimation()
      } else {
        stopAnimation()
      }
    },
  )
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

  /* 蒸汽模式跑马灯：scroll-view 作为带裁剪的横向容器 */
  .uni-noticebar__content-scroll {
    flex: 1;
    flex-direction: row;
    overflow: hidden;
  }

  .uni-noticebar__content-text {
    font-size: 14px;
    line-height: 18px;
  }

  /* 跑马灯文本：强制不换行，宽度由文本自然撑开，scroll-view 负责左右裁剪 */
  .uni-noticebar__content-text--scroll {
    white-space: nowrap;
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
