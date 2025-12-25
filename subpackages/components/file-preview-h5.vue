<template>
  <view class="file-preview-h5" :style="containerStyle">
    <!-- Loading Overlay -->
    <view v-show="loading" class="state-overlay">
      <text>加载中...</text>
    </view>
    
    <!-- Error Overlay -->
    <view v-show="error" class="state-overlay error">
      <text class="error-text">{{ error }}</text>
      <button size="mini" @click="renderPreview">重试</button>
    </view>
    
    <!-- Preview Container - Always mounted -->
    <view ref="previewContainer" class="preview-container" :style="containerStyle"></view>
  </view>
</template>

<script>
// 静态导入 CSS，确保生产构建时被正确打包
import '@js-preview/docx/lib/index.css';
import '@js-preview/excel/lib/index.css';

export default {
  name: 'FilePreviewH5',
  props: {
    src: {
      type: String,
      required: true
    },
    fileType: {
      type: String,
      required: true
    },
    height: {
      type: String,
      default: '400px'
    }
  },
  computed: {
    containerStyle() {
      return {
        minHeight: this.height,
        height: this.height
      };
    }
  },
  data() {
    return {
      loading: true,
      error: null,
      previewer: null
    };
  },
  mounted() {
    console.log('[FilePreviewH5] Mounted', { src: this.src, type: this.fileType });
    // Delay to ensure DOM is ready
    setTimeout(() => {
      this.renderPreview();
    }, 100);
  },
  watch: {
    src(newSrc) {
      if (newSrc) {
        setTimeout(() => {
          this.renderPreview();
        }, 100);
      }
    }
  },
  beforeUnmount() {
    this.destroyPreviewer();
  },
  methods: {
    destroyPreviewer() {
      if (this.previewer) {
        try {
          this.previewer.destroy && this.previewer.destroy();
        } catch (e) { /* ignore */ }
        this.previewer = null;
      }
    },
    
    getContainer() {
      const ref = this.$refs.previewContainer;
      if (!ref) return null;
      // Uniapp: ref might be component instance or DOM element
      if (ref.$el) return ref.$el;
      if (ref instanceof HTMLElement) return ref;
      // Try to find actual DOM element
      if (ref.nodeType === 1) return ref;
      return null;
    },
    
    async renderPreview() {
      const container = this.getContainer();
      console.log('[FilePreviewH5] Container:', container, 'src:', this.src, 'type:', this.fileType);
      
      if (!container) {
        console.error('[FilePreviewH5] Container not found');
        this.error = '容器未找到';
        this.loading = false;
        return;
      }
      
      if (!this.src) {
        this.error = '文件地址不存在';
        this.loading = false;
        return;
      }
      
      this.loading = true;
      this.error = null;
      this.destroyPreviewer();
      container.innerHTML = '';
      
      try {
        switch (this.fileType) {
          case 'docx': {
            const jsPreviewDocx = await import('@js-preview/docx/lib/index.umd.js');
            this.previewer = jsPreviewDocx.default.init(container);
            await this.previewer.preview(this.src);
            this.loading = false;
            break;
          }
          case 'xlsx': {
            const jsPreviewExcel = await import('@js-preview/excel/lib/index.umd.js');
            this.previewer = jsPreviewExcel.default.init(container);
            await this.previewer.preview(this.src);
            this.loading = false;
            break;
          }
          case 'pdf': {
            // Use browser native PDF embed for better compatibility
            const embed = document.createElement('embed');
            embed.src = this.src;
            embed.type = 'application/pdf';
            embed.style.width = '100%';
            embed.style.height = '100%';
            embed.style.minHeight = this.height || '400px';
            container.appendChild(embed);
            this.loading = false;
            console.log('[FilePreviewH5] PDF rendered via native embed');
            break;
          }
          case 'pptx': {
            const pptxPreview = await import('pptx-preview');
            this.previewer = pptxPreview.init(container, {
              width: container.clientWidth || 800,
              height: container.clientHeight || 600
            });
            const response = await fetch(this.src);
            const arrayBuffer = await response.arrayBuffer();
            await this.previewer.preview(arrayBuffer);
            this.loading = false;
            break;
          }
          default:
            this.error = `不支持的文件类型: ${this.fileType}`;
            this.loading = false;
        }
        console.log('[FilePreviewH5] Rendered:', this.fileType);
      } catch (e) {
        console.error('[FilePreviewH5] Render error:', e);
        this.error = e?.message || '文档渲染失败';
        this.loading = false;
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

.preview-container {
  width: 100%;
  height: 100%;
  min-height: 400px;
  overflow: auto;
}
</style>
