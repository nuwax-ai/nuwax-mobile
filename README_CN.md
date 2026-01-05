# Nuwax Mobile

[English](./README.md)

基于 UniApp X 构建的跨平台 AI 智能体移动应用，支持 H5 和微信小程序。

## 功能特性

- 🤖 **AI 智能体平台** - 浏览、搜索和使用 AI 智能体
- 💬 **智能对话** - 与 AI 智能体实时流式对话
- 📝 **Markdown 渲染** - 富文本展示，支持代码高亮和 LaTeX 公式
- 🎙️ **语音输入** - 语音转文字输入功能
- 📁 **文件预览** - 支持多种文档格式（DOCX、XLSX、PPTX、PDF、图片）
- 🔐 **多种登录方式** - 手机号、微信授权等

## 技术栈

- **框架**：[UniApp X](https://uniapp.dcloud.io/)（Vue 3）
- **构建工具**：Vite
- **开发语言**：UTS（UniApp TypeScript）、Vue
- **支持平台**：H5、微信小程序

## 项目结构

```
├── pages/               # 主包页面
│   ├── index/           # 首页
│   ├── agent-list/      # 智能体列表
│   └── ...
├── subpackages/         # 分包（懒加载）
│   └── pages/
│       ├── chat-conversation-component/  # 聊天界面
│       ├── agent-detail/                 # 智能体详情
│       ├── login/                        # 登录页面
│       └── ...
├── components/          # 可复用组件
│   ├── markdown-renderer/
│   ├── voice-recorder-button/
│   └── ...
├── utils/               # 工具函数
├── types/               # TypeScript 类型定义
├── static/              # 静态资源
└── docs/                # 文档
```

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) >= 16
- [HBuilderX](https://www.dcloud.io/hbuilderx.html)（推荐用于 UniApp X 开发）
- [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)（用于小程序开发）

### 安装

```bash
# 克隆仓库
git clone https://github.com/nuwax-ai/nuwax-mobile.git

# 安装依赖
pnpm install
# 或
yarn install
```

### 开发

#### H5 开发

通过 HBuilderX 运行 H5 开发服务器：
1. 在 HBuilderX 中打开项目
2. 点击「运行」→「运行到浏览器」→「Chrome」

H5 版本部署在 `{域名}/m/` 路径下。

#### 微信小程序

1. 通过 HBuilderX 运行到小程序：
   - 点击「运行」→「运行到小程序模拟器」→「微信开发者工具」
2. 在微信开发者工具中打开生成的项目

### 构建

#### H5 生产构建

通过 HBuilderX：「发行」→「网站-H5手机版」

#### 微信小程序构建

通过 HBuilderX：「发行」→「小程序-微信」

## 配置

- `manifest.json` - 应用配置、平台特定设置
- `pages.json` - 页面路由和导航配置
- `platformConfig.json` - 平台特定配置

## 文档

更多文档请查看 [docs](./docs) 目录。

## 许可证

本项目采用 [MIT 许可证](./LICENSE) 开源。
