<template>
  <view class="tool-call-status">
    <!-- Plan 类型：直接显示任务列表 -->
    <template v-if="isPlanType">
      <!-- Plan 头部信息 -->
      <view class="plan-header" @tap="togglePlanExpanded">
        <view class="plan-info">
          <text class="plan-name">{{ toolCall.name || '执行计划' }}</text>
          <!-- <view class="plan-status-display">
            <view class="status-icon" :class="getStatusIconClass(toolCall.status)">
              <text :class="getStatusIconType(toolCall.status)" :style="{color: getStatusIconColor(toolCall.status),fontSize: '32rpx'}"></text>
            </view>
            <text class="plan-status-text">{{ getStatusText(toolCall.status) }}</text>
          </view> -->
        </view>
        <view class="plan-expand-icon">
          <text class="iconfont" :class="planExpanded ? 'icon-Chevron-up' : 'icon-a-Chevrondown'"></text>
        </view>
      </view>
      
      <!-- Plan 任务列表（直接展示） -->
      <view v-if="planExpanded && planTaskList.length > 0" class="plan-task-list">
        <view v-for="(task, index) in planTaskList" :key="index" class="plan-task-item">
          <!-- 字体图标实现的状态 -->
          <view class="task-status-icon" :class="getTaskStatusClass(task.status)">
            <text class="task-icon iconfont" :class="getTaskStatusIcon(task.status)"></text>
          </view>
          <text class="task-content">{{ task.content }}</text>
        </view>
      </view>
    </template>
    
    <!-- 非 Plan 类型：显示工具调用状态 -->
    <template v-else>
      <!-- 工具调用头部信息 -->
      <view v-if="toolCall?.type !== 'Event'" class="tool-header" @tap="toggleExpanded">
        <view class="tool-info">
          <text class="tool-name">{{ toolCall.name || toolCall.type }}</text>
          <view class="tool-status-display">
            <view class="status-icon" :class="getStatusIconClass(toolCall.status)">
              <text :class="getStatusIconType(toolCall.status)" :style="{color: getStatusIconColor(toolCall.status),fontSize: '32rpx'}"></text>
            </view>
            <text class="tool-status-text">{{ getStatusText(toolCall.status) }}</text>
          </view>
        </view>
        <view class="tool-actions">
          <view class="action-icon" @tap.stop.prevent="handleShowDetails">
            <text class="iconfont icon-List"></text>
          </view>
          <view class="action-icon" @tap.stop.prevent="handleCopyToClipboard">
            <text class="iconfont icon-Copy"></text>
          </view>
          <view v-if="isPageType(toolCall)" class="action-icon" @tap.stop.prevent="openPreviewPage(toolCall)">
            <text class="iconfont icon-eye-open"></text>
          </view>
        </view>
      </view>

      <!-- 展开后的详细信息 -->
      <view v-if="expanded" class="tool-details-expanded">
        <!-- 调用参数 -->
        <view v-if="detailData.params && Object.keys(detailData.params).length > 0" class="detail-section">
          <view class="section-header">
            <text class="section-title">调用参数</text>
          </view>
          <view class="arguments-content">
            <text class="arguments-text">{{ formatArguments(detailData.params) }}</text>
          </view>
        </view>

        <!-- 调用结果 -->
        <view v-if="detailData.response" class="detail-section">
          <view class="section-header">
            <text class="section-title">调用结果</text>
          </view>
          <view class="output-content">
            <text class="output-text">{{ formatResult(detailData.response) }}</text>
          </view>
        </view>
      </view>
    </template>
  </view>
</template>

<script>
import uniIcons from '@/uni_modules/uni-icons/components/uni-icons/uni-icons.vue'
import { AgentComponentTypeEnum } from '@/types/enums/agent.uts';
import { getCurrentPageParams } from '@/utils/common';
import { getFileProxyUrlByConversationIdAndFilePath, jumpToFilePreviewPage } from '@/utils/system.uts';

