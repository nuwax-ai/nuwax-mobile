<template>
  <view
    :id="attrs.id"
    :class="'_block _' + name + ' ' + attrs.class"
    :style="attrs.style"
  >
    <block v-for="(n, i) in childs" v-bind:key="i">
      <!-- 图片 -->
      <!-- 占位图 -->
      <image
        v-if="
          n.name === 'img' &&
          isTruthy(n.t) === false &&
          ((isTruthy(opts[1]) && isTruthy(ctrl[i]) === false) || ctrl[i] < 0)
        "
        class="_img"
        :style="n.attrs.style"
        :src="ctrl[i] < 0 ? opts[2] : opts[1]"
        mode="widthFix"
      />
      <!-- 显示图片 -->
      <!-- #ifdef H5 -->
      <img
        v-if="n.name === 'img'"
        :id="n.attrs.id"
        :class="'_img ' + n.attrs.class"
        :style="(ctrl[i] === -1 ? 'display:none;' : '') + n.attrs.style"
        :src="
          isTruthy(n.attrs.src)
            ? n.attrs.src
            : isTruthy(ctrl.load)
              ? n.attrs['data-src']
              : ''
        "
        :data-i="i"
        @load="imgLoad"
        @error="mediaError"
        @tap.stop="imgTap"
        @longpress="imgLongTap"
      />
      <!-- #endif -->
      <!-- #ifndef H5 -->
      <!-- 表格中的图片，使用 rich-text 防止大小不正确 -->
      <rich-text
        v-if="n.name === 'img' && isTruthy(n.t)"
        :style="'display:' + n.t"
        :nodes="[
          {
            attrs: { style: valOr(n.attrs.style, ''), src: n.attrs.src },
            name: 'img',
          },
        ]"
        :data-i="i"
        @tap.stop="imgTap"
      />
      <!-- #endif -->
      <!-- #ifdef APP-HARMONY -->
      <image
        v-else-if="n.name === 'img'"
        :id="n.attrs.id"
        :class="'_img ' + n.attrs.class"
        :style="
          (ctrl[i] === -1 ? 'display:none;' : '') +
          'width:' +
          ctrl[i] +
          'px;' +
          n.attrs.style
        "
        :src="
          isTruthy(n.attrs.src)
            ? n.attrs.src
            : isTruthy(ctrl.load)
              ? n.attrs['data-src']
              : ''
        "
        :mode="
          isTruthy(n.h) === false
            ? 'widthFix'
            : isTruthy(n.w) === false
              ? 'heightFix'
              : valOr(n.m, 'scaleToFill')
        "
        :data-i="i"
        @load="imgLoad"
        @error="mediaError"
        @tap.stop="imgTap"
        @longpress="imgLongTap"
      />
      <!-- #endif -->
      <!-- #ifndef H5 || MP-KUAISHOU -->
      <image
        v-else-if="n.name === 'img'"
        :id="n.attrs.id"
        :class="'_img ' + n.attrs.class"
        :style="
          (ctrl[i] === -1 ? 'display:none;' : '') +
          'width:' +
          toNumberOr(ctrl[i], 1) +
          'px;height:1px;' +
          n.attrs.style
        "
        :src="n.attrs.src"
        :mode="
          isTruthy(n.h) === false
            ? 'widthFix'
            : isTruthy(n.w) === false
              ? 'heightFix'
              : valOr(n.m, 'scaleToFill')
        "
        :lazy-load="isTruthy(opts[0])"
        :webp="n.webp"
        :show-menu-by-longpress="
          isTruthy(opts[3]) && isTruthy(n.attrs.ignore) === false
        "
        :image-menu-prevent="
          isTruthy(opts[3]) === false || isTruthy(n.attrs.ignore)
        "
        :data-i="i"
        @load="imgLoad"
        @error="mediaError"
        @tap.stop="imgTap"
        @longpress="imgLongTap"
      />
      <!-- #endif -->
      <!-- #ifdef MP-KUAISHOU -->
      <image
        v-else-if="n.name === 'img'"
        :id="n.attrs.id"
        :class="'_img ' + n.attrs.class"
        :style="(ctrl[i] === -1 ? 'display:none;' : '') + n.attrs.style"
        :src="n.attrs.src"
        :lazy-load="isTruthy(opts[0])"
        :data-i="i"
        @load="imgLoad"
        @error="mediaError"
        @tap.stop="imgTap"
      ></image>
      <!-- #endif -->
      <!-- 文本 -->
      <!-- #ifdef MP-WEIXIN -->
      <text
        v-else-if="isTruthy(n.text)"
        :user-select="opts[4] == 'force' && isiOS"
        decode
        >{{ n.text }}</text
      >
      <!-- #endif -->
      <!-- #ifndef MP-WEIXIN || MP-BAIDU || MP-ALIPAY || MP-TOUTIAO -->
      <text v-else-if="isTruthy(n.text)" decode>{{ n.text }}</text>
      <!-- #endif -->
      <text v-else-if="n.name === 'br'">{{ "\n" }}</text>
      <!-- 链接 -->
      <view
        v-else-if="n.name === 'a'"
        :id="n.attrs.id"
        :class="(isTruthy(n.attrs.href) ? '_a ' : '') + n.attrs.class"
        hover-class="_hover"
        :style="'display:inline;' + n.attrs.style"
        :data-i="i"
        @tap.stop="linkTap"
      >
        <node
          name="span"
          :childs="n.children"
          :opts="opts"
          style="display: inherit"
        />
      </view>
      <!-- 视频 -->
      <video
        v-else-if="n.name === 'video'"
        :id="n.attrs.id"
        :class="n.attrs.class"
        :style="n.attrs.style"
        :autoplay="n.attrs.autoplay"
        :controls="n.attrs.controls"
        :loop="n.attrs.loop"
        :muted="n.attrs.muted"
        :object-fit="n.attrs['object-fit']"
        :poster="n.attrs.poster"
        :src="n.src[toNumberOr(ctrl[i], 0)]"
        :data-i="i"
        @play="play"
        @error="mediaError"
      />
      <!-- #ifdef H5 || APP -->
      <iframe
        v-else-if="n.name === 'iframe'"
        :style="n.attrs.style"
        :allowfullscreen="n.attrs.allowfullscreen"
        :frameborder="n.attrs.frameborder"
        :src="n.attrs.src"
      />
      <embed
        v-else-if="n.name === 'embed'"
        :style="n.attrs.style"
        :src="n.attrs.src"
      />
      <!-- #endif -->
      <!-- #ifndef MP-TOUTIAO || H5 -->
      <!-- 音频 -->
      <audio
        v-else-if="n.name === 'audio'"
        :id="n.attrs.id"
        :class="n.attrs.class"
        :style="n.attrs.style"
        :author="n.attrs.author"
        :controls="n.attrs.controls"
        :loop="n.attrs.loop"
        :name="n.attrs.name"
        :poster="n.attrs.poster"
        :src="n.src[toNumberOr(ctrl[i], 0)]"
        :data-i="i"
        @play="play"
        @error="mediaError"
      />
      <!-- #endif -->
      <view
        v-else-if="(n.name === 'table' && isTruthy(n.c)) || n.name === 'li'"
        :id="n.attrs.id"
        :class="'_' + n.name + ' ' + n.attrs.class"
        :style="n.attrs.style"
      >
        <node v-if="n.name === 'li'" :childs="n.children" :opts="opts" />
        <view
          v-else
          v-for="(tbody, x) in n.children"
          v-bind:key="x"
          :class="'_' + tbody.name + ' ' + tbody.attrs.class"
          :style="tbody.attrs.style"
        >
          <node
            v-if="tbody.name === 'td' || tbody.name === 'th'"
            :childs="tbody.children"
            :opts="opts"
          />
          <block v-else v-for="(tr, y) in tbody.children" v-bind:key="y">
            <view
              v-if="tr.name === 'td' || tr.name === 'th'"
              :class="'_' + tr.name + ' ' + tr.attrs.class"
              :style="tr.attrs.style"
            >
              <node :childs="tr.children" :opts="opts" />
            </view>
            <view
              v-else
              :class="'_' + tr.name + ' ' + tr.attrs.class"
              :style="tr.attrs.style"
            >
              <view
                v-for="(td, z) in tr.children"
                v-bind:key="z"
                :class="'_' + td.name + ' ' + td.attrs.class"
                :style="td.attrs.style"
              >
                <node :childs="td.children" :opts="opts" />
              </view>
            </view>
          </block>
        </view>
      </view>
      <markdown-container
        v-else-if="n.name == 'container'"
        :data="getRenderData(n.attrs.data)"
        data-source="markdown-container"
      />
      <!-- task-result 任务结果组件 -->
      <task-result
        v-else-if="n.name === 'task-result'"
        :data="n"
        :conversation-id="getConversationId()"
      />
      <!-- 富文本 -->
      <!-- #ifdef H5 -->
      <rich-text
        v-else-if="
          n.c !== true &&
          (isTruthy(n.l) || !isInline(n.name, n.attrs.style))
        "
        :id="n.attrs.id"
        :style="n.f"
        :user-select="opts[4]"
        :nodes="[n]"
        @tap="copyCode"
      />
      <!-- #endif -->
      <!-- #ifndef H5 -->
      <!-- hl-language 头部节点：将 rich-text 和原生复制按钮并排在同一行，避免给对布局的依赖 -->
      <view
        v-else-if="
          isTruthy(n.c) === false &&
          n.attrs != null &&
          n.attrs.class === 'hl-language' &&
          isTruthy(copyText)
        "
        class="hl-language-native"
      >
        <text class="hl-language-name">{{ getFirstChildText(n.children) }}</text>
        <view class="hl-copy-btn-native" @tap.stop="doCopyText(copyText)">
          <text class="hl-copy-btn-text">{{
            getI18nText("Mobile.ThirdParty.MpHtml.copyCode")
          }}</text>
        </view>
      </view>
      <rich-text
        v-else-if="isTruthy(n.c) === false"
        :id="n.attrs.id"
        :style="'display:inline;' + n.f"
        :class="
          n.name === 'div' && n.attrs?.class === 'event'
            ? 'div-event-style'
            : ''
        "
        :preview="false"
        :selectable="opts[4]"
        :user-select="opts[4]"
        :nodes="[n]"
        @tap="handleCurrentTap(n)"
      />
      <!-- #endif -->
      <!-- 继续递归 -->
      <view
        v-else-if="n.c === 2"
        :id="n.attrs.id"
        :class="'_block _' + n.name + ' ' + n.attrs.class"
        :style="n.f + ';' + n.attrs.style"
      >
        <node
          v-for="(n2, j) in n.children"
          v-bind:key="j"
          :style="n2.f"
          :name="n2.name"
          :attrs="n2.attrs"
          :childs="n2.children"
          :opts="opts"
          :copy-text="n2._copyText"
        />
      </view>
      <node
        v-else
        :style="n.f"
        :name="n.name"
        :attrs="n.attrs"
        :childs="n.children"
        :opts="opts"
        :copy-text="n._copyText"
      />
    </block>
  </view>
