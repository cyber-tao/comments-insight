# E2E Testing for Chrome Extensions

## Overview

E2E testing for Chrome extensions requires special considerations due to the extension's architecture (background scripts, content scripts, popup, etc.).

## Recommended Approach

### Option 1: Playwright with Chrome Extension Support

Playwright supports loading Chrome extensions in headful mode:

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  use: {
    headless: false,
    launchOptions: {
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    },
  },
});
```

### Option 2: Puppeteer with Extension

Similar approach using Puppeteer:

```typescript
const browser = await puppeteer.launch({
  headless: false,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});
```

## Key Test Scenarios

1. **Popup functionality**
   - Settings save/load
   - Navigation to history page
   - Extraction button triggers content script

2. **Content script injection**
   - Script injects on supported pages
   - Comment extraction works correctly
   - Progress updates display properly

3. **Background service worker**
   - Message routing between components
   - History storage operations
   - AI service calls

4. **Options page**
   - API configuration
   - Scraper configuration management

## Installation (when ready)

```bash
npm install -D @playwright/test
npx playwright install chromium
```

## Notes

- Chrome extensions can only be tested in headful mode
- Service worker testing requires special handling
- Consider using `chrome.storage.local.get/set` mocks for isolated tests
