<template>
  <view class="task-result" @tap="handleClick">
    <!-- 文件图标 -->
    <view class="task-result-icon">
      <text class="iconfont icon-file-text"></text>
    </view>
    
    <!-- 文件描述/名称 -->
    <view class="task-result-action">
      <text class="action-text">{{ displayText }}</text>
    </view>
    
    <!-- 右箭头 -->
    <view class="task-result-arrow">
      <text class="iconfont icon-Chevron-right"></text>
    </view>
  </view>
</template>

<script>
import { CustomActionService } from '@/utils/customActionService.uts'

export default {
  name: 'TaskResult',
  props: {
    // task-result 节点数据
    data: {
      type: Object,
      default: () => ({})
    },
    // 会话ID
    conversationId: {
      type: [String, Number],
      default: ''
    }
  },
  computed: {
    // 提取描述文本
    description() {
      return this.extractChildText('description')
    },
    // 提取文件名
    fileName() {
      return this.extractChildText('file')
    },
    // 显示文本：优先显示描述，其次显示文件名
    displayText() {
      return this.description || this.fileName || '查看结果'
    }
  },
  methods: {
    /**
     * 从子节点中提取指定类型的文本内容
     * @param tagName 标签名
     * @returns 文本内容
     */
    extractChildText(tagName) {
      const children = this.data?.children || []
      
      for (const child of children) {
        if (child.name === tagName) {
          // 递归提取文本
          return this.getTextContent(child)
        }
      }
      
      return ''
    },
    
    /**
     * 递归获取节点的文本内容
     * @param node 节点
     * @returns 文本内容
     */
    getTextContent(node) {
      if (!node) return ''
      
      // 如果是文本节点
      if (node.type === 'text') {
        return node.text || ''
      }
      
      // 如果有子节点，递归处理
      if (node.children && Array.isArray(node.children)) {
        return node.children
          .map(child => this.getTextContent(child))
          .join('')
      }
      
      return ''
    },
    
    /**
     * 点击处理：打开预览视图
     */
    handleClick() {
      const conversationId = this.conversationId
      
      if (conversationId) {
        CustomActionService.openPreviewView(Number(conversationId))
      } else {
        // 如果没有会话ID，发送事件让父组件处理
        uni.$emit('task_result_click', {
          data: this.data,
          fileName: this.fileName,
          description: this.description
        })
      }
    }
  }
}
</script>

<style lang="scss">
.task-result {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16rpx;
  padding: 20rpx 32rpx;
  margin: 16rpx 0;
  border-radius: 16rpx;
  background-color: #fafafa;
  border: 2rpx solid #f0f0f0;
  width: 100%;
  box-sizing: border-box;
  
  &:active {
    background-color: #f5f5f5;
  }
  
  .task-result-icon {
    flex-shrink: 0;
    width: 40rpx;
    height: 40rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    
    .iconfont {
      font-size: 32rpx;
      color: rgba(0, 0, 0, 0.45);
    }
  }
  
  .task-result-action {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    
    .action-text {
      font-size: 28rpx;
      font-weight: 400;
      color: rgba(0, 0, 0, 0.65);
      line-height: 40rpx;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }
  
  .task-result-arrow {
    flex-shrink: 0;
    width: 32rpx;
    height: 32rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    
    .iconfont {
      font-size: 24rpx;
      color: rgba(0, 0, 0, 0.25);
    }
  }
}
</style>