export default {
  name: 'Container',
  components: {
    uniIcons
  },
  props: {
    data: {
      type: Object,
      required: true
    }
  },
  data() {
    return {
      expanded: false,
      planExpanded: true, // Plan 类型默认展开
      toolCall: this.data
    }
  },
  computed: {
    // 判断是否为 Plan 类型
    isPlanType() {
      return this.toolCall.type === AgentComponentTypeEnum.Plan || this.toolCall.type === 'Plan'
    },
    
    // Plan 任务列表
    planTaskList() {
      const result = this.toolCall.result || {}
      const data = result.data
      
      if (Array.isArray(data)) {
        return data
      }
      
      return []
    },
    
    detailData() {
      const _result = this.toolCall.result || {}
      return {
        // 从结果中提取输入参数，如果没有则提供空对象
        params: _result.input || {},
        // 使用结果的 data 作为响应数据，如果没有则提供空对象
        response: _result.data || null,
      }
    }
  },
  watch: {
    data: {
      handler(newData) {
        this.toolCall = newData;
      },
      immediate: true
    }
  },
  methods: {

    // 打开页面首页
    openPreviewPage(data) {
      uni.$emit('page_preview_executing', data);
    },

    // 切换展开状态
   async toggleExpanded() {
      const result = this.data?.result;

      // 打开预览页面
      if (result?.kind === 'edit') {
        const params = getCurrentPageParams();

        const conversationId = params.conversationId;
        const file_path = result?.input?.file_path;

        const fileProxyUrl = await getFileProxyUrlByConversationIdAndFilePath(conversationId, file_path);
        jumpToFilePreviewPage(conversationId, fileProxyUrl);
        return;
      }

      this.expanded = !this.expanded
    },
    
    // 切换 Plan 展开状态
    togglePlanExpanded() {
      this.planExpanded = !this.planExpanded
    },

    // 显示详情
    showDetails() {
      if (!this.toolCall.result) {
        return uni.showToast({
          icon: 'none',
          title: '结果为空',
        })
      }
      this.expanded = !this.expanded
    },

    // 处理显示详情点击（阻止冒泡）
    handleShowDetails(event) {
      event.stopPropagation()
      this.showDetails()
    },

    // 处理复制到剪贴板点击（阻止冒泡）
    handleCopyToClipboard(event) {
      event.stopPropagation()
      this.copyToClipboard()
    },

    // 复制结果
    copyResult() {
      // 实现复制功能
      console.log('复制结果')
    },

    // 复制到剪贴板
    copyToClipboard() {
      // 实现复制到剪贴板功能
      uni.setClipboardData({
        data: this.formatArguments(this.detailData),
        success: () => {
          uni.showToast({
            title: '复制成功',
          })
        },
        fail: () => {
          uni.showToast({
            title: '复制失败',
          })
        }
      })
    },

    // 获取状态图标类型
    getStatusIconType(status) {
      const iconMap = {
        'EXECUTING': 'icon-Loader',    // 执行中显示加载图标
        'FINISHED': 'icon-Check', // 已完成显示对勾
        'FAILED': 'icon-waring'     // 执行失败显示叉号
      }
      return ` iconfont ${iconMap[status] || 'icon-Check'}`
    },

    // 获取状态图标样式类
    getStatusIconClass(status) {
      const statusClassMap = {
        'EXECUTING': 'status-icon-executing',
        'FINISHED': 'status-icon-finished',
        'FAILED': 'status-icon-failed'
      }
      return statusClassMap[status] || 'status-icon-default'
    },

    // 获取状态图标颜色
    getStatusIconColor(status) {
      const statusColorMap = {
        'EXECUTING': '#1890ff',
        'FINISHED': '#52c41a',
        // 'FAILED': '#ff4d4f'
        'FAILED': '#ffcb00'
      }
      return statusColorMap[status] || '#999'
    },

    // 获取状态文本
    getStatusText(status) {
      return '';
      // const statusTextMap = {
      //   'EXECUTING': '执行中',
      //   'FINISHED': '已完成',
      //   'FAILED': '执行失败'
      // }
      // return statusTextMap[status] || '未知状态'
    },

    
    // 获取任务状态样式类
    getTaskStatusClass(status) {
      const classMap = {
        'completed': 'task-status-completed',
        'pending': 'task-status-pending',
        'in_progress': 'task-status-in-progress',
        'failed': 'task-status-failed'
      }
      return classMap[status] || 'task-status-pending'
    },
    
    // 获取任务状态图标 (使用字体图标unicode)
    getTaskStatusIcon(status) {
      const iconMap = {
        'pending': 'icon-BorderOutlined',      // 待处理
        'in_progress': 'icon-HourglassOutlined',  // 进行中
        'completed': 'icon-CheckSquareOutlined',    // 已完成
        'failed': 'icon-CloseSquareOutlined'        // 失败
      }
      return iconMap[status] || 'icon-BorderOutlined'
    },

    // 格式化参数显示
    formatArguments(args) {
      try {
        return JSON.stringify(args, null, 2)
      } catch (error) {
        return String(args)
      }
    },

    // 格式化结果显示
    formatResult(result) {
      if (result && typeof result === 'object') {
        try {
          return JSON.stringify(result, null, 2)
        } catch (error) {
          return String(result)
        }
      }
      return String(result)
    },

    // 格式化执行时间
    formatExecutionTime(time) {
      if (time < 1000) {
        return `${time}ms`
      } else if (time < 60000) {
        return `${(time / 1000).toFixed(2)}s`
      } else {
        return `${(time / 60000).toFixed(2)}min`
      }
    },
    isPageType(toolCall) {
      return toolCall.type === AgentComponentTypeEnum.Page;
    }
  }
}
</script>