</template>
<script>
  import markdownContainer from '../container/container.vue'
  import taskResult from '../task-result/task-result.vue'
  import { t } from '@/utils/i18n'
  import { valOr } from '@/utils/common'
  export default {
    name: 'node',
    options: {
      // #ifdef MP-WEIXIN
      virtualHost: true,
      // #endif
      // #ifdef MP-TOUTIAO
      addGlobalClass: false
      // #endif
    },
    data () {
      return {
        ctrl: {},
        root: null, // Initialize root to prevent "not defined" warning during render
        // #ifdef MP-WEIXIN
        isiOS: uni.getDeviceInfo().system.includes('iOS')
        // #endif
      }
    },
    props: {
      name: String,
      processingList: Array,
      attrs: {
        type: Object,
        default () {
          return {}
        }
      },
      childs: Array,
      opts: Array,
      copyText: String
    },
    components: {
      markdownContainer,
      taskResult,
    },
    mounted () {
      this.$nextTick(() => {
        for (this.root = this.$parent; this.root.$options.name !== 'mp-html'; this.root = this.root.$parent);
      })
      // #ifdef H5 || APP
      if (this.isTruthy(this.opts[0])) {
        let i
        for (i = this.childs.length - 1; i >= 0; i--) {
          if (this.childs[i].name === 'img') break
        }
        if (i !== -1) {
          this.observer = uni.createIntersectionObserver(this).relativeToViewport({
            top: 500,
            bottom: 500
          })
          this.observer.observe('._img', res => {
            if (res.intersectionRatio > 0) {
              this.$set(this.ctrl, 'load', 1)
              this.observer.disconnect()
            }
          })
        }
      }
      // #endif
    },
    beforeDestroy () {
      // #ifdef H5 || APP
      if (this.observer != null) {
        this.observer.disconnect()
      }
      // #endif
    },
    methods:{
      isTruthy (value: any): boolean {
        if (value == null) {
          return false
        }
        if (typeof value === 'boolean') {
          return value
        }
        if (typeof value === 'number') {
          return value !== 0
        }
        if (typeof value === 'string') {
          return value.length > 0
        }
        return true
      },
      getFirstChildText (children: any): string {
        if (Array.isArray(children) === false) {
          return ''
        }
        if (children.length === 0) {
          return ''
        }
        const first = children[0]
        if (first == null) {
          return ''
        }
        return typeof first.text === 'string' ? first.text : ''
      },
      toNumberOr (value: any, fallback: number): number {
        if (typeof value === 'number') {
          return value
        }
        return fallback
      },
      getProcessingDataByPriority (executeId: any, processingList: any): any {
        if (Array.isArray(processingList) === false) {
          return {}
        }
        if (processingList.length === 0) {
          return {}
        }

        let bestItem: any = null
        let bestPriority = 999
        for (let i = 0; i < processingList.length; i++) {
          const item = processingList[i]
          if (item == null || item.executeId !== executeId) {
            continue
          }
          let priority = 999
          if (item.status === 'FINISHED') {
            priority = 1
          } else if (item.status === 'FAILED') {
            priority = 2
          } else if (item.status === 'EXECUTING') {
            priority = 3
          }
          if (priority < bestPriority) {
            bestPriority = priority
            bestItem = item
          }
        }

        if (bestItem == null) {
          return {}
        }
        return bestItem
      },
      /**
       * @description 判断是否为行内标签（替代原 WXS handler 模块，APP 端不支持 WXS）
       */
      isInline (tagName, style) {
        const inlineTags = { abbr: true, b: true, big: true, code: true, del: true, em: true, i: true, ins: true, label: true, q: true, small: true, span: true, strong: true, sub: true, sup: true }
        if (inlineTags[tagName] === true) {
          return true;
        }
        const tempStyle = valOr(style, '');
        return tempStyle.indexOf('display:inline') !== -1;
      },
      getI18nText (key) {
        return t(key)
      },
      showTextToast (title) {
        uni.showToast({
          title,
          icon: 'none'
        })
      },
      /**
       * 获取会话ID（用于task-result等组件）
       */
      getConversationId() {
        // 尝试从根组件获取会话ID
        if (this.root != null) {
          if (this.isTruthy(this.root.conversationId)) {
            return this.root.conversationId
          }
        }
        // 尝试从mp-html组件获取
        for (let parent = this.$parent; parent != null; parent = parent.$parent) {
          if (parent.conversationId != null) {
            if (parent.conversationId.length > 0) {
              return parent.conversationId
            }
          }
        }
        return ''
      },
      getRenderData (data: any) {
        if (this.isTruthy(data) === false) {
          return {}
        }

        if(typeof data === 'string') {
          try {
            data = JSON.parse(data)
          } catch (e) {
            console.warn('[mp-html/node] getRenderData JSON.parse error:', e, 'data:', data)
            return {} // Return empty object on parse failure
          }
        }

        // Ensure data is an object before spreading
        const dataType = typeof data
        const isObjectType = dataType === 'object'
        if (isObjectType === false) {
          return {}
        }
        if (data === null) {
          return {}
        }

        const result = {
        ...data,
        ...this.getProcessingDataByPriority(data.executeId, this.processingList)
        }

        return result
      },
      // #ifdef MP-WEIXIN
      toJSON () { return this },
      // #endif
      /**
       * @description 播放视频事件
       * @param {Event} e
       */
      play (e) {
        const dataIndex = e.currentTarget.dataset.i
        const node = this.childs[dataIndex]
        let currentSrc = null
        if (this.ctrl[dataIndex] != null) {
          if (node.src != null) {
            if (node.src[this.ctrl[dataIndex]] != null) {
              currentSrc = node.src[this.ctrl[dataIndex]]
            }
          }
        }
        this.root.$emit('play', {
          source: node.name,
          attrs: {
            ...node.attrs,
            src: currentSrc
          }
        })
        // #ifndef H5
        const shouldPause = this.isTruthy(this.root.pauseVideo)
        if (shouldPause === true) {
          const targetId = e.target.id
          const originVideos = this.root._videos
          const videos = Array.isArray(originVideos) ? originVideos : []
          let found = false
          for (let idx = 0; idx < videos.length; idx += 1) {
            const video: any = videos[idx]
            let isCurrent = false
            if (video != null) {
              if (video.id === targetId) {
                isCurrent = true
              }
            }
            if (isCurrent === true) {
              found = true
            } else if (video != null) {
              video.pause()
            }
          }
          if (found === false) {
            const ctx = uni.createVideoContext(targetId)
            ctx.id = targetId
            const hasRate = this.root.playbackRate != null
            if (hasRate === true) {
              ctx.playbackRate(this.root.playbackRate)
            }
            videos.push(ctx)
            if (Array.isArray(originVideos) === false) {
              this.root._videos = videos
            }
          }
        }
        // #endif
      },

      /**
       * @description 图片点击事件
       * @param {Event} e
       */
      imgTap (e) {
        const node = this.childs[e.currentTarget.dataset.i]
        if (this.isTruthy(node.a)) {
          this.linkTap(node.a)
          return
        }
        if (this.isTruthy(node.attrs.ignore)) return
        // #ifdef H5 || APP
        if (this.isTruthy(node.attrs.src) === false) {
          node.attrs.src = node.attrs['data-src']
        }
        // #endif
        // #ifndef APP-HARMONY
        this.root.$emit('imgtap', node.attrs)
        // #endif
        // #ifdef APP-HARMONY
        this.root.$emit('imgtap', {
          ...node.attrs
        })
        // #endif
        // 自动预览图片
        if (this.isTruthy(this.root.previewImg)) {
          uni.previewImage({
            // #ifdef MP-WEIXIN
            showmenu: this.root.showImgMenu,
            // #endif
            // #ifdef MP-ALIPAY
            enablesavephoto: this.root.showImgMenu,
            enableShowPhotoDownload: this.root.showImgMenu,
            // #endif
            current: parseInt(node.attrs.i),
            urls: this.root.imgList
          })
        }
      },

      /**
       * @description 图片长按
       */
      imgLongTap (e) {
        // #ifdef APP
        const attrs = this.childs[e.currentTarget.dataset.i].attrs
        let allowShowMenu = false
        if (this.isTruthy(this.opts[3])) {
          allowShowMenu = this.isTruthy(attrs.ignore) === false
        }
        if (allowShowMenu === true) {
          uni.showActionSheet({
            itemList: ['保存图片'],
            success: () => {
              const save = path => {
                uni.saveImageToPhotosAlbum({
                  filePath: path,
                  success: () => {
                    this.showTextToast(t('Mobile.ThirdParty.MpHtml.saveSuccess'))
                  }
                })
              }
              if (this.root.imgList[attrs.i].startsWith('http')) {
                uni.downloadFile({
                  url: this.root.imgList[attrs.i],
                  success: res => save(res.tempFilePath)
                })
              } else {
                save(this.root.imgList[attrs.i])
              }
            }
          })
        }
        // #endif
      },

      /**
       * @description 图片加载完成事件
       * @param {Event} e
       */
      imgLoad (e) {
        const i = e.currentTarget.dataset.i
        /* #ifndef H5 */
        let hasWidth = true
        if (this.childs[i].w == null) {
          hasWidth = false
        } else if (this.childs[i].w == 0) {
          hasWidth = false
        }
        if (hasWidth === false) {
          // 设置原宽度
          this.$set(this.ctrl, i, e.detail.width)
        } else /* #endif */ {
          let needPlaceholder = false
          if (this.ctrl[i] == null) {
            needPlaceholder = true
          } else if (this.ctrl[i] == 0) {
            needPlaceholder = true
          }
          let shouldSetReady = false
          if (this.ctrl[i] === -1) {
            shouldSetReady = true
          } else if (this.isTruthy(this.opts[1])) {
            shouldSetReady = needPlaceholder
          }
          if (shouldSetReady === true) {
            // 加载完毕，取消加载中占位图
            this.$set(this.ctrl, i, 1)
          }
        }
        this.checkReady()
      },

      /**
       * @description 检查是否所有图片加载完毕
       */
      checkReady () {
        if (this.root == null) {
          return
        }
        if (this.isTruthy(this.root.lazyLoad)) {
          return
        }
        this.root._unloadimgs -= 1
        if (this.root._unloadimgs <= 0) {
          setTimeout(() => {
            this.root.getRect().then(rect => {
              this.root.$emit('ready', rect)
            }).catch(() => {
              this.root.$emit('ready', {})
            })
          }, 350)
        }
      },

      /**
       * @description 链接点击事件
       * @param {Event} e
       */
      linkTap (e) {
        const node = e.currentTarget != null ? this.childs[e.currentTarget.dataset.i] : {}
        const attrs = node.attrs != null ? node.attrs : e
        const href = attrs.href
        this.root.$emit('linktap', Object.assign({
          innerText: this.root.getText(node.children != null ? node.children : []) // 链接内的文本内容
        }, attrs))
        if (this.isTruthy(href)) {
          if (href[0] === '#') {
            // 跳转锚点
            this.root.navigateTo(href.substring(1)).catch(() => { })
          } else if (href.split('?')[0].includes('://')) {
            // 复制外部链接
            if (this.isTruthy(this.root.copyLink)) {
              // #ifdef H5
              window.open(href)
              // #endif
              // #ifdef MP
              uni.setClipboardData({
                data: href,
                success: () => this.showTextToast(t('Mobile.Link.copied'))
              })
              // #endif
              // #ifdef APP
              uni.setClipboardData({
                data: href,
                success: () => this.showTextToast(t('Mobile.Link.copied'))
              })
              // #endif
            }
          } else {
            // 跳转页面
            uni.navigateTo({
              url: href,
              fail () {
                uni.switchTab({
                  url: href,
                  fail () { }
                })
              }
            })
          }
        }
      },

      /**
       * @description 复制代码事件
       * @param {Event} e
       */
      copyCode (e) {
        // srcElement \u5728\u5fae\u4fe1\u5c0f\u7a0b\u5e8f\u4e2d\u4e0d\u5b58\u5728\uff0c\u52a0\u5b89\u5168\u8bbf\u95ee
        let data = null
        if (e.srcElement != null) {
          data = e.srcElement.dataset
        }
        if (data == null) {
          if (e.currentTarget != null) {
            data = e.currentTarget.dataset
          }
        }
        if (data == null) {
          return
        }
        if (data.action !== 'copy') {
          return
        }
        const content = data.content

        if (this.isTruthy(content)) {
          // 实现复制到剪贴板功能
          uni.setClipboardData({
            data: content,
            success: () => {
              this.showTextToast(t('Mobile.Common.copySuccess'))
            },
            fail: () => {
              this.showTextToast(t('Mobile.Common.copyFailed'))
            }
          })
        }
      },
      /**
       * @description 当前节点点击事件
       * @param {Event} e
       */
      handleCurrentTap(e){
        // #ifdef MP-WEIXIN
        if (e.name === 'div') {
          if (e.attrs?.class === 'event') {
            uni.$emit('message-event-delegate', e)
            return
          }
        }
        // #endif

        // Handle copy code button in highlight blocks
        const hasCopyContent = this.isTruthy(e.attrs?.['data-content'])
        if (e.attrs?.['data-action'] === 'copy') {
          if (hasCopyContent === true) {
          uni.setClipboardData({
            data: e.attrs['data-content'],
            success: () => {
              this.showTextToast(t('Mobile.Common.copySuccess'))
            },
            fail: () => {
              this.showTextToast(t('Mobile.Common.copyFailed'))
            }
          })
          }
        }
      },

      /**
       * @description 复制代码文本（非 H5 平台使用）
       * @param {String} text
       */
      doCopyText (text) {
        if (this.isTruthy(text) === false) return
        uni.setClipboardData({
          data: text,
          success: () => {
            this.showTextToast(t('Mobile.Common.copySuccess'))
          },
          fail: () => {
            this.showTextToast(t('Mobile.Common.copyFailed'))
          }
        })
      },

      /**
       * @description 错误事件
       * @param {Event} e
       */
      mediaError (e) {
        const i = e.currentTarget.dataset.i
        const node = this.childs[i]
        // 加载其他源
        const isVideo = node.name === 'video'
        const isAudio = node.name === 'audio'
        if (isVideo === true || isAudio === true) {
          let index = this.toNumberOr(this.ctrl[i], 0) + 1
          if (index > node.src.length) {
            index = 0
          }
          if (index < node.src.length) {
            this.$set(this.ctrl, i, index)
            return
          }
        } else if (node.name === 'img') {
          // #ifdef H5
          if (this.isTruthy(this.opts[0])) {
            if (this.isTruthy(this.ctrl.load) === false) return
          }
          // #endif
          // 显示错误占位图
          if (this.isTruthy(this.opts[2])) {
            this.$set(this.ctrl, i, -1)
          }
          this.checkReady()
        }
        if (this.root != null) {
          this.root.$emit('error', {
            source: node.name,
            attrs: node.attrs,
            // #ifndef H5
            errMsg: e.detail.errMsg
            // #endif
          })
        }
      }
    }
  }
