<template>
  <view id="_root" :class="(isTruthy(selectable) ? '_select ' : '') + '_root'" :style="containerStyle">
    <slot v-if="isEmptyNodes(nodes)" />
    <node v-else :childs="nodes" :processing-list="processingList"
      :opts="[lazyLoad, loadingImg, errorImg, showImgMenu, selectable]" name="span" />
  </view>
</template>

<script>
/**
 * mp-html v2.5.1
 * @description 富文本组件
 * @tutorial https://github.com/jin-yufeng/mp-html
 * @property {String} container-style 容器的样式
 * @property {String} content 用于渲染的 html 字符串
 * @property {Boolean} copy-link 是否允许外部链接被点击时自动复制
 * @property {String} domain 主域名，用于拼接链接
 * @property {String} error-img 图片出错时的占位图链接
 * @property {Boolean} lazy-load 是否开启图片懒加载
 * @property {string} loading-img 图片加载过程中的占位图链接
 * @property {Boolean} pause-video 是否在播放一个视频时自动暂停其他视频
 * @property {Boolean} preview-img 是否允许图片被点击时自动预览
 * @property {Boolean} scroll-table 是否给每个表格添加一个滚动层使其能单独横向滚动
 * @property {Boolean | String} selectable 是否开启长按复制
 * @property {Boolean} set-title 是否将 title 标签的内容设置到页面标题
 * @property {Boolean} show-img-menu 是否允许图片被长按时显示菜单
 * @property {Object} tag-style 标签的默认样式
 * @property {Boolean | Number} use-anchor 是否使用锚点链接
 * @event {Function} load dom 结构加载完毕时触发
 * @event {Function} ready 所有图片加载完毕时触发
 * @event {Function} imgtap 图片被点击时触发
 * @event {Function} linktap 链接被点击时触发
 * @event {Function} play 音视频播放时触发
 * @event {Function} error 媒体加载出错时触发
 */
