# Nuwax Mobile

[中文文档](./README_CN.md)

A cross-platform AI agent mobile application built with UniApp X, supporting H5 and WeChat Mini Program.

## Features

- 🤖 **AI Agent Platform** - Browse, search, and interact with AI agents
- 💬 **Intelligent Chat** - Real-time streaming conversations with AI agents
- 📝 **Markdown Rendering** - Rich text display with code highlighting and LaTeX support
- 🎙️ **Voice Input** - Voice-to-text input capability
- 📁 **File Preview** - Support for various document formats (DOCX, XLSX, PPTX, PDF, images)
- 🔐 **Multiple Login Methods** - Phone, WeChat authorization, and more

## Tech Stack

- **Framework**: [UniApp X](https://uniapp.dcloud.io/) (Vue 3)
- **Build Tool**: Vite
- **Languages**: UTS (UniApp TypeScript), Vue
- **Platforms**: H5, WeChat Mini Program

## Project Structure

```
├── pages/               # Main pages
│   ├── index/           # Home page
│   ├── agent-list/      # Agent list
│   └── ...
├── subpackages/         # Subpackages (lazy loading)
│   └── pages/
│       ├── chat-conversation-component/  # Chat interface
│       ├── agent-detail/                 # Agent details
│       ├── login/                        # Login pages
│       └── ...
├── components/          # Reusable components
│   ├── markdown-renderer/
│   ├── voice-recorder-button/
│   └── ...
├── utils/               # Utility functions
├── types/               # TypeScript definitions
├── static/              # Static assets
└── docs/                # Documentation
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 16
- [HBuilderX](https://www.dcloud.io/hbuilderx.html) (recommended for UniApp X development)
- [WeChat DevTools](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html) (for Mini Program)

### Installation

```bash
# Clone the repository
git clone https://github.com/nuwax-ai/nuwax-mobile.git

# Install dependencies
pnpm install
# or
yarn install
```

### Development

#### H5 Development

Run the H5 development server via HBuilderX:
1. Open the project in HBuilderX
2. Click "Run" → "Run to Browser" → "Chrome"

The H5 version is deployed at `{domain}/m/` path.

#### WeChat Mini Program

1. Run to Mini Program via HBuilderX:
   - Click "Run" → "Run to Mini Program Simulator" → "WeChat DevTools"
2. Open the generated project in WeChat DevTools

### Build

#### H5 Production Build

Via HBuilderX: "Release" → "Website-H5"

#### WeChat Mini Program Build

Via HBuilderX: "Release" → "Mini Program-WeChat"

## Configuration

- `manifest.json` - App configuration, platform-specific settings
- `pages.json` - Page routing and navigation configuration
- `platformConfig.json` - Platform-specific configurations

## Documentation

Additional documentation can be found in the [docs](./docs) directory.

## License

This project is licensed under the [Apache License 2.0](./LICENSE).
