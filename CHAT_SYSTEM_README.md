# 聊天系统集成说明

本项目已经成功集成了独立的聊天系统，包含流式请求、Markdown渲染等功能，不再依赖uni-ai-x模块。

## 功能特性

### ✅ 已实现功能
- **流式聊天**: 支持实时流式响应，打字机效果
- **Markdown渲染**: 支持基本的Markdown语法渲染
- **消息管理**: 完整的消息状态管理（发送中、已发送、错误等）
- **UI组件**: 美观的聊天界面，支持用户和AI消息区分
- **输入组件**: 支持多行输入，自动调整高度
- **滚动管理**: 自动滚动到最新消息

### 📝 支持的Markdown语法
- 标题 (H1-H6): `# ## ### #### ##### ######`
- 代码块: ` ```language code ``` `
- 列表: `- item`
- 引用: `> quote`
- 分割线: `---`
- 链接: `[text](url)`
- 图片: `![alt](src)`
- 普通文本

## 文件结构

```
├── types/interfaces/chat.uts          # 聊天相关类型定义
├── utils/
│   ├── streamRequest.uts              # 流式请求工具
│   ├── markdownParser.uts             # Markdown解析器
│   └── chatService.uts                # 聊天服务类
├── components/
│   ├── markdown-renderer/             # Markdown渲染组件
│   ├── chat-message/                  # 聊天消息组件
│   └── chat-input/                    # 聊天输入组件
├── constants/api.constants.uts        # API配置
└── pages/chat/chat.uvue               # 聊天页面
```

## 使用方法

### 1. 配置API端点

编辑 `constants/api.constants.uts` 文件，配置您的API端点：

```typescript
export const API_BASE_URL = 'https://your-api-domain.com'
```

### 2. 配置认证Token

在 `utils/chatService.uts` 中替换实际的认证token：

```typescript
'Authorization': 'Bearer your-actual-token-here'
```

### 3. 启动聊天

直接访问 `pages/chat/chat.uvue` 页面即可开始聊天。

## API接口要求

您的后端API需要支持以下格式的流式响应：

### 请求格式
```json
{
  "message": "用户输入的消息",
  "stream": true
}
```

### 响应格式
服务器需要返回Server-Sent Events (SSE)格式的数据：

```
data: {"type": "content", "data": "部分响应内容"}

data: {"type": "content", "data": "更多响应内容"}

data: [DONE]
```

## 自定义配置

### 修改样式
所有组件都使用SCSS样式，您可以在各组件文件中修改样式来适配您的设计需求。

### 扩展Markdown支持
在 `utils/markdownParser.uts` 中添加更多Markdown语法支持。

### 添加新功能
- 在 `types/interfaces/chat.uts` 中添加新的类型定义
- 在 `utils/chatService.uts` 中添加新的服务方法
- 在组件中添加对应的UI功能

## 注意事项

1. **API兼容性**: 确保您的后端API支持SSE格式的流式响应
2. **跨域问题**: 在H5环境下需要处理跨域问题
3. **Token管理**: 建议实现token的自动刷新和管理机制
4. **错误处理**: 系统已包含基本的错误处理，可根据需要扩展
5. **性能优化**: 对于大量消息，建议实现虚拟滚动

## 故障排除

### 流式请求失败
- 检查API端点配置是否正确
- 确认后端支持SSE格式
- 检查网络连接和跨域设置

### Markdown渲染问题
- 检查markdownParser.uts中的解析逻辑
- 确认输入的markdown格式正确

### 消息显示异常
- 检查ChatMessage类型定义
- 确认消息状态管理逻辑

## 后续优化建议

1. **代码高亮**: 集成代码高亮库
2. **图片预览**: 添加图片预览功能
3. **消息搜索**: 实现消息搜索功能
4. **消息编辑**: 支持消息编辑和撤回
5. **文件上传**: 添加文件上传功能
6. **语音输入**: 集成语音识别
7. **主题切换**: 支持深色/浅色主题
8. **多语言**: 支持国际化

## 技术栈

- **框架**: uni-app (uvue)
- **语言**: UTS (TypeScript)
- **样式**: SCSS
- **状态管理**: Vue 3 Composition API
- **流式通信**: Server-Sent Events (SSE)
- **Markdown解析**: 自定义解析器

这个聊天系统已经完全独立，不依赖任何第三方聊天模块，您可以根据实际需求进行定制和扩展。
