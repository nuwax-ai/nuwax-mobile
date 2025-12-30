<template>
  <view class="file-preview-h5" :style="containerStyle">
    <!-- Loading Overlay -->
    <view v-show="loading" class="state-overlay">
      <!-- <text>加载中...</text> -->
    </view>
    
    <!-- Error Overlay -->
    <view v-show="error" class="state-overlay error">
      <text class="error-text">{{ error }}</text>
      <button size="mini" @click="reload">重试</button>
    </view>
    
    <!-- Preview iframe -->
    <iframe
      v-if="previewUrl"
      ref="previewIframe"
      :src="previewUrl"
      class="preview-iframe"
      frameborder="0"
      allowfullscreen
      @load="onIframeLoad"
      @error="onIframeError"
    ></iframe>
  </view>
</template>

<script>
import { API_BASE_URL } from '@/constants/config';
export default {
  name: 'FilePreviewH5',
  props: {
    src: {
      type: String,
      required: true
    },
    fileType: {
      type: String,
      default: ''
    },
    height: {
      type: String,
      default: '100%'
    }
  },
  computed: {
    containerStyle() {
      return {
        minHeight: this.height,
        height: this.height
      };
    },
    previewUrl() {
      if (!this.src) return '';
      
      // Get the base URL for the preview page
      // In production, H5 is served under /m/ path
      const baseUrl = this.getPreviewBaseUrl();
      
      // Build query parameters
      const params = new URLSearchParams();
      params.set('fileUrl', this.src);
      
      if (this.fileType) {
        params.set('fileType', this.fileType);
      }
      
      // Use /static/ for H5 deployment
      return `${baseUrl}/static/file-preview.html?${params.toString()}`;
    }
  },
  data() {
    return {
      loading: true,
      error: null
    };
  },
  watch: {
    src: {
      handler(newSrc) {
        if (newSrc) {
          this.loading = true;
          this.error = null;
        }
      },
      immediate: true
    }
  },
  mounted() {
    console.log('[FilePreviewH5] Mounted with iframe mode', { src: this.src, type: this.fileType });
    
    // Listen for messages from iframe
    window.addEventListener('message', this.handleMessage);
  },
  beforeUnmount() {
    window.removeEventListener('message', this.handleMessage);
  },
  methods: {
    getPreviewBaseUrl() {
      // 判断是否为开发环境
      if (process.env.NODE_ENV === 'development') {
        console.log('API_BASE_URL',API_BASE_URL);
        
        return API_BASE_URL;
      }
      // In development, use current origin
      // In production, use the same origin or configured base URL
      if (typeof window !== 'undefined') {
        return window.location.origin;
      }
      return '';
    },
    
    onIframeLoad() {
      console.log('[FilePreviewH5] Iframe loaded');
      // Don't hide loading here - wait for preview_success message
    },
    
    onIframeError(e) {
      console.error('[FilePreviewH5] Iframe error:', e);
      this.loading = false;
      this.error = '预览页面加载失败';
    },
    
    handleMessage(event) {
      // Validate message origin if needed
      const data = event.data;
      
      if (!data || !data.type) return;
      
      console.log('[FilePreviewH5] Received message:', data);
      
      if (data.type === 'preview_success') {
        this.loading = false;
        this.error = null;
        this.$emit('load');
      } else if (data.type === 'preview_error') {
        this.loading = false;
        this.error = data.error || '文档渲染失败';
        this.$emit('error', data.error);
      }
    },
    
    reload() {
      this.loading = true;
      this.error = null;
      
      // Force iframe reload by toggling src
      const iframe = this.$refs.previewIframe;
      if (iframe) {
        const currentSrc = iframe.src;
        iframe.src = '';
        this.$nextTick(() => {
          iframe.src = currentSrc;
        });
      }
    }
  }
};
</script>

<style scoped>
.file-preview-h5 {
  width: 100%;
  height: 100%;
  min-height: 400px;
  background: #fff;
  position: relative;
}

.state-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.9);
  z-index: 10;
  color: #666;
}

.state-overlay.error {
  color: #ff4d4f;
}

.error-text {
  margin-bottom: 16px;
}

.preview-iframe {
  width: 100%;
  height: 100%;
  border: none;
}
</style>
