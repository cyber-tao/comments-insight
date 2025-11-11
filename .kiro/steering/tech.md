# Technology Stack

## Build System

- **Build Tool**: Vite 5.4
- **Extension Plugin**: CRXJS 2.0 (Chrome extension development)
- **Language**: TypeScript 5.6 (strict mode enabled)
- **Package Manager**: npm

## Frontend Stack

- **Framework**: React 18.3 with React DOM
- **State Management**: Zustand 5.0
- **Styling**: Tailwind CSS 3.4 with Typography plugin
- **Internationalization**: i18next 23.15 + react-i18next 15.0
- **Markdown Rendering**: react-markdown 9.0 with remark-gfm 4.0

## Chrome Extension APIs

- **Manifest Version**: 3
- **Service Worker**: Background script for task management
- **Content Scripts**: DOM analysis and page interaction
- **Storage API**: Local data persistence
- **Notifications**: Task completion alerts

## Utilities

- **Compression**: LZ-String 1.5 (for data storage optimization)
- **Archiver**: archiver 7.0 (for packaging)

## Common Commands

```bash
# Development with hot reload
npm run dev

# Build for production (TypeScript compilation + Vite build)
npm run build

# Package extension as ZIP file
npm run package

# Preview production build
npm run preview
```

## Loading Extension in Chrome

1. Navigate to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `dist` folder

## TypeScript Configuration

- Target: ES2020
- Module: ESNext with bundler resolution
- Strict mode enabled
- Path alias: `@/*` maps to `src/*`
- JSX: react-jsx

## AI Integration

- Configurable API endpoints (OpenAI-compatible)
- Separate models for extraction vs analysis
- Token management for large comment datasets
- Chunked analysis to handle token limits
