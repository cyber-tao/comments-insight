# Project Structure

## Root Organization

```
comments-insight/
├── src/                    # Source code
├── public/                 # Static assets
├── scripts/                # Build and utility scripts
├── dist/                   # Build output (generated)
├── docs/                   # Documentation
└── node_modules/           # Dependencies (generated)
```

## Source Directory (`src/`)

### Core Components

- **`background/`** - Service Worker (Manifest V3)
  - `index.ts` - Main entry point
  - `TaskManager.ts` - Background task orchestration
  - `StorageManager.ts` - Chrome storage API wrapper
  - `AIService.ts` - AI API integration
  - `MessageRouter.ts` - Extension message handling

- **`content/`** - Content Scripts
  - `index.ts` - Main entry point
  - `PlatformDetector.ts` - Detect current platform
  - `DOMAnalyzer.ts` - AI-powered DOM analysis
  - `PageController.ts` - Page interaction (scroll, click)
  - `CommentExtractor.ts` - Comment extraction logic

### UI Pages

- **`popup/`** - Extension popup interface
- **`options/`** - Settings page
- **`history/`** - History viewer page
- **`logs/`** - Development logs viewer

### Supporting Directories

- **`components/`** - Reusable React components
- **`hooks/`** - Custom React hooks
- **`types/`** - TypeScript type definitions
- **`styles/`** - Global styles and Tailwind config
- **`locales/`** - i18n translation files
- **`utils/`** - Utility functions

### Configuration

- **`manifest.json`** - Chrome extension manifest

## Public Assets (`public/`)

- **`icons/`** - Extension icons (16x16, 48x48, 128x128)

## Scripts (`scripts/`)

- **`create-icons.js`** - Icon generation
- **`package.js`** - Extension packaging
- **`view-ai-logs.js`** - Log viewer utility

## Architecture Patterns

### Message Passing

Extension uses Chrome's message passing API for communication between:
- Popup ↔ Background
- Content Script ↔ Background
- Options ↔ Background

### AI Extraction Flow

1. Content script analyzes page structure layer by layer
2. AI decides which DOM elements to examine
3. Page controller handles scrolling and expanding collapsed replies
4. Extractor collects comments with metadata (username, time, likes, replies)

### Data Storage

- Chrome Storage API for settings and history
- LZ-String compression for large comment datasets
- Local-only storage (privacy-first)

## Naming Conventions

- **Classes**: `PascalCase` (e.g., `TaskManager`, `AIService`)
- **Functions**: `camelCase` (e.g., `extractComments`, `analyzeDOM`)
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `MAX_TOKENS`, `API_URL`)
- **Files**: Match class names or use kebab-case for utilities

## Code Style

- TypeScript strict mode required
- English for all comments and logs
- JSDoc comments for public APIs
- Path alias `@/` for imports from `src/`
