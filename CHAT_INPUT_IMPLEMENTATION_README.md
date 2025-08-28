# 输入框回车发送消息功能实现

## 功能概述

在首页的输入框组件中实现了回车键发送消息的功能，支持发送文本消息和文件。

## 实现位置

### 1. 主页面 (pages/home/home.uvue)

- **handleEnter方法**: 处理输入框回车事件，接收消息内容和文件列表
- **handleSelectComponent方法**: 处理组件选择事件

### 2. 输入框组件 (components/chat-input-phone/chat-input-phone.uvue)

- **handleKeyDown方法**: 监听键盘事件，检测回车键
- **handleSendMessage方法**: 发送消息的核心逻辑
- **handleInput方法**: 处理输入框内容变化

## 功能特性

### 1. 回车发送消息
- 在输入框中按回车键可以发送消息
- 支持发送纯文本消息
- 支持发送文件（图片等）
- 支持同时发送文本和文件

### 2. 输入验证
- 检查消息内容是否为空
- 检查是否有文件被选择
- 至少需要文本内容或文件才能发送

### 3. 用户体验
- 发送成功后显示提示信息
- 发送后自动清空输入框和文件列表
- 支持组件选择功能

## 使用方法

### 在输入框中：
1. 输入文本消息
2. 可选择上传文件（图片）
3. 按回车键或点击发送按钮发送消息

### 事件处理：
```typescript
// 处理回车发送事件
const handleEnter = (message: string, files: UploadFileInfo[]) => {
  // 验证输入
  if (!message.trim() && (!files || files.length === 0)) {
    // 显示错误提示
    return;
  }
  
  // 构建消息数据
  const messageData = {
    message: message.trim(),
    files: files || [],
    timestamp: Date.now()
  };
  
  // 发送消息逻辑
  // ...
};
```

## 类型定义

### UploadFileInfo
```typescript
interface UploadFileInfo {
  url: string;
  name: string;
  type: string;
  key?: string;
  size: number;
  width?: number;
  height?: number;
  percent?: number;
  status?: UploadFileStatus;
  uid?: string;
  response?: any;
}
```

### AgentSelectedComponentInfo
```typescript
interface AgentSelectedComponentInfo {
  id: number;
  type: AgentComponentTypeEnum;
}
```

## 扩展功能

### 1. 服务器通信
可以在 `handleEnter` 方法中添加与服务器的通信逻辑：
```typescript
// 调用聊天API发送消息
const sendMessageToServer = async (messageData) => {
  // 实现发送消息到服务器的逻辑
};
```

### 2. 页面跳转
可以在发送消息后跳转到聊天页面：
```typescript
uni.navigateTo({
  url: `/pages/chat/chat?message=${encodeURIComponent(message)}&files=${encodeURIComponent(JSON.stringify(files))}`
});
```

### 3. 消息历史
可以添加消息历史记录功能，保存发送的消息到本地存储。

## 注意事项

1. 确保输入框组件正确绑定了 `onEnter` 事件
2. 文件上传功能需要正确的API接口支持
3. 键盘事件在不同平台可能有差异，需要测试兼容性
4. 消息发送前应该进行适当的验证和错误处理
