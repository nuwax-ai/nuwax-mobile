<template>
  <view class="demo-container">
    <view class="header">
      <text class="title">FilePreview Component Demo</text>
      <text class="subtitle">Supports DOCX, XLSX, PPTX, PDF, Using Native Preview</text>
    </view>

    <!-- Image Preview - Single -->
    <view class="section">
      <view class="section-header">
        <text class="section-title">Image Preview (Single)</text>
      </view>
      <file-preview 
        src="https://images.unsplash.com/photo-1682687220742-aba13b6e50ba?w=800&h=600&fit=crop" 
        fileType="image"
        fileName="unsplash_image.jpg"
        :showDownload="true"
        height="400rpx"
      />
    </view>

    <!-- Audio Preview -->
    <view class="section">
      <view class="section-header">
        <text class="section-title">Audio Preview</text>
      </view>
      <file-preview 
        src="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" 
        fileName="SoundHelix-Song-1.mp3"
        height="200rpx"
        :showDownload="true"
      />
    </view>

    <!-- Video Preview -->
    <view class="section">
      <view class="section-header">
        <text class="section-title">Video Preview</text>
      </view>
      <file-preview 
        src="https://www.w3schools.com/html/mov_bbb.mp4" 
        fileName="mov_bbb.mp4"
        height="400rpx"
        :showDownload="true"
      />
    </view>

    <!-- Markdown Preview -->
    <view class="section">
      <view class="section-header">
        <text class="section-title">Markdown Preview</text>
      </view>
      <file-preview 
        src="https://raw.githubusercontent.com/facebook/react/main/README.md"
        height="400rpx"
        :showDownload="true"
      />
    </view>

    <!-- JSON/Text Preview -->
    <view class="section">
      <view class="section-header">
        <text class="section-title">JSON/Text Preview</text>
      </view>
      <file-preview 
        src="https://jsonplaceholder.typicode.com/posts/1" 
        fileType="text"
        height="300rpx"
        :showDownload="true"
      />
    </view>

    <view class="divider">Document Previews</view>

    <!-- DOCX Preview -->
    <view class="section">
      <view class="section-header">
        <text class="section-title">DOCX Preview</text>
      </view>
      <!-- #ifdef H5 -->
      <file-preview-h5 
        src="https://501351981.github.io/vue-office/examples/dist/static/test-files/test.docx" 
        fileType="docx"
        height="300rpx"
      />
      <!-- #endif -->
      <!-- #ifndef H5 -->
      <file-preview 
        src="https://501351981.github.io/vue-office/examples/dist/static/test-files/test.docx" 
        fileName="test.docx"
        height="300rpx"
        :showDownload="true"
      />
      <!-- #endif -->
    </view>

    <!-- XLSX Preview -->
    <view class="section">
      <view class="section-header">
        <text class="section-title">XLSX Preview</text>
      </view>
      <!-- #ifdef H5 -->
      <file-preview-h5 
        src="https://501351981.github.io/vue-office/examples/dist/static/test-files/test.xlsx" 
        fileType="xlsx"
        height="300rpx"
      />
      <!-- #endif -->
      <!-- #ifndef H5 -->
      <file-preview 
        src="https://501351981.github.io/vue-office/examples/dist/static/test-files/test.xlsx" 
        fileName="test.xlsx"
        height="300rpx"
        :showDownload="true"
      />
      <!-- #endif -->
    </view>

    <!-- PDF Preview -->
    <view class="section">
      <view class="section-header">
        <text class="section-title">PDF Preview</text>
      </view>
      <!-- #ifdef H5 -->
      <file-preview-h5 
        src="https://501351981.github.io/vue-office/examples/dist/static/test-files/test.pdf" 
        fileType="pdf"
        height="300rpx"
      />
      <!-- #endif -->
      <!-- #ifndef H5 -->
      <file-preview 
        src="https://501351981.github.io/vue-office/examples/dist/static/test-files/test.pdf" 
        fileName="test.pdf"
        height="300rpx"
        :showDownload="true"
      />
      <!-- #endif -->
    </view>

     <!-- PPTX Preview -->
    <view class="section">
      <view class="section-header">
        <text class="section-title">PPTX Preview</text>
      </view>
      <!-- #ifdef H5 -->
      <file-preview-h5 
        src="https://501351981.github.io/vue-office/examples/dist/static/test-files/test.pptx" 
        fileType="pptx"
        height="300rpx"
        :showDownload="true"
      />
      <!-- #endif -->
      <!-- #ifndef H5 -->
      <file-preview 
        src="https://501351981.github.io/vue-office/examples/dist/static/test-files/test.pptx" 
        fileName="test.pptx"
        height="300rpx"
        :showDownload="true"
      />
      <!-- #endif -->
    </view>

    <view class="divider">Iframe 直接使用示例</view>

    <!-- Iframe DOCX Demo -->
    <view class="section">
      <view class="section-header">
        <text class="section-title">Iframe DOCX (直接使用 file-preview.html)</text>
      </view>
      <!-- #ifdef H5 -->
      <iframe 
        :src="getPreviewUrl('https://501351981.github.io/vue-office/examples/dist/static/test-files/test.docx', 'docx')"
        style="width: 100%; height: 300px; border: none;"
      ></iframe>
      <!-- #endif -->
      <!-- #ifndef H5 -->
      <view class="iframe-tip">
        <text>小程序环境请使用 WebView 打开</text>
        <button size="mini" @click="openInWebview('docx')">打开预览</button>
      </view>
      <!-- #endif -->
    </view>

    <!-- Iframe XLSX Demo -->
    <view class="section">
      <view class="section-header">
        <text class="section-title">Iframe XLSX (直接使用 file-preview.html)</text>
      </view>
      <!-- #ifdef H5 -->
      <iframe 
        :src="getPreviewUrl('https://501351981.github.io/vue-office/examples/dist/static/test-files/test.xlsx', 'xlsx')"
        style="width: 100%; height: 300px; border: none;"
      ></iframe>
      <!-- #endif -->
      <!-- #ifndef H5 -->
      <view class="iframe-tip">
        <text>小程序环境请使用 WebView 打开</text>
        <button size="mini" @click="openInWebview('xlsx')">打开预览</button>
      </view>
      <!-- #endif -->
    </view>

    <!-- Iframe PDF Demo -->
    <view class="section">
      <view class="section-header">
        <text class="section-title">Iframe PDF (直接使用 file-preview.html)</text>
      </view>
      <!-- #ifdef H5 -->
      <iframe 
        :src="getPreviewUrl('https://501351981.github.io/vue-office/examples/dist/static/test-files/test.pdf', 'pdf')"
        style="width: 100%; height: 300px; border: none;"
      ></iframe>
      <!-- #endif -->
      <!-- #ifndef H5 -->
      <view class="iframe-tip">
        <text>小程序环境请使用 WebView 打开</text>
        <button size="mini" @click="openInWebview('pdf')">打开预览</button>
      </view>
      <!-- #endif -->
    </view>

    <!-- Iframe PPTX Demo -->
    <view class="section">
      <view class="section-header">
        <text class="section-title">Iframe PPTX (直接使用 file-preview.html)</text>
      </view>
      <!-- #ifdef H5 -->
      <iframe 
        :src="getPreviewUrl('https://501351981.github.io/vue-office/examples/dist/static/test-files/test.pptx', 'pptx')"
        style="width: 100%; height: 300px; border: none;"
      ></iframe>
      <!-- #endif -->
      <!-- #ifndef H5 -->
      <view class="iframe-tip">
        <text>小程序环境请使用 WebView 打开</text>
        <button size="mini" @click="openInWebview('pptx')">打开预览</button>
      </view>
      <!-- #endif -->
    </view>

    <view class="divider">Special States</view>

    <!-- Unsupported File -->
    <view class="section">
      <view class="section-header">
        <text class="section-title">Unsupported File Type</text>
      </view>
      <file-preview 
        src="https://example.com/file.exe" 
        fileName="file.exe"
        height="300rpx"
        :showDownload="true"
      />
    </view>

    <!-- Empty State -->
    <view class="section">
      <view class="section-header">
        <text class="section-title">Empty State</text>
      </view>
      <file-preview height="300rpx" />
    </view>

    <view style="height: 50rpx;"></view>
  </view>