</script>

<style lang="scss">
  /* #ifdef APP-UVUE */
  @import "../styles/index-app.scss";
  /* #endif */
  /* #ifndef APP-UVUE */
  @import "../styles/index.scss";
  /* #endif */

  // 会话输出内容点击事件
  // 事件绑定配置样式
  .div-event-style {
    display: flex !important;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    margin: 0 4px;
    padding: 4px 8px;
    max-width: 100px;
    min-width: 18px;
    border-radius: 24px;
    color: rgba(0, 0, 0, 60%) !important;
    background-color: rgba(0, 0, 0, 5%);
    line-height: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* 非 H5 平台：hl-language 头部行的原生包裹层，匹配 .hl-language 的布局 */
  .hl-language-native {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    padding: 2px 10px;
    background-color: #252526;
    border-radius: 6px 6px 0 0;
    font-size: 12px;
    width: 100%;
    box-sizing: border-box;
    flex-shrink: 0;
  }

  /* 非 H5 平台的原生可交互复制按钮 */
  .hl-copy-btn-native {
    display: flex;
    align-items: center;
    padding: 2px 4px;
    border-radius: 4px;
    cursor: pointer;

    .hl-copy-btn-text {
      font-size: 10px;
      color: #999;
      line-height: normal;
      white-space: normal;
    }
  }

  /* 语言名称文本 */
  .hl-language-name {
    font-size: 12px;
    color: #999;
    flex: 1;
  }
</style>
