<template>
  <view class="task-result" @tap="handleClick">
    <!-- 左侧图标 -->
    <view class="task-result-icon">
      <text class="iconfont">&#xe64e;</text>
    </view>

    <!-- 文件描述/名称 -->
    <view class="task-result-action">
      <text class="action-text">{{ displayText }}</text>
    </view>

    <!-- 右侧图标 -->
    <view class="task-result-arrow">
      <text class="iconfont">&#xe63f;</text>
    </view>
  </view>
</template>

<script>
  import { CustomActionService } from "@/utils/customActionService.uts";
  import { SUCCESS_CODE } from "@/constants/codes.constants";
  import { apiGetStaticFileList } from "@/servers/agentDev.uts";

  export default {
    name: "TaskResult",
    props: {
      // task-result 节点数据
      data: {
        type: Object,
        default: () => ({}),
      },
      // 会话ID
      conversationId: {
        type: [String, Number],
        default: "",
      },
    },
    computed: {
      // 提取描述文本
      description() {
        return this.extractChildText("description");
      },
      // 提取文件名
      fileName() {
        return this.extractChildText("file");
      },
      // 显示文本：优先显示描述，其次显示文件名
      displayText() {
        return this.description || this.fileName || "查看结果";
      },
    },
    data() {
      return {
        fileTreeData: [],
      };
    },
    methods: {
      /**
       * 从子节点中提取指定类型的文本内容
       * @param tagName 标签名
       * @returns 文本内容
       */
      extractChildText(tagName) {
        const children = this.data?.children || [];

        for (const child of children) {
          if (child.name === tagName) {
            // 递归提取文本
            return this.getTextContent(child);
          }
        }

        return "";
      },

      /**
       * 递归获取节点的文本内容
       * @param node 节点
       * @returns 文本内容
       */
      getTextContent(node) {
        if (!node) return "";

        // 如果是文本节点
        if (node.type === "text") {
          return node.text || "";
        }

        // 如果有子节点，递归处理
        if (node.children && Array.isArray(node.children)) {
          return node.children
            .map((child) => this.getTextContent(child))
            .join("");
        }

        return "";
      },

      /**
       * 点击处理：打开预览视图
       */
      async handleClick() {
        let conversationId = String(this.conversationId);
        // 移除 chat- 前缀，因为页面参数使用的是纯数字ID
        if (conversationId && conversationId.startsWith("chat-")) {
          conversationId = conversationId.replace("chat-", "");
        }

        if (conversationId) {
          // CustomActionService.openPreviewView(conversationId)
          const fileId = this.fileName.split(`${conversationId}/`).pop();

          // 查找当前文件是否在 fileTreeData 存在
          const file = this.fileTreeData.find((item) => item.name === fileId);
          const path = "/subpackages/pages/file-preview-page/file-preview-page";
          if (file) {
            const url = `${path}?cId=${conversationId}&fileProxyUrl=${encodeURIComponent(file.fileProxyUrl)}`;
            uni.navigateTo({ url });
          } else {
            const result = await apiGetStaticFileList(conversationId);
            if (result.code === SUCCESS_CODE) {
              const { files } = result.data || {};
              this.fileTreeData = files;
              const file = files.find((item) => item.name === fileId);
              if (file) {
                const url = `${path}?cId=${conversationId}&fileProxyUrl=${encodeURIComponent(file.fileProxyUrl)}`;
                uni.navigateTo({ url });
              }
            }
          }
        } else {
          // 如果没有会话ID，发送事件让父组件处理
          uni.$emit("task_result_click", {
            data: this.data,
            fileName: this.fileName,
            description: this.description,
          });
        }
      },
    },
  };
</script>

<style lang="scss">
  .task-result {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8rpx;
    padding: 20rpx 20rpx;
    margin: 16rpx 0;
    border-radius: 16rpx;
    background-color: rgba(12, 20, 102, 0.04);
    width: 100%;
    box-sizing: border-box;

    &:active {
      background-color: rgba(12, 20, 102, 0.08);
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
        font-weight: 600;
        color: #333;
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

    // 响应式设计
    @media (max-width: 750rpx) {
      .task-result-action {
        .action-text {
          font-size: 26rpx;
        }
      }
    }
  }
</style>