</template>

<script>
import FilePreview from '@/uni_modules/file-preview/components/file-preview/file-preview.vue'

// #ifdef H5
import FilePreviewH5 from '@/subpackages/components/file-preview-h5.vue'
// #endif

export default {
  components: {
    FilePreview,
    // #ifdef H5
    FilePreviewH5
    // #endif
  },
  data() {
    return {
      testFiles: {
        docx: 'https://501351981.github.io/vue-office/examples/dist/static/test-files/test.docx',
        xlsx: 'https://501351981.github.io/vue-office/examples/dist/static/test-files/test.xlsx',
        pdf: 'https://501351981.github.io/vue-office/examples/dist/static/test-files/test.pdf',
        pptx: 'https://501351981.github.io/vue-office/examples/dist/static/test-files/test.pptx'
      }
    }
  },
  methods: {
    // 获取预览页面 URL（用于 H5 iframe）
    getPreviewUrl(fileUrl, fileType) {
      const baseUrl = window?.location?.origin || '';
      const params = new URLSearchParams();
      params.set('fileUrl', fileUrl);
      params.set('fileType', fileType);
      return `${baseUrl}/m/static/file-preview.html?${params.toString()}`;
    },
    
    // 小程序环境通过 WebView 打开
    openInWebview(fileType) {
      const fileUrl = this.testFiles[fileType];
      if (!fileUrl) return;
      
      // 构建预览页面地址
      const previewUrl = `http://localhost:5173/m/static/file-preview.html?fileUrl=${encodeURIComponent(fileUrl)}&fileType=${fileType}`;
      
      uni.navigateTo({
        url: `/subpackages/pages/webview/webview?url=${encodeURIComponent(previewUrl)}`
      });
    }
  }
}
</script>

<style scoped>
.demo-container {
  padding: 30rpx;
  background-color: #f5f5f5;
  min-height: 100vh;
}

.header {
  margin-bottom: 40rpx;
  text-align: center;
}

.title {
  font-size: 36rpx;
  font-weight: bold;
  color: #333;
  display: block;
}

.subtitle {
  font-size: 24rpx;
  color: #999;
  margin-top: 10rpx;
  display: block;
}

.section {
  background: #fff;
  padding: 24rpx;
  border-radius: 12rpx;
  margin-bottom: 30rpx;
  box-shadow: 0 2rpx 8rpx rgba(0,0,0,0.05);
}

.section-header {
  margin-bottom: 20rpx;
  border-left: 6rpx solid #1890ff;
  padding-left: 16rpx;
}

.section-title {
  font-size: 30rpx;
  font-weight: 500;
  color: #333;
}

.divider {
  display: flex;
  align-items: center;
  margin: 40rpx 0;
  color: #999;
  font-size: 28rpx;
  justify-content: center;
}
.divider::before, .divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #e8e8e8;
  margin: 0 20rpx;
}

.iframe-tip {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40rpx;
  background: #f9f9f9;
  border-radius: 8rpx;
  gap: 20rpx;
}

.iframe-tip text {
  color: #666;
  font-size: 28rpx;
}
</style>
