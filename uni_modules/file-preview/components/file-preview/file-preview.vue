<template>
  <view class="file-preview-container">
    <!-- Loading State -->
    <view v-if="status === 'loading'" class="state-overlay loading">
      <view class="loading-icon">
          <!-- TODO: Add proper loading icon/spinner -->
          <text>Loading...</text>
      </view>
    </view>

    <!-- Error State -->
    <view v-else-if="status === 'error'" class="state-overlay error">
      <text class="error-text">{{ errorMessage || '加载失败' }}</text>
      <button class="retry-btn" size="mini" @tap="handleRetry">重试</button>
    </view>

    <!-- Content State (non-Office files) -->
    <view v-else-if="status === 'success' && !isOfficeDoc" class="content-area">
        <view v-if="resolvedType === 'image' || resolvedType === 'audio' || resolvedType === 'video'"
        class="w-full h-full flex items-center content-center"
        >
            <!-- Image -->
            <image 
                v-if="resolvedType === 'image'" 
                class="preview-image" 
                :src="src" 
                mode="widthFix"
                @tap="handleImageClick"
                @error="handleError"
            />

            <!-- Audio -->
            <video 
                v-else-if="resolvedType === 'audio'" 
                class="w-full" 
                :src="src" 
                :controls="true"
            />
            <!-- Note: rendering audio as video tag often works for simple players in uniapp or use audio component -->

            <!-- Video -->
            <video 
                v-else-if="resolvedType === 'video'" 
                class="w-full" 
                :src="src" 
                :controls="true"
            />
        </view>

        <!-- HTML -->
        <template v-else-if="['html'].includes(resolvedType)">
            <!-- #ifdef H5 -->
            <view class="html-preview-container">
                <iframe 
                    :src="src" 
                    class="html-iframe"
                    frameborder="0"
                    allowfullscreen
                ></iframe>
            </view>
            <!-- #endif -->

            <!-- #ifndef H5 -->
            <view class="preview-text">
                <!-- <mp-html :content="textContent" :markdown="resolvedType === 'markdown' || resolvedType === 'text'" /> -->
                <web-view
                    :src="src"
                ></web-view>
            </view>
            <!-- #endif -->
        </template>

        <!-- Markdown / Text -->
        <view v-else-if="['markdown', 'text'].includes(resolvedType)" class="preview-text">
             <mp-html :content="textContent" :markdown="resolvedType === 'markdown' || resolvedType === 'text'" />
        </view>

    </view>

    <!-- Office / PDF Preview -->
    <view v-if="status === 'success' && isOfficeDoc" class="office-preview">
        <!-- #ifdef H5 -->
        <!-- H5: Use inline iframe -->
        <iframe 
            class="office-iframe"
            :src="officeViewerUrl"
            frameborder="0"
            allowfullscreen
        ></iframe>
        <!-- #endif -->
        <!-- #ifdef MP-WEIXIN -->
        <!-- Mini Program: Show file card -->
        <view class="file-card">
            <view class="file-icon">
                <text class="icon-text">{{ getExtension(fileName || src).toUpperCase() }}</text>
            </view>
            <view class="file-info">
                <text class="file-name">{{ fileName || '未命名文件' }}</text>
                <text class="file-tip">点击打开文档</text>
            </view>
            <button size="mini" @tap="handleDocClick" :loading="loadingDoc">打开</button>
        </view>
        <!-- #endif -->
        <!-- #ifdef MP-ALIPAY || MP-BAIDU || MP-TOUTIAO || MP-QQ -->
        <!-- Other Mini Programs -->
        <view class="file-card">
            <view class="file-icon">
                <text class="icon-text">{{ getExtension(fileName || src).toUpperCase() }}</text>
            </view>
            <view class="file-info">
                <text class="file-name">{{ fileName || '未命名文件' }}</text>
                <text class="file-tip">点击打开文档</text>
            </view>
            <button size="mini" @tap="handleDocClick" :loading="loadingDoc">打开</button>
        </view>
        <!-- #endif -->
    </view>

    <!-- Unsupported File (File Card Style) -->
    <view v-if="status === 'unsupported' || (status === 'idle' && resolvedType === 'unsupported')" class="file-card">
        {{ status }}勾搭噶是的 {{ resolvedType }}
        <view class="file-icon">
            <text class="icon-text">{{ getExtension(fileName || src).toUpperCase() }}</text>
        </view>
        <view class="file-info">
            <text class="file-name">{{ fileName || '未命名文件' }}</text>
            <text class="file-tip">暂不支持预览</text>
        </view>
        <button size="mini" @tap="handleDownload" v-if="showDownload">下载</button>
    </view>

  </view>
