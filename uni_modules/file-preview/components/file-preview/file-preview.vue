<template>
  <view class="file-preview-container" :style="{ width: width, height: height }">
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

    <!-- Content State -->
    <view v-else-if="status === 'success'" class="content-area">
        
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
            class="preview-audio" 
            :src="src" 
            :controls="true"
        />
        <!-- Note: rendering audio as video tag often works for simple players in uniapp or use audio component -->

        <!-- Video -->
        <video 
            v-else-if="resolvedType === 'video'" 
            class="preview-video" 
            :src="src" 
            :controls="true"
        />

        <!-- HTML / Markdown / Text -->
        <view v-else-if="['html', 'markdown', 'text'].includes(resolvedType)" class="preview-text">
             <mp-html :content="textContent" :markdown="resolvedType === 'markdown' || resolvedType === 'text'" />
        </view>

    </view>

    <!-- Office / PDF / Unsupported (File Card Style) -->
    <!-- Display if: 
         1. Status is 'idle' (default for docs waiting for click) AND it is a doc or unsupported
         2. OR Status is 'unsupported'
    -->
    <view v-if="(status === 'idle' || status === 'unsupported') && isDocOrUnsupported" class="file-card">
        <view class="file-icon">
            <!-- Placeholder for icon -->
            <text class="icon-text">{{ getExtension(fileName || src).toUpperCase() }}</text>
        </view>
        <view class="file-info">
            <text class="file-name">{{ fileName }}</text>
            <text class="file-tip" v-if="resolvedType !== 'unsupported'">点击预览</text>
            <text class="file-tip" v-else>暂不支持预览</text>
        </view>
        <button class="action-btn" size="mini" @tap="handleDocClick" v-if="resolvedType !== 'unsupported'" :loading="loadingDoc">打开</button>
        <button class="action-btn" size="mini" @tap="handleDownload" v-else-if="showDownload">下载</button>
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
    console.log('[FilePreview] Mounted', { src: this.src, type: this.fileType });
    this.initPreview();
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
          if (!this.src) {
              this.status = 'idle';
              return;
          }

          this.status = 'loading';
          this.errorMessage = '';
          
          try {
            const type = this.resolvedType;
            console.log('[FilePreview] Init preview for type:', type);
            
            // Text/MD/HTML: Fetch content
            if (['html', 'markdown', 'text'].includes(type)) {
                await this.fetchTextContent();
            } 
            // Image/Audio/Video: Ready to render
            else if (['image', 'audio', 'video'].includes(type)) {
                this.status = 'success';
            }
            // Office/PDF: Ready to show card
            else if (['docx', 'xlsx', 'pptx', 'pdf'].includes(type)) {
                this.status = 'idle'; // Let user click to open
            }
             else {
                this.status = 'unsupported';
            }
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
                  success: (res) => {
                      if (res.statusCode === 200) {
                          if (typeof res.data === 'string') {
                              this.textContent = res.data;
                          } else {
                              // If it's markdown/text but returned as arraybuffer or json? 
                              // Try to convert or just stringify
                              this.textContent = String(res.data);
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
    height: 100%;
    display: block;
}

.preview-video {
    width: 100%;
    height: 100%; 
}

.preview-text {
    padding: 20rpx;
    background: #fff;
    overflow-y: auto;
    height: 100%;
    box-sizing: border-box;
}

.file-card {
    display: flex;
    align-items: center;
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
    margin-right: 20rpx;
    font-size: 20rpx;
    color: #666;
    font-weight: bold;
}

.file-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.file-name {
    font-size: 28rpx;
    color: #333;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.file-tip {
    font-size: 24rpx;
    color: #999;
    margin-top: 4rpx;
}

.action-btn {
    margin-left: 20rpx;
}
</style>
