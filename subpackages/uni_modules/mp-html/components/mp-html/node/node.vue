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
          n.name === 'img' && !n.t && ((opts[1] && !ctrl[i]) || ctrl[i] < 0)
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
        :src="n.attrs.src || (ctrl.load ? n.attrs['data-src'] : '')"
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
        v-if="n.name === 'img' && n.t"
        :style="'display:' + n.t"
        :nodes="[
          {
            attrs: { style: n.attrs.style || '', src: n.attrs.src },
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
        :src="n.attrs.src || (ctrl.load ? n.attrs['data-src'] : '')"
        :mode="!n.h ? 'widthFix' : !n.w ? 'heightFix' : n.m || 'scaleToFill'"
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
          (ctrl[i] || 1) +
          'px;height:1px;' +
          n.attrs.style
        "
        :src="n.attrs.src"
        :mode="!n.h ? 'widthFix' : !n.w ? 'heightFix' : n.m || 'scaleToFill'"
        :lazy-load="opts[0]"
        :webp="n.webp"
        :show-menu-by-longpress="opts[3] && !n.attrs.ignore"
        :image-menu-prevent="!opts[3] || n.attrs.ignore"
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
        :lazy-load="opts[0]"
        :data-i="i"
        @load="imgLoad"
        @error="mediaError"
        @tap.stop="imgTap"
      ></image>
      <!-- #endif -->
      <!-- 文本 -->
      <!-- #ifdef MP-WEIXIN -->
      <text
        v-else-if="n.text"
        :user-select="opts[4] == 'force' && isiOS"
        decode
        >{{ n.text }}</text
      >
      <!-- #endif -->
      <!-- #ifndef MP-WEIXIN || MP-BAIDU || MP-ALIPAY || MP-TOUTIAO -->
      <text v-else-if="n.text" decode>{{ n.text }}</text>
      <!-- #endif -->
      <text v-else-if="n.name === 'br'">{{ "\n" }}</text>
      <!-- 链接 -->
      <view
        v-else-if="n.name === 'a'"
        :id="n.attrs.id"
        :class="(n.attrs.href ? '_a ' : '') + n.attrs.class"
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
        :src="n.src[ctrl[i] || 0]"
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
        :src="n.src[ctrl[i] || 0]"
        :data-i="i"
        @play="play"
        @error="mediaError"
      />
      <!-- #endif -->
      <view
        v-else-if="(n.name === 'table' && n.c) || n.name === 'li'"
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
        v-else-if="!n.c && (n.l || !isInline(n.name, n.attrs.style))"
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
          !n.c && n.attrs && n.attrs.class === 'hl-language' && copyText
        "
        class="hl-language-native"
      >
        <text class="hl-language-name">{{
          (n.children && n.children[0] && n.children[0].text) || ""
        }}</text>
        <view class="hl-copy-btn-native" @tap.stop="doCopyText(copyText)">
          <text class="hl-copy-btn-text">{{
            getI18nText("Mobile.ThirdParty.MpHtml.copyCode")
          }}</text>
        </view>
      </view>
      <rich-text
        v-else-if="!n.c"
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
  import { getProcessingDataByPriority } from '../container/utils'
  import { t } from '@/utils/i18n'
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
      if (this.opts[0]) {
        let i
        for (i = this.childs.length; i--;) {
          if (this.childs[i].name === 'img') break
        }
        if (i !== -1) {
          this.observer = uni.createIntersectionObserver(this).relativeToViewport({
            top: 500,
            bottom: 500
          })
          this.observer.observe('._img', res => {
            if (res.intersectionRatio) {
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
      if (this.observer) {
        this.observer.disconnect()
      }
      // #endif
    },
    methods:{
      /**
       * @description 判断是否为行内标签（替代原 WXS handler 模块，APP 端不支持 WXS）
       */
      isInline (tagName, style) {
        const inlineTags = { abbr: true, b: true, big: true, code: true, del: true, em: true, i: true, ins: true, label: true, q: true, small: true, span: true, strong: true, sub: true, sup: true }
        return inlineTags[tagName] || (style || '').indexOf('display:inline') !== -1
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
        if (this.root && this.root.conversationId) {
          return this.root.conversationId
        }
        // 尝试从mp-html组件获取
        for (let parent = this.$parent; parent; parent = parent.$parent) {
          if (parent.conversationId) {
            return parent.conversationId
          }
        }
        return ''
      },
      getRenderData (data: any) {
        if(!data) {
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
        if (typeof data !== 'object' || data === null) {
          return {}
        }

        const result = {
        ...data,
        ...getProcessingDataByPriority(data.executeId, this.processingList)
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
        const i = e.currentTarget.dataset.i
        const node = this.childs[i]
        this.root.$emit('play', {
          source: node.name,
          attrs: {
            ...node.attrs,
            src: node.src[this.ctrl[i] || 0]
          }
        })
        // #ifndef H5
        if (this.root.pauseVideo) {
          let flag = false
          const id = e.target.id
          for (let i = this.root._videos.length; i--;) {
            if (this.root._videos[i].id === id) {
              flag = true
            } else {
              this.root._videos[i].pause() // 自动暂停其他视频
            }
          }
          // 将自己加入列表
          if (!flag) {
            const ctx = uni.createVideoContext(id
              // #ifndef MP-BAIDU
              , this
              // #endif
            )
            ctx.id = id
            if (this.root.playbackRate) {
              ctx.playbackRate(this.root.playbackRate)
            }
            this.root._videos.push(ctx)
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
        if (node.a) {
          this.linkTap(node.a)
          return
        }
        if (node.attrs.ignore) return
        // #ifdef H5 || APP
        node.attrs.src = node.attrs.src || node.attrs['data-src']
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
        if (this.root.previewImg) {
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
        if (this.opts[3] && !attrs.ignore) {
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
        if (!this.childs[i].w) {
          // 设置原宽度
          this.$set(this.ctrl, i, e.detail.width)
        } else /* #endif */ if ((this.opts[1] && !this.ctrl[i]) || this.ctrl[i] === -1) {
          // 加载完毕，取消加载中占位图
          this.$set(this.ctrl, i, 1)
        }
        this.checkReady()
      },

      /**
       * @description 检查是否所有图片加载完毕
       */
      checkReady () {
        if (this.root && !this.root.lazyLoad) {
          this.root._unloadimgs -= 1
          if (!this.root._unloadimgs) {
            setTimeout(() => {
              this.root.getRect().then(rect => {
                this.root.$emit('ready', rect)
              }).catch(() => {
                this.root.$emit('ready', {})
              })
            }, 350)
          }
        }
      },

      /**
       * @description 链接点击事件
       * @param {Event} e
       */
      linkTap (e) {
        const node = e.currentTarget ? this.childs[e.currentTarget.dataset.i] : {}
        const attrs = node.attrs || e
        const href = attrs.href
        this.root.$emit('linktap', Object.assign({
          innerText: this.root.getText(node.children || []) // 链接内的文本内容
        }, attrs))
        if (href) {
          if (href[0] === '#') {
            // 跳转锚点
            this.root.navigateTo(href.substring(1)).catch(() => { })
          } else if (href.split('?')[0].includes('://')) {
            // 复制外部链接
            if (this.root.copyLink) {
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
        const data = (e.srcElement && e.srcElement.dataset) || (e.currentTarget && e.currentTarget.dataset)
        if(!data || data.action !== 'copy') {
          return
        }
        const content = data.content

        if (content) {
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
        if (e.name==='div' && e.attrs?.class==='event') {
          uni.$emit('message-event-delegate', e)
          return
        }
        // #endif

        // Handle copy code button in highlight blocks
        if (e.attrs?.['data-action'] === 'copy' && e.attrs?.['data-content']) {
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
      },

      /**
       * @description 复制代码文本（非 H5 平台使用）
       * @param {String} text
       */
      doCopyText (text) {
        if (!text) return
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
        if (node.name === 'video' || node.name === 'audio') {
          let index = (this.ctrl[i] || 0) + 1
          if (index > node.src.length) {
            index = 0
          }
          if (index < node.src.length) {
            this.$set(this.ctrl, i, index)
            return
          }
        } else if (node.name === 'img') {
          // #ifdef H5
          if (this.opts[0] && !this.ctrl.load) return
          // #endif
          // 显示错误占位图
          if (this.opts[2]) {
            this.$set(this.ctrl, i, -1)
          }
          this.checkReady()
        }
        if (this.root) {
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