import node from './node/node.vue'
import { hasLen, valOr } from '@/utils/common'
class Parser {
  constructor(vm) {
    this.vm = vm
  }
  parse(content) {
    const source = typeof content === 'string' ? content : ''
    if (source.length === 0) {
      return []
    }
    const normalized = source
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
    return [{
      type: 'text',
      text: normalized
    }]
  }
}
const plugins = []
export default {
  name: 'mp-html',
  data() {
    return {
      nodes: []
    }
  },
  props: {
    markdown: Boolean,
    containerStyle: {
      type: String,
      default: ''
    },
    content: {
      type: String,
      default: ''
    },
    processingList: {
      type: Array,
      default: () => []
    },
    conversationId: {
      type: [String, Number],
      default: ''
    },
    copyLink: {
      type: [Boolean, String],
      default: true
    },
    domain: String,
    errorImg: {
      type: String,
      default: ''
    },
    lazyLoad: {
      type: [Boolean, String],
      default: false
    },
    loadingImg: {
      type: String,
      default: ''
    },
    pauseVideo: {
      type: [Boolean, String],
      default: true
    },
    previewImg: {
      type: [Boolean, String],
      default: true
    },
    scrollTable: [Boolean, String],
    selectable: [Boolean, String],
    setTitle: {
      type: [Boolean, String],
      default: true
    },
    showImgMenu: {
      type: [Boolean, String],
      default: true
    },
    tagStyle: Object,
    useAnchor: [Boolean, Number]
  },
  // #ifdef VUE3
  emits: ['load', 'ready', 'imgtap', 'linktap', 'play', 'error'],
  // #endif
  components: {
    node
  },
  watch: {
    content(content) {
      this.setContent(content)
    }
  },
  created() {
    this.plugins = []
    for (let i = plugins.length - 1; i >= 0; i--) {
      this.plugins.push(new plugins[i](this))
    }
  },
  mounted() {
    if (hasLen(this.content) && hasLen(this.nodes) === false) {
      this.setContent(this.content)
    }
  },
  beforeDestroy() {
    this._hook('onDetached')
  },
  methods: {
    /**
     * @description 将锚点跳转的范围限定在一个 scroll-view 内
     * @param {Object} page scroll-view 所在页面的示例
     * @param {String} selector scroll-view 的选择器
     * @param {String} scrollTop scroll-view scroll-top 属性绑定的变量名
     */
    in(page, selector, scrollTop) {
      const hasPage = page != null
      const hasSelector = typeof selector === 'string' && selector.length > 0
      const hasScrollTop = typeof scrollTop === 'string' && scrollTop.length > 0
      if (hasPage && hasSelector && hasScrollTop) {
        this._in = {
          page,
          selector,
          scrollTop
        }
      }
    },

    /**
     * @description 锚点跳转
     * @param {String} id 要跳转的锚点 id
     * @param {Number} offset 跳转位置的偏移量
     * @returns {Promise}
     */
    navigateTo(id, offset) {
      const mappedId = this._ids[decodeURI(id)]
      const hasMappedId = typeof mappedId === 'string' && mappedId.length > 0
      id = hasMappedId ? mappedId : id
      return new Promise((resolve, reject) => {
        if (this.isTruthy(this.useAnchor) === false) {
          reject(Error('Anchor is disabled'))
          return
        }
        const parsed = parseInt(this.useAnchor)
        offset = valOr(offset, isNaN(parsed) ? 0 : parsed)
        // #ifndef MP-ALIPAY
        let deep = ' '
        // #ifdef MP-WEIXIN || MP-QQ || MP-TOUTIAO
        deep = '>>>'
        // #endif
        const hasInTarget = this._in != null
        const rootSelector = hasInTarget ? this._in.selector : '._root'
        const hasId = typeof id === 'string' && id.length > 0
        const selector = uni.createSelectorQuery()
          .in(hasInTarget ? this._in.page : this)
          .select(rootSelector + (hasId ? `${deep}#${id}` : '')).boundingClientRect()
        if (hasInTarget) {
          selector.select(this._in.selector).scrollOffset()
            .select(this._in.selector).boundingClientRect()
        } else {
          // 获取 scroll-view 的位置和滚动距离
          selector.selectViewport().scrollOffset() // 获取窗口的滚动距离
        }
        selector.exec(res => {
          if (res[0] == null) {
            reject(Error('Label not found'))
            return
          }
          const viewportTop = res[2] != null ? res[2].top : 0
          const scrollTop = res[1].scrollTop + res[0].top - viewportTop + offset
          if (hasInTarget) {
            // scroll-view 跳转
            this._in.page[this._in.scrollTop] = scrollTop
          } else {
            // 页面跳转
            uni.pageScrollTo({
              scrollTop,
              duration: 300
            })
          }
          resolve()
        })
        // #endif
      })
    },

    /**
     * @description 获取文本内容
     * @return {String}
     */
    getText(nodes) {
      let text = '';
      (function traversal(nodes) {
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i]
          if (node.type === 'text') {
            text += node.text.replace(/&amp;/g, '&')
          } else if (node.name === 'br') {
            text += '\n'
          } else {
            // 块级标签前后加换行
            const isBlock = node.name === 'p' || node.name === 'div' || node.name === 'tr' || node.name === 'li' || (node.name[0] === 'h' && node.name[1] > '0' && node.name[1] < '7')
            const hasText = text.length > 0
            if (isBlock && hasText && text[text.length - 1] !== '\n') {
              text += '\n'
            }
            // 递归获取子节点的文本
            if (Array.isArray(node.children)) {
              traversal(node.children)
            }
            if (isBlock && text.length > 0 && text[text.length - 1] !== '\n') {
              text += '\n'
            } else if (node.name === 'td' || node.name === 'th') {
              text += '\t'
            }
          }
        }
      })(Array.isArray(nodes) ? nodes : this.nodes)
      return text
    },

    /**
     * @description 获取内容大小和位置
     * @return {Promise}
     */
    getRect() {
      return new Promise((resolve, reject) => {
        uni.createSelectorQuery()
          // #ifndef MP-ALIPAY
          .in(this)
          // #endif
          .select('#_root').boundingClientRect().exec(res => res[0] != null ? resolve(res[0]) : reject(Error('Root label not found')))
      })
    },

    /**
     * @description 暂停播放媒体
     */
    pauseMedia() {
      const videos = Array.isArray(this._videos) ? this._videos : []
      for (let i = videos.length; i--;) {
        videos[i].pause()
      }
    },

    /**
     * @description 设置媒体播放速率
     * @param {Number} rate 播放速率
     */
    setPlaybackRate(rate) {
      this.playbackRate = rate
      const videos = Array.isArray(this._videos) ? this._videos : []
      for (let i = videos.length; i--;) {
        videos[i].playbackRate(rate)
      }
    },

    /**
     * @description 设置内容
     * @param {String} content html 内容
     * @param {Boolean} append 是否在尾部追加
     */
    setContent(content, append) {
      if (!append || this.imgList == null) {
        this.imgList = []
      }
      const nodes = new Parser(this).parse(content)
      const currentNodes = Array.isArray(this.nodes) ? this.nodes : []
      this.$set(this, 'nodes', append ? currentNodes.concat(nodes) : nodes)

      this._videos = []
      this.$nextTick(() => {
        this._hook('onLoad')
        this.$emit('load')
      })

      if (this.isTruthy(this.lazyLoad) || this.imgList._unloadimgs < this.imgList.length / 2) {
        // 设置懒加载，每 350ms 获取高度，不变则认为加载完毕
        let height = 0
        const callback = rect => {
          if (rect == null || rect.height == 0) rect = {}
          // 350ms 总高度无变化就触发 ready 事件
          if (rect.height === height) {
            this.$emit('ready', rect)
          } else {
            height = rect.height
            setTimeout(() => {
              this.getRect().then(callback).catch(callback)
            }, 350)
          }
        }
        this.getRect().then(callback).catch(callback)
      } else {
        // 未设置懒加载，等待所有图片加载完毕
        if (this.imgList._unloadimgs == null) {
          this.getRect().then(rect => {
            this.$emit('ready', rect)
          }).catch(() => {
            this.$emit('ready', {})
          })
        }
      }
    },

    /**
     * @description 调用插件钩子函数
     */
    _hook(name) {
      for (let i = plugins.length; i--;) {
        if (this.plugins[i][name] != null) {
          this.plugins[i][name]()
        }
      }
    },
    isTruthy(value) {
      if (value == null) return false
      if (typeof value === 'boolean') return value
      if (typeof value === 'number') return value !== 0
      if (typeof value === 'string') return value.length > 0
      return true
    },
    isEmptyNodes(value) {
      if (Array.isArray(value) === false) return true
      return value.length === 0
    },

    // NVUE web-view mode removed - not needed in uni-app x
  }
}
</script>

<style>
/* 根节点样式 */
._root {
  padding: 1px 0;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  color: rgb(64, 64, 64);
  white-space: pre-wrap;
}

/* 长按复制 */
._select {
  user-select: text;
}
</style>