<style lang="scss">
.tool-call-status {
  width: 100%;
  margin: 16rpx 0;
  border-radius: 16rpx;
  background-color: rgba(12, 20, 102, 0.04);
  overflow: hidden;

  // Plan 类型样式
  .plan-header {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    padding: 24rpx;

    .plan-info {
      display: flex;
      flex-direction: row;
      align-items: center;
      flex: 1;
      gap: 16rpx;

      .plan-name {
        font-size: 28rpx;
        font-weight: 600;
        color: #333;
        line-height: 40rpx;
      }

      .plan-status-display {
        display: flex;
        align-items: center;
        flex-direction: row;
        gap: 8rpx;

        .status-icon {
          width: 32rpx;
          height: 32rpx;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;

          &.status-icon-executing {
            animation: spin 1s linear infinite;
          }
        }

        .plan-status-text {
          font-size: 24rpx;
          color: #666;
          line-height: 32rpx;
        }
      }
    }

    .plan-expand-icon {
      .iconfont {
        font-size: 28rpx;
        color: #999;
      }
    }
  }

  // Plan 任务列表
  .plan-task-list {
    padding: 0 24rpx 24rpx;
    border-top: 2rpx solid rgba(0, 0, 0, 0.06);
    margin-top: 0;

    .plan-task-item {
      display: flex;
      flex-direction: row;
      align-items: flex-start;
      gap: 8rpx;
      padding: 12rpx 0;

      .task-status-icon {
        flex-shrink: 0;
        width: 32rpx;
        height: 32rpx;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-top: 4rpx;

        .task-icon {
          font-family: 'iconfont';
          font-size: 32rpx;
          font-style: normal;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          color: #8c8c8c;
        }
      }

      .task-content {
        flex: 1;
        font-size: 26rpx;
        color: #262626;
        line-height: 40rpx;
      }
    }
  }

  // 非 Plan 类型样式（原有样式）
  .tool-header {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    padding: 24rpx;

    .tool-info {
      display: flex;
      flex-direction: row;
      align-items: center;
      flex: 1;
      gap: 16rpx;

      .tool-name {
        font-size: 28rpx;
        font-weight: 600;
        color: #333;
        line-height: 40rpx;
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tool-status-display {
        display: flex;
        align-items: center;
        flex-direction: row;
        gap: 8rpx;

        .status-icon {
          width: 32rpx;
          height: 32rpx;
          // border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;

          &.status-icon-executing {
            animation: spin 1s linear infinite;

            .iconfont {
              color: #1890ff;
            }
          }

          &.status-icon-finished {
            color: #52c41a;
          }

          &.status-icon-failed {
            color: #ff4d4f;
          }

          &.status-icon-default {
            color: #999;
          }
        }

        .tool-status-text {
          font-size: 24rpx;
          color: #666;
          line-height: 32rpx;
          margin-right: 6px;
        }
      }
    }

    .tool-actions {
      display: flex;
      align-items: center;
      flex-direction: row;
      gap: 16rpx;

      .action-icon {
        width: 40rpx;
        height: 40rpx;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 6rpx;
        transition: background-color 0.3s ease;
        cursor: pointer;

        .iconfont {
          font-size: 36rpx;
          font-weight: 400;
          color: #333;
          line-height: 36rpx;
        }

        &:hover {
          background-color: #f0f0f0;
        }
      }
    }
  }

  .tool-details-expanded {
    padding: 24rpx;
    background-color: #f8f9fa;
    border-top: 2rpx solid #f0f0f0;

    .detail-section {
      margin-bottom: 24rpx;

      &:last-child {
        margin-bottom: 0;
      }

      .section-header {
        margin-bottom: 16rpx;

        .section-title {
          font-size: 26rpx;
          font-weight: 600;
          color: #333;
          line-height: 36rpx;
        }
      }

      .execute-id-content,
      .arguments-content,
      .output-content,
      .error-content,
      .execution-time {
        padding: 16rpx;
        background-color: #ffffff;
        border-radius: 8rpx;
        border: 2rpx solid #e9ecef;

        .execute-id-text,
        .arguments-text,
        .output-text,
        .error-text,
        .time-text {
          font-size: 24rpx;
          line-height: 36rpx;
          color: #495057;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          white-space: pre-wrap;
          word-break: break-word;
        }
      }

      &.error-section {
        .error-content {
          background-color: #fff5f5;
          border-color: #ffccc7;

          .error-text {
            color: #cf1322;
          }
        }
      }
    }
  }

  // 加载动画
  @keyframes spin {
    from {
      transform: rotate(0deg);
    }

    to {
      transform: rotate(360deg);
    }
  }

  // 响应式设计
  @media (max-width: 750rpx) {
    .tool-header {
      padding: 20rpx;

      .tool-info {
        .tool-name {
          font-size: 26rpx;
        }

        .tool-status-display {
          .tool-status-text {
            font-size: 22rpx;
          }
        }
      }
    }

    .tool-details-expanded {
      padding: 20rpx;
    }
  }
}
</style>