</template>

<script>
import { getFileTypeFromName, getExtension } from './file-type-utils.js';

export default {
  name: "file-preview",
  props: {
    src: {
      type: String,
      default: ''
    },
    fileName: {
      type: String,
      default: ''
    },
    fileType: {
      type: String,
      default: ''
    },
    showDownload: {
      type: Boolean,
      default: false
    },
    width: {
        type: String,
        default: '100%'
    },
    height: {
        type: String,
        default: 'auto'
    }
  },
  data() {
    return {
      status: 'idle', // PreviewStatus
      errorMessage: '',
      detectedType: '',
      textContent: '',
      loadingDoc: false // Add loading state for open button
    };
  },
  mounted() {
    console.log('[FilePreview] Mounted', { src: this.src, type: this.fileType, resolvedType: this.resolvedType, isDocOrUnsupported: this.isDocOrUnsupported });
    // initPreview is called by watch with immediate:true, no need to call again here
  },
  computed: {
    resolvedType() {
        if (this.fileType) return this.fileType;
        if (this.detectedType) return this.detectedType;
        return getFileTypeFromName(this.src || this.fileName);
    },
    isDocOrUnsupported() {
        const t = this.resolvedType;
        return ['docx', 'xlsx', 'pptx', 'pdf'].includes(t) || t === 'unsupported';
    },
    isOfficeDoc() {
        const t = this.resolvedType;
        return ['docx', 'xlsx', 'pptx', 'pdf'].includes(t);
    },
    officeViewerUrl() {
        if (!this.src || !this.isOfficeDoc) return '';
        // Use Microsoft Office Online Viewer for inline preview
        return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(this.src)}`;
    }
  },
  watch: {
      src: {
          immediate: true,
          handler() {
              this.initPreview();
          }
      }
  },
  methods: {
      getExtension,
      async initPreview() {
          console.log('[FilePreview] initPreview called', { src: this.src, status: this.status });
          if (!this.src) {
              this.status = 'idle';
              console.log('[FilePreview] No src, setting idle');
              return;
          }

          this.status = 'loading';
          this.errorMessage = '';
          
          try {
            const type = this.resolvedType;
            console.log('[FilePreview] Init preview for type:', type, 'isDocOrUnsupported:', this.isDocOrUnsupported);
            
            // Text/MD/HTML: Fetch content
            // if (['html', 'markdown', 'text'].includes(type)) {

            /**
             * HTML 文件在h5中是使用iframe直接渲染的，所以直接设置为成功状态
             * 在小程序中是使用web-view组件渲染的，不需要通过fetchTextContent方法获取内容
             * 因为后端的tickek参数值，只能使用一次，如果先通过ticket获取了内容，再通过web-view组件渲染，会导致ticket参数值失效
             */
            if (['html'].includes(type)) {
                this.status = 'success';
            } else if (['markdown', 'text'].includes(type)) {
                await this.fetchTextContent();
            } 
            // Image/Audio/Video: Ready to render
            else if (['image', 'audio', 'video'].includes(type)) {
                this.status = 'success';
            }
            // Office/PDF: Set success to trigger iframe (H5) or file card (MP)
            else if (['docx', 'xlsx', 'pptx', 'pdf'].includes(type)) {
                this.status = 'success';
                console.log('[FilePreview] Office doc, setting success for preview');
            }
             else {
                this.status = 'unsupported';
            }
            console.log('[FilePreview] After init, status:', this.status);
          } catch (e) {
              console.error('[FilePreview] Init error:', e);
              this.status = 'error';
              this.errorMessage = e.message || '加载失败';
          }
      },
      
      async fetchTextContent() {
          return new Promise((resolve, reject) => {
              uni.request({
                  url: this.src,
                  dataType: 'text', // Prevent auto JSON parsing for text/markdown content
                  success: (res) => {
                      if (res.statusCode === 200) {
                          if (typeof res.data === 'string') {
                              this.textContent = res.data;
                          } else {
                              // If it's markdown/text but returned as arraybuffer or json? 
                              // Try to convert or just stringify
                              this.textContent = JSON.stringify(res.data, null, 2);
                          }
                          this.status = 'success';
                          resolve();
                      } else {
                          reject(new Error('Fetch failed: ' + res.statusCode));
                      }
                  },
                  fail: (err) => {
                      reject(err);
                  }
              });
          });
      },

      handleImageClick() {
          uni.previewImage({
              urls: [this.src]
          });
      },

      handleDocClick() {
          if (this.loadingDoc) return;
          
          // Download and Open
          this.loadingDoc = true;
          uni.showLoading({ title: '打开中...' });
          uni.downloadFile({
              url: this.src,
              success: (res) => {
                  if (res.statusCode === 200) {
                      const filePath = res.tempFilePath;
                      uni.openDocument({
                          filePath: filePath,
                          fileType: this.resolvedType, // docx, xlsx, pptx, pdf
                          showMenu: true,
                          success: () => {
                              console.log('Opened document');
                              uni.hideLoading();
                              this.loadingDoc = false;
                          },
                          fail: (err) => {
                              console.error('Open document failed:', err);
                              uni.hideLoading();
                              uni.showToast({ title: '无法打开文档', icon: 'none' });
                              this.loadingDoc = false;
                          }
                      });
                  } else {
                      uni.hideLoading();
                       uni.showToast({ title: '下载失败', icon: 'none' });
                       this.loadingDoc = false;
                  }
              },
              fail: (err) => {
                   uni.hideLoading();
                   console.error('Download failed:', err);
                   uni.showToast({ title: '下载失败', icon: 'none' });
                   this.loadingDoc = false;
              }
          });
      },
      
      handleDownload() {
          // Just download to local (saveFile) or just show tip
           uni.showLoading({ title: '下载中...' });
           uni.downloadFile({
               url: this.src,
               success: (res) => {
                   if (res.statusCode === 200) {
                       uni.saveFile({
                           tempFilePath: res.tempFilePath,
                           success: (saveRes) => {
                               uni.hideLoading();
                               uni.showToast({ title: '已保存: ' + saveRes.savedFilePath, icon: 'none' });
                           },
                           fail: () => {
                               uni.hideLoading();
                               uni.showToast({ title: '保存失败', icon: 'none' });
                           }
                       });
                   }
               },
               fail: () => {
                   uni.hideLoading();
                   uni.showToast({ title: '下载失败', icon: 'none' });
               }
           });
      },
      
      handleRetry() {
          this.initPreview();
      },
      
      handleError(e) {
          this.status = 'error';
          this.errorMessage = '加载失败';
      }
  }
}
</script>

<style scoped>
.file-preview-container {
    position: relative;
    width: 100%;
    height: 100%;
    background: #f8f8f8;
    border-radius: 8px;
    overflow: hidden;
}

.state-overlay {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100%;
    min-height: 200rpx;
    flex-direction: column;
}

.content-area {
    width: 100%;
    height: 100%;
}

.preview-image {
    width: 100%;
    height: auto;
    display: block;
}

.preview-text {
    padding: 20rpx;
    background: #fff;
    overflow-y: auto;
    height: 100%;
    box-sizing: border-box;
}

.file-card {
    height: 100%;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 20rpx;
    padding: 20rpx;
    background: #fff;
    border: 1px solid #eee;
    border-radius: 8px;
}

.file-icon {
    width: 80rpx;
    height: 80rpx;
    background: #eee;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8rpx;
    font-size: 20rpx;
    color: #666;
    font-weight: bold;
}

.file-info {
    display: flex;
    flex-direction: column;
    gap: 12rpx;
    overflow: hidden;
    text-align: center;
}

.file-name {
    margin-top: 8rpx;
    font-size: 28rpx;
    color: #333;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.file-tip {
    font-size: 24rpx;
    color: #999;
    margin-top: 4rpx;
}

.office-preview {
    width: 100%;
    height: 100%;
    min-height: 200rpx;
    display: flex;
    align-items: center;
    justify-content: center;
}

.office-iframe {
    width: 100%;
    height: 100%;
    min-height: 200rpx;
    border: none;
    background: #fff;
}

.html-preview-container {
    width: 100%;
    height: 100%;
    overflow: auto;
    position: relative;
}

.html-iframe {
    width: 100%;
    height: 100%;
    border: none;
    display: block;
}
</style>
