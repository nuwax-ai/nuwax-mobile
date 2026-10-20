<template>
  <view class="task-result">
    <text v-if="displayText" class="task-result-title">{{ displayText }}</text>
    <view
      v-for="(name, index) in fileNames"
      :key="index"
      class="task-result-file"
      @tap="handleClickFile(name)"
    >
      <view class="task-result-icon">
        <text class="iconfont">&#xe64e;</text>
      </view>
      <text class="file-text">{{ fileLabel(name) }}</text>
      <view class="task-result-arrow">
        <text class="iconfont">&#xe63f;</text>
      </view>
    </view>
  </view>
</template>

<script>
  import {
    getFileProxyUrlByConversationIdAndFilePath,
    jumpToFilePreviewPage,
  } from "@/utils/system.uts";

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
      fileNames() {
        const children = this.data?.children || [];
        const names = [];
        for (const child of children) {
          if (child.name === "file") {
            const text = `${this.getTextContent(child)}`.trim();
            if (text.length > 0) names.push(text);
          }
        }
        return names;
      },
      // 显示文本：优先显示描述，其次显示第一个文件名
      displayText() {
        return this.description || "";
      },
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

      fileLabel(filePath) {
        const normalized = `${filePath}`.trim();
        const slash = normalized.lastIndexOf("/");
        if (slash >= 0 && slash < normalized.length - 1) {
          return normalized.substring(slash + 1);
        }
        return normalized;
      },

      /**
       * 点击指定文件：打开预览视图
       */
      async handleClickFile(fileName) {
        let conversationId = String(this.conversationId);
        if (conversationId && conversationId.startsWith("chat-")) {
          conversationId = conversationId.replace("chat-", "");
        }

        if (conversationId) {
          try {
            const fileId = `${fileName}`.split(`${conversationId}/`).pop();
            const fileProxyUrl =
              await getFileProxyUrlByConversationIdAndFilePath(
                conversationId,
                fileId,
              );
            if (!fileProxyUrl) {
              uni.showToast({ title: "打开文件失败", icon: "none" });
              return;
            }
            jumpToFilePreviewPage(conversationId, fileProxyUrl);
          } catch (error) {
            console.error("[TaskResult] 获取文件列表失败:", error);
            uni.showToast({ title: "打开文件失败", icon: "none" });
          }
        } else {
          uni.$emit("task_result_click", {
            data: this.data,
            fileName,
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
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    margin: 16rpx 0;
    box-sizing: border-box;

    .task-result-title {
      color: #17191f;
      font-size: 28rpx;
      font-weight: 600;
      line-height: 40rpx;
      margin-bottom: 16rpx;
    }

    .task-result-file {
      display: flex;
      flex-direction: row;
      align-items: center;
      width: 100%;
      margin-bottom: 16rpx;
      padding: 22rpx 24rpx;
      border-radius: 16rpx;
      background-color: #ffffff;
      border: 1rpx solid #eceef2;
      box-sizing: border-box;
    }

    .file-text {
      flex: 1;
      min-width: 0;
      font-size: 28rpx;
      line-height: 40rpx;
      color: #17191f;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
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
