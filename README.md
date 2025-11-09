# Comments Insight (评论洞察)

<div align="center">

🤖 AI-powered comment extraction and analysis Chrome extension for social media platforms

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.3-61dafb)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-5.4-646cff)](https://vitejs.dev/)

</div>

## ✨ Features

- 🤖 **AI-Driven Extraction** - Intelligent comment extraction using AI models
- 📊 **Professional Analysis** - Sentiment analysis and hot comment identification
- 🌳 **Tree View** - Hierarchical comment and reply visualization
- 📁 **Data Export** - Export to CSV and Markdown formats
- 🌍 **Multi-Language** - Support for Chinese and English
- 📜 **History Tracking** - Save and review past analyses
- ⚡ **Background Tasks** - Non-blocking task execution
- 🔒 **Privacy First** - All data stored locally

## 🎯 Supported Platforms

| Platform | Status | Notes |
|----------|--------|-------|
| YouTube | ✅ | Full support |
| Bilibili | ✅ | Full support |
| Weibo | ✅ | Full support |
| Douyin | ✅ | Full support |
| Twitter/X | ✅ | Full support |
| TikTok | ✅ | Full support |
| Reddit | ✅ | Full support |

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Chrome Browser

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/comments-insight.git
cd comments-insight

# Install dependencies
npm install

# Start development server
npm run dev
```

### Load Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **"Developer mode"** (top right)
3. Click **"Load unpacked"**
4. Select the `dist` folder from the project

### Configuration

1. Click the extension icon
2. Go to Settings
3. Configure your AI API:
   - API URL (e.g., `https://api.openai.com/v1/chat/completions`)
   - API Key
   - Model selection
   - Parameters (max tokens, temperature, etc.)

## 📖 Usage

1. **Navigate** to a supported platform (e.g., YouTube video)
2. **Click** the extension icon
3. **Start** comment extraction
4. **View** analysis results
5. **Export** data if needed

## 🏗️ Project Structure

```
comments-insight/
├── src/
│   ├── background/          # Service Worker
│   │   ├── index.ts        # Main entry
│   │   ├── TaskManager.ts  # Task management
│   │   ├── StorageManager.ts # Data storage
│   │   ├── AIService.ts    # AI integration
│   │   └── MessageRouter.ts # Message routing
│   ├── content/             # Content Scripts
│   │   ├── index.ts        # Main entry
│   │   ├── PlatformDetector.ts # Platform detection
│   │   ├── DOMAnalyzer.ts  # DOM analysis
│   │   ├── PageController.ts # Page interaction
│   │   └── CommentExtractor.ts # Comment extraction
│   ├── popup/               # Popup UI
│   ├── options/             # Settings page
│   ├── history/             # History page
│   ├── types/               # TypeScript types
│   └── styles/              # Global styles
├── public/
│   └── icons/               # Extension icons
├── scripts/                 # Build scripts
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## 🛠️ Development

### Available Scripts

```bash
# Development mode with hot reload
npm run dev

# Build for production
npm run build

# Package extension as ZIP
npm run package

# Preview production build
npm run preview
```

### Tech Stack

- **Framework**: React 18.3
- **Language**: TypeScript 5.6
- **Build Tool**: Vite 5.4
- **Extension Tool**: CRXJS 2.0
- **Styling**: Tailwind CSS 3.4
- **State Management**: Zustand 5.0
- **i18n**: i18next 23.15
- **Markdown**: react-markdown 9.0
- **Compression**: LZ-String 1.5

### Code Style

- Use TypeScript strict mode
- Follow ESLint rules
- Add JSDoc comments for public APIs
- Use English for all comments and logs
- Follow naming conventions:
  - Classes: `PascalCase`
  - Functions: `camelCase`
  - Constants: `UPPER_SNAKE_CASE`

## 📚 Documentation

- [Development Guide](DEVELOPMENT_GUIDE.md) - Detailed development instructions
- [Implementation Summary](IMPLEMENTATION_SUMMARY.md) - Technical implementation details
- [Progress](PROGRESS.md) - Current development status

## 🔧 Configuration

### AI Settings

Configure in the Options page:

```typescript
{
  "apiUrl": "https://api.openai.com/v1/chat/completions",
  "apiKey": "your-api-key",
  "model": "gpt-4",
  "maxTokens": 4000,
  "temperature": 0.7,
  "topP": 0.9
}
```

### Extraction Settings

- **Max Comments**: Maximum number of comments to extract
- **Extractor Model**: AI model for comment extraction
- **Analyzer Model**: AI model for comment analysis
- **Prompt Template**: Custom analysis prompt template

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Chrome Extensions Documentation](https://developer.chrome.com/docs/extensions/)
- [CRXJS Vite Plugin](https://crxjs.dev/vite-plugin/)
- [React](https://reactjs.org/)
- [Tailwind CSS](https://tailwindcss.com/)

## 📧 Contact

- **Issues**: [GitHub Issues](https://github.com/yourusername/comments-insight/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/comments-insight/discussions)

## 🗺️ Roadmap

- [x] Project setup and architecture
- [x] Service Worker implementation
- [x] Content Scripts implementation
- [x] Platform detection
- [x] UI components (Popup, Options, History)
- [x] AI prompt templates
- [x] Data storage and compression
- [x] Task management system
- [x] History and search
- [x] CSV export
- [x] Settings import/export
- [x] Internationalization files (needs UI integration)
- [ ] Complete UI i18n integration
- [ ] Markdown export
- [ ] Background notifications
- [ ] Performance optimization
- [ ] Testing and debugging
- [ ] Chrome Web Store publication

**Current Status**: ✅ Core features complete (~85%), ready for testing

---

<div align="center">

Made with ❤️ by the Comments Insight Team

[Report Bug](https://github.com/yourusername/comments-insight/issues) · [Request Feature](https://github.com/yourusername/comments-insight/issues)

</div>
